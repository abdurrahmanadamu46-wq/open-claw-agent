from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from account_health_monitor import AccountHealthMonitor  # noqa: E402
from marionette_executor import MarionetteExecutor  # noqa: E402
from marionette_executor import StagehandSession  # noqa: E402


class _FakePage:
    def __init__(self) -> None:
        self.url = ""
        self.goto_calls: list[str] = []
        self.body_text = ""

    async def goto(self, url: str, wait_until: str = "domcontentloaded") -> None:
        self.url = url
        self.goto_calls.append(url)

    async def evaluate(self, script: str) -> str:
        return self.body_text

    async def screenshot(self, type: str = "png") -> bytes:
        return b"fake-page-shot"


class _FakeSession:
    def __init__(self) -> None:
        self.page = _FakePage()
        self.acts: list[str] = []

    async def act(self, instruction: str) -> None:
        self.acts.append(instruction)
        if "触发失败" in instruction:
            raise RuntimeError("boom")

    async def extract(self, instruction: str, schema: dict) -> dict:
        return {key: f"{instruction}:{key}" for key in schema.keys()}

    async def observe(self, instruction: str) -> str:
        return f"observed:{instruction}"

    async def screenshot(self) -> str:
        return "fake-base64-shot"

    async def save_cookies(self) -> None:
        return


class _TestExecutor(MarionetteExecutor):
    def __init__(self) -> None:
        self.snapshot_reports: list[dict] = []
        super().__init__(snapshot_uploader=self.snapshot_reports.append)
        self.fake_session = _FakeSession()
        self.upload_count = 0

    async def _get_session(self, account_id: str, platform: str):  # type: ignore[override]
        return self.fake_session

    async def _upload_files(self, session, attachments):  # type: ignore[override]
        self.upload_count = len(attachments)
        return self.upload_count


class TestMarionetteExecutor(unittest.IsolatedAsyncioTestCase):
    async def test_stagehand_session_selects_camoufox_for_high_risk_platform(self) -> None:
        self.assertEqual(StagehandSession.select_browser_strategy("xiaohongshu"), "camoufox")
        self.assertEqual(StagehandSession.select_browser_strategy("douyin"), "camoufox")
        self.assertEqual(StagehandSession.select_browser_strategy("default"), "stagehand")

    async def test_execute_stagehand_sop_with_variables(self) -> None:
        executor = _TestExecutor()
        result = await executor.execute(
            {
                "sop_type": "publish_xiaohongshu",
                "account_id": "xhs_001",
                "platform": "xiaohongshu",
                "variables": {"title": "今日好物推荐", "images": ["a", "b"]},
                "attachments": ["fallback"],
                "steps": [
                    {"action": "navigate", "url": "https://creator.xiaohongshu.com"},
                    {"action": "act", "instruction": "点击发布按钮"},
                    {"action": "act", "instruction": "在标题框输入: {title}"},
                    {"action": "upload", "attachments": "{images}"},
                    {"action": "extract", "instruction": "提取发布链接", "schema": {"note_url": "string"}},
                    {"action": "observe", "instruction": "观察页面"},
                    {"action": "screenshot"},
                ],
            }
        )
        self.assertTrue(result["success"])
        self.assertEqual(executor.fake_session.page.goto_calls[0], "https://creator.xiaohongshu.com")
        self.assertIn("在标题框输入: 今日好物推荐", executor.fake_session.acts)
        self.assertEqual(executor.upload_count, 2)
        self.assertIn("note_url", result["result"])
        self.assertEqual(len(result["screenshots"]), 1)
        self.assertEqual(len(executor.snapshot_reports), 1)
        self.assertEqual(executor.snapshot_reports[0]["status"], "success")

    async def test_execute_failure_captures_screenshot(self) -> None:
        executor = _TestExecutor()
        result = await executor.execute(
            {
                "sop_type": "reply_comment",
                "account_id": "xhs_002",
                "platform": "xiaohongshu",
                "steps": [
                    {"action": "act", "instruction": "触发失败"},
                ],
            }
        )
        self.assertFalse(result["success"])
        self.assertEqual(result["screenshots"][0]["data"], "fake-base64-shot")
        self.assertEqual(executor.snapshot_reports[0]["status"], "failed")

    async def test_execute_packet_delegates_stagehand_payload(self) -> None:
        executor = _TestExecutor()

        async def fake_execute(payload):
            return {"success": True, "sop_type": payload.get("sop_type")}

        executor.execute = fake_execute  # type: ignore[assignment]
        result = await executor.execute_packet(
            {
                "sop_type": "publish_xiaohongshu",
                "steps": [{"action": "act", "instruction": "点击发布按钮"}],
            }
        )
        self.assertTrue(result["success"])
        self.assertEqual(result["sop_type"], "publish_xiaohongshu")

    async def test_account_health_monitor_detects_risk_signal(self) -> None:
        monitor = AccountHealthMonitor()
        session = _FakeSession()
        session.page.body_text = "您的账号存在异常，请完成验证"
        result = await monitor.check_after_action(session, "xiaohongshu")
        self.assertFalse(result["healthy"])
        self.assertEqual(result["action"], "pause_account")


if __name__ == "__main__":
    unittest.main()
