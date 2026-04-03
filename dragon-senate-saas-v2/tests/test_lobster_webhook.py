"""Tests for lobster_webhook module."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_webhook import (
    LobsterWebhookRegistry,
    WebhookAfterRequest,
    WebhookBeforeRequest,
    WebhookBeforeResponse,
)


def _make_before_req(**kwargs) -> WebhookBeforeRequest:
    defaults = {
        "lobster": "echoer",
        "action": "reply_comment",
        "tenant_id": "t1",
        "user_id": "u1",
        "trace_id": "tr1",
        "payload": {"text": "hello"},
    }
    defaults.update(kwargs)
    return WebhookBeforeRequest(**defaults)


class TestWebhookRegistry(unittest.TestCase):
    def test_no_hooks_allows(self):
        registry = LobsterWebhookRegistry()
        req = _make_before_req()
        resp = asyncio.get_event_loop().run_until_complete(registry.fire_before(req))
        self.assertTrue(resp.allow)

    def test_before_hook_blocks(self):
        registry = LobsterWebhookRegistry()

        async def block_all(req: WebhookBeforeRequest) -> WebhookBeforeResponse:
            return WebhookBeforeResponse(allow=False, reason="compliance_check_failed")

        registry.register_before("echoer", "reply_comment", block_all)
        req = _make_before_req()
        resp = asyncio.get_event_loop().run_until_complete(registry.fire_before(req))
        self.assertFalse(resp.allow)
        self.assertEqual(resp.reason, "compliance_check_failed")

    def test_before_hook_modifies_payload(self):
        registry = LobsterWebhookRegistry()

        async def modify(req: WebhookBeforeRequest) -> WebhookBeforeResponse:
            return WebhookBeforeResponse(allow=True, modified_payload={**req.payload, "sanitized": True})

        registry.register_before("echoer", "reply_comment", modify)
        req = _make_before_req()
        resp = asyncio.get_event_loop().run_until_complete(registry.fire_before(req))
        self.assertTrue(resp.allow)
        self.assertTrue(resp.modified_payload["sanitized"])

    def test_after_hook_fires(self):
        registry = LobsterWebhookRegistry()
        called: list[str] = []

        async def on_after(req: WebhookAfterRequest) -> None:
            called.append(req.lobster)

        registry.register_after("catcher", "capture_lead", on_after)
        after_req = WebhookAfterRequest(
            lobster="catcher",
            action="capture_lead",
            tenant_id="t1",
            user_id="u1",
            trace_id="tr1",
            payload={},
            result={"score": 85},
            duration_ms=100,
            success=True,
        )
        asyncio.get_event_loop().run_until_complete(registry.fire_after(after_req))
        self.assertEqual(called, ["catcher"])

    def test_global_hook(self):
        registry = LobsterWebhookRegistry()
        called: list[str] = []

        async def global_after(req: WebhookAfterRequest) -> None:
            called.append(f"{req.lobster}.{req.action}")

        registry.register_after("*", "*", global_after)
        after_req = WebhookAfterRequest(
            lobster="abacus",
            action="score",
            tenant_id="t1",
            user_id="u1",
            trace_id="tr1",
            payload={},
            result={},
            duration_ms=50,
            success=True,
        )
        asyncio.get_event_loop().run_until_complete(registry.fire_after(after_req))
        self.assertEqual(called, ["abacus.score"])

    def test_describe(self):
        registry = LobsterWebhookRegistry()

        async def noop_before(req: WebhookBeforeRequest) -> WebhookBeforeResponse:
            return WebhookBeforeResponse()

        async def noop_after(req: WebhookAfterRequest) -> None:
            return None

        registry.register_before("echoer", "reply", noop_before)
        registry.register_after("catcher", "capture", noop_after)
        desc = registry.describe()
        self.assertIn("before_hooks", desc)
        self.assertIn("after_hooks", desc)
        self.assertEqual(desc["total_before"], 1)
        self.assertEqual(desc["total_after"], 1)


if __name__ == "__main__":
    unittest.main()
