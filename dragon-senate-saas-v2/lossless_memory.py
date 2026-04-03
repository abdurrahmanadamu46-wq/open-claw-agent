from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any


_LOCK = threading.RLock()


def _db_path() -> str:
    return os.getenv("LOSSLESS_MEMORY_DB_PATH", "./data/lossless_memory.sqlite").strip()


def _ensure_parent(path: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


@contextmanager
def _conn() -> sqlite3.Connection:
    path = _db_path()
    _ensure_parent(path)
    conn = sqlite3.connect(path, timeout=15, isolation_level=None)
    try:
        conn.row_factory = sqlite3.Row
        yield conn
    finally:
        conn.close()


def ensure_schema() -> None:
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS lossless_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE,
                ts TEXT NOT NULL,
                user_id TEXT NOT NULL,
                trace_id TEXT,
                node TEXT NOT NULL,
                event_type TEXT NOT NULL,
                level TEXT NOT NULL DEFAULT 'info',
                stage TEXT NOT NULL DEFAULT 'runtime',
                span_id TEXT,
                parent_span_id TEXT,
                parent_event_id TEXT,
                payload_json TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        rows = conn.execute("PRAGMA table_info(lossless_events)").fetchall()
        cols = {str(row["name"]) for row in rows}
        if "event_id" not in cols:
            conn.execute("ALTER TABLE lossless_events ADD COLUMN event_id TEXT")
        if "stage" not in cols:
            conn.execute("ALTER TABLE lossless_events ADD COLUMN stage TEXT NOT NULL DEFAULT 'runtime'")
        if "span_id" not in cols:
            conn.execute("ALTER TABLE lossless_events ADD COLUMN span_id TEXT")
        if "parent_span_id" not in cols:
            conn.execute("ALTER TABLE lossless_events ADD COLUMN parent_span_id TEXT")
        if "parent_event_id" not in cols:
            conn.execute("ALTER TABLE lossless_events ADD COLUMN parent_event_id TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_lossless_event_id ON lossless_events(event_id)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_lossless_user_ts ON lossless_events(user_id, ts DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_lossless_trace ON lossless_events(trace_id, ts DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_lossless_parent ON lossless_events(trace_id, parent_event_id, parent_span_id)"
        )


def append_event(
    *,
    user_id: str,
    trace_id: str | None,
    node: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
    level: str = "info",
    stage: str = "runtime",
    span_id: str | None = None,
    parent_span_id: str | None = None,
    parent_event_id: str | None = None,
) -> None:
    ensure_schema()
    now = datetime.now(timezone.utc).isoformat()
    event_id = uuid.uuid4().hex
    payload_json = json.dumps(payload or {}, ensure_ascii=False, default=str)
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            INSERT INTO lossless_events(
                event_id, ts, user_id, trace_id, node, event_type, level,
                stage, span_id, parent_span_id, parent_event_id, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                now,
                user_id,
                trace_id,
                node,
                event_type,
                level,
                stage,
                span_id,
                parent_span_id,
                parent_event_id,
                payload_json,
            ),
        )


def query_events(
    *,
    user_id: str,
    limit: int = 100,
    trace_id: str | None = None,
    keyword: str | None = None,
    errors_only: bool = False,
) -> list[dict[str, Any]]:
    ensure_schema()
    limit = max(1, min(int(limit), 500))
    where = ["user_id = ?"]
    params: list[Any] = [user_id]
    if trace_id:
        where.append("trace_id = ?")
        params.append(trace_id)
    if errors_only:
        where.append("level IN ('error', 'fatal')")
    if keyword:
        where.append("payload_json LIKE ?")
        params.append(f"%{keyword[:80]}%")
    sql = (
        "SELECT id, event_id, ts, user_id, trace_id, node, event_type, level, stage, "
        "span_id, parent_span_id, parent_event_id, payload_json "
        f"FROM lossless_events WHERE {' AND '.join(where)} "
        "ORDER BY id DESC LIMIT ?"
    )
    params.append(limit)
    with _LOCK, _conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    output: list[dict[str, Any]] = []
    for row in rows:
        try:
            payload = json.loads(str(row["payload_json"] or "{}"))
        except json.JSONDecodeError:
            payload = {"raw": str(row["payload_json"] or "")}
        output.append(
            {
                "id": int(row["id"]),
                "event_id": str(row["event_id"] or ""),
                "ts": str(row["ts"]),
                "user_id": str(row["user_id"]),
                "trace_id": str(row["trace_id"] or ""),
                "node": str(row["node"]),
                "event_type": str(row["event_type"]),
                "level": str(row["level"]),
                "stage": str(row["stage"] or "runtime"),
                "span_id": str(row["span_id"] or ""),
                "parent_span_id": str(row["parent_span_id"] or ""),
                "parent_event_id": str(row["parent_event_id"] or ""),
                "payload": payload,
            }
        )
    return output


def build_trace_dag(*, user_id: str, trace_id: str) -> dict[str, Any]:
    events = query_events(user_id=user_id, trace_id=trace_id, limit=2000)
    events = list(reversed(events))
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, str]] = []
    by_span: dict[str, str] = {}

    for event in events:
        event_id = str(event.get("event_id") or event.get("id"))
        if not event_id:
            continue
        nodes[event_id] = {
            "id": event_id,
            "node": event.get("node"),
            "event_type": event.get("event_type"),
            "stage": event.get("stage"),
            "level": event.get("level"),
            "ts": event.get("ts"),
        }
        span_id = str(event.get("span_id") or "")
        if span_id:
            by_span[span_id] = event_id

    for event in events:
        child_id = str(event.get("event_id") or event.get("id"))
        if not child_id or child_id not in nodes:
            continue
        parent_event_id = str(event.get("parent_event_id") or "").strip()
        parent_span_id = str(event.get("parent_span_id") or "").strip()
        if parent_event_id and parent_event_id in nodes:
            edges.append({"from": parent_event_id, "to": child_id, "type": "parent_event"})
        elif parent_span_id and parent_span_id in by_span:
            edges.append({"from": by_span[parent_span_id], "to": child_id, "type": "parent_span"})

    root_ids = set(nodes.keys())
    for edge in edges:
        if edge["to"] in root_ids:
            root_ids.remove(edge["to"])

    return {
        "user_id": user_id,
        "trace_id": trace_id,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "roots": sorted(root_ids),
        "nodes": list(nodes.values()),
        "edges": edges,
    }


def replay_trace(*, user_id: str, trace_id: str) -> dict[str, Any]:
    dag = build_trace_dag(user_id=user_id, trace_id=trace_id)
    events = query_events(user_id=user_id, trace_id=trace_id, limit=2000)
    ordered = list(reversed(events))
    by_level: dict[str, int] = {}
    stages: dict[str, int] = {}
    for event in ordered:
        level = str(event.get("level") or "info")
        by_level[level] = by_level.get(level, 0) + 1
        stage = str(event.get("stage") or "runtime")
        stages[stage] = stages.get(stage, 0) + 1

    first_ts = ordered[0]["ts"] if ordered else None
    last_ts = ordered[-1]["ts"] if ordered else None
    return {
        "user_id": user_id,
        "trace_id": trace_id,
        "first_ts": first_ts,
        "last_ts": last_ts,
        "event_count": len(ordered),
        "levels": by_level,
        "stages": stages,
        "dag": dag,
        "timeline": ordered,
    }


def trace_snapshot(*, user_id: str, trace_id: str) -> dict[str, Any]:
    events = query_events(user_id=user_id, trace_id=trace_id, limit=500)
    dag = build_trace_dag(user_id=user_id, trace_id=trace_id)
    node_stats: dict[str, int] = {}
    error_count = 0
    for event in events:
        node = str(event.get("node") or "unknown")
        node_stats[node] = node_stats.get(node, 0) + 1
        if str(event.get("level")) in {"error", "fatal"}:
            error_count += 1
    return {
        "user_id": user_id,
        "trace_id": trace_id,
        "event_count": len(events),
        "error_count": error_count,
        "node_stats": node_stats,
        "dag_roots": dag.get("roots", []),
        "dag_node_count": dag.get("node_count", 0),
        "dag_edge_count": dag.get("edge_count", 0),
        "events": events,
    }
