"""
Structured activity stream inspired by Fleet activity logs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger("activity_stream")

DB_PATH = (Path(__file__).resolve().parent / "data" / "activity_stream.sqlite").resolve()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ActivityType(str, Enum):
    LOBSTER_EXECUTED = "lobster_executed"
    LOBSTER_FAILED = "lobster_failed"
    RULE_CREATED = "rule_created"
    RULE_UPDATED = "rule_updated"
    RULE_DELETED = "rule_deleted"
    EDGE_NODE_ENROLLED = "edge_node_enrolled"
    EDGE_NODE_OFFLINE = "edge_node_offline"
    EDGE_NODE_UPDATED = "edge_node_updated"
    JOB_COMPLETED = "job_completed"
    JOB_FAILED = "job_failed"


@dataclass(slots=True)
class Activity:
    activity_id: str = field(default_factory=lambda: f"act_{uuid.uuid4().hex[:16]}")
    tenant_id: str = "tenant_main"
    activity_type: ActivityType = ActivityType.LOBSTER_EXECUTED
    actor_type: str = "system"
    actor_id: str = ""
    actor_name: str = ""
    target_type: str = ""
    target_id: str = ""
    target_name: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["activity_type"] = self.activity_type.value
        return payload


class ActivityStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or DB_PATH
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
                CREATE TABLE IF NOT EXISTS activity_stream (
                    activity_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    activity_type TEXT NOT NULL,
                    actor_type TEXT NOT NULL,
                    actor_id TEXT NOT NULL DEFAULT '',
                    actor_name TEXT NOT NULL DEFAULT '',
                    target_type TEXT NOT NULL DEFAULT '',
                    target_id TEXT NOT NULL DEFAULT '',
                    target_name TEXT NOT NULL DEFAULT '',
                    details_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_activity_stream_tenant_created
                    ON activity_stream(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_activity_stream_type
                    ON activity_stream(tenant_id, activity_type, created_at DESC);
                """
            )
            conn.commit()

    def save(self, activity: Activity) -> Activity:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO activity_stream(
                    activity_id, tenant_id, activity_type, actor_type, actor_id, actor_name,
                    target_type, target_id, target_name, details_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    activity.activity_id,
                    activity.tenant_id,
                    activity.activity_type.value,
                    activity.actor_type,
                    activity.actor_id,
                    activity.actor_name,
                    activity.target_type,
                    activity.target_id,
                    activity.target_name,
                    json.dumps(activity.details, ensure_ascii=False),
                    activity.created_at,
                ),
            )
            conn.commit()
        return activity

    def get(self, activity_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM activity_stream WHERE activity_id = ?",
                (activity_id,),
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def list(
        self,
        *,
        tenant_id: str,
        activity_type: str | None = None,
        actor_id: str | None = None,
        target_id: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = ["tenant_id = ?"]
        params: list[Any] = [tenant_id]
        if activity_type:
            clauses.append("activity_type = ?")
            params.append(activity_type)
        if actor_id:
            clauses.append("actor_id = ?")
            params.append(actor_id)
        if target_id:
            clauses.append("target_id = ?")
            params.append(target_id)
        where_clause = " AND ".join(clauses)
        offset = max(page - 1, 0) * page_size
        with self._connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM activity_stream WHERE {where_clause}",
                    params,
                ).fetchone()[0]
            )
            rows = conn.execute(
                f"""
                SELECT *
                  FROM activity_stream
                 WHERE {where_clause}
              ORDER BY created_at DESC
                 LIMIT ? OFFSET ?
                """,
                [*params, page_size, offset],
            ).fetchall()
        return [self._row_to_dict(row) for row in rows], total

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "activity_id": str(row["activity_id"]),
            "tenant_id": str(row["tenant_id"]),
            "activity_type": str(row["activity_type"]),
            "actor_type": str(row["actor_type"]),
            "actor_id": str(row["actor_id"] or ""),
            "actor_name": str(row["actor_name"] or ""),
            "target_type": str(row["target_type"] or ""),
            "target_id": str(row["target_id"] or ""),
            "target_name": str(row["target_name"] or ""),
            "details": json.loads(str(row["details_json"] or "{}")),
            "created_at": str(row["created_at"]),
        }


class ActivityStream:
    def __init__(self, store: ActivityStore | None = None) -> None:
        self.store = store or ActivityStore()

    async def record(self, activity: Activity) -> Activity:
        self.store.save(activity)
        await self._publish_webhook(activity)
        return activity

    async def _publish_webhook(self, activity: Activity) -> None:
        try:
            from webhook_event_bus import get_webhook_event_bus

            await get_webhook_event_bus().publish_legacy(
                event_type=f"activity.{activity.activity_type.value}",
                tenant_id=activity.tenant_id,
                payload=activity.to_dict(),
                subject=f"activity.{activity.tenant_id}.{activity.activity_type.value}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Activity webhook publish skipped: %s", exc)

    def record_sync(self, activity: Activity) -> Activity:
        self.store.save(activity)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._publish_webhook(activity))
        except RuntimeError:
            pass
        return activity

    async def record_lobster_execution(
        self,
        *,
        tenant_id: str,
        lobster_id: str,
        lobster_name: str,
        task_id: str,
        success: bool,
        details: dict[str, Any] | None = None,
    ) -> Activity:
        return await self.record(
            Activity(
                tenant_id=tenant_id,
                activity_type=ActivityType.LOBSTER_EXECUTED if success else ActivityType.LOBSTER_FAILED,
                actor_type="lobster",
                actor_id=lobster_id,
                actor_name=lobster_name or lobster_id,
                target_type="task",
                target_id=task_id,
                target_name=task_id,
                details=dict(details or {}),
            )
        )

    async def record_rule_change(
        self,
        *,
        tenant_id: str,
        actor_id: str,
        actor_name: str,
        rule_id: str,
        rule_name: str,
        change_type: str,
        details: dict[str, Any] | None = None,
    ) -> Activity:
        mapping = {
            "create": ActivityType.RULE_CREATED,
            "update": ActivityType.RULE_UPDATED,
            "delete": ActivityType.RULE_DELETED,
        }
        return await self.record(
            Activity(
                tenant_id=tenant_id,
                activity_type=mapping.get(change_type, ActivityType.RULE_UPDATED),
                actor_type="operator",
                actor_id=actor_id,
                actor_name=actor_name,
                target_type="rule",
                target_id=rule_id,
                target_name=rule_name or rule_id,
                details=dict(details or {}),
            )
        )

    async def record_edge_state(
        self,
        *,
        tenant_id: str,
        edge_id: str,
        user_id: str,
        activity_type: ActivityType,
        details: dict[str, Any] | None = None,
    ) -> Activity:
        return await self.record(
            Activity(
                tenant_id=tenant_id,
                activity_type=activity_type,
                actor_type="edge_node",
                actor_id=edge_id,
                actor_name=edge_id,
                target_type="user",
                target_id=user_id,
                target_name=user_id,
                details=dict(details or {}),
            )
        )

    def record_job_result(
        self,
        *,
        tenant_id: str,
        worker_id: str,
        job_id: str,
        task_type: str,
        success: bool,
        details: dict[str, Any] | None = None,
    ) -> Activity:
        return self.record_sync(
            Activity(
                tenant_id=tenant_id or "tenant_main",
                activity_type=ActivityType.JOB_COMPLETED if success else ActivityType.JOB_FAILED,
                actor_type="worker",
                actor_id=worker_id,
                actor_name=worker_id,
                target_type="job",
                target_id=job_id,
                target_name=task_type,
                details=dict(details or {}),
            )
        )


_stream: ActivityStream | None = None


def get_activity_stream() -> ActivityStream:
    global _stream
    if _stream is None:
        _stream = ActivityStream()
    return _stream
