"""
Escalation manager for retry exhaustion and human review.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("escalation_manager")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("ESCALATION_DB_PATH", "./data/escalations.sqlite").strip()
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


def ensure_escalation_schema() -> None:
    conn = _conn()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS escalations (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'tenant_main',
                task_id TEXT,
                lobster_id TEXT NOT NULL,
                error_summary TEXT NOT NULL,
                retry_count INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                resolution TEXT,
                resolution_note TEXT,
                resolved_by TEXT,
                created_at TEXT NOT NULL,
                resolved_at TEXT,
                notified_channels TEXT NOT NULL DEFAULT '[]',
                context_json TEXT NOT NULL DEFAULT '{}'
            );

            CREATE INDEX IF NOT EXISTS idx_escalations_tenant
                ON escalations(tenant_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_escalations_status
                ON escalations(status, created_at DESC);
            """
        )
        conn.commit()
    finally:
        conn.close()


@dataclass
class EscalationEvent:
    escalation_id: str
    tenant_id: str
    task_id: str | None
    lobster_id: str
    error_summary: str
    retry_count: int
    status: str = "pending_human_review"
    created_at: str = field(default_factory=_utc_now)
    notified_channels: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "escalation_id": self.escalation_id,
            "tenant_id": self.tenant_id,
            "task_id": self.task_id,
            "lobster_id": self.lobster_id,
            "error_summary": self.error_summary,
            "retry_count": self.retry_count,
            "status": self.status,
            "created_at": self.created_at,
            "notified_channels": list(self.notified_channels),
        }


def _build_escalation_message(event: EscalationEvent, context: dict[str, Any]) -> str:
    task_hint = str(context.get("task_type") or context.get("workflow_step_id") or "").strip()
    return (
        "⚠️ 龙虾任务升级通知\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        f"🦞 龙虾：{event.lobster_id}\n"
        f"📋 任务ID：{event.task_id or 'N/A'}\n"
        f"🧭 任务类型：{task_hint or 'unknown'}\n"
        f"❌ 失败原因：{event.error_summary[:220]}\n"
        f"🔄 已重试：{event.retry_count} 次\n"
        f"⏰ 时间：{event.created_at}\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        f"处理链接：/escalations/{event.escalation_id}\n"
        "请人工选择：继续 / 跳过 / 修改后重试"
    )


async def _send_escalation_notifications(event: EscalationEvent, context: dict[str, Any]) -> list[str]:
    notified: list[str] = []
    message = _build_escalation_message(event, context)

    try:
        from notification_center import send_notification

        await send_notification(
            tenant_id=event.tenant_id,
            message=message,
            level="warning",
            category="escalation",
        )
        notified.append("notification_center")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Escalation] notification_center failed: %s", exc)

    return notified


async def escalate(
    *,
    tenant_id: str = "tenant_main",
    task_id: str | None = None,
    lobster_id: str,
    error_summary: str,
    retry_count: int = 0,
    context: dict[str, Any] | None = None,
) -> EscalationEvent:
    ensure_escalation_schema()
    payload_context = dict(context or {})
    event = EscalationEvent(
        escalation_id=f"esc_{uuid.uuid4().hex[:12]}",
        tenant_id=tenant_id,
        task_id=task_id,
        lobster_id=lobster_id,
        error_summary=str(error_summary or "")[:1000],
        retry_count=max(0, int(retry_count)),
    )
    event.notified_channels = await _send_escalation_notifications(event, payload_context)

    conn = _conn()
    try:
        conn.execute(
            """
            INSERT INTO escalations (
                id, tenant_id, task_id, lobster_id, error_summary, retry_count,
                status, resolution, resolution_note, resolved_by, created_at,
                resolved_at, notified_channels, context_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)
            """,
            (
                event.escalation_id,
                event.tenant_id,
                event.task_id,
                event.lobster_id,
                event.error_summary,
                event.retry_count,
                event.status,
                event.created_at,
                json.dumps(event.notified_channels, ensure_ascii=False),
                json.dumps(payload_context, ensure_ascii=False),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    try:
        from audit_logger import record_audit_log

        await record_audit_log(
            tenant_id=tenant_id,
            user_id="system",
            operator="system",
            action="escalation_created",
            category="workflow",
            resource_type="escalation",
            resource_id=event.escalation_id,
            summary=f"{lobster_id} escalated after retry exhaustion",
            detail={**event.to_dict(), "context": payload_context},
            result="warning",
            source="escalation_manager",
            trace_id=str(task_id or event.escalation_id),
        )
    except Exception:
        pass

    return event


def list_escalations(
    tenant_id: str = "tenant_main",
    status: str | None = "pending_human_review",
    limit: int = 50,
) -> list[dict[str, Any]]:
    ensure_escalation_schema()
    query = "SELECT * FROM escalations WHERE tenant_id = ?"
    params: list[Any] = [tenant_id]
    if status:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(int(limit), 200)))
    conn = _conn()
    try:
        rows = conn.execute(query, params).fetchall()
    finally:
        conn.close()
    items: list[dict[str, Any]] = []
    for row in rows:
        payload = dict(row)
        payload["escalation_id"] = payload.pop("id")
        payload["notified_channels"] = json.loads(str(payload.get("notified_channels") or "[]"))
        payload["context"] = json.loads(str(payload.pop("context_json", "{}") or "{}"))
        items.append(payload)
    return items


def resolve_escalation(
    escalation_id: str,
    *,
    resolution: str,
    note: str = "",
    resolved_by: str = "human",
) -> dict[str, Any]:
    ensure_escalation_schema()
    normalized = str(resolution or "skip").strip().lower()
    if normalized not in {"continue", "skip", "retry"}:
        raise ValueError("resolution must be continue, skip, or retry")
    resolved_at = _utc_now()
    conn = _conn()
    try:
        conn.execute(
            """
            UPDATE escalations
               SET status = ?, resolution = ?, resolution_note = ?, resolved_by = ?, resolved_at = ?
             WHERE id = ?
            """,
            (
                f"resolved_{normalized}",
                normalized,
                str(note or "")[:500],
                str(resolved_by or "human")[:120],
                resolved_at,
                str(escalation_id or "").strip(),
            ),
        )
        row = conn.execute("SELECT * FROM escalations WHERE id = ?", (str(escalation_id or "").strip(),)).fetchone()
        conn.commit()
    finally:
        conn.close()
    if row is None:
        return {}
    payload = dict(row)
    payload["escalation_id"] = payload.pop("id")
    payload["notified_channels"] = json.loads(str(payload.get("notified_channels") or "[]"))
    payload["context"] = json.loads(str(payload.pop("context_json", "{}") or "{}"))
    return payload
