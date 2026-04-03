"""Tests for skill_loader and design-time gotchas loading."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_skill_registry import get_skill_registry  # noqa: E402
from skill_loader import SkillLoader  # noqa: E402


class TestSkillLoader(unittest.TestCase):
    def test_registry_loads_gotchas_from_markdown(self) -> None:
        registry = get_skill_registry()
        skill = registry.get_skill("radar_web_search")
        self.assertIsNotNone(skill)
        assert skill is not None
        self.assertGreaterEqual(len(skill.gotchas), 2)

    def test_loader_matches_context(self) -> None:
        registry = get_skill_registry()
        loader = SkillLoader(registry)
        selected = loader.load_on_demand(
            "inkwriter",
            {
                "task_type": "content_generation",
                "channel": "xiaohongshu",
                "task_description": "请生成一篇小红书种草文案并检查违禁词",
            },
        )
        ids = {skill.id for skill in selected}
        self.assertIn("inkwriter_copy_generate", ids)
        self.assertIn("inkwriter_banned_word_check", ids)

    def test_check_gotchas(self) -> None:
        registry = get_skill_registry()
        loader = SkillLoader(registry)
        gotchas = loader.check_gotchas("dispatcher_scheduled_publish")
        self.assertGreaterEqual(len(gotchas), 2)


if __name__ == "__main__":
    unittest.main()
