from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any


def _db_path() -> str:
    raw = os.getenv("RESEARCH_RADAR_DB_PATH", "./data/research_radar.sqlite").strip()
    if os.path.isabs(raw):
        return raw
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(base_dir, raw))


def _ensure_parent(path: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


@contextmanager
def _conn() -> sqlite3.Connection:
    path = _db_path()
    _ensure_parent(path)
    conn = sqlite3.connect(path, timeout=20, isolation_level=None)
    try:
        conn.row_factory = sqlite3.Row
        yield conn
    finally:
        conn.close()


_LOCK = threading.RLock()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_schema() -> None:
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS research_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                signal_id TEXT NOT NULL UNIQUE,
                tenant_id TEXT NOT NULL,
                source TEXT NOT NULL,
                bucket TEXT NOT NULL, -- A_auto / B_semi / C_manual
                rank_type TEXT NOT NULL, -- hot / latest / manual
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                summary TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                score REAL NOT NULL DEFAULT 0.0,
                credibility REAL NOT NULL DEFAULT 0.0,
                actionability REAL NOT NULL DEFAULT 0.0,
                raw_json TEXT NOT NULL,
                published_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_research_signals_tenant_source_rank
            ON research_signals(tenant_id, source, rank_type, score DESC)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_research_signals_tenant_created
            ON research_signals(tenant_id, created_at DESC)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS research_fetch_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL UNIQUE,
                tenant_id TEXT NOT NULL,
                trigger_type TEXT NOT NULL, -- manual / scheduled
                requested_sources_json TEXT NOT NULL,
                success_count INTEGER NOT NULL DEFAULT 0,
                fail_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL, -- running/success/failed
                error_summary TEXT,
                started_at TEXT NOT NULL,
                finished_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS research_source_health (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                source TEXT NOT NULL,
                last_run_id TEXT,
                last_status TEXT NOT NULL,
                last_error TEXT,
                last_item_count INTEGER NOT NULL DEFAULT 0,
                last_duration_ms INTEGER NOT NULL DEFAULT 0,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                last_success_at TEXT,
                last_failure_at TEXT,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, source)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_research_source_health_tenant
            ON research_source_health(tenant_id, updated_at DESC)
            """
        )


def _signal_id(tenant_id: str, source: str, rank_type: str, title: str, url: str) -> str:
    digest = sha256(f"{tenant_id}|{source}|{rank_type}|{title}|{url}".encode("utf-8")).hexdigest()
    return f"rs_{digest[:24]}"


def upsert_signal(
    *,
    tenant_id: str,
    source: str,
    bucket: str,
    rank_type: str,
    title: str,
    url: str,
    summary: str,
    tags: list[str],
    score: float,
    credibility: float,
    actionability: float,
    raw: dict[str, Any],
    published_at: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now_iso()
    signal_id = _signal_id(tenant_id, source, rank_type, title, url)
    payload = {
        "signal_id": signal_id,
        "tenant_id": tenant_id,
        "source": source,
        "bucket": bucket,
        "rank_type": rank_type,
        "title": title[:300],
        "url": url[:1000],
        "summary": summary[:4000],
        "tags_json": json.dumps(tags[:30], ensure_ascii=False),
        "score": float(score),
        "credibility": float(credibility),
        "actionability": float(actionability),
        "raw_json": json.dumps(raw, ensure_ascii=False)[:20000],
        "published_at": (published_at or "")[:64] or None,
        "created_at": now,
        "updated_at": now,
    }
    with _LOCK, _conn() as conn:
        existing = conn.execute(
            "SELECT id FROM research_signals WHERE signal_id = ?",
            (signal_id,),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO research_signals(
                    signal_id, tenant_id, source, bucket, rank_type, title, url, summary,
                    tags_json, score, credibility, actionability, raw_json, published_at, created_at, updated_at
                )
                VALUES(
                    :signal_id, :tenant_id, :source, :bucket, :rank_type, :title, :url, :summary,
                    :tags_json, :score, :credibility, :actionability, :raw_json, :published_at, :created_at, :updated_at
                )
                """,
                payload,
            )
            payload["inserted"] = True
        else:
            conn.execute(
                """
                UPDATE research_signals
                SET summary=:summary,
                    tags_json=:tags_json,
                    score=:score,
                    credibility=:credibility,
                    actionability=:actionability,
                    raw_json=:raw_json,
                    published_at=:published_at,
                    updated_at=:updated_at
                WHERE signal_id=:signal_id
                """,
                payload,
            )
            payload["inserted"] = False
    return payload


def list_signals(
    *,
    tenant_id: str,
    source: str | None = None,
    rank_type: str | None = None,
    limit: int = 20,
    only_executable: bool = False,
) -> list[dict[str, Any]]:
    ensure_schema()
    where = ["tenant_id = ?"]
    params: list[Any] = [tenant_id]
    if source:
        where.append("source = ?")
        params.append(source)
    if rank_type:
        where.append("rank_type = ?")
        params.append(rank_type)
    if only_executable:
        where.append("actionability >= 0.65")
    limit = max(1, min(int(limit), 200))
    params.append(limit)

    sql = (
        "SELECT signal_id, tenant_id, source, bucket, rank_type, title, url, summary, tags_json, "
        "score, credibility, actionability, published_at, created_at, updated_at "
        f"FROM research_signals WHERE {' AND '.join(where)} ORDER BY score DESC, updated_at DESC LIMIT ?"
    )
    with _LOCK, _conn() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()

    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            tags = json.loads(str(row["tags_json"] or "[]"))
            if not isinstance(tags, list):
                tags = []
        except json.JSONDecodeError:
            tags = []
        out.append(
            {
                "signal_id": str(row["signal_id"]),
                "tenant_id": str(row["tenant_id"]),
                "source": str(row["source"]),
                "bucket": str(row["bucket"]),
                "rank_type": str(row["rank_type"]),
                "title": str(row["title"]),
                "url": str(row["url"]),
                "summary": str(row["summary"]),
                "tags": [str(t) for t in tags[:30]],
                "score": float(row["score"] or 0),
                "credibility": float(row["credibility"] or 0),
                "actionability": float(row["actionability"] or 0),
                "published_at": str(row["published_at"] or ""),
                "created_at": str(row["created_at"] or ""),
                "updated_at": str(row["updated_at"] or ""),
            }
        )
    return out


def begin_fetch_run(*, tenant_id: str, trigger_type: str, requested_sources: list[str]) -> dict[str, Any]:
    ensure_schema()
    run_id = _signal_id(tenant_id, "fetch_run", trigger_type, ",".join(sorted(requested_sources)), _utc_now_iso())
    started_at = _utc_now_iso()
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            INSERT INTO research_fetch_runs(
                run_id, tenant_id, trigger_type, requested_sources_json, success_count, fail_count, status, started_at
            )
            VALUES(?, ?, ?, ?, 0, 0, 'running', ?)
            """,
            (run_id, tenant_id, trigger_type, json.dumps(requested_sources, ensure_ascii=False), started_at),
        )
    return {"run_id": run_id, "tenant_id": tenant_id, "status": "running", "started_at": started_at}


def finish_fetch_run(*, run_id: str, success_count: int, fail_count: int, error_summary: str = "") -> None:
    ensure_schema()
    status = "success" if fail_count == 0 else ("failed" if success_count == 0 else "partial_success")
    with _LOCK, _conn() as conn:
        conn.execute(
            """
            UPDATE research_fetch_runs
            SET success_count = ?, fail_count = ?, status = ?, error_summary = ?, finished_at = ?
            WHERE run_id = ?
            """,
            (int(success_count), int(fail_count), status, error_summary[:2000], _utc_now_iso(), run_id),
        )


def record_source_health(
    *,
    tenant_id: str,
    source: str,
    run_id: str,
    status: str,
    item_count: int,
    duration_ms: int,
    error_message: str = "",
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now_iso()
    safe_status = str(status or "unknown").strip().lower() or "unknown"
    safe_error = str(error_message or "").strip()[:2000]

    with _LOCK, _conn() as conn:
        existing = conn.execute(
            """
            SELECT consecutive_failures, last_success_at, last_failure_at
            FROM research_source_health
            WHERE tenant_id = ? AND source = ?
            """,
            (tenant_id, source),
        ).fetchone()

        previous_failures = int(existing["consecutive_failures"]) if existing else 0
        if safe_status == "success":
            consecutive_failures = 0
        else:
            consecutive_failures = previous_failures + 1

        last_success_at = (
            now
            if safe_status == "success"
            else (str(existing["last_success_at"]) if existing and existing["last_success_at"] else None)
        )
        last_failure_at = (
            now
            if safe_status != "success"
            else (str(existing["last_failure_at"]) if existing and existing["last_failure_at"] else None)
        )

        conn.execute(
            """
            INSERT INTO research_source_health(
                tenant_id, source, last_run_id, last_status, last_error, last_item_count,
                last_duration_ms, consecutive_failures, last_success_at, last_failure_at, updated_at
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, source) DO UPDATE SET
                last_run_id=excluded.last_run_id,
                last_status=excluded.last_status,
                last_error=excluded.last_error,
                last_item_count=excluded.last_item_count,
                last_duration_ms=excluded.last_duration_ms,
                consecutive_failures=excluded.consecutive_failures,
                last_success_at=excluded.last_success_at,
                last_failure_at=excluded.last_failure_at,
                updated_at=excluded.updated_at
            """,
            (
                tenant_id,
                source,
                run_id,
                safe_status,
                safe_error,
                max(0, int(item_count)),
                max(0, int(duration_ms)),
                consecutive_failures,
                last_success_at,
                last_failure_at,
                now,
            ),
        )

    return {
        "tenant_id": tenant_id,
        "source": source,
        "last_run_id": run_id,
        "last_status": safe_status,
        "last_error": safe_error,
        "last_item_count": max(0, int(item_count)),
        "last_duration_ms": max(0, int(duration_ms)),
        "consecutive_failures": consecutive_failures,
        "last_success_at": last_success_at,
        "last_failure_at": last_failure_at,
        "updated_at": now,
    }


def list_source_health(*, tenant_id: str, limit: int = 20) -> list[dict[str, Any]]:
    ensure_schema()
    bounded_limit = max(1, min(int(limit), 200))
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            """
            SELECT tenant_id, source, last_run_id, last_status, last_error, last_item_count,
                   last_duration_ms, consecutive_failures, last_success_at, last_failure_at, updated_at
            FROM research_source_health
            WHERE tenant_id = ?
            ORDER BY updated_at DESC, source ASC
            LIMIT ?
            """,
            (tenant_id, bounded_limit),
        ).fetchall()

    return [
        {
            "tenant_id": str(row["tenant_id"]),
            "source": str(row["source"]),
            "last_run_id": str(row["last_run_id"] or ""),
            "last_status": str(row["last_status"] or ""),
            "last_error": str(row["last_error"] or ""),
            "last_item_count": int(row["last_item_count"] or 0),
            "last_duration_ms": int(row["last_duration_ms"] or 0),
            "consecutive_failures": int(row["consecutive_failures"] or 0),
            "last_success_at": str(row["last_success_at"] or ""),
            "last_failure_at": str(row["last_failure_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
        }
        for row in rows
    ]


def run_health_summary(*, tenant_id: str, window_hours: int = 24) -> dict[str, Any]:
    ensure_schema()
    hours = max(1, min(int(window_hours), 24 * 30))
    threshold = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    with _LOCK, _conn() as conn:
        rows = conn.execute(
            """
            SELECT status, started_at, finished_at
            FROM research_fetch_runs
            WHERE tenant_id = ? AND started_at >= ?
            ORDER BY started_at DESC
            """,
            (tenant_id, threshold),
        ).fetchall()

    total_runs = len(rows)
    success_runs = sum(1 for row in rows if str(row["status"] or "") == "success")
    partial_runs = sum(1 for row in rows if str(row["status"] or "") == "partial_success")
    failed_runs = sum(1 for row in rows if str(row["status"] or "") == "failed")
    success_rate = success_runs / total_runs if total_runs > 0 else 1.0

    return {
        "tenant_id": tenant_id,
        "window_hours": hours,
        "total_runs": total_runs,
        "success_runs": success_runs,
        "partial_success_runs": partial_runs,
        "failed_runs": failed_runs,
        "success_rate": round(success_rate, 4),
    }
