"""
api_snapshot_audit.py — 边缘执行快照存储
======================================

给 app.py 提供快照报告的持久化 / 查询能力。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

DEFAULT_DB_PATH = "./data/execution_snapshot_audit.sqlite"


def _resolve_db_path(db_path: str | None = None) -> Path:
    raw = str(db_path or os.getenv("SNAPSHOT_AUDIT_DB_PATH", DEFAULT_DB_PATH)).strip() or DEFAULT_DB_PATH
    path = Path(raw)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class SnapshotAuditStore:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = _resolve_db_path(db_path)
        self._lock = threading.Lock()
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS execution_snapshots (
                    snapshot_id      TEXT PRIMARY KEY,
                    tenant_id        TEXT NOT NULL,
                    node_id          TEXT NOT NULL,
                    account_id       TEXT NOT NULL DEFAULT '',
                    platform         TEXT NOT NULL DEFAULT '',
                    action_type      TEXT NOT NULL DEFAULT '',
                    task_id          TEXT NOT NULL DEFAULT '',
                    workflow_run_id  TEXT NOT NULL DEFAULT '',
                    status           TEXT NOT NULL DEFAULT 'unknown',
                    started_at       TEXT NOT NULL DEFAULT '',
                    finished_at      TEXT NOT NULL DEFAULT '',
                    duration_ms      INTEGER NOT NULL DEFAULT 0,
                    total_steps      INTEGER NOT NULL DEFAULT 0,
                    result_summary   TEXT NOT NULL DEFAULT '',
                    error_detail     TEXT NOT NULL DEFAULT '',
                    report_json      TEXT NOT NULL DEFAULT '{}',
                    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                CREATE INDEX IF NOT EXISTS idx_snapshot_tenant_created
                    ON execution_snapshots(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_snapshot_node_created
                    ON execution_snapshots(node_id, created_at DESC);
                """
            )

    def store_report(self, report: dict[str, Any]) -> dict[str, Any]:
        payload = dict(report or {})
        snapshot_id = str(payload.get("snapshot_id") or "").strip()
        if not snapshot_id:
            raise ValueError("snapshot_id is required")
        tenant_id = str(payload.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        node_id = str(payload.get("node_id") or "").strip()
        if not node_id:
            raise ValueError("node_id is required")
        with self._lock, self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO execution_snapshots(
                    snapshot_id, tenant_id, node_id, account_id, platform, action_type,
                    task_id, workflow_run_id, status, started_at, finished_at,
                    duration_ms, total_steps, result_summary, error_detail, report_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
                    (SELECT created_at FROM execution_snapshots WHERE snapshot_id = ?),
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                ))
                """,
                (
                    snapshot_id,
                    tenant_id,
                    node_id,
                    str(payload.get("account_id") or "").strip(),
                    str(payload.get("platform") or "").strip(),
                    str(payload.get("action_type") or "").strip(),
                    str(payload.get("task_id") or "").strip(),
                    str(payload.get("workflow_run_id") or "").strip(),
                    str(payload.get("status") or "unknown").strip() or "unknown",
                    str(payload.get("started_at") or "").strip(),
                    str(payload.get("finished_at") or "").strip(),
                    int(payload.get("duration_ms") or 0),
                    int(payload.get("total_steps") or 0),
                    str(payload.get("result_summary") or "").strip(),
                    str(payload.get("error_detail") or "").strip(),
                    json.dumps(payload, ensure_ascii=False),
                    snapshot_id,
                ),
            )
        return self.get_snapshot(snapshot_id, tenant_id=tenant_id) or {}

    def list_snapshots(
        self,
        *,
        tenant_id: str,
        node_id: str | None = None,
        account_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM execution_snapshots WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if node_id:
            query += " AND node_id = ?"
            params.append(str(node_id))
        if account_id:
            query += " AND account_id = ?"
            params.append(str(account_id))
        if status:
            query += " AND status = ?"
            params.append(str(status))
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, min(100, int(limit))))
        with self._lock, self._conn() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_summary(row) for row in rows]

    def get_snapshot(self, snapshot_id: str, *, tenant_id: str | None = None) -> dict[str, Any] | None:
        query = "SELECT * FROM execution_snapshots WHERE snapshot_id = ?"
        params: list[Any] = [str(snapshot_id)]
        if tenant_id:
            query += " AND tenant_id = ?"
            params.append(str(tenant_id))
        with self._lock, self._conn() as conn:
            row = conn.execute(query, params).fetchone()
        if row is None:
            return None
        payload = json.loads(row["report_json"]) if row["report_json"] else {}
        if not isinstance(payload, dict):
            payload = {}
        payload.setdefault("snapshot_id", row["snapshot_id"])
        payload.setdefault("tenant_id", row["tenant_id"])
        payload.setdefault("node_id", row["node_id"])
        payload.setdefault("account_id", row["account_id"])
        payload.setdefault("platform", row["platform"])
        payload.setdefault("action_type", row["action_type"])
        payload.setdefault("status", row["status"])
        payload.setdefault("duration_ms", int(row["duration_ms"] or 0))
        payload.setdefault("total_steps", int(row["total_steps"] or 0))
        return payload

    def get_replay(self, snapshot_id: str, *, tenant_id: str | None = None) -> dict[str, Any] | None:
        payload = self.get_snapshot(snapshot_id, tenant_id=tenant_id)
        if payload is None:
            return None
        return {
            "snapshot_id": payload.get("snapshot_id"),
            "node_id": payload.get("node_id"),
            "tenant_id": payload.get("tenant_id"),
            "status": payload.get("status"),
            "replay": payload.get("replay") or {
                "frames": [],
                "timeline": [],
            },
        }

    @staticmethod
    def _row_to_summary(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "snapshot_id": row["snapshot_id"],
            "tenant_id": row["tenant_id"],
            "node_id": row["node_id"],
            "account_id": row["account_id"],
            "platform": row["platform"],
            "action_type": row["action_type"],
            "task_id": row["task_id"] or None,
            "workflow_run_id": row["workflow_run_id"] or None,
            "status": row["status"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "duration_ms": int(row["duration_ms"] or 0),
            "total_steps": int(row["total_steps"] or 0),
            "result_summary": row["result_summary"],
            "error_detail": row["error_detail"],
        }


_snapshot_store: SnapshotAuditStore | None = None


def get_snapshot_audit_store() -> SnapshotAuditStore:
    global _snapshot_store
    if _snapshot_store is None:
        _snapshot_store = SnapshotAuditStore()
    return _snapshot_store
