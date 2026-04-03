from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from edge_telemetry_store import get_edge_telemetry_store
from heartbeat_engine import get_active_checker
from lobster_pool_manager import _get_db as lobster_pool_db_connect  # type: ignore[attr-defined]
from notification_center import send_notification


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("ALERT_ENGINE_DB_PATH", "./data/alert_engine.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class AlertSeverity(str, Enum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class AlertState(str, Enum):
    NORMAL = "normal"
    PENDING = "pending"
    FIRING = "firing"
    SILENCED = "silenced"


@dataclass
class AlertRule:
    rule_id: str
    name: str
    description: str
    metric: str
    aggregation: str
    condition: str
    threshold: float
    window_seconds: int
    pending_seconds: int
    silence_seconds: int
    severity: AlertSeverity
    lobster_filter: str | None = None
    tenant_filter: str | None = None
    edge_node_filter: str | None = None
    notification_channel_ids: list[str] = field(default_factory=list)
    state: AlertState = AlertState.NORMAL
    pending_since: str | None = None
    last_fired_at: str | None = None
    last_resolved_at: str | None = None
    enabled: bool = True
    tenant_id: str | None = None
    created_by: str = "system"

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["severity"] = self.severity.value
        payload["state"] = self.state.value
        return payload


@dataclass
class NotificationChannel:
    channel_id: str
    name: str
    channel_type: str
    config: dict[str, Any]
    severity_filter: str = "all"
    enabled: bool = True
    tenant_id: str | None = None


@dataclass
class AlertFiringEvent:
    event_id: str
    rule_id: str
    rule_name: str
    state: str
    severity: str
    message: str
    current_value: float
    threshold: float
    fired_at: str
    resolved_at: str | None = None
    tenant_id: str | None = None
    lobster_id: str | None = None


DEFAULT_RULES = [
    AlertRule("default_quality_warning", "龙虾质量分过低", "30分钟平均质量分低于7.0", "quality_score", "avg", "<", 7.0, 1800, 300, 1800, AlertSeverity.WARNING, notification_channel_ids=["platform_default"]),
    AlertRule("default_quality_critical", "龙虾质量分严重过低", "30分钟平均质量分低于6.0", "quality_score", "avg", "<", 6.0, 1800, 60, 900, AlertSeverity.CRITICAL, notification_channel_ids=["platform_default"]),
    AlertRule("default_error_rate", "执行错误率过高", "最近30分钟错误率超过10%", "error_rate", "avg", ">", 10.0, 1800, 120, 1800, AlertSeverity.WARNING, notification_channel_ids=["platform_default"]),
    AlertRule("default_edge_offline", "边缘节点离线", "最近心跳巡检发现边缘离线问题", "edge_offline_count", "count", ">", 0.0, 600, 0, 600, AlertSeverity.CRITICAL, notification_channel_ids=["platform_default"]),
]


class AlertStore:
    def __init__(self) -> None:
        self._ensure_schema()
        self._seed_defaults()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(_db_path()))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS alert_rules (
                    rule_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    metric TEXT NOT NULL,
                    aggregation TEXT NOT NULL,
                    condition_op TEXT NOT NULL,
                    threshold REAL NOT NULL,
                    window_seconds INTEGER NOT NULL,
                    pending_seconds INTEGER NOT NULL,
                    silence_seconds INTEGER NOT NULL,
                    severity TEXT NOT NULL,
                    lobster_filter TEXT,
                    tenant_filter TEXT,
                    edge_node_filter TEXT,
                    notification_channel_ids_json TEXT NOT NULL DEFAULT '[]',
                    state TEXT NOT NULL DEFAULT 'normal',
                    pending_since TEXT,
                    last_fired_at TEXT,
                    last_resolved_at TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    tenant_id TEXT,
                    created_by TEXT NOT NULL DEFAULT 'system',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS notification_channels (
                    channel_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    channel_type TEXT NOT NULL,
                    config_json TEXT NOT NULL DEFAULT '{}',
                    severity_filter TEXT NOT NULL DEFAULT 'all',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    tenant_id TEXT,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS alert_events (
                    event_id TEXT PRIMARY KEY,
                    rule_id TEXT NOT NULL,
                    rule_name TEXT NOT NULL,
                    state TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    current_value REAL NOT NULL,
                    threshold REAL NOT NULL,
                    fired_at TEXT NOT NULL,
                    resolved_at TEXT,
                    tenant_id TEXT,
                    lobster_id TEXT
                );
                """
            )
            conn.commit()

    def _seed_defaults(self) -> None:
        with self._connect() as conn:
            total = int((conn.execute("SELECT COUNT(*) AS total FROM notification_channels").fetchone() or {"total": 0})["total"])
            if total == 0:
                conn.execute(
                    "INSERT INTO notification_channels(channel_id, name, channel_type, config_json, severity_filter, enabled, tenant_id, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    ("platform_default", "平台默认通知", "notification_center", "{}", "all", 1, None, _utc_now()),
                )
            for rule in DEFAULT_RULES:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO alert_rules(
                        rule_id,name,description,metric,aggregation,condition_op,threshold,window_seconds,pending_seconds,silence_seconds,severity,
                        lobster_filter,tenant_filter,edge_node_filter,notification_channel_ids_json,state,pending_since,last_fired_at,last_resolved_at,
                        enabled,tenant_id,created_by,updated_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        rule.rule_id, rule.name, rule.description, rule.metric, rule.aggregation, rule.condition, rule.threshold,
                        rule.window_seconds, rule.pending_seconds, rule.silence_seconds, rule.severity.value,
                        rule.lobster_filter, rule.tenant_filter, rule.edge_node_filter, json.dumps(rule.notification_channel_ids, ensure_ascii=False),
                        rule.state.value, rule.pending_since, rule.last_fired_at, rule.last_resolved_at, 1 if rule.enabled else 0,
                        rule.tenant_id, rule.created_by, _utc_now(),
                    ),
                )
            conn.commit()

    def _row_to_rule(self, row: dict[str, Any]) -> AlertRule:
        return AlertRule(
            rule_id=str(row["rule_id"]),
            name=str(row["name"]),
            description=str(row["description"]),
            metric=str(row["metric"]),
            aggregation=str(row["aggregation"]),
            condition=str(row["condition_op"]),
            threshold=float(row["threshold"]),
            window_seconds=int(row["window_seconds"]),
            pending_seconds=int(row["pending_seconds"]),
            silence_seconds=int(row["silence_seconds"]),
            severity=AlertSeverity(str(row["severity"])),
            lobster_filter=row.get("lobster_filter"),
            tenant_filter=row.get("tenant_filter"),
            edge_node_filter=row.get("edge_node_filter"),
            notification_channel_ids=json.loads(str(row.get("notification_channel_ids_json") or "[]")),
            state=AlertState(str(row["state"])),
            pending_since=row.get("pending_since"),
            last_fired_at=row.get("last_fired_at"),
            last_resolved_at=row.get("last_resolved_at"),
            enabled=bool(row.get("enabled", 1)),
            tenant_id=row.get("tenant_id"),
            created_by=str(row.get("created_by") or "system"),
        )

    def list_rules(self, tenant_id: str | None = None) -> list[AlertRule]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM alert_rules WHERE tenant_id IS NULL OR tenant_id = ? ORDER BY name ASC", (tenant_id,)).fetchall()
        return [self._row_to_rule(dict(row)) for row in rows]

    def get_rule(self, rule_id: str) -> AlertRule | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM alert_rules WHERE rule_id = ?", (rule_id,)).fetchone()
        return self._row_to_rule(dict(row)) if row else None

    def upsert_rule(self, rule: AlertRule) -> AlertRule:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO alert_rules(rule_id,name,description,metric,aggregation,condition_op,threshold,window_seconds,pending_seconds,silence_seconds,severity,lobster_filter,tenant_filter,edge_node_filter,notification_channel_ids_json,state,pending_since,last_fired_at,last_resolved_at,enabled,tenant_id,created_by,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(rule_id) DO UPDATE SET
                    name=excluded.name,description=excluded.description,metric=excluded.metric,aggregation=excluded.aggregation,
                    condition_op=excluded.condition_op,threshold=excluded.threshold,window_seconds=excluded.window_seconds,
                    pending_seconds=excluded.pending_seconds,silence_seconds=excluded.silence_seconds,severity=excluded.severity,
                    lobster_filter=excluded.lobster_filter,tenant_filter=excluded.tenant_filter,edge_node_filter=excluded.edge_node_filter,
                    notification_channel_ids_json=excluded.notification_channel_ids_json,state=excluded.state,pending_since=excluded.pending_since,
                    last_fired_at=excluded.last_fired_at,last_resolved_at=excluded.last_resolved_at,enabled=excluded.enabled,tenant_id=excluded.tenant_id,
                    created_by=excluded.created_by,updated_at=excluded.updated_at
                """,
                (
                    rule.rule_id, rule.name, rule.description, rule.metric, rule.aggregation, rule.condition, rule.threshold,
                    rule.window_seconds, rule.pending_seconds, rule.silence_seconds, rule.severity.value,
                    rule.lobster_filter, rule.tenant_filter, rule.edge_node_filter, json.dumps(rule.notification_channel_ids, ensure_ascii=False),
                    rule.state.value, rule.pending_since, rule.last_fired_at, rule.last_resolved_at, 1 if rule.enabled else 0,
                    rule.tenant_id, rule.created_by, _utc_now(),
                ),
            )
            conn.commit()
        return rule

    def list_channels(self, tenant_id: str | None = None) -> list[NotificationChannel]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM notification_channels WHERE tenant_id IS NULL OR tenant_id = ? ORDER BY name ASC", (tenant_id,)).fetchall()
        result: list[NotificationChannel] = []
        for row in rows:
            payload = dict(row)
            result.append(NotificationChannel(
                channel_id=str(payload["channel_id"]),
                name=str(payload["name"]),
                channel_type=str(payload["channel_type"]),
                config=json.loads(str(payload.get("config_json") or "{}")),
                severity_filter=str(payload.get("severity_filter") or "all"),
                enabled=bool(payload.get("enabled", 1)),
                tenant_id=payload.get("tenant_id"),
            ))
        return result

    def upsert_channel(self, channel: NotificationChannel) -> NotificationChannel:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO notification_channels(channel_id,name,channel_type,config_json,severity_filter,enabled,tenant_id,updated_at)
                VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(channel_id) DO UPDATE SET
                    name=excluded.name,channel_type=excluded.channel_type,config_json=excluded.config_json,
                    severity_filter=excluded.severity_filter,enabled=excluded.enabled,tenant_id=excluded.tenant_id,updated_at=excluded.updated_at
                """,
                (channel.channel_id, channel.name, channel.channel_type, json.dumps(channel.config, ensure_ascii=False), channel.severity_filter, 1 if channel.enabled else 0, channel.tenant_id, _utc_now()),
            )
            conn.commit()
        return channel

    def add_event(self, event: AlertFiringEvent) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO alert_events(event_id,rule_id,rule_name,state,severity,message,current_value,threshold,fired_at,resolved_at,tenant_id,lobster_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (event.event_id, event.rule_id, event.rule_name, event.state, event.severity, event.message, event.current_value, event.threshold, event.fired_at, event.resolved_at, event.tenant_id, event.lobster_id),
            )
            conn.commit()

    def list_events(self, tenant_id: str | None = None, limit: int = 100) -> list[AlertFiringEvent]:
        query = "SELECT * FROM alert_events"
        params: list[Any] = []
        if tenant_id:
            query += " WHERE tenant_id IS NULL OR tenant_id = ?"
            params.append(tenant_id)
        query += " ORDER BY fired_at DESC LIMIT ?"
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [AlertFiringEvent(**dict(row)) for row in rows]


class MetricsCalculator:
    def calculate(self, *, metric: str, aggregation: str, window_seconds: int, lobster_filter: str | None, tenant_filter: str | None, edge_node_filter: str | None = None) -> float:
        tenant_id = tenant_filter or "tenant_main"
        since_iso = (datetime.now(timezone.utc) - timedelta(seconds=window_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")
        if metric == "quality_score":
            return self._quality_score(tenant_id, since_iso, aggregation, lobster_filter)
        if metric == "error_rate":
            return self._error_rate(tenant_id, since_iso, lobster_filter)
        if metric == "run_count":
            return self._run_count(tenant_id, since_iso, lobster_filter)
        if metric == "duration_ms":
            return self._duration_ms(tenant_id, since_iso, aggregation, lobster_filter)
        if metric == "edge_offline_count":
            return self._edge_offline_count(tenant_id)
        if metric == "edge_error_count":
            return self._edge_error_count(tenant_id, lobster_filter)
        return 0.0

    def _query_values(self, sql: str, params: list[Any]) -> list[sqlite3.Row]:
        conn = lobster_pool_db_connect()
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    def _quality_score(self, tenant_id: str, since_iso: str, aggregation: str, lobster_id: str | None) -> float:
        query = "SELECT score FROM lobster_run_log WHERE tenant_id = ? AND created_at >= ? AND score IS NOT NULL"
        params: list[Any] = [tenant_id, since_iso]
        if lobster_id:
            query += " AND lobster_id = ?"
            params.append(lobster_id)
        scores = [float(row["score"]) for row in self._query_values(query, params) if row["score"] is not None]
        if not scores:
            return 10.0
        ordered = sorted(scores)
        if aggregation == "p90":
            return ordered[max(0, min(len(ordered) - 1, int(len(ordered) * 0.9)))]
        if aggregation == "p99":
            return ordered[max(0, min(len(ordered) - 1, int(len(ordered) * 0.99)))]
        return sum(scores) / len(scores)

    def _error_rate(self, tenant_id: str, since_iso: str, lobster_id: str | None) -> float:
        query = "SELECT status FROM lobster_run_log WHERE tenant_id = ? AND created_at >= ?"
        params: list[Any] = [tenant_id, since_iso]
        if lobster_id:
            query += " AND lobster_id = ?"
            params.append(lobster_id)
        rows = self._query_values(query, params)
        total = len(rows)
        if total == 0:
            return 0.0
        errors = sum(1 for row in rows if str(row["status"]) != "success")
        return (errors / total) * 100.0

    def _run_count(self, tenant_id: str, since_iso: str, lobster_id: str | None) -> float:
        query = "SELECT COUNT(*) AS total FROM lobster_run_log WHERE tenant_id = ? AND created_at >= ?"
        params: list[Any] = [tenant_id, since_iso]
        if lobster_id:
            query += " AND lobster_id = ?"
            params.append(lobster_id)
        rows = self._query_values(query, params)
        return float(rows[0]["total"] or 0) if rows else 0.0

    def _duration_ms(self, tenant_id: str, since_iso: str, aggregation: str, lobster_id: str | None) -> float:
        query = "SELECT duration_ms FROM lobster_run_log WHERE tenant_id = ? AND created_at >= ?"
        params: list[Any] = [tenant_id, since_iso]
        if lobster_id:
            query += " AND lobster_id = ?"
            params.append(lobster_id)
        values = [float(row["duration_ms"]) for row in self._query_values(query, params) if row["duration_ms"] is not None]
        if not values:
            return 0.0
        ordered = sorted(values)
        if aggregation == "p90":
            return ordered[max(0, min(len(ordered) - 1, int(len(ordered) * 0.9)))]
        if aggregation == "p99":
            return ordered[max(0, min(len(ordered) - 1, int(len(ordered) * 0.99)))]
        return sum(values) / len(values)

    def _edge_offline_count(self, tenant_id: str) -> float:
        report = get_active_checker(tenant_id).last_report() or {}
        issues = report.get("issues") if isinstance(report.get("issues"), list) else []
        return float(sum(1 for item in issues if item.get("check") == "edge_offline"))

    def _edge_error_count(self, tenant_id: str, lobster_id: str | None) -> float:
        items = get_edge_telemetry_store().latest_run_results(tenant_id=tenant_id, limit=200)
        filtered = [item for item in items if not lobster_id or str(item.get("lobster_id")) == lobster_id]
        return float(sum(1 for item in filtered if str(item.get("status") or "") not in {"success", "published", "scheduled"}))


class NotificationDispatcher:
    def __init__(self, store: AlertStore) -> None:
        self.store = store

    async def dispatch(self, rule: AlertRule, message: str) -> None:
        channels = [item for item in self.store.list_channels(rule.tenant_id) if item.channel_id in set(rule.notification_channel_ids)]
        for channel in channels:
            if channel.enabled and channel.severity_filter in {"all", rule.severity.value}:
                await send_notification(tenant_id=channel.tenant_id or "tenant_main", message=f"[{rule.severity.value.upper()}] {message}", level="warning", category="alert")

    async def dispatch_resolved(self, rule: AlertRule, message: str) -> None:
        channels = [item for item in self.store.list_channels(rule.tenant_id) if item.channel_id in set(rule.notification_channel_ids)]
        for channel in channels:
            if channel.enabled:
                await send_notification(tenant_id=channel.tenant_id or "tenant_main", message=message, level="info", category="alert")


class AlertEngine:
    def __init__(self, store: AlertStore | None = None) -> None:
        self.store = store or AlertStore()
        self.metrics = MetricsCalculator()
        self.notifier = NotificationDispatcher(self.store)
        self.eval_interval = max(30, int(os.getenv("ALERT_ENGINE_INTERVAL_SEC", "60") or 60))
        self._running = False
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._loop(), name="alert-engine")

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _loop(self) -> None:
        while self._running:
            try:
                await self.evaluate_all()
            except Exception:
                pass
            await asyncio.sleep(self.eval_interval)

    async def evaluate_all(self) -> list[AlertFiringEvent]:
        results: list[AlertFiringEvent] = []
        for rule in self.store.list_rules():
            if not rule.enabled:
                continue
            event = await self._evaluate_rule(rule)
            if event:
                results.append(event)
        return results

    async def _evaluate_rule(self, rule: AlertRule) -> AlertFiringEvent | None:
        current = self.metrics.calculate(metric=rule.metric, aggregation=rule.aggregation, window_seconds=rule.window_seconds, lobster_filter=rule.lobster_filter, tenant_filter=rule.tenant_filter or rule.tenant_id, edge_node_filter=rule.edge_node_filter)
        breached = self._check_threshold(current, rule.condition, rule.threshold)
        now = datetime.now(timezone.utc)
        pending_since = datetime.fromisoformat(rule.pending_since) if rule.pending_since else None
        last_fired = datetime.fromisoformat(rule.last_fired_at) if rule.last_fired_at else None

        if rule.state == AlertState.NORMAL and breached:
            rule.state = AlertState.PENDING
            rule.pending_since = now.isoformat()
            self.store.upsert_rule(rule)
            return None
        if rule.state == AlertState.PENDING:
            if not breached:
                rule.state = AlertState.NORMAL
                rule.pending_since = None
                self.store.upsert_rule(rule)
                return None
            if pending_since and (now - pending_since).total_seconds() >= rule.pending_seconds:
                rule.state = AlertState.FIRING
                rule.pending_since = None
                rule.last_fired_at = now.isoformat()
                self.store.upsert_rule(rule)
                event = self._make_event(rule, current, AlertState.FIRING.value, now.isoformat())
                self.store.add_event(event)
                await self.notifier.dispatch(rule, event.message)
                return event
            self.store.upsert_rule(rule)
            return None
        if rule.state == AlertState.FIRING:
            if not breached:
                rule.state = AlertState.NORMAL
                rule.last_resolved_at = now.isoformat()
                self.store.upsert_rule(rule)
                event = self._make_event(rule, current, AlertState.NORMAL.value, rule.last_fired_at or now.isoformat(), resolved_at=now.isoformat(), resolved=True)
                self.store.add_event(event)
                await self.notifier.dispatch_resolved(rule, event.message)
                return event
            if last_fired and rule.silence_seconds > 0 and (now - last_fired).total_seconds() < rule.silence_seconds:
                return None
            rule.last_fired_at = now.isoformat()
            self.store.upsert_rule(rule)
            event = self._make_event(rule, current, AlertState.FIRING.value, now.isoformat())
            self.store.add_event(event)
            await self.notifier.dispatch(rule, event.message)
            return event
        return None

    def _make_event(self, rule: AlertRule, current: float, state: str, fired_at: str, resolved_at: str | None = None, resolved: bool = False) -> AlertFiringEvent:
        prefix = "✓" if resolved else "⚠"
        message = f"{prefix} [{rule.severity.value.upper()}] {rule.name} {'已恢复' if resolved else '超阈值'}：当前值 {current:.2f}，阈值 {rule.condition} {rule.threshold}"
        return AlertFiringEvent(
            event_id=f"alr_{uuid.uuid4().hex[:12]}",
            rule_id=rule.rule_id,
            rule_name=rule.name,
            state=state,
            severity=rule.severity.value,
            message=message,
            current_value=current,
            threshold=rule.threshold,
            fired_at=fired_at,
            resolved_at=resolved_at,
            tenant_id=rule.tenant_id,
            lobster_id=rule.lobster_filter,
        )

    @staticmethod
    def _check_threshold(value: float, condition: str, threshold: float) -> bool:
        if condition == "<":
            return value < threshold
        if condition == "<=":
            return value <= threshold
        if condition == ">=":
            return value >= threshold
        if condition == "==":
            return value == threshold
        return value > threshold


_engine: AlertEngine | None = None


def get_alert_engine() -> AlertEngine:
    global _engine
    if _engine is None:
        _engine = AlertEngine()
    return _engine
