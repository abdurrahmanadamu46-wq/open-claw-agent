from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


class InstructorOutputGuardStore:
    def __init__(self, db_path: str = "./data/instructor_output_guard.sqlite") -> None:
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
                CREATE TABLE IF NOT EXISTS instructor_output_runs (
                    run_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    schema_name TEXT NOT NULL,
                    model TEXT DEFAULT '',
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    success INTEGER NOT NULL DEFAULT 0,
                    instructor_enabled INTEGER NOT NULL DEFAULT 1,
                    error_message TEXT DEFAULT '',
                    created_at REAL NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_instructor_runs_period
                    ON instructor_output_runs(created_at, tenant_id, lobster_id);
                """
            )
            conn.commit()

    def record_run(
        self,
        *,
        tenant_id: str,
        lobster_id: str,
        task_id: str,
        schema_name: str,
        retry_count: int,
        success: bool,
        instructor_enabled: bool,
        model: str = "",
        error_message: str = "",
    ) -> dict[str, Any]:
        payload = {
            "run_id": f"ior_{uuid.uuid4().hex[:12]}",
            "tenant_id": str(tenant_id or "tenant_main").strip() or "tenant_main",
            "lobster_id": str(lobster_id or "").strip() or "unknown",
            "task_id": str(task_id or "").strip() or "task",
            "schema_name": str(schema_name or "").strip() or "unknown",
            "model": str(model or "").strip(),
            "retry_count": max(0, int(retry_count or 0)),
            "success": 1 if success else 0,
            "instructor_enabled": 1 if instructor_enabled else 0,
            "error_message": str(error_message or "")[:1000],
            "created_at": time.time(),
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO instructor_output_runs(
                    run_id, tenant_id, lobster_id, task_id, schema_name, model,
                    retry_count, success, instructor_enabled, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["run_id"],
                    payload["tenant_id"],
                    payload["lobster_id"],
                    payload["task_id"],
                    payload["schema_name"],
                    payload["model"],
                    payload["retry_count"],
                    payload["success"],
                    payload["instructor_enabled"],
                    payload["error_message"],
                    payload["created_at"],
                ),
            )
            conn.commit()
        return payload

    def stats_for_period(self, period: str = "") -> dict[str, Any]:
        normalized_period = str(period or "").strip()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM instructor_output_runs ORDER BY created_at DESC"
            ).fetchall()
        if normalized_period:
            rows = [
                row for row in rows
                if time.strftime("%Y-%m", time.gmtime(float(row["created_at"] or 0))) == normalized_period
            ]
        total_calls = len(rows)
        retry_calls = sum(1 for row in rows if int(row["retry_count"] or 0) > 0)
        failed_calls = sum(1 for row in rows if not bool(int(row["success"] or 0)))
        actual_loss_rate = 1 + (retry_calls * 0.3 + failed_calls) / max(total_calls, 1)
        baseline_loss_rate = 2.0
        improvement = baseline_loss_rate - actual_loss_rate
        return {
            "period": normalized_period or time.strftime("%Y-%m", time.gmtime()),
            "total_calls": total_calls,
            "retry_calls": retry_calls,
            "failed_calls": failed_calls,
            "success_rate": round(((total_calls - failed_calls) / max(total_calls, 1)) * 100, 1),
            "actual_loss_rate": round(actual_loss_rate, 2),
            "baseline_loss_rate": baseline_loss_rate,
            "improvement": round(improvement, 2),
        }


_store: InstructorOutputGuardStore | None = None


def get_instructor_output_guard_store() -> InstructorOutputGuardStore:
    global _store
    if _store is None:
        _store = InstructorOutputGuardStore()
    return _store
