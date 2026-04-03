from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("FOLLOWUP_SUBAGENT_DB_PATH", "./data/followup_subagents.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def ensure_schema() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS followup_spawn_runs (
                spawn_run_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                trace_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                parent_agent TEXT NOT NULL,
                lead_count INTEGER NOT NULL DEFAULT 0,
                child_count INTEGER NOT NULL DEFAULT 0,
                max_concurrency INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'running',
                plan_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_followup_spawn_trace
                ON followup_spawn_runs (tenant_id, user_id, trace_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS followup_child_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                spawn_run_id TEXT NOT NULL,
                child_id TEXT NOT NULL,
                worker_id TEXT NOT NULL,
                lead_ids_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL,
                action_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                finished_at TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                detail_json TEXT NOT NULL DEFAULT '{}',
                UNIQUE(spawn_run_id, child_id)
            );
            CREATE INDEX IF NOT EXISTS idx_followup_child_spawn
                ON followup_child_runs (spawn_run_id, finished_at DESC);
            """
        )


def _lead_rank(lead: dict[str, Any]) -> int:
    grade = str(lead.get("grade", "")).strip().upper()
    intent = str(lead.get("intent", "")).strip().lower()
    if grade == "A" or intent == "hot":
        return 0
    if grade == "B" or intent == "warm":
        return 1
    return 2


def _lead_id(lead: dict[str, Any], index: int) -> str:
    base = str(lead.get("lead_id") or "").strip()
    if base:
        return base[:96]
    text = str(lead.get("text") or "").strip()[:96]
    if text:
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]
        return f"lead_{index + 1}_{digest}"
    return f"lead_{index + 1}"


def plan_deterministic_subagents(
    *,
    leads: list[dict[str, Any]],
    trace_id: str,
    max_children: int,
    leads_per_child: int,
) -> dict[str, Any]:
    total = len(leads)
    if total <= 0:
        return {
            "trace_id": trace_id,
            "lead_count": 0,
            "child_count": 0,
            "leads_per_child": max(1, leads_per_child),
            "shards": [],
        }

    shard_size = max(1, leads_per_child)
    child_count = max(1, math.ceil(total / shard_size))
    child_count = min(child_count, max(1, max_children))
    if child_count > 0:
        shard_size = max(1, math.ceil(total / child_count))

    sortable: list[tuple[int, str, dict[str, Any]]] = []
    for idx, lead in enumerate(leads):
        lead_key = _lead_id(lead, idx)
        sortable.append((_lead_rank(lead), lead_key, lead))
    sortable.sort(key=lambda row: (row[0], row[1]))
    ordered: list[tuple[str, dict[str, Any]]] = [(row[1], row[2]) for row in sortable]

    shards: list[dict[str, Any]] = []
    for idx in range(child_count):
        start = idx * shard_size
        if start >= len(ordered):
            break
        chunk = ordered[start : start + shard_size]
        lead_ids = [item[0] for item in chunk]
        seed = f"{trace_id}|{idx + 1}|{'|'.join(lead_ids)}"
        child_hash = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:10]
        child_id = f"sub_{idx + 1:02d}_{child_hash}"
        shards.append(
            {
                "child_id": child_id,
                "child_index": idx + 1,
                "lead_ids": lead_ids,
                "leads": [item[1] for item in chunk],
            }
        )

    return {
        "trace_id": trace_id,
        "lead_count": total,
        "child_count": len(shards),
        "leads_per_child": shard_size,
        "shards": shards,
    }


def create_spawn_run(
    *,
    tenant_id: str,
    user_id: str,
    trace_id: str,
    mode: str,
    parent_agent: str,
    plan: dict[str, Any],
    max_concurrency: int,
) -> str:
    ensure_schema()
    now = _utc_now()
    digest = hashlib.sha1(
        f"{tenant_id}|{user_id}|{trace_id}|{mode}|{plan.get('child_count', 0)}|{now}".encode("utf-8")
    ).hexdigest()[:12]
    spawn_run_id = f"spr_{digest}"
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO followup_spawn_runs(
                spawn_run_id, tenant_id, user_id, trace_id, mode, parent_agent,
                lead_count, child_count, max_concurrency, status, plan_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
            """,
            (
                spawn_run_id,
                tenant_id,
                user_id,
                trace_id,
                mode,
                parent_agent,
                int(plan.get("lead_count", 0) or 0),
                int(plan.get("child_count", 0) or 0),
                max(1, int(max_concurrency or 1)),
                json.dumps(plan, ensure_ascii=False, default=str),
                now,
                now,
            ),
        )
    return spawn_run_id


def record_child_run(
    *,
    spawn_run_id: str,
    child_id: str,
    worker_id: str,
    lead_ids: list[str],
    status: str,
    action_count: int,
    started_at: str,
    finished_at: str,
    duration_ms: int,
    error: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    ensure_schema()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO followup_child_runs(
                spawn_run_id, child_id, worker_id, lead_ids_json, status, action_count,
                started_at, finished_at, duration_ms, error, detail_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(spawn_run_id, child_id) DO UPDATE SET
                worker_id=excluded.worker_id,
                lead_ids_json=excluded.lead_ids_json,
                status=excluded.status,
                action_count=excluded.action_count,
                started_at=excluded.started_at,
                finished_at=excluded.finished_at,
                duration_ms=excluded.duration_ms,
                error=excluded.error,
                detail_json=excluded.detail_json
            """,
            (
                spawn_run_id,
                child_id,
                worker_id,
                json.dumps(list(lead_ids), ensure_ascii=False),
                str(status or "unknown").strip().lower()[:32] or "unknown",
                max(0, int(action_count or 0)),
                started_at,
                finished_at,
                max(0, int(duration_ms or 0)),
                (str(error)[:500] if error else None),
                json.dumps(detail or {}, ensure_ascii=False, default=str),
            ),
        )


def finish_spawn_run(*, spawn_run_id: str, status: str, summary: dict[str, Any] | None = None) -> None:
    ensure_schema()
    now = _utc_now()
    with _conn() as conn:
        row = conn.execute(
            "SELECT plan_json FROM followup_spawn_runs WHERE spawn_run_id = ?",
            (spawn_run_id,),
        ).fetchone()
        plan_obj: dict[str, Any] = {}
        if row is not None:
            try:
                plan_obj = json.loads(str(row["plan_json"] or "{}"))
            except json.JSONDecodeError:
                plan_obj = {}
        if summary:
            plan_obj["execution_summary"] = summary
        conn.execute(
            """
            UPDATE followup_spawn_runs
            SET status = ?, plan_json = ?, updated_at = ?
            WHERE spawn_run_id = ?
            """,
            (
                str(status or "completed").strip().lower()[:32] or "completed",
                json.dumps(plan_obj, ensure_ascii=False, default=str),
                now,
                spawn_run_id,
            ),
        )


def get_spawn_run(
    *,
    tenant_id: str,
    user_id: str,
    trace_id: str,
) -> dict[str, Any]:
    ensure_schema()
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT * FROM followup_spawn_runs
            WHERE tenant_id = ? AND user_id = ? AND trace_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (tenant_id, user_id, trace_id),
        ).fetchone()
        if row is None:
            return {}
        spawn_run_id = str(row["spawn_run_id"])
        child_rows = conn.execute(
            """
            SELECT child_id, worker_id, lead_ids_json, status, action_count, started_at, finished_at,
                   duration_ms, error, detail_json
            FROM followup_child_runs
            WHERE spawn_run_id = ?
            ORDER BY child_id ASC
            """,
            (spawn_run_id,),
        ).fetchall()

    try:
        plan = json.loads(str(row["plan_json"] or "{}"))
    except json.JSONDecodeError:
        plan = {}

    children: list[dict[str, Any]] = []
    for item in child_rows:
        try:
            lead_ids = json.loads(str(item["lead_ids_json"] or "[]"))
        except json.JSONDecodeError:
            lead_ids = []
        try:
            detail = json.loads(str(item["detail_json"] or "{}"))
        except json.JSONDecodeError:
            detail = {}
        children.append(
            {
                "child_id": str(item["child_id"]),
                "worker_id": str(item["worker_id"]),
                "lead_ids": lead_ids if isinstance(lead_ids, list) else [],
                "status": str(item["status"]),
                "action_count": int(item["action_count"] or 0),
                "started_at": item["started_at"],
                "finished_at": item["finished_at"],
                "duration_ms": int(item["duration_ms"] or 0),
                "error": item["error"],
                "detail": detail if isinstance(detail, dict) else {},
            }
        )

    return {
        "spawn_run_id": spawn_run_id,
        "tenant_id": str(row["tenant_id"]),
        "user_id": str(row["user_id"]),
        "trace_id": str(row["trace_id"]),
        "mode": str(row["mode"]),
        "status": str(row["status"]),
        "parent_agent": str(row["parent_agent"]),
        "lead_count": int(row["lead_count"] or 0),
        "child_count": int(row["child_count"] or 0),
        "max_concurrency": int(row["max_concurrency"] or 1),
        "plan": plan if isinstance(plan, dict) else {},
        "children": children,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_recent_spawn_runs(
    *,
    tenant_id: str,
    user_id: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    ensure_schema()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT spawn_run_id, trace_id, mode, status, lead_count, child_count, max_concurrency,
                   created_at, updated_at
            FROM followup_spawn_runs
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (tenant_id, user_id, max(1, min(int(limit or 20), 200))),
        ).fetchall()
    output: list[dict[str, Any]] = []
    for row in rows:
        output.append(
            {
                "spawn_run_id": str(row["spawn_run_id"]),
                "trace_id": str(row["trace_id"]),
                "mode": str(row["mode"]),
                "status": str(row["status"]),
                "lead_count": int(row["lead_count"] or 0),
                "child_count": int(row["child_count"] or 0),
                "max_concurrency": int(row["max_concurrency"] or 1),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )
    return output
