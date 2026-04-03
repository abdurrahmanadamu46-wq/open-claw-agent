from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


def _default_cache_path() -> Path:
    root = Path(os.getenv("EDGE_CACHE_DIR", "~/.openclaw/cache")).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root / "meta_cache.db"


@dataclass
class CachedLobsterConfig:
    lobster_id: str
    config_version: str
    config_json: str
    synced_at: float
    is_valid: bool = True


@dataclass
class CachedPendingTask:
    task_id: str
    workflow_id: str
    step_id: str
    lobster_id: str
    skill_name: str
    payload_json: str
    priority: int = 5
    received_at: float = field(default_factory=time.time)
    status: str = "pending"
    result_json: str | None = None
    completed_at: float | None = None
    cloud_synced: bool = False


@dataclass
class CachedSkillRegistry:
    lobster_id: str
    registry_version: str
    skills_json: str
    synced_at: float


class EdgeMetaCache:
    """Offline-first edge metadata cache inspired by KubeEdge MetaManager."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or _default_cache_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS lobster_configs (
                    lobster_id TEXT PRIMARY KEY,
                    config_version TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    synced_at REAL NOT NULL,
                    is_valid INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS pending_tasks (
                    task_id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    skill_name TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 5,
                    received_at REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    result_json TEXT,
                    completed_at REAL,
                    cloud_synced INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_pending_tasks_status
                    ON pending_tasks(status, priority DESC, received_at ASC);
                CREATE INDEX IF NOT EXISTS idx_pending_tasks_sync
                    ON pending_tasks(cloud_synced, completed_at ASC);

                CREATE TABLE IF NOT EXISTS skill_registry (
                    lobster_id TEXT PRIMARY KEY,
                    registry_version TEXT NOT NULL,
                    skills_json TEXT NOT NULL,
                    synced_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sync_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                """
            )
            conn.commit()

    def save_lobster_config(self, cfg: CachedLobsterConfig) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO lobster_configs(lobster_id, config_version, config_json, synced_at, is_valid)
                VALUES (:lobster_id, :config_version, :config_json, :synced_at, :is_valid)
                """,
                {**asdict(cfg), "is_valid": 1 if cfg.is_valid else 0},
            )
            conn.commit()

    def get_lobster_config(self, lobster_id: str) -> CachedLobsterConfig | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM lobster_configs WHERE lobster_id = ? AND is_valid = 1",
                (lobster_id,),
            ).fetchone()
        return CachedLobsterConfig(**dict(row)) if row else None

    def get_all_config_versions(self) -> dict[str, str]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT lobster_id, config_version FROM lobster_configs WHERE is_valid = 1"
            ).fetchall()
        return {str(row["lobster_id"]): str(row["config_version"]) for row in rows}

    def get_all_lobster_configs(self) -> list[CachedLobsterConfig]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM lobster_configs WHERE is_valid = 1 ORDER BY lobster_id ASC").fetchall()
        return [CachedLobsterConfig(**dict(row)) for row in rows]

    def save_skill_registry(self, reg: CachedSkillRegistry) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO skill_registry(lobster_id, registry_version, skills_json, synced_at)
                VALUES (:lobster_id, :registry_version, :skills_json, :synced_at)
                """,
                asdict(reg),
            )
            conn.commit()

    def get_skill_registry(self, lobster_id: str) -> CachedSkillRegistry | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM skill_registry WHERE lobster_id = ?", (lobster_id,)).fetchone()
        return CachedSkillRegistry(**dict(row)) if row else None

    def get_all_skill_versions(self) -> dict[str, str]:
        with self._conn() as conn:
            rows = conn.execute("SELECT lobster_id, registry_version FROM skill_registry").fetchall()
        return {str(row["lobster_id"]): str(row["registry_version"]) for row in rows}

    def enqueue_task(self, task: CachedPendingTask) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO pending_tasks(
                    task_id, workflow_id, step_id, lobster_id, skill_name,
                    payload_json, priority, received_at, status, result_json,
                    completed_at, cloud_synced
                ) VALUES (
                    :task_id, :workflow_id, :step_id, :lobster_id, :skill_name,
                    :payload_json, :priority, :received_at, :status, :result_json,
                    :completed_at, :cloud_synced
                )
                """,
                {**asdict(task), "cloud_synced": 1 if task.cloud_synced else 0},
            )
            conn.commit()

    def mark_task_running(self, task_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE pending_tasks SET status = 'running' WHERE task_id = ?",
                (task_id,),
            )
            conn.commit()

    def mark_task_completed(self, task_id: str, result: dict[str, Any], *, cloud_synced: bool = False) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                UPDATE pending_tasks
                SET status = 'completed', result_json = ?, completed_at = ?, cloud_synced = ?
                WHERE task_id = ?
                """,
                (json.dumps(result, ensure_ascii=False), time.time(), 1 if cloud_synced else 0, task_id),
            )
            conn.commit()

    def mark_task_failed(self, task_id: str, error: str, *, cloud_synced: bool = False) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                UPDATE pending_tasks
                SET status = 'failed', result_json = ?, completed_at = ?, cloud_synced = ?
                WHERE task_id = ?
                """,
                (json.dumps({"error": error}, ensure_ascii=False), time.time(), 1 if cloud_synced else 0, task_id),
            )
            conn.commit()

    def list_unsynced_finished_tasks(self, limit: int = 100) -> list[CachedPendingTask]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT * FROM pending_tasks
                WHERE status IN ('completed', 'failed') AND cloud_synced = 0
                ORDER BY completed_at ASC
                LIMIT ?
                """,
                (max(1, int(limit)),),
            ).fetchall()
        return [
            CachedPendingTask(
                **{
                    **dict(row),
                    "cloud_synced": bool(row["cloud_synced"]),
                }
            )
            for row in rows
        ]

    def mark_task_synced(self, task_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE pending_tasks SET cloud_synced = 1 WHERE task_id = ?",
                (task_id,),
            )
            conn.commit()

    def count_pending_tasks(self) -> int:
        return self._count_status("pending")

    def count_running_tasks(self) -> int:
        return self._count_status("running")

    def _count_status(self, status: str) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) AS total FROM pending_tasks WHERE status = ?", (status,)).fetchone()
        return int(row["total"] or 0) if row else 0

    def set_sync_meta(self, key: str, value: str) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO sync_metadata(key, value, updated_at)
                VALUES (?, ?, ?)
                """,
                (str(key), str(value), time.time()),
            )
            conn.commit()

    def get_sync_meta(self, key: str) -> str | None:
        with self._conn() as conn:
            row = conn.execute("SELECT value FROM sync_metadata WHERE key = ?", (str(key),)).fetchone()
        return str(row["value"]) if row else None

    def snapshot(self) -> dict[str, Any]:
        config_versions = self.get_all_config_versions()
        skill_versions = self.get_all_skill_versions()
        unsynced_finished = len(self.list_unsynced_finished_tasks(limit=1000))
        if config_versions or skill_versions:
            status = "warm"
        else:
            status = "cold"
        return {
            "meta_cache_status": status,
            "cached_config_count": len(config_versions),
            "cached_skill_registry_count": len(skill_versions),
            "pending_task_count": self.count_pending_tasks(),
            "running_task_count": self.count_running_tasks(),
            "unsynced_finished_task_count": unsynced_finished,
            "config_versions": config_versions,
            "skill_versions": skill_versions,
            "desired_resource_version": self.get_sync_meta("desired_resource_version") or "",
        }


_cache: EdgeMetaCache | None = None


def get_edge_cache() -> EdgeMetaCache:
    global _cache
    if _cache is None:
        _cache = EdgeMetaCache()
    return _cache
