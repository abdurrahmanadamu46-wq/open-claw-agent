from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("APPROVAL_GATE_DB_PATH", "./data/approval_gate.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / raw).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]) == column for row in rows)


def ensure_schema() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS approval_gate_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                approval_id TEXT NOT NULL UNIQUE,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                trace_id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                tool_id TEXT NOT NULL,
                risk_level TEXT NOT NULL DEFAULT 'medium',
                action_summary TEXT NOT NULL DEFAULT '',
                approval_channel TEXT NOT NULL DEFAULT 'manual',
                approval_state TEXT NOT NULL DEFAULT 'waiting_human',
                context_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT NOT NULL DEFAULT '{}',
                timeline_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_approval_gate_tenant_trace
                ON approval_gate_requests (tenant_id, trace_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_approval_gate_state
                ON approval_gate_requests (approval_state, updated_at DESC);
            """
        )
        if not _has_column(conn, "approval_gate_requests", "timeline_json"):
            conn.execute(
                "ALTER TABLE approval_gate_requests ADD COLUMN timeline_json TEXT NOT NULL DEFAULT '[]'"
            )


def _timeline_event(*, event: str, actor: str, detail: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "event": str(event or "").strip() or "unknown",
        "actor": str(actor or "").strip() or "system",
        "detail": detail or {},
        "ts": _utc_now(),
    }


def create_pending_approval(
    *,
    approval_id: str | None = None,
    trace_id: str,
    request_id: str,
    tenant_id: str,
    user_id: str,
    agent_id: str,
    tool_id: str,
    risk_level: str,
    action_summary: str,
    approval_channel: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    safe_approval_id = str(approval_id or "").strip() or f"appr_{uuid.uuid4().hex[:12]}"
    now = _utc_now()
    row = {
        "approval_id": safe_approval_id,
        "tenant_id": str(tenant_id or "").strip(),
        "user_id": str(user_id or "").strip(),
        "trace_id": str(trace_id or "").strip(),
        "request_id": str(request_id or "").strip(),
        "agent_id": str(agent_id or "").strip(),
        "tool_id": str(tool_id or "").strip(),
        "risk_level": str(risk_level or "medium").strip().lower() or "medium",
        "action_summary": str(action_summary or "").strip()[:500],
        "approval_channel": str(approval_channel or "manual").strip().lower() or "manual",
        "approval_state": "waiting_human",
        "context_json": json.dumps(context or {}, ensure_ascii=False),
        "result_json": json.dumps(
            {
                "status": "pending",
                "approval_state": "waiting_human",
                "channel_payload": {
                    "channel": str(approval_channel or "manual").strip().lower() or "manual",
                    "message_preview": str(action_summary or "").strip()[:200],
                },
            },
            ensure_ascii=False,
        ),
        "timeline_json": json.dumps(
            [
                _timeline_event(
                    event="approval_requested",
                    actor="system",
                    detail={
                        "agent_id": str(agent_id or "").strip(),
                        "tool_id": str(tool_id or "").strip(),
                        "risk_level": str(risk_level or "").strip(),
                    },
                )
            ],
            ensure_ascii=False,
        ),
        "created_at": now,
        "updated_at": now,
    }
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO approval_gate_requests
                (approval_id, tenant_id, user_id, trace_id, request_id, agent_id, tool_id, risk_level, action_summary,
                 approval_channel, approval_state, context_json, result_json, timeline_json, created_at, updated_at)
            VALUES
                (:approval_id, :tenant_id, :user_id, :trace_id, :request_id, :agent_id, :tool_id, :risk_level, :action_summary,
                 :approval_channel, :approval_state, :context_json, :result_json, :timeline_json, :created_at, :updated_at)
            """,
            row,
        )
    return get_approval(safe_approval_id) or {}


def get_approval(approval_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT approval_id, tenant_id, user_id, trace_id, request_id, agent_id, tool_id, risk_level, action_summary,
                   approval_channel, approval_state, context_json, result_json, timeline_json, created_at, updated_at
            FROM approval_gate_requests
            WHERE approval_id = ?
            """,
            (str(approval_id or "").strip(),),
        ).fetchone()
    if row is None:
        return None
    return {
        "approval_id": str(row["approval_id"]),
        "tenant_id": str(row["tenant_id"]),
        "user_id": str(row["user_id"]),
        "trace_id": str(row["trace_id"]),
        "request_id": str(row["request_id"]),
        "agent_id": str(row["agent_id"]),
        "tool_id": str(row["tool_id"]),
        "risk_level": str(row["risk_level"]),
        "action_summary": str(row["action_summary"]),
        "approval_channel": str(row["approval_channel"]),
        "approval_state": str(row["approval_state"]),
        "context": json.loads(str(row["context_json"] or "{}")),
        "result": json.loads(str(row["result_json"] or "{}")),
        "timeline": json.loads(str(row["timeline_json"] or "[]")),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def resolve_approval(
    *,
    approval_id: str,
    decision: str,
    operator_id: str,
    reason: str | None = None,
) -> dict[str, Any] | None:
    ensure_schema()
    safe_decision = str(decision or "").strip().lower()
    if safe_decision not in {"approved", "rejected"}:
        raise ValueError("decision must be approved or rejected")
    now = _utc_now()
    result = {
        "status": "resolved",
        "approval_id": str(approval_id or "").strip(),
        "approval_state": safe_decision,
        "decision": safe_decision,
        "operator_id": str(operator_id or "").strip(),
        "reason": str(reason or "").strip()[:300] or None,
    }
    with _conn() as conn:
        row = conn.execute(
            "SELECT timeline_json FROM approval_gate_requests WHERE approval_id = ?",
            (str(approval_id or "").strip(),),
        ).fetchone()
        timeline = []
        if row is not None:
            try:
                timeline = json.loads(str(row["timeline_json"] or "[]"))
            except json.JSONDecodeError:
                timeline = []
        if not isinstance(timeline, list):
            timeline = []
        timeline.append(
            _timeline_event(
                event="approval_decided",
                actor=str(operator_id or "").strip() or "unknown_operator",
                detail={"decision": safe_decision, "reason": str(reason or "").strip()[:300] or None},
            )
        )
        conn.execute(
            """
            UPDATE approval_gate_requests
            SET approval_state = ?, result_json = ?, timeline_json = ?, updated_at = ?
            WHERE approval_id = ?
            """,
            (
                safe_decision,
                json.dumps(result, ensure_ascii=False),
                json.dumps(timeline, ensure_ascii=False),
                now,
                str(approval_id or "").strip(),
            ),
        )
    return get_approval(str(approval_id or "").strip())


def list_pending_approvals(*, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
    ensure_schema()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT approval_id
            FROM approval_gate_requests
            WHERE tenant_id = ? AND approval_state = 'waiting_human'
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (str(tenant_id or "").strip(), max(1, int(limit))),
        ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        item = get_approval(str(row["approval_id"]))
        if item:
            result.append(item)
    return result
