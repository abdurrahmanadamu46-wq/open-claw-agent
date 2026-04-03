from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bridge_protocol import BridgeProtocolManager  # noqa: E402
from edge_outbox import EdgeOutbox  # noqa: E402


class BridgeProtocolManagerTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_process_node_ping_updates_capacity_wake(self) -> None:
        manager = BridgeProtocolManager()
        decision = await manager.process_edge_message(
            {
                "msg_id": "ping-1",
                "msg_type": "node_ping",
                "tenant_id": "tenant-a",
                "node_id": "node-1",
                "payload": {"skills": ["content_publish"]},
            }
        )
        self.assertTrue(decision.accepted)
        rows = manager.capacity_wake.list_online_edges("tenant-a")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["edge_id"], "node-1")

    async def test_enqueue_to_edge_uses_outbox(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        manager = BridgeProtocolManager()
        manager.set_outbox(EdgeOutbox(db_path=os.path.join(tmpdir.name, "bridge_outbox.sqlite")))
        outbox_id = await manager.enqueue_to_edge(
            tenant_id="tenant-a",
            node_id="node-1",
            msg_type="task_dispatch",
            payload={"taskId": "task-1"},
        )
        self.assertTrue(outbox_id.startswith("outbox_"))
        self.assertEqual(manager.outbox.stats()["by_status"].get("pending"), 1)


if __name__ == "__main__":
    unittest.main()
