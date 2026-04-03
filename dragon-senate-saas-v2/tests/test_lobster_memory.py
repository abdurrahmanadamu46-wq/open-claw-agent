"""Tests for file-backed lobster memory and continuity helpers."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from brain.memory_service import BrainMemoryService  # noqa: E402
from lobsters.experience_extractor import ExperienceExtractor  # noqa: E402
from lobsters.lobster_memory import LobsterMemory  # noqa: E402
from lobsters.task_continuity import TaskContinuityManager  # noqa: E402


class FakeLLM:
    async def __call__(self, prompt: str, max_tokens: int) -> str:
        if "JSON 数组" in prompt:
            return '[{"category":"preferences","key":"communication_style","value":"用户偏好简洁直接的回复"}]'
        return "[]"


class TestLobsterMemory(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.memory = LobsterMemory("strategist", "test_tenant", base_path=self.tmpdir.name)

    async def test_remember_and_recall(self) -> None:
        await self.memory.remember(
            category="knowledge",
            key="user_preference_communication",
            value="用户偏好简洁直接的沟通风格，不喜欢冗长解释",
        )
        results = await self.memory.recall("沟通风格")
        self.assertGreater(len(results), 0)
        self.assertIn("简洁直接", results[0]["content"])

    async def test_memory_stats(self) -> None:
        await self.memory.remember("knowledge", "test1", "content1")
        await self.memory.remember("skills", "test2", "content2")
        stats = self.memory.get_stats()
        self.assertGreaterEqual(stats["knowledge"], 1)
        self.assertGreaterEqual(stats["skills"], 1)

    async def test_list_and_forget_memory(self) -> None:
        await self.memory.remember("preferences", "tone", "简洁直接")
        items = await self.memory.list_by_category("preferences")
        self.assertEqual(len(items), 1)
        deleted = await self.memory.forget("preferences", "tone")
        self.assertTrue(deleted)
        items_after = await self.memory.list_by_category("preferences")
        self.assertEqual(len(items_after), 0)

    async def test_extract_from_session(self) -> None:
        extracted = await self.memory.extract_from_session("session log", llm_call_fn=FakeLLM())
        self.assertEqual(len(extracted), 1)
        self.assertEqual(extracted[0]["category"], "preferences")

    async def test_task_continuity(self) -> None:
        continuity = TaskContinuityManager(self.memory)
        await continuity.save_pending_task(
            tenant_id="test_tenant",
            lobster_id="strategist",
            task={"task_id": "task-1", "description": "follow up", "priority": 9},
        )
        pending = await continuity.get_pending_tasks("test_tenant", "strategist")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["task_id"], "task-1")
        await continuity.mark_task_completed("test_tenant", "strategist", "task-1")
        pending_after = await continuity.get_pending_tasks("test_tenant", "strategist")
        self.assertEqual(len(pending_after), 0)

    async def test_brain_memory_service_inmemory(self) -> None:
        service = BrainMemoryService(backend_type="inmemory")
        await service.memorize("tenant-a", "radar", "knowledge", "topic", "热点规则")
        results = await service.retrieve("tenant-a", "radar", "热点")
        self.assertEqual(len(results), 1)

    async def test_experience_extractor(self) -> None:
        extractor = ExperienceExtractor(FakeLLM())
        rows = await extractor.extract("session log", "echoer")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["key"], "communication_style")


if __name__ == "__main__":
    unittest.main()
