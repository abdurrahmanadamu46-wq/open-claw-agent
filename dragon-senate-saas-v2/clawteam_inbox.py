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
_VALID_STATUS = {"queued", "running", "completed", "failed", "canceled"}


def _db_path() -> str:
    return os.getenv("CLAWTEAM_DB_PATH", "./data/clawteam_inbox.sqlite").strip()


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("PRAGMA table_info(clawteam_tasks)").fetchall()
    cols = {str(row["name"]) for row in rows}
    statements = [
        ("worker_id", "TEXT"),
        ("attempt_count", "INTEGER NOT NULL DEFAULT 0"),
        ("started_at", "TEXT"),
        ("finished_at", "TEXT"),
        ("last_error", "TEXT"),
    ]
    for col, col_type in statements:
        if col in cols:
            continue
        conn.execute(f"ALTER TABLE clawteam_tasks ADD COLUMN {col} {col_type}")


def _ensure_worker_columns(conn: sqlite3.Connection) -> None:
    rows = conn.execute("PRAGMA table_info(clawteam_workers)").fetchall()
    cols = {str(row["name"]) for row in rows}
    statements = [
        ("meta_json", "TEXT NOT NULL DEFAULT '{}'"),
        ("status", "TEXT NOT NULL DEFAULT 'idle'"),
    ]
    for col, col_type in statements:
        if col in cols:
            continue
        conn.execute(f"ALTER TABLE clawteam_workers ADD COLUMN {col} {col_type}")


def ensure_schema() -> None:
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS clawteam_tasks (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                trace_id TEXT NOT NULL,
                task_key TEXT NOT NULL,
                lane TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                priority INTEGER NOT NULL DEFAULT 100,
                depends_json TEXT NOT NULL DEFAULT '[]',
                payload_json TEXT NOT NULL DEFAULT '{}',
                worktree_path TEXT,
                worker_id TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                finished_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(trace_id, task_key)
            )
            """
        )
        _ensure_columns(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS clawteam_workers (
                worker_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                trace_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                lanes_json TEXT NOT NULL DEFAULT '[]',
                heartbeat_at TEXT NOT NULL,
                claimed_count INTEGER NOT NULL DEFAULT 0,
                completed_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                meta_json TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        _ensure_worker_columns(conn)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_clawteam_user_trace ON clawteam_tasks(user_id, trace_id, status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_clawteam_lane_status ON clawteam_tasks(trace_id, lane, status, priority)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_clawteam_worker_trace ON clawteam_workers(user_id, trace_id, heartbeat_at DESC)"
        )


def _normalize_depends(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def _normalize_payload(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    return {"raw_payload": str(raw)}


def _normalize_status(status: str) -> str:
    status_norm = status.strip().lower()
    if status_norm not in _VALID_STATUS:
        return "failed"
    return status_norm


def _status_map(conn: sqlite3.Connection, trace_id: str) -> dict[str, str]:
    rows = conn.execute(
        "SELECT task_key, status FROM clawteam_tasks WHERE trace_id = ?",
        (trace_id,),
    ).fetchall()
    return {str(row["task_key"]): str(row["status"]) for row in rows}


def _row_to_task(row: sqlite3.Row) -> dict[str, Any]:
    try:
        depends = json.loads(str(row["depends_json"] or "[]"))
    except json.JSONDecodeError:
        depends = []
    depends = [str(x).strip() for x in depends if str(x).strip()]
    try:
        payload = json.loads(str(row["payload_json"] or "{}"))
    except json.JSONDecodeError:
        payload = {"raw_payload": str(row["payload_json"] or "")}
    return {
        "id": str(row["id"]),
        "task_key": str(row["task_key"]),
        "lane": str(row["lane"]),
        "status": str(row["status"]),
        "priority": int(row["priority"]),
        "depends_on": depends,
        "payload": payload,
        "worktree_path": str(row["worktree_path"] or ""),
        "worker_id": str(row["worker_id"] or ""),
        "attempt_count": int(row["attempt_count"] or 0),
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "last_error": row["last_error"],
    }


def _normalize_lanes(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    lanes: list[str] = []
    seen: set[str] = set()
    for item in raw:
        lane = str(item).strip().lower()
        if not lane or lane in seen:
            continue
        seen.add(lane)
        lanes.append(lane)
    return lanes


def heartbeat_worker(
    *,
    worker_id: str,
    user_id: str,
    trace_id: str,
    lanes: list[str] | None = None,
    status: str = "idle",
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    now = _now()
    lanes_norm = _normalize_lanes(lanes or [])
    status_norm = status.strip().lower() or "idle"
    meta_json = json.dumps(meta or {}, ensure_ascii=False, default=str)
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            INSERT INTO clawteam_workers(
                worker_id, user_id, trace_id, status, lanes_json, heartbeat_at, meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(worker_id) DO UPDATE SET
                user_id=excluded.user_id,
                trace_id=excluded.trace_id,
                status=excluded.status,
                lanes_json=excluded.lanes_json,
                heartbeat_at=excluded.heartbeat_at,
                meta_json=excluded.meta_json
            """,
            (
                worker_id,
                user_id,
                trace_id,
                status_norm,
                json.dumps(lanes_norm, ensure_ascii=False),
                now,
                meta_json,
            ),
        )
    return {
        "worker_id": worker_id,
        "user_id": user_id,
        "trace_id": trace_id,
        "status": status_norm,
        "lanes": lanes_norm,
        "heartbeat_at": now,
    }


def enqueue_inbox_tasks(
    *,
    user_id: str,
    trace_id: str,
    tasks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    ensure_schema()
    now = _now()
    created: list[dict[str, Any]] = []
    with _LOCK, _conn() as conn:
        for idx, raw in enumerate(tasks):
            task_key = str(raw.get("task_key") or f"task_{idx + 1}").strip()
            if not task_key:
                continue
            task_id = str(raw.get("id") or uuid.uuid4().hex)
            lane = str(raw.get("lane") or "general").strip().lower()[:64] or "general"
            priority = int(raw.get("priority", 100) or 100)
            depends_norm = _normalize_depends(raw.get("depends_on", []))
            payload = _normalize_payload(raw.get("payload", {}))
            worktree_path = str(
                raw.get("worktree_path")
                or f"./worktrees/{user_id}/{trace_id}/{lane}/{task_key.replace('.', '_')}"
            )[:260]

            conn.execute(
                """
                INSERT INTO clawteam_tasks(
                    id, user_id, trace_id, task_key, lane, status, priority,
                    depends_json, payload_json, worktree_path,
                    worker_id, attempt_count, started_at, finished_at, last_error,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, NULL, 0, NULL, NULL, NULL, ?, ?)
                ON CONFLICT(trace_id, task_key) DO UPDATE SET
                    lane=excluded.lane,
                    priority=excluded.priority,
                    depends_json=excluded.depends_json,
                    payload_json=excluded.payload_json,
                    worktree_path=excluded.worktree_path,
                    status='queued',
                    worker_id=NULL,
                    started_at=NULL,
                    finished_at=NULL,
                    last_error=NULL,
                    updated_at=excluded.updated_at
                """,
                (
                    task_id,
                    user_id,
                    trace_id,
                    task_key,
                    lane,
                    priority,
                    json.dumps(depends_norm, ensure_ascii=False),
                    json.dumps(payload, ensure_ascii=False, default=str),
                    worktree_path,
                    now,
                    now,
                ),
            )
            created.append(
                {
                    "id": task_id,
                    "task_key": task_key,
                    "lane": lane,
                    "priority": priority,
                    "depends_on": depends_norm,
                    "worktree_path": worktree_path,
                    "status": "queued",
                }
            )
    return created


def get_ready_tasks(*, user_id: str, trace_id: str, limit: int = 20) -> list[dict[str, Any]]:
    ensure_schema()
    limit = max(1, min(int(limit), 200))
    with _LOCK, _conn() as conn:
        status_map = _status_map(conn, trace_id)
        rows = conn.execute(
            """
            SELECT id, task_key, lane, status, priority, depends_json, payload_json, worktree_path,
                   worker_id, attempt_count, started_at, finished_at, last_error
            FROM clawteam_tasks
            WHERE user_id = ? AND trace_id = ? AND status = 'queued'
            ORDER BY priority ASC, created_at ASC
            LIMIT ?
            """,
            (user_id, trace_id, limit * 5),
        ).fetchall()

        ready: list[dict[str, Any]] = []
        for row in rows:
            task = _row_to_task(row)
            if any(status_map.get(dep) != "completed" for dep in task["depends_on"]):
                continue
            ready.append(task)
            if len(ready) >= limit:
                break
        return ready


def claim_ready_tasks(
    *,
    user_id: str,
    trace_id: str,
    worker_id: str,
    lanes: list[str] | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    ensure_schema()
    limit = max(1, min(int(limit), 200))
    lane_filter = {str(x).strip().lower() for x in (lanes or []) if str(x).strip()}
    now = _now()

    with _LOCK, _conn() as conn:
        conn.execute(
            """
            INSERT INTO clawteam_workers(worker_id, user_id, trace_id, status, lanes_json, heartbeat_at)
            VALUES (?, ?, ?, 'running', ?, ?)
            ON CONFLICT(worker_id) DO UPDATE SET
                user_id=excluded.user_id,
                trace_id=excluded.trace_id,
                status='running',
                lanes_json=excluded.lanes_json,
                heartbeat_at=excluded.heartbeat_at
            """,
            (
                worker_id,
                user_id,
                trace_id,
                json.dumps(sorted(lane_filter), ensure_ascii=False),
                now,
            ),
        )
        status_map = _status_map(conn, trace_id)
        rows = conn.execute(
            """
            SELECT id, task_key, lane, status, priority, depends_json, payload_json, worktree_path,
                   worker_id, attempt_count, started_at, finished_at, last_error
            FROM clawteam_tasks
            WHERE user_id = ? AND trace_id = ? AND status = 'queued'
            ORDER BY priority ASC, created_at ASC
            LIMIT ?
            """,
            (user_id, trace_id, limit * 8),
        ).fetchall()

        claimed: list[dict[str, Any]] = []
        for row in rows:
            lane = str(row["lane"] or "").strip().lower()
            if lane_filter and lane not in lane_filter:
                continue
            task = _row_to_task(row)
            if any(status_map.get(dep) != "completed" for dep in task["depends_on"]):
                continue

            update_row = conn.execute(
                """
                UPDATE clawteam_tasks
                SET status = 'running',
                    worker_id = ?,
                    attempt_count = attempt_count + 1,
                    started_at = ?,
                    updated_at = ?,
                    last_error = NULL
                WHERE id = ? AND status = 'queued'
                """,
                (worker_id, now, now, task["id"]),
            )
            if update_row.rowcount <= 0:
                continue

            task["status"] = "running"
            task["worker_id"] = worker_id
            task["attempt_count"] = int(task.get("attempt_count", 0) or 0) + 1
            task["started_at"] = now
            task["last_error"] = None
            claimed.append(task)
            status_map[task["task_key"]] = "running"
            conn.execute(
                """
                UPDATE clawteam_workers
                SET claimed_count = claimed_count + 1,
                    heartbeat_at = ?,
                    status = 'running'
                WHERE worker_id = ?
                """,
                (now, worker_id),
            )

            if len(claimed) >= limit:
                break
        return claimed


def mark_many_status(
    *,
    trace_id: str,
    task_keys: list[str],
    status: str,
    worker_id: str | None = None,
    error: str | None = None,
) -> int:
    ensure_schema()
    keys = [str(x).strip() for x in task_keys if str(x).strip()]
    if not keys:
        return 0
    status_norm = _normalize_status(status)
    now = _now()
    finished_at = now if status_norm in {"completed", "failed", "canceled"} else None
    error_value = (error or "")[:600] if status_norm == "failed" else None

    with _LOCK, _conn() as conn:
        count = 0
        for key in keys:
            row = conn.execute(
                """
                UPDATE clawteam_tasks
                SET status = ?,
                    worker_id = COALESCE(?, worker_id),
                    updated_at = ?,
                    finished_at = COALESCE(?, finished_at),
                    last_error = ?
                WHERE trace_id = ? AND task_key = ?
                """,
                (
                    status_norm,
                    worker_id,
                    now,
                    finished_at,
                    error_value,
                    trace_id,
                    key,
                ),
            )
            count += int(row.rowcount or 0)
        if worker_id:
            if status_norm == "completed":
                conn.execute(
                    """
                    UPDATE clawteam_workers
                    SET completed_count = completed_count + ?,
                        heartbeat_at = ?,
                        status = 'running'
                    WHERE worker_id = ?
                    """,
                    (count, now, worker_id),
                )
            elif status_norm == "failed":
                conn.execute(
                    """
                    UPDATE clawteam_workers
                    SET failed_count = failed_count + ?,
                        heartbeat_at = ?,
                        status = 'running'
                    WHERE worker_id = ?
                    """,
                    (count, now, worker_id),
                )
            elif status_norm in {"canceled"}:
                conn.execute(
                    """
                    UPDATE clawteam_workers
                    SET heartbeat_at = ?,
                        status = 'idle'
                    WHERE worker_id = ?
                    """,
                    (now, worker_id),
                )
        return count


def requeue_stale_running_tasks(
    *,
    user_id: str,
    trace_id: str,
    stale_after_sec: int = 180,
    max_attempt_count: int = 5,
) -> dict[str, Any]:
    ensure_schema()
    stale_after_sec = max(30, int(stale_after_sec))
    max_attempt_count = max(1, int(max_attempt_count))
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, task_key, worker_id, attempt_count, updated_at
            FROM clawteam_tasks
            WHERE user_id = ? AND trace_id = ? AND status = 'running'
            """,
            (user_id, trace_id),
        ).fetchall()

        now_dt = datetime.now(timezone.utc)
        reclaimed: list[str] = []
        failed: list[str] = []
        for row in rows:
            updated_raw = str(row["updated_at"] or "").strip()
            try:
                updated_dt = datetime.fromisoformat(updated_raw.replace("Z", "+00:00"))
                if updated_dt.tzinfo is None:
                    updated_dt = updated_dt.replace(tzinfo=timezone.utc)
            except ValueError:
                updated_dt = now_dt
            age_sec = int((now_dt - updated_dt).total_seconds())
            if age_sec < stale_after_sec:
                continue
            task_key = str(row["task_key"])
            attempts = int(row["attempt_count"] or 0)
            worker_id = str(row["worker_id"] or "")
            if attempts >= max_attempt_count:
                mark_many_status(
                    trace_id=trace_id,
                    task_keys=[task_key],
                    status="failed",
                    worker_id=worker_id or None,
                    error=f"stale_timeout_exceeded(age={age_sec}s, attempts={attempts})",
                )
                failed.append(task_key)
                continue
            conn.execute(
                """
                UPDATE clawteam_tasks
                SET status = 'queued',
                    worker_id = NULL,
                    started_at = NULL,
                    updated_at = ?,
                    last_error = ?
                WHERE id = ? AND status = 'running'
                """,
                (
                    _now(),
                    f"requeued_from_stale(age={age_sec}s)",
                    str(row["id"]),
                ),
            )
            reclaimed.append(task_key)

        return {
            "user_id": user_id,
            "trace_id": trace_id,
            "stale_after_sec": stale_after_sec,
            "max_attempt_count": max_attempt_count,
            "requeued_count": len(reclaimed),
            "failed_count": len(failed),
            "requeued_task_keys": reclaimed,
            "failed_task_keys": failed,
        }


def mark_task_status(*, trace_id: str, task_key: str, status: str, worker_id: str | None = None) -> bool:
    return bool(
        mark_many_status(
            trace_id=trace_id,
            task_keys=[task_key],
            status=status,
            worker_id=worker_id,
        )
    )


def mark_many_completed(*, trace_id: str, task_keys: list[str], worker_id: str | None = None) -> int:
    return mark_many_status(
        trace_id=trace_id,
        task_keys=task_keys,
        status="completed",
        worker_id=worker_id,
    )


def mark_many_failed(
    *,
    trace_id: str,
    task_keys: list[str],
    worker_id: str | None = None,
    error: str = "",
) -> int:
    return mark_many_status(
        trace_id=trace_id,
        task_keys=task_keys,
        status="failed",
        worker_id=worker_id,
        error=error,
    )


def list_tasks(
    *,
    user_id: str,
    trace_id: str,
    limit: int = 200,
    status: str | None = None,
    lane: str | None = None,
) -> list[dict[str, Any]]:
    ensure_schema()
    limit = max(1, min(int(limit), 500))
    params: list[Any] = [user_id, trace_id]
    where = ["user_id = ?", "trace_id = ?"]
    if status:
        where.append("status = ?")
        params.append(_normalize_status(status))
    if lane:
        where.append("lane = ?")
        params.append(str(lane).strip().lower())

    query = f"""
        SELECT id, task_key, lane, status, priority, depends_json, payload_json, worktree_path,
               worker_id, attempt_count, started_at, finished_at, last_error
        FROM clawteam_tasks
        WHERE {' AND '.join(where)}
        ORDER BY priority ASC, created_at ASC
        LIMIT ?
    """
    params.append(limit)
    with _LOCK, _conn() as conn:
        rows = conn.execute(query, tuple(params)).fetchall()
    return [_row_to_task(row) for row in rows]


def list_workers(
    *,
    user_id: str,
    trace_id: str,
    limit: int = 100,
) -> list[dict[str, Any]]:
    ensure_schema()
    limit = max(1, min(int(limit), 500))
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            """
            SELECT worker_id, user_id, trace_id, status, lanes_json, heartbeat_at,
                   claimed_count, completed_count, failed_count, meta_json
            FROM clawteam_workers
            WHERE user_id = ? AND trace_id = ?
            ORDER BY heartbeat_at DESC
            LIMIT ?
            """,
            (user_id, trace_id, limit),
        ).fetchall()
    output: list[dict[str, Any]] = []
    for row in rows:
        try:
            lanes = json.loads(str(row["lanes_json"] or "[]"))
            if not isinstance(lanes, list):
                lanes = []
        except json.JSONDecodeError:
            lanes = []
        try:
            meta = json.loads(str(row["meta_json"] or "{}"))
            if not isinstance(meta, dict):
                meta = {}
        except json.JSONDecodeError:
            meta = {}
        output.append(
            {
                "worker_id": str(row["worker_id"]),
                "user_id": str(row["user_id"]),
                "trace_id": str(row["trace_id"]),
                "status": str(row["status"]),
                "lanes": [str(x).strip().lower() for x in lanes if str(x).strip()],
                "heartbeat_at": str(row["heartbeat_at"]),
                "claimed_count": int(row["claimed_count"] or 0),
                "completed_count": int(row["completed_count"] or 0),
                "failed_count": int(row["failed_count"] or 0),
                "meta": meta,
            }
        )
    return output


def summary(*, user_id: str, trace_id: str) -> dict[str, Any]:
    ensure_schema()
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            """
            SELECT status, COUNT(*) AS c
            FROM clawteam_tasks
            WHERE user_id = ? AND trace_id = ?
            GROUP BY status
            """,
            (user_id, trace_id),
        ).fetchall()
        latest = conn.execute(
            """
            SELECT MAX(updated_at) AS latest_updated_at,
                   MAX(CASE WHEN status='failed' THEN updated_at END) AS latest_failed_at
            FROM clawteam_tasks
            WHERE user_id = ? AND trace_id = ?
            """,
            (user_id, trace_id),
        ).fetchone()
        worker_rows = conn.execute(
            """
            SELECT status, COUNT(*) AS c
            FROM clawteam_workers
            WHERE user_id = ? AND trace_id = ?
            GROUP BY status
            """,
            (user_id, trace_id),
        ).fetchall()
        worker_latest = conn.execute(
            """
            SELECT MAX(heartbeat_at) AS latest_heartbeat
            FROM clawteam_workers
            WHERE user_id = ? AND trace_id = ?
            """,
            (user_id, trace_id),
        ).fetchone()

    status_counts = {str(row["status"]): int(row["c"]) for row in rows}
    worker_counts = {str(row["status"]): int(row["c"]) for row in worker_rows}
    total = sum(status_counts.values())
    completed = status_counts.get("completed", 0)
    return {
        "user_id": user_id,
        "trace_id": trace_id,
        "total": total,
        "queued": status_counts.get("queued", 0),
        "running": status_counts.get("running", 0),
        "completed": completed,
        "failed": status_counts.get("failed", 0),
        "canceled": status_counts.get("canceled", 0),
        "progress": round(completed / total, 4) if total > 0 else 0.0,
        "latest_updated_at": latest["latest_updated_at"] if latest else None,
        "latest_failed_at": latest["latest_failed_at"] if latest else None,
        "workers_total": sum(worker_counts.values()),
        "workers_running": worker_counts.get("running", 0),
        "workers_idle": worker_counts.get("idle", 0),
        "workers_offline": worker_counts.get("offline", 0),
        "latest_worker_heartbeat": worker_latest["latest_heartbeat"] if worker_latest else None,
    }
