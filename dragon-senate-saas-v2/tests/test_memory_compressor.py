"""Tests for memory_compressor."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from memory_compressor import L0RawEntry  # noqa: E402
from memory_compressor import MemoryCompressor  # noqa: E402


class FakeLLM:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def __call__(self, prompt: str, max_tokens: int) -> str:
        self.calls.append({"prompt": prompt, "max_tokens": max_tokens})
        if "JSON 数组" in prompt:
            return json.dumps(
                [
                    {
                        "statement": "视频内容在该客户画像下的转化率高于图文 2.3x",
                        "confidence": 0.82,
                        "category": "content_rule",
                    },
                    {
                        "statement": "晚间 19-22 点发布更容易拉高首屏停留",
                        "confidence": 0.74,
                        "category": "channel_pattern",
                    },
                ],
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "task_summary": "整理客户转化洞察",
                "decision": "优先保留高转化视频素材",
                "outcome": "success",
                "next_steps": ["继续补充高转化视频模板"],
                "key_entities": ["客户A", "抖音", "视频素材"],
                "metrics": {"conversion": 0.23},
            },
            ensure_ascii=False,
        )


class TestMemoryCompressor(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.fake_llm = FakeLLM()
        self.compressor = MemoryCompressor(self.fake_llm, storage_dir=self.tmpdir.name)

    async def test_l0_to_l1_dedup_by_content_hash(self) -> None:
        entry = L0RawEntry(
            entry_id="task-1",
            lobster_id="inkwriter",
            task_id="task-1",
            content="## USER\n\n写一段成交文案\n\n## ASSISTANT\n\n好的，我来写。",
            token_count=5000,
            tenant_id="tenant-a",
        )

        first = await self.compressor.compress_l0_to_l1(entry)
        second = await self.compressor.compress_l0_to_l1(entry)

        self.assertEqual(first.report_id, second.report_id)
        self.assertEqual(len(self.fake_llm.calls), 1)
        self.assertGreaterEqual(first.source_token_count / max(first.token_count, 1), 20)
        l0_files = list((os.path.join(self.tmpdir.name, "l0", "tenant-a"),))
        self.assertTrue(os.path.isdir(l0_files[0]))

    async def test_pending_reports_promote_to_l2_after_threshold(self) -> None:
        for index in range(10):
            entry = L0RawEntry(
                entry_id=f"task-{index}",
                lobster_id="echoer" if index % 2 else "inkwriter",
                task_id=f"task-{index}",
                content=f"## USER\n\n任务 {index}\n\n## ASSISTANT\n\n完成 {index}",
                token_count=5000 + index,
                tenant_id="tenant-b",
            )
            await self.compressor.compress_l0_to_l1(entry)

        wisdoms = await self.compressor.maybe_promote_pending_to_l2(tenant_id="tenant-b", min_reports=10, batch_size=10)

        self.assertEqual(len(wisdoms), 2)
        reports = self.compressor.get_reports(tenant_id="tenant-b")
        self.assertEqual(sum(1 for report in reports if report.promoted_to_l2), 10)
        content_rules = self.compressor.get_wisdoms(tenant_id="tenant-b", category="content_rule")
        self.assertEqual(len(content_rules), 1)

    async def test_stats_and_filters(self) -> None:
        for index, lobster_id in enumerate(("radar", "strategist", "radar")):
            entry = L0RawEntry(
                entry_id=f"{lobster_id}-{index}",
                lobster_id=lobster_id,
                task_id=f"{lobster_id}-task-{index}",
                content=f"## USER\n\n{lobster_id}-{index}\n\n## ASSISTANT\n\nok-{index}",
                token_count=3000,
                tenant_id="tenant-c",
            )
            await self.compressor.compress_l0_to_l1(entry)
        await self.compressor.compress_l1_batch_to_l2(
            self.compressor.get_reports(tenant_id="tenant-c"),
            category="workflow_pattern",
        )

        stats = self.compressor.get_stats(tenant_id="tenant-c")
        self.assertEqual(stats["layers"]["l1"]["count"], 3)
        self.assertGreaterEqual(stats["compression"]["avg_l0_to_l1_ratio"], 20)
        radar_reports = self.compressor.get_reports(tenant_id="tenant-c", lobster_id="radar")
        self.assertEqual(len(radar_reports), 2)
        radar_wisdoms = self.compressor.get_wisdoms(tenant_id="tenant-c", lobster_id="radar")
        self.assertGreaterEqual(len(radar_wisdoms), 1)


if __name__ == "__main__":
    unittest.main()
