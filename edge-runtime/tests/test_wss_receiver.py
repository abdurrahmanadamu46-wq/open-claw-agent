"""
Unit tests for WSSReceiver.
Run with: python -m pytest edge-runtime/tests/ -v
"""
import asyncio
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from wss_receiver import WSSReceiver


class TestWSSReceiverInit(unittest.TestCase):
    """Test WSSReceiver initialization and state."""

    def test_basic_init(self):
        r = WSSReceiver(
            gateway_url="wss://gw.example.com/fleet",
            node_id="node-001",
            edge_secret="secret123",
        )
        self.assertEqual(r.gateway_url, "wss://gw.example.com/fleet")
        self.assertEqual(r.node_id, "node-001")
        self.assertFalse(r.connected)

    def test_stats_initial(self):
        r = WSSReceiver(
            gateway_url="wss://gw.example.com",
            node_id="n1",
            edge_secret="s",
        )
        stats = r.stats
        self.assertEqual(stats["tasks_received"], 0)
        self.assertEqual(stats["tasks_completed"], 0)
        self.assertEqual(stats["tasks_failed"], 0)
        self.assertIsNone(stats["connected_since"])

    def test_describe(self):
        r = WSSReceiver(
            gateway_url="wss://gw.example.com/",
            node_id="node-x",
            edge_secret="sec",
        )
        desc = r.describe()
        self.assertEqual(desc["gateway_url"], "wss://gw.example.com")
        self.assertEqual(desc["node_id"], "node-x")
        self.assertFalse(desc["connected"])
        self.assertIn("stats", desc)

    def test_trailing_slash_stripped(self):
        r = WSSReceiver(
            gateway_url="wss://gw.example.com///",
            node_id="n",
            edge_secret="s",
        )
        self.assertEqual(r.gateway_url, "wss://gw.example.com")

    def test_handler_registration(self):
        r = WSSReceiver(
            gateway_url="wss://gw.example.com",
            node_id="n",
            edge_secret="s",
        )

        async def dummy_handler(payload: dict) -> dict:
            return {"ok": True}

        r.on_task(dummy_handler)
        self.assertIsNotNone(r._task_handler)

        r.on_behavior_session(dummy_handler)
        self.assertIsNotNone(r._behavior_handler)

    def test_ping_payload_idle(self):
        r = WSSReceiver(
            gateway_url="wss://gw.example.com",
            node_id="node-001",
            edge_secret="s",
            tenant_id="tenant-abc",
        )
        payload = r._build_ping_payload()
        self.assertEqual(payload["nodeId"], "node-001")
        self.assertEqual(payload["tenantId"], "tenant-abc")
        self.assertEqual(payload["status"], "IDLE")
        self.assertEqual(payload["currentTaskId"], "")
        self.assertIn("cpuPercent", payload)
        self.assertIn("version", payload)


class TestWSSReceiverTaskHandling(unittest.TestCase):
    """Test task handling flow with mock WebSocket."""

    def test_handle_task_no_handler(self):
        """When no handler is registered, task should fail."""
        r = WSSReceiver(
            gateway_url="wss://gw.example.com",
            node_id="n",
            edge_secret="s",
        )

        sent_messages = []

        class MockWS:
            async def send(self, data):
                sent_messages.append(data)

        ws = MockWS()
        payload = {"taskId": "task-123"}

        asyncio.get_event_loop().run_until_complete(r._handle_task(ws, payload))

        self.assertEqual(r.stats["tasks_received"], 1)
        self.assertEqual(r.stats["tasks_failed"], 1)
        self.assertEqual(r.stats["tasks_completed"], 0)
        # Should have sent progress + completed messages
        self.assertGreaterEqual(len(sent_messages), 2)

    def test_handle_task_with_handler(self):
        """When handler is registered and succeeds, task should complete."""
        r = WSSReceiver(
            gateway_url="wss://gw.example.com",
            node_id="n",
            edge_secret="s",
        )

        async def handler(payload: dict) -> dict:
            return {"status": "done"}

        r.on_task(handler)

        sent_messages = []

        class MockWS:
            async def send(self, data):
                sent_messages.append(data)

        ws = MockWS()
        payload = {"taskId": "task-456"}

        asyncio.get_event_loop().run_until_complete(r._handle_task(ws, payload))

        self.assertEqual(r.stats["tasks_received"], 1)
        self.assertEqual(r.stats["tasks_completed"], 1)
        self.assertEqual(r.stats["tasks_failed"], 0)

    def test_handle_task_empty_id_ignored(self):
        """Tasks with empty ID should be silently ignored."""
        r = WSSReceiver(
            gateway_url="wss://gw.example.com",
            node_id="n",
            edge_secret="s",
        )

        class MockWS:
            async def send(self, data):
                pass

        ws = MockWS()
        asyncio.get_event_loop().run_until_complete(r._handle_task(ws, {}))
        self.assertEqual(r.stats["tasks_received"], 0)


if __name__ == "__main__":
    unittest.main()
