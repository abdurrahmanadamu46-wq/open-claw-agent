"""Tests for cron_scheduler."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cron_scheduler import CronScheduler  # noqa: E402
from cron_scheduler import ScheduleKind  # noqa: E402
from cron_scheduler import ScheduledTask  # noqa: E402
from cron_scheduler import SchedulerStore  # noqa: E402
from cron_scheduler import SessionMode  # noqa: E402
from cron_scheduler import _parse_interval  # noqa: E402
from cron_scheduler import register_scheduler_routes  # noqa: E402


class TestCronSchedulerBasics(unittest.TestCase):
    def test_parse_interval(self) -> None:
        self.assertEqual(_parse_interval("30m").total_seconds(), 1800)
        self.assertEqual(_parse_interval("1h").total_seconds(), 3600)
        self.assertEqual(_parse_interval("2d").total_seconds(), 172800)

    def test_task_id_generation(self) -> None:
        id1 = ScheduledTask.generate_id("daily-report", "tenant-1")
        id2 = ScheduledTask.generate_id("daily-report", "tenant-2")
        self.assertNotEqual(id1, id2)
        self.assertEqual(len(id1), 12)

    def test_store_upsert_and_list(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        store = SchedulerStore(str(Path(tmpdir.name) / "scheduler.sqlite"))
        task = ScheduledTask(
            task_id="task-001",
            name="每日早报",
            kind=ScheduleKind.CRON,
            schedule="0 8 * * *",
            lobster_id="radar",
            prompt="生成今日早报",
        )
        store.upsert_task(task)
        tasks = store.list_tasks(enabled_only=False)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].name, "每日早报")
        self.assertEqual(tasks[0].session_mode, SessionMode.ISOLATED)

    def test_register_routes_crud(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        store = SchedulerStore(str(Path(tmpdir.name) / "scheduler.sqlite"))

        async def fake_executor(task: ScheduledTask) -> str:
            return f"done:{task.name}"

        scheduler = CronScheduler(store, fake_executor, check_interval=0.1)
        app = FastAPI()
        register_scheduler_routes(app, scheduler, store)

        client = TestClient(app)
        create_resp = client.post(
            "/api/scheduler/tasks",
            json={
                "name": "库存检查",
                "kind": "every",
                "schedule": "1h",
                "lobster_id": "dispatcher",
                "prompt": "检查库存",
                "tenant_id": "tenant-a",
            },
        )
        self.assertEqual(create_resp.status_code, 200)
        task_id = create_resp.json()["task_id"]

        list_resp = client.get("/api/scheduler/tasks", params={"tenant_id": "tenant-a"})
        self.assertEqual(list_resp.status_code, 200)
        self.assertEqual(len(list_resp.json()["tasks"]), 1)

        history_resp = client.get(f"/api/scheduler/tasks/{task_id}/history")
        self.assertEqual(history_resp.status_code, 200)
        self.assertEqual(history_resp.json()["history"], [])

        delete_resp = client.delete(f"/api/scheduler/tasks/{task_id}", params={"tenant_id": "tenant-a"})
        self.assertEqual(delete_resp.status_code, 200)
        disabled = store.get_task(task_id, tenant_id="tenant-a")
        self.assertIsNotNone(disabled)
        assert disabled is not None
        self.assertFalse(disabled.enabled)


class TestCronSchedulerAsync(unittest.IsolatedAsyncioTestCase):
    async def test_scheduler_executes_every_task(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        store = SchedulerStore(str(Path(tmpdir.name) / "scheduler.sqlite"))
        results: list[str] = []

        async def fake_executor(task: ScheduledTask) -> str:
            results.append(task.name)
            return "ok"

        scheduler = CronScheduler(store, fake_executor, check_interval=0.1)
        task = ScheduledTask(
            task_id="task-every",
            name="库存检查",
            kind=ScheduleKind.EVERY,
            schedule="1s",
            lobster_id="dispatcher",
            prompt="检查库存",
            tenant_id="tenant-a",
        )
        scheduler.add_task(task)

        loop_task = asyncio.create_task(scheduler.run())
        await asyncio.sleep(1.4)
        scheduler.stop()
        await asyncio.wait_for(loop_task, timeout=2)

        self.assertGreaterEqual(len(results), 1)
        history = store.get_run_history("task-every")
        self.assertGreaterEqual(len(history), 1)
        self.assertEqual(history[0]["status"], "success")


if __name__ == "__main__":
    unittest.main()
