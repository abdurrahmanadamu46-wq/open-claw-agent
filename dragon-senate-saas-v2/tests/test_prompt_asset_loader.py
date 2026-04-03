"""Tests for prompt asset loading and selection."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from prompt_asset_loader import get_prompt_loader  # noqa: E402


class TestPromptAssetLoader(unittest.TestCase):
    def test_initial_prompt_inventory(self):
        loader = get_prompt_loader()
        self.assertGreaterEqual(len(loader.load_lobster_prompts("inkwriter")), 20)
        self.assertGreaterEqual(len(loader.load_lobster_prompts("echoer")), 15)
        self.assertGreaterEqual(len(loader.load_lobster_prompts("followup")), 10)

    def test_extract_template_block(self):
        loader = get_prompt_loader()
        prompt = loader.get_prompt("inkwriter.douyin.short-script.v1")
        self.assertIsNotNone(prompt)
        assert prompt is not None
        block = prompt.extract_template_block()
        self.assertIn("抖音短脚本", block)
        self.assertIn("{task_description}", block)

    def test_best_prompt_prefers_high_rating(self):
        loader = get_prompt_loader()
        prompt = loader.get_best_for("inkwriter_copy_generate", "beauty")
        self.assertIsNotNone(prompt)
        assert prompt is not None
        self.assertEqual(prompt.effectiveness_rating, 5)
        self.assertEqual(prompt.skill_id, "inkwriter_copy_generate")

    def test_target_lobsters_import(self):
        from lobsters.echoer import echoer  # noqa: F401
        from lobsters.followup import followup  # noqa: F401
        from lobsters.inkwriter import inkwriter  # noqa: F401


if __name__ == "__main__":
    unittest.main()
