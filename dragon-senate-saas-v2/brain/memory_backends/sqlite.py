from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .base import MemoryBackend


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SQLiteBackend(MemoryBackend):
    def __init__(self, db_path: str = "data/brain_memory.sqlite"):
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    metadata TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, lobster_id, category, key)
                )
                """
            )
            conn.commit()

    async def save(self, tenant_id: str, lobster_id: str, category: str, key: str, value: str, metadata: dict[str, Any] | None = None) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO memories (tenant_id, lobster_id, category, key, value, metadata, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, lobster_id, category, key)
                DO UPDATE SET value=excluded.value, metadata=excluded.metadata, updated_at=excluded.updated_at
                """,
                (
                    tenant_id,
                    lobster_id,
                    category,
                    key,
                    value,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    _utc_now(),
                ),
            )
            conn.commit()

    async def load(self, tenant_id: str, lobster_id: str, category: str, key: str) -> dict[str, Any] | None:
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT tenant_id, lobster_id, category, key, value, metadata, updated_at
                FROM memories
                WHERE tenant_id = ? AND lobster_id = ? AND category = ? AND key = ?
                """,
                (tenant_id, lobster_id, category, key),
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    async def search(self, tenant_id: str, lobster_id: str, query: str, category: str | None = None, top_k: int = 5) -> list[dict[str, Any]]:
        sql = """
            SELECT tenant_id, lobster_id, category, key, value, metadata, updated_at
            FROM memories
            WHERE tenant_id = ? AND lobster_id = ?
        """
        params: list[Any] = [tenant_id, lobster_id]
        if category:
            sql += " AND category = ?"
            params.append(category)
        sql += " AND (key LIKE ? OR value LIKE ?) ORDER BY updated_at DESC LIMIT ?"
        params.extend([f"%{query}%", f"%{query}%", max(1, int(top_k))])
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    async def delete(self, tenant_id: str, lobster_id: str, category: str, key: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM memories WHERE tenant_id = ? AND lobster_id = ? AND category = ? AND key = ?",
                (tenant_id, lobster_id, category, key),
            )
            conn.commit()
