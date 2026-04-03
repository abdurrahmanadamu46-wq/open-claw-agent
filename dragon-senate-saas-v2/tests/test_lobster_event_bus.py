"""Tests for lobster_event_bus module."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_event_bus import LobsterEventBus


class TestEventBusMemoryFallback(unittest.TestCase):
    """Test EventBus without Redis (memory fallback)."""

    def test_publish_and_read(self):
        bus = LobsterEventBus(redis=None)
        loop = asyncio.get_event_loop()
        msg_id = loop.run_until_complete(
            bus.publish(
                tenant_id="t1",
                lobster="echoer",
                action="reply_comment",
                trace_id="tr1",
                user_id="u1",
                payload={"text": "hello"},
            )
        )
        self.assertTrue(msg_id.startswith("mem_"))

        events = loop.run_until_complete(bus.read_recent("t1", count=10))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["lobster"], "echoer")

    def test_consumer_callback(self):
        bus = LobsterEventBus(redis=None)
        received: list[str] = []

        async def consumer(msg):
            received.append(msg["lobster"])

        bus.register_consumer("test_group", consumer)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            bus.publish(
                tenant_id="t1",
                lobster="catcher",
                action="capture",
                trace_id="tr2",
                user_id="u1",
                payload={},
            )
        )
        self.assertEqual(received, ["catcher"])

    def test_tenant_isolation(self):
        bus = LobsterEventBus(redis=None)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            bus.publish(
                tenant_id="t1",
                lobster="a",
                action="x",
                trace_id="tr1",
                user_id="u1",
                payload={},
            )
        )
        loop.run_until_complete(
            bus.publish(
                tenant_id="t2",
                lobster="b",
                action="y",
                trace_id="tr2",
                user_id="u2",
                payload={},
            )
        )
        t1_events = loop.run_until_complete(bus.read_recent("t1"))
        t2_events = loop.run_until_complete(bus.read_recent("t2"))
        self.assertEqual(len(t1_events), 1)
        self.assertEqual(len(t2_events), 1)
        self.assertEqual(t1_events[0]["lobster"], "a")
        self.assertEqual(t2_events[0]["lobster"], "b")

    def test_snapshot(self):
        bus = LobsterEventBus(redis=None)
        snap = bus.snapshot()
        self.assertFalse(snap["has_redis"])
        self.assertEqual(snap["memory_queue_size"], 0)

    def test_memory_queue_limit(self):
        bus = LobsterEventBus(redis=None)
        loop = asyncio.get_event_loop()
        for i in range(1100):
            loop.run_until_complete(
                bus.publish(
                    tenant_id="t1",
                    lobster="x",
                    action="y",
                    trace_id=f"tr_{i}",
                    user_id="u1",
                    payload={},
                )
            )
        self.assertLessEqual(len(bus._memory_queue), 1000)


if __name__ == "__main__":
    unittest.main()
