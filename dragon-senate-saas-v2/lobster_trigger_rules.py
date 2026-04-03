"""
When/If/Then trigger rules for lobsters.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
import uuid
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any
from typing import Awaitable
from typing import Callable


RULES_DB_PATH = Path(os.getenv("LOBSTER_TRIGGER_RULES_DB", "./data/lobster_trigger_rules.sqlite"))
LLM_LOG_DB_PATH = Path(os.getenv("LLM_CALL_LOGGER_DB", "./data/llm_call_log.sqlite"))


@dataclass(slots=True)
class RuleCondition:
    metric: str
    op: str
    value: Any
    lobster_name: str = ""


@dataclass(slots=True)
class RuleAction:
    action_type: str
    lobster_name: str = ""
    message: str = ""
    tenant_id: str = ""
    alert_level: str = "warn"


@dataclass(slots=True)
class LobsterTriggerRule:
    rule_id: str
    tenant_id: str
    name: str
    conditions: list[RuleCondition]
    action: RuleAction
    condition_logic: str = "AND"
    is_active: bool = True
    cooldown_seconds: int = 300
    created_at: float = field(default_factory=time.time)
    last_triggered_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["conditions"] = [asdict(item) for item in self.conditions]
        payload["action"] = asdict(self.action)
        return payload


def evaluate_condition(cond: RuleCondition, value: float) -> bool:
    operations = {
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
        ">": lambda a, b: a > b,
        "<": lambda a, b: a < b,
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
    }
    fn = operations.get(cond.op)
    return fn(float(value), float(cond.value)) if fn else False


class MetricCollector:
    def __init__(self, log_db_path: Path = LLM_LOG_DB_PATH) -> None:
        self._log_db_path = log_db_path

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._log_db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_metric(self, metric: str, lobster_name: str, tenant_id: str) -> float:
        now = time.time()
        hour_ago = now - 3600
        day_start = int(now // 86400) * 86400
        conn = self._conn()
        try:
            if metric == "task_fail_count":
                row = conn.execute(
                    """
                    SELECT COUNT(*) AS cnt FROM llm_call_logs
                    WHERE tenant_id=? AND lobster_name=? AND is_error=1 AND timestamp>=?
                    """,
                    (tenant_id, lobster_name, hour_ago),
                ).fetchone()
                return float(row["cnt"] or 0) if row else 0.0

            if metric == "daily_task_count":
                row = conn.execute(
                    """
                    SELECT COUNT(*) AS cnt FROM llm_call_logs
                    WHERE tenant_id=? AND timestamp>=?
                    """,
                    (tenant_id, day_start),
                ).fetchone()
                return float(row["cnt"] or 0) if row else 0.0

            if metric == "error_rate":
                row = conn.execute(
                    """
                    SELECT COUNT(*) AS total, SUM(CASE WHEN is_error=1 THEN 1 ELSE 0 END) AS errors
                    FROM llm_call_logs
                    WHERE tenant_id=? AND lobster_name=? AND timestamp>=?
                    """,
                    (tenant_id, lobster_name, hour_ago),
                ).fetchone()
                total = float(row["total"] or 0) if row else 0.0
                errors = float(row["errors"] or 0) if row else 0.0
                return (errors / total) if total > 0 else 0.0
        finally:
            conn.close()
        return 0.0


class LobsterTriggerRuleStore:
    def __init__(self, db_path: Path = RULES_DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS lobster_trigger_rules (
                    rule_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    conditions_json TEXT NOT NULL DEFAULT '[]',
                    action_json TEXT NOT NULL DEFAULT '{}',
                    condition_logic TEXT NOT NULL DEFAULT 'AND',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    cooldown_seconds INTEGER NOT NULL DEFAULT 300,
                    created_at REAL NOT NULL,
                    last_triggered_at REAL NOT NULL DEFAULT 0
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

    def list_rules(self, tenant_id: str) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM lobster_trigger_rules WHERE tenant_id=? ORDER BY created_at DESC",
                (tenant_id,),
            ).fetchall()
            return [self._deserialize(row).to_dict() for row in rows]
        finally:
            conn.close()

    def upsert_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        rule_id = str(payload.get("rule_id") or f"ltr_{uuid.uuid4().hex[:12]}")
        tenant_id = str(payload.get("tenant_id") or "tenant_main")
        conditions = [
            RuleCondition(**item)
            for item in (payload.get("conditions") or [])
            if isinstance(item, dict)
        ]
        action = RuleAction(**dict(payload.get("action") or {}))
        rule = LobsterTriggerRule(
            rule_id=rule_id,
            tenant_id=tenant_id,
            name=str(payload.get("name") or rule_id),
            conditions=conditions,
            action=action,
            condition_logic=str(payload.get("condition_logic") or "AND").upper(),
            is_active=bool(payload.get("is_active", True)),
            cooldown_seconds=int(payload.get("cooldown_seconds") or 300),
            created_at=float(payload.get("created_at") or time.time()),
            last_triggered_at=float(payload.get("last_triggered_at") or 0.0),
        )
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO lobster_trigger_rules (
                    rule_id, tenant_id, name, conditions_json, action_json, condition_logic,
                    is_active, cooldown_seconds, created_at, last_triggered_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(rule_id) DO UPDATE SET
                    tenant_id=excluded.tenant_id,
                    name=excluded.name,
                    conditions_json=excluded.conditions_json,
                    action_json=excluded.action_json,
                    condition_logic=excluded.condition_logic,
                    is_active=excluded.is_active,
                    cooldown_seconds=excluded.cooldown_seconds,
                    last_triggered_at=excluded.last_triggered_at
                """,
                (
                    rule.rule_id,
                    rule.tenant_id,
                    rule.name,
                    json.dumps([asdict(item) for item in rule.conditions], ensure_ascii=False),
                    json.dumps(asdict(rule.action), ensure_ascii=False),
                    rule.condition_logic,
                    1 if rule.is_active else 0,
                    rule.cooldown_seconds,
                    rule.created_at,
                    rule.last_triggered_at,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return rule.to_dict()

    def delete_rule(self, rule_id: str, tenant_id: str) -> bool:
        conn = self._conn()
        try:
            conn.execute(
                "DELETE FROM lobster_trigger_rules WHERE rule_id=? AND tenant_id=?",
                (rule_id, tenant_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def active_rules(self) -> list[LobsterTriggerRule]:
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT * FROM lobster_trigger_rules WHERE is_active=1 ORDER BY created_at DESC"
            ).fetchall()
            return [self._deserialize(row) for row in rows]
        finally:
            conn.close()

    def touch_triggered(self, rule_id: str, ts: float) -> None:
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE lobster_trigger_rules SET last_triggered_at=? WHERE rule_id=?",
                (ts, rule_id),
            )
            conn.commit()
        finally:
            conn.close()

    def _deserialize(self, row: sqlite3.Row) -> LobsterTriggerRule:
        conditions = [RuleCondition(**item) for item in json.loads(row["conditions_json"] or "[]")]
        action = RuleAction(**json.loads(row["action_json"] or "{}"))
        return LobsterTriggerRule(
            rule_id=row["rule_id"],
            tenant_id=row["tenant_id"],
            name=row["name"],
            conditions=conditions,
            action=action,
            condition_logic=row["condition_logic"],
            is_active=bool(row["is_active"]),
            cooldown_seconds=int(row["cooldown_seconds"] or 300),
            created_at=float(row["created_at"] or time.time()),
            last_triggered_at=float(row["last_triggered_at"] or 0.0),
        )


class LobsterTriggerEngine:
    def __init__(
        self,
        *,
        action_runner: Callable[[LobsterTriggerRule], Awaitable[None]] | None = None,
        store: LobsterTriggerRuleStore | None = None,
        eval_interval: int = 60,
    ) -> None:
        self._store = store or LobsterTriggerRuleStore()
        self._collector = MetricCollector()
        self._action_runner = action_runner
        self._eval_interval = max(10, int(eval_interval))
        self._task: asyncio.Task[None] | None = None
        self._running = False

    async def evaluate_once(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        now = time.time()
        for rule in self._store.active_rules():
            if now - rule.last_triggered_at < rule.cooldown_seconds:
                continue
            matched = self._check_conditions(rule)
            results.append({"rule_id": rule.rule_id, "name": rule.name, "matched": matched})
            if matched:
                await self._execute_action(rule)
                self._store.touch_triggered(rule.rule_id, now)
        return results

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self.run_loop(), name="lobster-trigger-engine")

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def run_loop(self) -> None:
        while self._running:
            try:
                await self.evaluate_once()
            except Exception:
                pass
            await asyncio.sleep(self._eval_interval)

    def _check_conditions(self, rule: LobsterTriggerRule) -> bool:
        results: list[bool] = []
        for condition in rule.conditions:
            value = self._collector.get_metric(condition.metric, condition.lobster_name, rule.tenant_id)
            results.append(evaluate_condition(condition, value))
        return all(results) if rule.condition_logic == "AND" else any(results)

    async def _execute_action(self, rule: LobsterTriggerRule) -> None:
        if self._action_runner is not None:
            await self._action_runner(rule)


_default_store: LobsterTriggerRuleStore | None = None
_default_engine: LobsterTriggerEngine | None = None


def get_lobster_trigger_rule_store() -> LobsterTriggerRuleStore:
    global _default_store
    if _default_store is None:
        _default_store = LobsterTriggerRuleStore()
    return _default_store


def get_lobster_trigger_engine(
    *,
    action_runner: Callable[[LobsterTriggerRule], Awaitable[None]] | None = None,
    eval_interval: int = 60,
) -> LobsterTriggerEngine:
    global _default_engine
    if _default_engine is None:
        _default_engine = LobsterTriggerEngine(
            action_runner=action_runner,
            store=get_lobster_trigger_rule_store(),
            eval_interval=eval_interval,
        )
    return _default_engine
