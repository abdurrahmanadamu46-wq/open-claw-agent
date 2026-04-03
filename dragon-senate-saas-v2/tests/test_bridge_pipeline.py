from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bridge_pipeline import EdgeMessagePipeline  # noqa: E402
from bridge_pipeline import sign_payload  # noqa: E402


class BridgePipelineTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_v09_data_field_is_normalized(self) -> None:
        handled: list[dict[str, object]] = []
        pipeline = EdgeMessagePipeline()

        async def handler(message):
            handled.append({"payload": dict(message.payload), "version": message.protocol_version})
            return {"ok": True}

        pipeline.register("monitor_data", handler)
        decision = await pipeline.process(
            {
                "msg_id": "m1",
                "msg_type": "monitor_data",
                "tenant_id": "tenant-a",
                "node_id": "node-1",
                "data": {"metric": "cpu"},
            }
        )
        self.assertTrue(decision.accepted)
        self.assertEqual(handled[0]["payload"], {"metric": "cpu"})
        self.assertEqual(handled[0]["version"], "0.9")

    async def test_missing_required_fields_is_rejected(self) -> None:
        pipeline = EdgeMessagePipeline()
        decision = await pipeline.process({"msg_type": "monitor_data", "tenant_id": "t1"})
        self.assertFalse(decision.accepted)
        self.assertEqual(decision.status, "invalid")

    async def test_bad_signature_is_rejected(self) -> None:
        pipeline = EdgeMessagePipeline(hmac_secrets={"node-1": "secret"}, require_signature=True)
        decision = await pipeline.process(
            {
                "msg_id": "m2",
                "msg_type": "monitor_data",
                "tenant_id": "tenant-a",
                "node_id": "node-1",
                "payload": {"hello": "world"},
                "signature": "bad-signature",
            }
        )
        self.assertFalse(decision.accepted)
        self.assertEqual(decision.status, "policy_rejected")

    async def test_sensitive_fields_are_redacted_before_dispatch(self) -> None:
        handled: list[dict[str, object]] = []
        pipeline = EdgeMessagePipeline(hmac_secrets={"node-1": "secret"})

        async def handler(message):
            handled.append(dict(message.payload))
            return {"ok": True}

        pipeline.register("monitor_data", handler)
        payload = {"token": "abc", "nested": {"password": "p@ss"}, "safe": "yes"}
        decision = await pipeline.process(
            {
                "msg_id": "m3",
                "msg_type": "monitor_data",
                "tenant_id": "tenant-a",
                "node_id": "node-1",
                "payload": dict(payload),
                "signature": sign_payload(payload, "secret"),
            }
        )
        self.assertTrue(decision.accepted)
        self.assertEqual(handled[0]["token"], "[REDACTED]")
        self.assertEqual(handled[0]["nested"]["password"], "[REDACTED]")
        self.assertEqual(handled[0]["safe"], "yes")

    async def test_throttle_rejects_over_limit(self) -> None:
        pipeline = EdgeMessagePipeline(node_limit=1, tenant_limit=10)

        async def handler(message):
            return {"ok": True}

        pipeline.register("node_ping", handler)
        first = await pipeline.process(
            {"msg_id": "a1", "msg_type": "node_ping", "tenant_id": "tenant-a", "node_id": "node-1", "payload": {}}
        )
        second = await pipeline.process(
            {"msg_id": "a2", "msg_type": "node_ping", "tenant_id": "tenant-a", "node_id": "node-1", "payload": {}}
        )
        self.assertTrue(first.accepted)
        self.assertFalse(second.accepted)
        self.assertEqual(second.status, "throttled")

    async def test_duplicate_message_is_dropped(self) -> None:
        call_count = 0
        pipeline = EdgeMessagePipeline()

        async def handler(message):
            nonlocal call_count
            call_count += 1
            return {"ok": True}

        pipeline.register("publish_result", handler)
        raw = {
            "msg_id": "dup-1",
            "msg_type": "publish_result",
            "tenant_id": "tenant-a",
            "node_id": "node-1",
            "payload": {"task_id": "t1"},
        }
        first = await pipeline.process(raw)
        second = await pipeline.process(raw)
        self.assertTrue(first.accepted)
        self.assertFalse(second.accepted)
        self.assertEqual(second.status, "duplicate")
        self.assertEqual(call_count, 1)


if __name__ == "__main__":
    unittest.main()
