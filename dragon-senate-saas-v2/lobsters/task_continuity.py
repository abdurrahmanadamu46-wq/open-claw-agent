"""
Pending task continuity manager inspired by memU pending_tasks persistence.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskContinuityManager:
    def __init__(self, memory_store: Any):
        self.memory = memory_store

    async def save_pending_task(self, tenant_id: str, lobster_id: str, task: dict[str, Any]) -> None:
        task_id = str(task.get("task_id") or task.get("trace_id") or task.get("package_id") or "pending")
        await self.memory.remember(
            category="context",
            key=f"pending_task_{task_id}",
            value=json.dumps(task, ensure_ascii=False),
            metadata={
                "status": "pending",
                "priority": int(task.get("priority", 5) or 5),
                "created_at": _utc_now(),
                "tenant_id": tenant_id,
                "lobster_id": lobster_id,
            },
        )

    async def get_pending_tasks(self, tenant_id: str, lobster_id: str) -> list[dict[str, Any]]:
        memories = await self.memory.recall("pending_task_", category="context", top_k=50)
        tasks: list[dict[str, Any]] = []
        for item in memories:
            metadata = item.get("metadata") or {}
            if str(metadata.get("status") or "") != "pending":
                continue
            try:
                payload = json.loads(str(item.get("content") or "").split("\n\n", 1)[1].split("\n\n---", 1)[0])
            except Exception:
                raw = str(item.get("content") or "")
                start = raw.find("{")
                end = raw.rfind("}")
                if start == -1 or end == -1 or end <= start:
                    continue
                try:
                    payload = json.loads(raw[start:end + 1])
                except Exception:
                    continue
            payload["_memory_key"] = item.get("key")
            tasks.append(payload)
        tasks.sort(key=lambda row: int(row.get("priority", 5) or 5), reverse=True)
        return tasks

    async def mark_task_completed(self, tenant_id: str, lobster_id: str, task_id: str) -> None:
        await self.memory.remember(
            category="context",
            key=f"pending_task_{task_id}",
            value=json.dumps({"task_id": task_id, "status": "completed"}, ensure_ascii=False),
            metadata={
                "status": "completed",
                "completed_at": _utc_now(),
                "tenant_id": tenant_id,
                "lobster_id": lobster_id,
            },
        )
