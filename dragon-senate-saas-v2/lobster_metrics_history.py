"""
Daily lobster metrics history snapshots.
"""

from __future__ import annotations

import os
import sqlite3
import time
from datetime import date
from datetime import datetime
from datetime import timedelta
from pathlib import Path
from typing import Any


DB_PATH = Path(os.getenv("LOBSTER_METRICS_HISTORY_DB", "./data/lobster_metrics_history.sqlite"))
LLM_DB_PATH = Path(os.getenv("LLM_CALL_LOGGER_DB", "./data/llm_call_log.sqlite"))
LOBSTERS = [
    "commander",
    "strategist",
    "radar",
    "inkwriter",
    "visualizer",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
]


class LobsterMetricsHistory:
    def __init__(self, db_path: Path = DB_PATH, llm_db_path: Path = LLM_DB_PATH) -> None:
        self._db_path = db_path
        self._llm_db_path = llm_db_path
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
                CREATE TABLE IF NOT EXISTS lobster_daily_metrics (
                    date TEXT NOT NULL,
                    lobster_name TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    task_count INTEGER DEFAULT 0,
                    success_count INTEGER DEFAULT 0,
                    avg_latency_ms REAL DEFAULT 0,
                    cost_usd REAL DEFAULT 0,
                    error_rate REAL DEFAULT 0,
                    PRIMARY KEY (date, lobster_name, tenant_id)
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

    def aggregate_day(self, target_date: date, tenant_id: str) -> None:
        day_start = datetime.combine(target_date, datetime.min.time()).timestamp()
        day_end = day_start + 86400
        llm_conn = sqlite3.connect(self._llm_db_path)
        llm_conn.row_factory = sqlite3.Row
        hist_conn = self._conn()
        try:
            for lobster_name in LOBSTERS:
                row = llm_conn.execute(
                    """
                    SELECT COUNT(*) AS task_count,
                           SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
                           AVG(latency_ms) AS avg_latency_ms,
                           SUM(cost_usd) AS cost_usd
                    FROM llm_call_logs
                    WHERE tenant_id=? AND lobster_name=? AND timestamp>=? AND timestamp<?
                    """,
                    (tenant_id, lobster_name, day_start, day_end),
                ).fetchone()
                task_count = int(row["task_count"] or 0) if row else 0
                if task_count <= 0:
                    continue
                success_count = int(row["success_count"] or 0)
                error_rate = 1.0 - (success_count / max(task_count, 1))
                hist_conn.execute(
                    """
                    INSERT INTO lobster_daily_metrics (
                        date, lobster_name, tenant_id, task_count, success_count, avg_latency_ms, cost_usd, error_rate
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(date, lobster_name, tenant_id) DO UPDATE SET
                        task_count=excluded.task_count,
                        success_count=excluded.success_count,
                        avg_latency_ms=excluded.avg_latency_ms,
                        cost_usd=excluded.cost_usd,
                        error_rate=excluded.error_rate
                    """,
                    (
                        target_date.isoformat(),
                        lobster_name,
                        tenant_id,
                        task_count,
                        success_count,
                        float(row["avg_latency_ms"] or 0.0),
                        float(row["cost_usd"] or 0.0),
                        round(error_rate, 4),
                    ),
                )
            hist_conn.commit()
        finally:
            llm_conn.close()
            hist_conn.close()

    def backfill_recent(self, tenant_id: str, days: int = 30) -> None:
        for offset in range(max(1, days)):
            self.aggregate_day(date.today() - timedelta(days=offset), tenant_id)

    def get_history(self, lobster_name: str, tenant_id: str, days: int = 30) -> list[dict[str, Any]]:
        self.backfill_recent(tenant_id, days=days)
        since = (date.today() - timedelta(days=max(1, days))).isoformat()
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT date, task_count, success_count, avg_latency_ms, cost_usd, error_rate
                FROM lobster_daily_metrics
                WHERE lobster_name=? AND tenant_id=? AND date>=?
                ORDER BY date ASC
                """,
                (lobster_name, tenant_id, since),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()


_default_history: LobsterMetricsHistory | None = None


def get_lobster_metrics_history() -> LobsterMetricsHistory:
    global _default_history
    if _default_history is None:
        _default_history = LobsterMetricsHistory()
    return _default_history
