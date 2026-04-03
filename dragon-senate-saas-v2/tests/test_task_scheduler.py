"""Tests for Layer 2 task scheduler facade."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cron_scheduler import ScheduleKind  # noqa: E402
from cron_scheduler import ScheduledTask  # noqa: E402
from task_scheduler import TaskScheduler  # noqa: E402


class TaskSchedulerTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_schedule_and_dispatch(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        executed: list[str] = []

        async def fake_executor(task: ScheduledTask) -> str:
            executed.append(task.task_id)
            return "ok"

        scheduler = TaskScheduler(
            fake_executor,
            db_path=str(Path(tmpdir.name) / "scheduler.sqlite"),
            state_path=str(Path(tmpdir.name) / "state.json"),
            rhythm_path=str(Path(tmpdir.name) / "rhythm.json"),
            check_interval=0.1,
        )
        task = ScheduledTask(
            task_id="ts-001",
            name="nightly-brief",
            kind=ScheduleKind.EVERY,
            schedule="1s",
            lobster_id="radar",
            prompt="Generate nightly brief",
            tenant_id="tenant-a",
        )
        await scheduler.schedule_task(task, "every")
        decision = await scheduler.dispatch_to_edge(task.task_id)

        self.assertTrue(decision.allowed)
        record = scheduler.state_machine.get(task.task_id)
        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.state, "DISPATCHED")


if __name__ == "__main__":
    unittest.main()
