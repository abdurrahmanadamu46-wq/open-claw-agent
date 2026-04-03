"""
Persistence for edge telemetry batches.
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any


def _db_path() -> Path:
    raw = os.getenv("EDGE_TELEMETRY_DB_PATH", "./data/edge_telemetry.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class EdgeTelemetryStore:
    def __init__(self) -> None:
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(_db_path()))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS edge_telemetry_batches (
                    batch_id TEXT PRIMARY KEY,
                    edge_node_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    batch_size INTEGER NOT NULL DEFAULT 0,
                    received_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS edge_run_results (
                    event_id TEXT PRIMARY KEY,
                    edge_node_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    trace_id TEXT,
                    task_id TEXT,
                    skill_name TEXT,
                    status TEXT,
                    duration_ms INTEGER DEFAULT 0,
                    quality_score REAL,
                    token_count INTEGER DEFAULT 0,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_edge_run_results_tenant_time
                  ON edge_run_results(tenant_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS edge_metrics (
                    event_id TEXT PRIMARY KEY,
                    edge_node_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    trace_id TEXT,
                    metric_name TEXT NOT NULL,
                    metric_value REAL NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS edge_errors (
                    event_id TEXT PRIMARY KEY,
                    edge_node_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    trace_id TEXT,
                    error_message TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL
                );
                """
            )
            conn.commit()

    def ingest_batch(self, *, batch_id: str, edge_node_id: str, tenant_id: str, events: list[dict[str, Any]], metadata: dict[str, Any] | None = None) -> dict[str, int]:
        run_results = 0
        metrics = 0
        errors = 0
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO edge_telemetry_batches(batch_id, edge_node_id, tenant_id, batch_size, received_at, metadata_json)
                VALUES (?, ?, ?, ?, datetime('now'), ?)
                """,
                (batch_id, edge_node_id, tenant_id, len(events), json.dumps(metadata or {}, ensure_ascii=False)),
            )

            for event in events:
                event_type = str(event.get("event_type") or "").strip()
                payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
                if event_type == "run_result":
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO edge_run_results(
                            event_id, edge_node_id, tenant_id, lobster_id, trace_id, task_id,
                            skill_name, status, duration_ms, quality_score, token_count, payload_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            event.get("event_id"),
                            edge_node_id,
                            tenant_id,
                            event.get("lobster_id"),
                            event.get("trace_id"),
                            payload.get("task_id"),
                            payload.get("skill_name"),
                            payload.get("status"),
                            int(payload.get("duration_ms") or 0),
                            float(payload.get("quality_score") or 0) if payload.get("quality_score") is not None else None,
                            int(payload.get("token_count") or 0),
                            json.dumps(payload, ensure_ascii=False),
                            float(event.get("timestamp") or 0),
                        ),
                    )
                    run_results += 1
                elif event_type == "metric":
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO edge_metrics(
                            event_id, edge_node_id, tenant_id, lobster_id, trace_id,
                            metric_name, metric_value, payload_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            event.get("event_id"),
                            edge_node_id,
                            tenant_id,
                            event.get("lobster_id"),
                            event.get("trace_id"),
                            str(payload.get("name") or payload.get("metric_name") or "metric"),
                            float(payload.get("value") or payload.get("metric_value") or 0),
                            json.dumps(payload, ensure_ascii=False),
                            float(event.get("timestamp") or 0),
                        ),
                    )
                    metrics += 1
                elif event_type == "error":
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO edge_errors(
                            event_id, edge_node_id, tenant_id, lobster_id, trace_id,
                            error_message, payload_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            event.get("event_id"),
                            edge_node_id,
                            tenant_id,
                            event.get("lobster_id"),
                            event.get("trace_id"),
                            str(payload.get("error") or payload.get("message") or "unknown"),
                            json.dumps(payload, ensure_ascii=False),
                            float(event.get("timestamp") or 0),
                        ),
                    )
                    errors += 1
            conn.commit()
        return {"run_results": run_results, "metrics": metrics, "errors": errors}

    def latest_run_results(self, *, tenant_id: str, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM edge_run_results
                 WHERE tenant_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?
                """,
                (tenant_id, max(1, min(limit, 1000))),
            ).fetchall()
        items = [dict(row) for row in rows]
        for item in items:
            item["payload"] = json.loads(str(item.pop("payload_json", "{}") or "{}"))
        return items


_store: EdgeTelemetryStore | None = None


def get_edge_telemetry_store() -> EdgeTelemetryStore:
    global _store
    if _store is None:
        _store = EdgeTelemetryStore()
    return _store
