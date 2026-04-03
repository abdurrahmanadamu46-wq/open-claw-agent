from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


@dataclass
class WorkflowIdempotencyRecord:
    idempotency_key: str
    tenant_id: str
    workflow_id: str
    run_id: str
    status: str
    result_summary: dict[str, Any] | None
    trigger_source: str = "manual"
    created_at: str = _utc_now_iso()
    expires_at: str = (_utc_now() + timedelta(hours=24)).isoformat()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class WorkflowIdempotencyStore:
    def __init__(self, db_path: str = "./data/workflow_idempotency.sqlite") -> None:
        self._db_path = Path(db_path)
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
                CREATE TABLE IF NOT EXISTS workflow_idempotency (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    workflow_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    trigger_source TEXT NOT NULL DEFAULT 'manual',
                    result_summary_json TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    UNIQUE(tenant_id, workflow_id, idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_idempotency_expiry
                    ON workflow_idempotency(expires_at);
                CREATE INDEX IF NOT EXISTS idx_workflow_idempotency_run
                    ON workflow_idempotency(run_id);
                """
            )
            conn.commit()

    def cleanup_expired(self) -> int:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM workflow_idempotency WHERE expires_at <= ?", (_utc_now_iso(),))
            conn.commit()
            return int(cur.rowcount or 0)

    def reserve_or_get_existing(
        self,
        *,
        tenant_id: str,
        workflow_id: str,
        idempotency_key: str,
        run_id: str,
        trigger_source: str = "manual",
        ttl_hours: int = 24,
    ) -> tuple[bool, dict[str, Any] | None]:
        normalized_key = str(idempotency_key or "").strip()
        if not normalized_key:
            return True, None
        self.cleanup_expired()
        record = WorkflowIdempotencyRecord(
            idempotency_key=normalized_key,
            tenant_id=str(tenant_id),
            workflow_id=str(workflow_id),
            run_id=str(run_id),
            status="pending",
            trigger_source=str(trigger_source or "manual"),
            result_summary=None,
            created_at=_utc_now_iso(),
            expires_at=(_utc_now() + timedelta(hours=max(1, ttl_hours))).isoformat(),
        )
        with self._connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO workflow_idempotency(
                        id, tenant_id, workflow_id, idempotency_key, run_id,
                        status, trigger_source, result_summary_json, created_at, expires_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"idem_{uuid.uuid4().hex[:12]}",
                        record.tenant_id,
                        record.workflow_id,
                        record.idempotency_key,
                        record.run_id,
                        record.status,
                        record.trigger_source,
                        json.dumps(record.result_summary or {}, ensure_ascii=False),
                        record.created_at,
                        record.expires_at,
                    ),
                )
                conn.commit()
                return True, None
            except sqlite3.IntegrityError:
                row = conn.execute(
                    """
                    SELECT run_id, status, result_summary_json, idempotency_key
                    FROM workflow_idempotency
                    WHERE tenant_id = ? AND workflow_id = ? AND idempotency_key = ? AND expires_at > ?
                    """,
                    (record.tenant_id, record.workflow_id, record.idempotency_key, _utc_now_iso()),
                ).fetchone()
                if row is None:
                    return False, None
                return False, {
                    "run_id": str(row["run_id"]),
                    "status": str(row["status"]),
                    "result_summary": json.loads(str(row["result_summary_json"] or "{}")),
                    "idempotency_key": str(row["idempotency_key"]),
                    "is_duplicate": True,
                }

    def update_by_run(self, run_id: str, *, status: str, result_summary: dict[str, Any] | None = None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE workflow_idempotency
                SET status = ?, result_summary_json = ?
                WHERE run_id = ?
                """,
                (str(status), json.dumps(result_summary or {}, ensure_ascii=False), str(run_id)),
            )
            conn.commit()

    def rebind_run_id(
        self,
        *,
        tenant_id: str,
        workflow_id: str,
        idempotency_key: str,
        run_id: str,
    ) -> None:
        normalized_key = str(idempotency_key or "").strip()
        if not normalized_key:
            return
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE workflow_idempotency
                SET run_id = ?
                WHERE tenant_id = ? AND workflow_id = ? AND idempotency_key = ?
                """,
                (str(run_id), str(tenant_id), str(workflow_id), normalized_key),
            )
            conn.commit()

    def delete_reservation(self, *, tenant_id: str, workflow_id: str, idempotency_key: str) -> None:
        normalized_key = str(idempotency_key or "").strip()
        if not normalized_key:
            return
        with self._connect() as conn:
            conn.execute(
                """
                DELETE FROM workflow_idempotency
                WHERE tenant_id = ? AND workflow_id = ? AND idempotency_key = ?
                """,
                (str(tenant_id), str(workflow_id), normalized_key),
            )
            conn.commit()


_store: WorkflowIdempotencyStore | None = None


def get_workflow_idempotency_store() -> WorkflowIdempotencyStore:
    global _store
    if _store is None:
        _store = WorkflowIdempotencyStore()
    return _store
