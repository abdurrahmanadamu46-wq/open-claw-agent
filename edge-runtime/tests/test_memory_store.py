"""Tests for edge SQLite memory store."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from memory_store import EdgeMemoryStore  # noqa: E402


class TestEdgeMemoryStore(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.store = EdgeMemoryStore(db_path=os.path.join(self.tmpdir.name, "edge_memory.db"))

    async def test_remember_and_recall(self) -> None:
        await self.store.remember(
            tenant_id="tenant-a",
            lobster_id="dispatcher",
            category="context",
            key="action_1",
            value="库存检查结果正常",
        )
        rows = await self.store.recall("tenant-a", "dispatcher", "库存检查")
        self.assertEqual(len(rows), 1)
        self.assertIn("正常", rows[0]["value"])

    async def test_unsynced_and_mark_synced(self) -> None:
        await self.store.remember(
            tenant_id="tenant-a",
            lobster_id="dispatcher",
            category="context",
            key="memory_1",
            value="待同步记忆",
        )
        unsynced = await self.store.get_unsynced_memories()
        self.assertEqual(len(unsynced), 1)
        await self.store.mark_synced([unsynced[0]["id"]])
        remaining = await self.store.get_unsynced_memories()
        self.assertEqual(len(remaining), 0)

    async def test_schedule_and_due_tasks(self) -> None:
        scheduled_at = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        await self.store.schedule_task(
            task_id="task-1",
            tenant_id="tenant-a",
            lobster_id="dispatcher",
            scheduled_at=scheduled_at,
            payload={"taskId": "task-1", "scheduledAt": scheduled_at},
        )
        due = await self.store.get_due_scheduled_tasks()
        self.assertEqual(len(due), 1)
        self.assertEqual(due[0]["task_id"], "task-1")
        await self.store.mark_scheduled_task_status("task-1", "done")
        all_tasks = await self.store.list_scheduled_tasks()
        self.assertEqual(all_tasks[0]["status"], "done")


if __name__ == "__main__":
    unittest.main()
