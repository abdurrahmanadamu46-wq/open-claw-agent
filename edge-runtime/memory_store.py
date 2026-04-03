"""
SQLite-backed edge memory store inspired by memU's local backend.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class EdgeMemoryStore:
    def __init__(self, db_path: str = "~/.openclaw/edge_memory.db"):
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    metadata TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    synced INTEGER DEFAULT 0,
                    UNIQUE(tenant_id, lobster_id, category, key)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sync_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    memory_key TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_memories_lookup
                ON memories(tenant_id, lobster_id, category)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scheduled_tasks (
                    task_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    scheduled_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_run_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_lookup
                ON scheduled_tasks(status, scheduled_at)
                """
            )
            conn.commit()

    async def remember(
        self,
        tenant_id: str,
        lobster_id: str,
        category: str,
        key: str,
        value: str,
        metadata: dict[str, Any] | None = None,
        ttl: int | None = None,
    ) -> None:
        now = _utc_now()
        metadata_payload = dict(metadata or {})
        if ttl is not None:
            metadata_payload["ttl"] = int(ttl)
        metadata_json = json.dumps(metadata_payload, ensure_ascii=False) if metadata_payload else None
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO memories (tenant_id, lobster_id, category, key, value, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, lobster_id, category, key)
                DO UPDATE SET value=excluded.value, metadata=excluded.metadata, updated_at=excluded.updated_at, synced=0
                """,
                (tenant_id, lobster_id, category, key, value, metadata_json, now, now),
            )
            conn.execute(
                """
                INSERT INTO sync_queue (memory_key, operation, created_at)
                VALUES (?, 'upsert', ?)
                """,
                (f"{tenant_id}:{lobster_id}:{category}:{key}", now),
            )
            conn.commit()

    async def recall(
        self,
        tenant_id: str,
        lobster_id: str,
        query: str,
        category: str | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT category, key, value, metadata, created_at, updated_at
            FROM memories
            WHERE tenant_id = ? AND lobster_id = ?
        """
        params: list[Any] = [tenant_id, lobster_id]
        if category:
            sql += " AND category = ?"
            params.append(category)
        sql += " AND (key LIKE ? OR value LIKE ?)"
        params.extend([f"%{query}%", f"%{query}%"])
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(max(1, int(top_k)))

        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [
            {
                "category": row["category"],
                "key": row["key"],
                "value": row["value"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    async def sync_to_cloud(self, cloud_endpoint: str) -> int:
        """Stub for future cloud sync."""
        return 0

    async def get_unsynced_memories(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT id, tenant_id, lobster_id, category, key, value, metadata, created_at, updated_at
                FROM memories
                WHERE synced = 0
                ORDER BY updated_at ASC
                LIMIT ?
                """,
                (max(1, int(limit)),),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "tenant_id": row["tenant_id"],
                "lobster_id": row["lobster_id"],
                "category": row["category"],
                "key": row["key"],
                "value": row["value"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    async def mark_synced(self, memory_ids: list[int]) -> None:
        normalized = [int(item) for item in memory_ids if str(item).strip()]
        if not normalized:
            return
        placeholders = ",".join("?" for _ in normalized)
        with self._conn() as conn:
            conn.execute(
                f"UPDATE memories SET synced = 1 WHERE id IN ({placeholders})",
                normalized,
            )
            keys = conn.execute(
                f"SELECT tenant_id, lobster_id, category, key FROM memories WHERE id IN ({placeholders})",
                normalized,
            ).fetchall()
            for row in keys:
                memory_key = f"{row['tenant_id']}:{row['lobster_id']}:{row['category']}:{row['key']}"
                conn.execute("DELETE FROM sync_queue WHERE memory_key = ?", (memory_key,))
            conn.commit()

    async def schedule_task(
        self,
        *,
        task_id: str,
        tenant_id: str,
        lobster_id: str,
        scheduled_at: str,
        payload: dict[str, Any],
    ) -> None:
        now = _utc_now()
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO scheduled_tasks (
                    task_id, tenant_id, lobster_id, scheduled_at, payload_json,
                    status, created_at, updated_at, last_error, last_run_at
                )
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)
                ON CONFLICT(task_id)
                DO UPDATE SET
                    scheduled_at=excluded.scheduled_at,
                    payload_json=excluded.payload_json,
                    status='pending',
                    updated_at=excluded.updated_at,
                    last_error=NULL
                """,
                (
                    task_id,
                    tenant_id,
                    lobster_id,
                    scheduled_at,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            conn.commit()

    async def get_due_scheduled_tasks(self, limit: int = 50) -> list[dict[str, Any]]:
        now = _utc_now()
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT task_id, tenant_id, lobster_id, scheduled_at, payload_json, status, last_error, created_at, updated_at, last_run_at
                FROM scheduled_tasks
                WHERE status = 'pending' AND scheduled_at <= ?
                ORDER BY scheduled_at ASC
                LIMIT ?
                """,
                (now, max(1, int(limit))),
            ).fetchall()
        return [
            {
                "task_id": row["task_id"],
                "tenant_id": row["tenant_id"],
                "lobster_id": row["lobster_id"],
                "scheduled_at": row["scheduled_at"],
                "payload": json.loads(row["payload_json"]),
                "status": row["status"],
                "last_error": row["last_error"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "last_run_at": row["last_run_at"],
            }
            for row in rows
        ]

    async def mark_scheduled_task_status(
        self,
        task_id: str,
        status: str,
        *,
        last_error: str | None = None,
        last_run_at: str | None = None,
    ) -> None:
        now = _utc_now()
        with self._conn() as conn:
            conn.execute(
                """
                UPDATE scheduled_tasks
                SET status = ?, last_error = ?, last_run_at = ?, updated_at = ?
                WHERE task_id = ?
                """,
                (status, last_error, last_run_at, now, task_id),
            )
            conn.commit()

    async def list_scheduled_tasks(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT task_id, tenant_id, lobster_id, scheduled_at, payload_json, status, last_error, created_at, updated_at, last_run_at
                FROM scheduled_tasks
                ORDER BY scheduled_at ASC
                LIMIT ?
                """,
                (max(1, int(limit)),),
            ).fetchall()
        return [
            {
                "task_id": row["task_id"],
                "tenant_id": row["tenant_id"],
                "lobster_id": row["lobster_id"],
                "scheduled_at": row["scheduled_at"],
                "payload": json.loads(row["payload_json"]),
                "status": row["status"],
                "last_error": row["last_error"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "last_run_at": row["last_run_at"],
            }
            for row in rows
        ]
