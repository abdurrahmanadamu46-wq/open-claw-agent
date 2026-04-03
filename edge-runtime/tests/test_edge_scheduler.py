"""Tests for edge scheduler."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from edge_scheduler import EdgeScheduler  # noqa: E402


class TestEdgeScheduler(unittest.IsolatedAsyncioTestCase):
    async def test_scheduler_runs_registered_job(self) -> None:
        scheduler = EdgeScheduler(use_apscheduler=False)
        hits: list[str] = []

        async def handler() -> None:
            hits.append("tick")

        scheduler.register_job(
            name="demo",
            interval_seconds=1,
            handler=handler,
            description="demo job",
        )
        await scheduler.start()
        try:
            await __import__("asyncio").sleep(1.2)
        finally:
            await scheduler.stop()

        self.assertGreaterEqual(len(hits), 1)
        status = scheduler.get_status()
        self.assertEqual(status[0]["name"], "demo")

    async def test_sync_sop_schedule_persists_and_executes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            scheduler = EdgeScheduler(
                edge_node_id="node-test",
                db_path=os.path.join(tmpdir, "edge_scheduler.sqlite"),
                use_apscheduler=False,
            )
            executed: list[str] = []

            async def executor(payload: dict, job_id: str) -> None:
                executed.append(job_id)

            scheduler.set_sop_executor(executor)
            await scheduler.sync_sop_from_cloud(
                {
                    "job_id": "sop_once",
                    "run_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
                    "payload": {"sop_type": "publish_post"},
                }
            )
            await scheduler.run_due_sops()
            jobs = await scheduler.list_scheduled_sops()

            self.assertEqual(executed, ["sop_once"])
            self.assertEqual(jobs[0]["job_id"], "sop_once")
            self.assertEqual(jobs[0]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
