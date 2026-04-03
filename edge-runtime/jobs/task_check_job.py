"""Scheduled task execution job factory."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def make_task_check_job(memory_store, task_executor):
    async def task_check() -> None:
        tasks = await memory_store.get_due_scheduled_tasks(limit=50)
        if not tasks:
            logger.debug("[TaskCheckJob] no due scheduled tasks")
            return

        executed = 0
        for task in tasks:
            task_id = str(task.get("task_id") or "").strip()
            if not task_id:
                continue
            await memory_store.mark_scheduled_task_status(task_id, "running")
            try:
                await task_executor(task)
                await memory_store.mark_scheduled_task_status(
                    task_id,
                    "done",
                    last_run_at=datetime.now(timezone.utc).isoformat(),
                )
                executed += 1
            except Exception as exc:  # noqa: BLE001
                await memory_store.mark_scheduled_task_status(
                    task_id,
                    "failed",
                    last_error=str(exc)[:500],
                    last_run_at=datetime.now(timezone.utc).isoformat(),
                )
                logger.error("[TaskCheckJob] task %s failed: %s", task_id, exc)

        if executed:
            logger.info("[TaskCheckJob] executed %s scheduled tasks", executed)

    return task_check
