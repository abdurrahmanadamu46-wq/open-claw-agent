from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class EdgeDesiredState:
    edge_id: str
    tenant_id: str
    lobster_configs: dict[str, Any] = field(default_factory=dict)
    skill_versions: dict[str, Any] = field(default_factory=dict)
    max_concurrent_tasks: int = 3
    log_level: str = "INFO"
    feature_flags: dict[str, Any] = field(default_factory=lambda: {"offline_mode": True, "auto_upgrade": True})
    resource_version: int = 1
    updated_at: str = field(default_factory=_utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EdgeActualState:
    edge_id: str
    tenant_id: str
    lobster_configs: dict[str, str] = field(default_factory=dict)
    skill_versions: dict[str, str] = field(default_factory=dict)
    pending_task_count: int = 0
    running_task_count: int = 0
    max_concurrent_tasks: int = 0
    log_level: str = "INFO"
    cpu_usage_pct: float = 0.0
    memory_usage_mb: int = 0
    is_online: bool = True
    meta_cache_status: str = "cold"
    edge_version: str = ""
    reported_resource_version: int = 0
    last_heartbeat_at: str = field(default_factory=_utc_now_iso)
    reported_at: str = field(default_factory=_utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EdgeTwinDiff:
    edge_id: str
    has_diff: bool
    config_diffs: list[dict[str, Any]] = field(default_factory=list)
    skill_diffs: list[dict[str, Any]] = field(default_factory=list)
    param_diffs: dict[str, Any] = field(default_factory=dict)
    computed_at: str = field(default_factory=_utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EdgeTwinManager:
    def __init__(self, db_path: str = "./data/edge_device_twin.sqlite") -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS edge_desired_state (
                    edge_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    lobster_configs_json TEXT NOT NULL DEFAULT '{}',
                    skill_versions_json TEXT NOT NULL DEFAULT '{}',
                    max_concurrent_tasks INTEGER NOT NULL DEFAULT 3,
                    log_level TEXT NOT NULL DEFAULT 'INFO',
                    feature_flags_json TEXT NOT NULL DEFAULT '{}',
                    resource_version INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS edge_actual_state (
                    edge_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    lobster_configs_json TEXT NOT NULL DEFAULT '{}',
                    skill_versions_json TEXT NOT NULL DEFAULT '{}',
                    pending_task_count INTEGER NOT NULL DEFAULT 0,
                    running_task_count INTEGER NOT NULL DEFAULT 0,
                    max_concurrent_tasks INTEGER NOT NULL DEFAULT 0,
                    log_level TEXT NOT NULL DEFAULT 'INFO',
                    cpu_usage_pct REAL NOT NULL DEFAULT 0,
                    memory_usage_mb INTEGER NOT NULL DEFAULT 0,
                    is_online INTEGER NOT NULL DEFAULT 1,
                    meta_cache_status TEXT NOT NULL DEFAULT 'cold',
                    edge_version TEXT NOT NULL DEFAULT '',
                    reported_resource_version INTEGER NOT NULL DEFAULT 0,
                    last_heartbeat_at TEXT NOT NULL,
                    reported_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    def get_desired_state(self, edge_id: str) -> EdgeDesiredState | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM edge_desired_state WHERE edge_id = ?", (edge_id,)).fetchone()
        return self._row_to_desired(row) if row else None

    def get_actual_state(self, edge_id: str) -> EdgeActualState | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM edge_actual_state WHERE edge_id = ?", (edge_id,)).fetchone()
        return self._row_to_actual(row) if row else None

    def ensure_desired_state(self, edge_id: str, tenant_id: str, defaults: dict[str, Any] | None = None) -> EdgeDesiredState:
        existing = self.get_desired_state(edge_id)
        if existing is not None:
            return existing
        payload = EdgeDesiredState(edge_id=edge_id, tenant_id=tenant_id)
        for key, value in (defaults or {}).items():
            if hasattr(payload, key):
                setattr(payload, key, value)
        self._save_desired(payload)
        return payload

    def update_desired_state(self, edge_id: str, tenant_id: str, updates: dict[str, Any]) -> EdgeDesiredState:
        current = self.ensure_desired_state(edge_id, tenant_id)
        for key, value in updates.items():
            if hasattr(current, key):
                setattr(current, key, value)
        current.resource_version += 1
        current.updated_at = _utc_now_iso()
        self._save_desired(current)
        return current

    def update_actual_state(self, actual: EdgeActualState) -> EdgeTwinDiff:
        desired = self.get_desired_state(actual.edge_id)
        if desired is None:
            desired = self.ensure_desired_state(
                actual.edge_id,
                actual.tenant_id,
                defaults={
                    "lobster_configs": {
                        lobster_id: {"version": version}
                        for lobster_id, version in actual.lobster_configs.items()
                    },
                    "skill_versions": {
                        lobster_id: {"version": version}
                        for lobster_id, version in actual.skill_versions.items()
                    },
                    "max_concurrent_tasks": max(actual.max_concurrent_tasks or 0, 1),
                    "log_level": actual.log_level or "INFO",
                },
            )
        self._save_actual(actual)
        return self.compute_diff(actual.edge_id)

    def compute_diff(self, edge_id: str) -> EdgeTwinDiff:
        desired = self.get_desired_state(edge_id)
        actual = self.get_actual_state(edge_id)
        if desired is None or actual is None:
            return EdgeTwinDiff(edge_id=edge_id, has_diff=False)

        config_diffs: list[dict[str, Any]] = []
        for lobster_id, desired_spec in desired.lobster_configs.items():
            desired_version = self._extract_version(desired_spec)
            actual_version = actual.lobster_configs.get(lobster_id)
            if desired_version != actual_version:
                config_diffs.append(
                    {
                        "lobster_id": lobster_id,
                        "desired": desired_version,
                        "actual": actual_version,
                        "config_data": desired_spec.get("config", {}) if isinstance(desired_spec, dict) else {},
                    }
                )

        skill_diffs: list[dict[str, Any]] = []
        for lobster_id, desired_spec in desired.skill_versions.items():
            desired_version = self._extract_version(desired_spec)
            actual_version = actual.skill_versions.get(lobster_id)
            if desired_version != actual_version:
                skill_diffs.append(
                    {
                        "lobster_id": lobster_id,
                        "desired": desired_version,
                        "actual": actual_version,
                        "skills": desired_spec.get("skills", []) if isinstance(desired_spec, dict) else [],
                    }
                )

        param_diffs: dict[str, Any] = {}
        if actual.max_concurrent_tasks != desired.max_concurrent_tasks:
            param_diffs["max_concurrent_tasks"] = desired.max_concurrent_tasks
        if (actual.log_level or "INFO").upper() != (desired.log_level or "INFO").upper():
            param_diffs["log_level"] = desired.log_level
        if desired.feature_flags:
            param_diffs["feature_flags"] = desired.feature_flags

        return EdgeTwinDiff(
            edge_id=edge_id,
            has_diff=bool(config_diffs or skill_diffs or param_diffs or actual.reported_resource_version != desired.resource_version),
            config_diffs=config_diffs,
            skill_diffs=skill_diffs,
            param_diffs=param_diffs,
        )

    def build_sync_payload(self, edge_id: str) -> dict[str, Any] | None:
        desired = self.get_desired_state(edge_id)
        diff = self.compute_diff(edge_id)
        if desired is None or not diff.has_diff:
            return None
        return {
            "type": "twin_sync",
            "edge_id": edge_id,
            "resource_version": desired.resource_version,
            "config_updates": diff.config_diffs,
            "skill_updates": diff.skill_diffs,
            "param_updates": diff.param_diffs,
        }

    def list_overview(self, tenant_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT edge_id FROM edge_desired_state WHERE tenant_id = ? ORDER BY edge_id ASC", (tenant_id,)).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            edge_id = str(row["edge_id"])
            diff = self.compute_diff(edge_id)
            actual = self.get_actual_state(edge_id)
            items.append(
                {
                    "edge_id": edge_id,
                    "is_synced": not diff.has_diff,
                    "pending_config_updates": len(diff.config_diffs),
                    "pending_skill_updates": len(diff.skill_diffs),
                    "meta_cache_status": actual.meta_cache_status if actual else "unknown",
                }
            )
        return items

    def _save_desired(self, state: EdgeDesiredState) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO edge_desired_state(
                    edge_id, tenant_id, lobster_configs_json, skill_versions_json,
                    max_concurrent_tasks, log_level, feature_flags_json, resource_version, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    state.edge_id,
                    state.tenant_id,
                    json.dumps(state.lobster_configs, ensure_ascii=False),
                    json.dumps(state.skill_versions, ensure_ascii=False),
                    state.max_concurrent_tasks,
                    state.log_level,
                    json.dumps(state.feature_flags, ensure_ascii=False),
                    state.resource_version,
                    state.updated_at,
                ),
            )
            conn.commit()

    def _save_actual(self, state: EdgeActualState) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO edge_actual_state(
                    edge_id, tenant_id, lobster_configs_json, skill_versions_json,
                    pending_task_count, running_task_count, max_concurrent_tasks, log_level,
                    cpu_usage_pct, memory_usage_mb, is_online, meta_cache_status, edge_version,
                    reported_resource_version, last_heartbeat_at, reported_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    state.edge_id,
                    state.tenant_id,
                    json.dumps(state.lobster_configs, ensure_ascii=False),
                    json.dumps(state.skill_versions, ensure_ascii=False),
                    state.pending_task_count,
                    state.running_task_count,
                    state.max_concurrent_tasks,
                    state.log_level,
                    state.cpu_usage_pct,
                    state.memory_usage_mb,
                    1 if state.is_online else 0,
                    state.meta_cache_status,
                    state.edge_version,
                    state.reported_resource_version,
                    state.last_heartbeat_at,
                    state.reported_at,
                ),
            )
            conn.commit()

    def _row_to_desired(self, row: sqlite3.Row) -> EdgeDesiredState:
        return EdgeDesiredState(
            edge_id=str(row["edge_id"]),
            tenant_id=str(row["tenant_id"]),
            lobster_configs=json.loads(str(row["lobster_configs_json"] or "{}")),
            skill_versions=json.loads(str(row["skill_versions_json"] or "{}")),
            max_concurrent_tasks=int(row["max_concurrent_tasks"] or 3),
            log_level=str(row["log_level"] or "INFO"),
            feature_flags=json.loads(str(row["feature_flags_json"] or "{}")),
            resource_version=int(row["resource_version"] or 1),
            updated_at=str(row["updated_at"]),
        )

    def _row_to_actual(self, row: sqlite3.Row) -> EdgeActualState:
        return EdgeActualState(
            edge_id=str(row["edge_id"]),
            tenant_id=str(row["tenant_id"]),
            lobster_configs=json.loads(str(row["lobster_configs_json"] or "{}")),
            skill_versions=json.loads(str(row["skill_versions_json"] or "{}")),
            pending_task_count=int(row["pending_task_count"] or 0),
            running_task_count=int(row["running_task_count"] or 0),
            max_concurrent_tasks=int(row["max_concurrent_tasks"] or 0),
            log_level=str(row["log_level"] or "INFO"),
            cpu_usage_pct=float(row["cpu_usage_pct"] or 0.0),
            memory_usage_mb=int(row["memory_usage_mb"] or 0),
            is_online=bool(row["is_online"]),
            meta_cache_status=str(row["meta_cache_status"] or "cold"),
            edge_version=str(row["edge_version"] or ""),
            reported_resource_version=int(row["reported_resource_version"] or 0),
            last_heartbeat_at=str(row["last_heartbeat_at"]),
            reported_at=str(row["reported_at"]),
        )

    @staticmethod
    def _extract_version(spec: Any) -> str | None:
        if isinstance(spec, dict):
            return str(spec.get("version") or "").strip() or None
        raw = str(spec or "").strip()
        return raw or None


_manager: EdgeTwinManager | None = None


def get_edge_twin_manager() -> EdgeTwinManager:
    global _manager
    if _manager is None:
        _manager = EdgeTwinManager()
    return _manager
