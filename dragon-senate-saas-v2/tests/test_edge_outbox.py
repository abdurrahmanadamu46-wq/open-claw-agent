from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from edge_outbox import EdgeOutbox  # noqa: E402


class EdgeOutboxTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.db_path = os.path.join(self.tmpdir.name, "edge_outbox.sqlite")
        self.sent_batches: list[tuple[str, dict]] = []

        async def sender(node_id: str, batch_payload: dict, entries):
            self.sent_batches.append((node_id, batch_payload))
            return {"accepted": True, "delivered_ids": [entry.outbox_id for entry in entries]}

        self.outbox = EdgeOutbox(db_path=self.db_path, sender=sender, ack_timeout_sec=1.0)

    async def test_enqueue_is_persisted(self) -> None:
        outbox_id = await self.outbox.enqueue("tenant-a", "node-1", "task_dispatch", {"taskId": "t1"})
        rows = self.outbox.list_entries(node_id="node-1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].outbox_id, outbox_id)
        self.assertEqual(rows[0].status, "pending")

    async def test_flush_groups_by_node_and_marks_delivered(self) -> None:
        await self.outbox.enqueue("tenant-a", "node-1", "task_dispatch", {"taskId": "a"}, delivery_mode="push", webhook_url="https://node-1")
        await self.outbox.enqueue("tenant-a", "node-1", "task_dispatch", {"taskId": "b"}, delivery_mode="push", webhook_url="https://node-1")
        await self.outbox.enqueue("tenant-a", "node-2", "task_dispatch", {"taskId": "c"}, delivery_mode="push", webhook_url="https://node-2")
        sent = await self.outbox.flush_once()
        self.assertEqual(sent, 3)
        self.assertEqual(len(self.sent_batches), 2)
        self.assertEqual(self.outbox.stats()["by_status"].get("delivered"), 3)

    async def test_ack_marks_polled_item_delivered(self) -> None:
        outbox_id = await self.outbox.enqueue("tenant-a", "node-1", "task_dispatch", {"taskId": "t1"}, delivery_mode="poll")
        items = await self.outbox.pull_batch("node-1", limit=5)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["outbox_id"], outbox_id)
        acknowledged = await self.outbox.ack(outbox_id)
        self.assertTrue(acknowledged)
        delivered = self.outbox.list_entries(status="delivered")
        self.assertEqual(len(delivered), 1)

    async def test_retry_backoff_and_fail_after_max_retries(self) -> None:
        async def failing_sender(node_id: str, batch_payload: dict, entries):
            return False

        outbox = EdgeOutbox(db_path=os.path.join(self.tmpdir.name, "retry.sqlite"), sender=failing_sender, ack_timeout_sec=1.0)
        outbox_id = await outbox.enqueue("tenant-a", "node-1", "task_dispatch", {"taskId": "t1"}, delivery_mode="push", webhook_url="https://node-1", max_retries=1)

        await outbox.flush_once()
        with sqlite3.connect(outbox.db_path) as conn:
            conn.execute("UPDATE edge_outbox SET next_retry_at = 0 WHERE outbox_id = ?", (outbox_id,))
            conn.commit()
        await outbox.flush_once()

        failed = outbox.list_entries(status="failed")
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0].outbox_id, outbox_id)

    async def test_stats_returns_counts(self) -> None:
        await self.outbox.enqueue("tenant-a", "node-1", "task_dispatch", {"taskId": "t1"}, delivery_mode="poll")
        await self.outbox.enqueue("tenant-a", "node-2", "task_dispatch", {"taskId": "t2"}, delivery_mode="poll")
        stats = self.outbox.stats()
        self.assertEqual(stats["by_status"].get("pending"), 2)
        self.assertEqual(stats["by_node"].get("node-1"), 1)
        self.assertEqual(stats["by_node"].get("node-2"), 1)


if __name__ == "__main__":
    unittest.main()
