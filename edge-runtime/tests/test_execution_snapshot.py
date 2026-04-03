from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from execution_snapshot import SnapshotCollector  # noqa: E402


class _FakePage:
    def __init__(self) -> None:
        self.url = "https://example.com/start"

    async def screenshot(self, type: str = "png"):
        return b"fake-image"

    async def evaluate(self, script: str):
        return "page body summary"


class SnapshotCollectorTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.reports: list[dict] = []
        self.collector = SnapshotCollector(
            node_id="node-1",
            tenant_id="tenant-a",
            account_id="acc-1",
            platform="xiaohongshu",
            snapshot_dir=self.tmpdir.name,
            uploader=self.reports.append,
        )

    async def test_collects_before_after_and_steps(self) -> None:
        page = _FakePage()
        async with self.collector.session("publish", "task-1") as snap:
            await snap.capture_before(page)
            page.url = "https://example.com/editor"
            await snap.step("fill_form", page, status="ok")
            page.url = "https://example.com/success"
            await snap.capture_after(page)
            snap.mark_result("published")

        recent = self.collector.get_recent(1)[0]
        self.assertEqual(recent.status, "success")
        self.assertEqual(recent.total_steps, 1)
        self.assertTrue(recent.before_screenshot)
        self.assertTrue(recent.after_screenshot)
        report = self.collector.to_report(recent)
        self.assertEqual(report["steps"][0]["name"], "fill_form")
        self.assertEqual(len(self.reports), 1)

    async def test_failed_session_records_error_detail(self) -> None:
        page = _FakePage()
        with self.assertRaises(RuntimeError):
            async with self.collector.session("reply", "task-2") as snap:
                await snap.capture_before(page)
                await snap.step("open_dialog", page)
                raise RuntimeError("boom")

        recent = self.collector.get_recent(1)[0]
        self.assertEqual(recent.status, "failed")
        self.assertIn("boom", recent.error_detail)


if __name__ == "__main__":
    unittest.main()
