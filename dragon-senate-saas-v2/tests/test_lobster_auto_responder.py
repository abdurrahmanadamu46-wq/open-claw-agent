from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from channel_account_manager import ChannelAccount  # noqa: E402
from channel_account_manager import channel_account_manager  # noqa: E402
from lobster_auto_responder import LobsterAutoResponder  # noqa: E402
from lobster_auto_responder import should_respond  # noqa: E402


class _FakeLobster:
    def __init__(self, role_id: str) -> None:
        self.role_id = role_id
        self.system_prompt_full = f"You are {role_id}."


class _FakeResult:
    def __init__(self, text: str) -> None:
        self.final_content = text
        self.error = None


class LobsterAutoResponderTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        channel_account_manager.register_account(
            ChannelAccount(
                account_id="acc-im-2",
                channel="feishu",
                tenant_id="tenant-a",
                enabled=True,
                options={
                    "group_respond_mode": "intent",
                    "thinking_placeholder_enabled": True,
                    "thinking_threshold_ms": 10,
                },
            )
        )

    async def test_should_respond_group_filter(self) -> None:
        self.assertFalse(should_respond({"chat_type": "group", "text": "好的", "mentions": []}, group_respond_mode="intent"))
        self.assertTrue(should_respond({"chat_type": "group", "text": "帮我分析一下竞品", "mentions": []}, group_respond_mode="intent"))
        self.assertTrue(should_respond({"chat_type": "group", "text": "收到", "mentions": ["echoer"]}, group_respond_mode="mention_only"))

    async def test_handle_im_message_sends_placeholder_and_updates(self) -> None:
        responder = LobsterAutoResponder(runtime_lobster_builder=lambda role_id, tenant_id: _FakeLobster(role_id), llm_router=object())

        async def fake_run(spec):  # noqa: ARG001
            await asyncio.sleep(0.05)
            return _FakeResult("正在处理完成")

        responder.runner.run = fake_run  # type: ignore[assignment]
        payload = await responder.handle_im_message(
            {
                "channel": "feishu",
                "account_id": "acc-im-2",
                "channel_id": "feishu:acc-im-2",
                "chat_id": "chat-2",
                "chat_type": "group",
                "text": "帮我分析一下竞品",
                "mentions": [],
            },
            {"lobster_id": "echoer"},
            "tenant-a",
        )
        self.assertTrue(payload["ok"])
        self.assertIsNotNone(payload["placeholder_id"])
        sender = channel_account_manager.get_sender("feishu:acc-im-2")
        self.assertIsNotNone(sender)
        assert sender is not None
        stored = sender.get_message(payload["placeholder_id"])
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertEqual(stored.text, "正在处理完成")

    async def test_handle_dispatch_lobster_filters_group_noise(self) -> None:
        responder = LobsterAutoResponder(runtime_lobster_builder=lambda role_id, tenant_id: _FakeLobster(role_id), llm_router=object())
        payload = await responder.handle_dispatch_lobster(
            {
                "message_ctx": {
                    "channel": "feishu",
                    "account_id": "acc-im-2",
                    "channel_id": "feishu:acc-im-2",
                    "chat_id": "chat-3",
                    "chat_type": "group",
                    "text": "哈哈",
                    "mentions": [],
                }
            },
            {"lobster_id": "echoer", "task": "{{message_ctx.text}}"},
            "tenant-a",
        )
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["filtered"])


if __name__ == "__main__":
    unittest.main()
