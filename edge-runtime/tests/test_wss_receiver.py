"""Unit tests for WSSReceiver."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from memory_store import EdgeMemoryStore  # noqa: E402
from wss_receiver import WSSReceiver  # noqa: E402


class MockTransport:
    def __init__(self) -> None:
        self.messages: list[str] = []

    async def send(self, data: str) -> None:
        self.messages.append(data)


class TestWSSReceiver(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.memory = EdgeMemoryStore(db_path=os.path.join(self.tmpdir.name, "edge_memory.db"))
        self.receiver = WSSReceiver(
            gateway_url="wss://gw.example.com/fleet",
            node_id="node-001",
            edge_secret="secret123",
            tenant_id="tenant-a",
            memory_store=self.memory,
        )

    async def test_basic_init(self) -> None:
        self.assertEqual(self.receiver.gateway_url, "wss://gw.example.com/fleet")
        self.assertEqual(self.receiver.node_id, "node-001")
        self.assertFalse(self.receiver.connected)

    async def test_ping_payload_idle(self) -> None:
        payload = self.receiver._build_ping_payload()
        self.assertEqual(payload["nodeId"], "node-001")
        self.assertEqual(payload["tenantId"], "tenant-a")
        self.assertEqual(payload["status"], "IDLE")

    async def test_handle_task_with_handler(self) -> None:
        async def handler(payload: dict) -> dict:
            return {"status": "done", "taskId": payload.get("taskId")}

        self.receiver.on_task(handler)
        transport = MockTransport()
        await self.receiver._handle_task(transport, {"taskId": "task-456"})
        self.assertEqual(self.receiver.stats["tasks_received"], 1)
        self.assertEqual(self.receiver.stats["tasks_completed"], 1)
        self.assertGreaterEqual(len(transport.messages), 2)

    async def test_future_scheduled_task_is_stored_locally(self) -> None:
        future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        transport = MockTransport()
        await self.receiver._handle_task(
            transport,
            {
                "taskId": "task-future",
                "scheduledAt": future,
                "tenant_id": "tenant-a",
                "lobster_id": "dispatcher",
            },
        )
        scheduled = await self.memory.list_scheduled_tasks()
        self.assertEqual(len(scheduled), 1)
        self.assertEqual(scheduled[0]["task_id"], "task-future")
        self.assertEqual(scheduled[0]["status"], "pending")

    async def test_sop_schedule_sync_persists_job(self) -> None:
        await self.receiver._handle_sop_schedule_sync(
            {
                "job_id": "sop_sync_demo",
                "cron": "0 8 * * *",
                "timezone": "Asia/Shanghai",
                "payload": {"sop_type": "publish_post"},
            }
        )
        jobs = await self.receiver.scheduler.list_scheduled_sops()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["job_id"], "sop_sync_demo")

    async def test_batch_delivery_executes_items_and_acks(self) -> None:
        self.receiver._execute_task_payload = AsyncMock(return_value={"success": True})  # type: ignore[method-assign]
        self.receiver._ack_outbox_item = AsyncMock()  # type: ignore[method-assign]
        await self.receiver._handle_batch_delivery(
            {
                "items": [
                    {
                        "outbox_id": "outbox-1",
                        "msg_type": "task_dispatch",
                        "payload": {"taskId": "task-123", "actionType": "SYNC_CONFIG", "params": {}},
                    }
                ]
            }
        )
        self.receiver._execute_task_payload.assert_awaited_once()  # type: ignore[attr-defined]
        self.receiver._ack_outbox_item.assert_awaited_once_with("outbox-1")  # type: ignore[attr-defined]


if __name__ == "__main__":
    unittest.main()
