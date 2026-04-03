from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


class SubAgentManager:
    def __init__(self, db_path: str = "./data/sub_agents.sqlite") -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sub_agents (
                    sub_agent_id TEXT PRIMARY KEY,
                    parent_agent_id TEXT NOT NULL,
                    company_name TEXT NOT NULL,
                    contact_name TEXT NOT NULL DEFAULT '',
                    region TEXT NOT NULL DEFAULT '',
                    allocated_seats INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sub_agents_parent ON sub_agents(parent_agent_id, created_at DESC);
                """
            )
            conn.commit()

    @staticmethod
    def _now_iso() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def create_sub_agent(
        self,
        *,
        parent_agent_id: str,
        company_name: str,
        contact_name: str,
        region: str,
        allocated_seats: int,
    ) -> dict[str, Any]:
        sub_agent_id = f"sub_{uuid.uuid4().hex[:12]}"
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sub_agents(sub_agent_id, parent_agent_id, company_name, contact_name, region, allocated_seats, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
                """,
                (
                    sub_agent_id,
                    str(parent_agent_id or "").strip(),
                    str(company_name or "").strip(),
                    str(contact_name or "").strip(),
                    str(region or "").strip(),
                    max(0, int(allocated_seats or 0)),
                    self._now_iso(),
                ),
            )
            conn.commit()
        return self.get_sub_agent(sub_agent_id) or {}

    def list_children(self, parent_agent_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM sub_agents WHERE parent_agent_id = ? ORDER BY created_at DESC",
                (str(parent_agent_id or "").strip(),),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_sub_agent(self, sub_agent_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM sub_agents WHERE sub_agent_id = ?",
                (str(sub_agent_id or "").strip(),),
            ).fetchone()
        return dict(row) if row else None

    def get_tree(self, parent_agent_id: str) -> dict[str, Any]:
        return {
            "agent_id": str(parent_agent_id or "").strip(),
            "children": self.list_children(parent_agent_id),
        }


_manager: SubAgentManager | None = None


def get_sub_agent_manager() -> SubAgentManager:
    global _manager
    if _manager is None:
        _manager = SubAgentManager()
    return _manager
