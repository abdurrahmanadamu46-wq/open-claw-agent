"""
Restore completion event reporting and summary generation.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("restore_event")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("RESTORE_EVENT_DB_PATH", "./data/restore_events.sqlite").strip()
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


def ensure_restore_schema() -> None:
    conn = _conn()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS restore_events (
                restore_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL DEFAULT 'tenant_main',
                backup_file TEXT NOT NULL,
                restore_type TEXT NOT NULL DEFAULT 'full',
                operator TEXT DEFAULT 'system',
                status TEXT NOT NULL DEFAULT 'completed',
                items_restored INTEGER DEFAULT 0,
                duration_seconds REAL DEFAULT 0,
                health_check_passed INTEGER DEFAULT 0,
                report_generated INTEGER DEFAULT 0,
                followup_report TEXT,
                detail_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_restore_events_tenant
                ON restore_events(tenant_id, created_at DESC);
            """
        )
        conn.commit()
    finally:
        conn.close()


def _compute_restore_id(backup_file: str, started_at: float) -> str:
    raw = f"{backup_file}:{int(started_at)}"
    return "rst_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


async def _generate_followup_report(
    *,
    restore_id: str,
    backup_file: str,
    items_restored: int,
    duration_seconds: float,
    tenant_id: str,
) -> str:
    try:
        from llm_router import RouteMeta, llm_router

        return await llm_router.routed_ainvoke_text(
            system_prompt="你是 FollowUp 汇报龙虾，请输出一段简洁的基础设施恢复摘要，必须以 FollowUpActionPlan: 开头。",
            user_prompt=(
                f"restore_id={restore_id}\n"
                f"backup_file={backup_file}\n"
                f"items_restored={items_restored}\n"
                f"duration_seconds={duration_seconds:.1f}\n"
                "请给出确认项、风险提醒和下一步建议。"
            ),
            meta=RouteMeta(
                critical=False,
                est_tokens=400,
                tenant_tier="basic",
                user_id="restore_event",
                tenant_id=tenant_id,
                task_type="restore_report",
            ),
            temperature=0.2,
        )
    except Exception:
        return (
            "FollowUpActionPlan:\n"
            f"- 已完成备份恢复：{backup_file}\n"
            f"- 恢复条目：{items_restored}\n"
            f"- 耗时：{duration_seconds:.1f} 秒\n"
            "- 建议下一步：检查边缘节点重连、校验关键配置、确认最近任务队列状态。"
        )


async def report_restore_complete(
    *,
    tenant_id: str = "tenant_main",
    backup_file: str,
    restore_type: str = "full",
    operator: str = "system",
    status: str = "completed",
    items_restored: int = 0,
    duration_seconds: float = 0.0,
    started_at: float | None = None,
    detail: dict[str, Any] | None = None,
    trigger_followup_report: bool = True,
) -> dict[str, Any]:
    ensure_restore_schema()
    restore_id = _compute_restore_id(backup_file, started_at or 0.0)

    conn = _conn()
    try:
        existing = conn.execute("SELECT restore_id FROM restore_events WHERE restore_id = ?", (restore_id,)).fetchone()
        if existing is not None:
            return {"restore_id": restore_id, "is_new": False}
    finally:
        conn.close()

    report_text = ""
    if trigger_followup_report and status == "completed":
        report_text = await _generate_followup_report(
            restore_id=restore_id,
            backup_file=backup_file,
            items_restored=items_restored,
            duration_seconds=duration_seconds,
            tenant_id=tenant_id,
        )

    conn = _conn()
    try:
        conn.execute(
            """
            INSERT INTO restore_events (
                restore_id, tenant_id, backup_file, restore_type, operator, status,
                items_restored, duration_seconds, health_check_passed, report_generated,
                followup_report, detail_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                restore_id,
                tenant_id,
                backup_file,
                restore_type,
                operator,
                status,
                int(items_restored),
                float(duration_seconds),
                0,
                1 if report_text else 0,
                report_text or None,
                json.dumps(detail or {}, ensure_ascii=False),
                _utc_now(),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    try:
        from notification_center import send_notification

        await send_notification(
            tenant_id=tenant_id,
            message=(
                "✅ 备份恢复通知\n"
                f"- 文件：{backup_file}\n"
                f"- 状态：{status}\n"
                f"- 条目：{items_restored}\n"
                f"- 耗时：{duration_seconds:.1f} 秒\n"
                f"- restore_id：{restore_id}"
            ),
            level="info" if status == "completed" else "warning",
            category="restore",
        )
    except Exception:
        pass

    try:
        from audit_logger import record_audit_log

        await record_audit_log(
            tenant_id=tenant_id,
            user_id=operator,
            operator=operator,
            action="restore_complete",
            category="infrastructure",
            resource_type="restore_event",
            resource_id=restore_id,
            summary=f"restore completed: {backup_file}",
            detail={
                "restore_id": restore_id,
                "backup_file": backup_file,
                "restore_type": restore_type,
                "status": status,
                "items_restored": items_restored,
                "duration_seconds": duration_seconds,
            },
            result=status,
            source="restore_event",
            trace_id=restore_id,
        )
    except Exception:
        pass

    return {"restore_id": restore_id, "is_new": True, "followup_report": report_text}


def list_restore_events(tenant_id: str = "tenant_main", limit: int = 20) -> list[dict[str, Any]]:
    ensure_restore_schema()
    conn = _conn()
    try:
        rows = conn.execute(
            "SELECT * FROM restore_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
            (tenant_id, max(1, min(int(limit), 200))),
        ).fetchall()
    finally:
        conn.close()
    items: list[dict[str, Any]] = []
    for row in rows:
        payload = dict(row)
        payload["detail"] = json.loads(str(payload.pop("detail_json", "{}") or "{}"))
        payload["health_check_passed"] = bool(payload.get("health_check_passed"))
        payload["report_generated"] = bool(payload.get("report_generated"))
        items.append(payload)
    return items
