"""Tests for smart model routing."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from smart_routing import (  # noqa: E402
    ModelTier,
    _score_complexity,
    choose_model_for_provider,
    route_model,
)


class TestPatternOverrides(unittest.TestCase):
    def test_greeting_is_flash(self) -> None:
        self.assertEqual(route_model("好的").tier, ModelTier.FLASH)
        self.assertEqual(route_model("hi").tier, ModelTier.FLASH)
        self.assertEqual(route_model("谢谢").tier, ModelTier.FLASH)

    def test_security_audit_is_frontier(self) -> None:
        self.assertEqual(route_model("帮我做一个安全审计").tier, ModelTier.FRONTIER)

    def test_code_review_is_pro(self) -> None:
        self.assertEqual(route_model("帮我做代码审查").tier, ModelTier.PRO)


class TestComplexityScoring(unittest.TestCase):
    def test_short_simple_is_low_score(self) -> None:
        score, _ = _score_complexity("天气怎么样")
        self.assertLessEqual(score, 20)

    def test_complex_task_is_high_score(self) -> None:
        score, _ = _score_complexity(
            "请分析我们小红书账号过去30天的数据，对比竞品，"
            "给出详细的内容策略调整方案，包括发布时间、标签选择和互动策略。"
        )
        self.assertGreaterEqual(score, 50)

    def test_multi_dim_boost(self) -> None:
        score, dims = _score_complexity(
            "为什么这段代码报错？请分析原因，然后一步步修复，"
            "最后解释如何避免类似问题。"
        )
        high_dims = sum(1 for value in dims.values() if value > 50)
        self.assertGreaterEqual(high_dims, 3)
        self.assertGreaterEqual(score, 30)


class TestForceTierAndProviderMapping(unittest.TestCase):
    def test_force_tier_overrides_routing(self) -> None:
        decision = route_model("hi", force_tier=ModelTier.FRONTIER)
        self.assertEqual(decision.tier, ModelTier.FRONTIER)
        self.assertEqual(decision.method, "forced")

    def test_choose_model_for_provider(self) -> None:
        self.assertEqual(
            choose_model_for_provider("deepseek", ModelTier.PRO),
            "deepseek-reasoner",
        )
        self.assertEqual(
            choose_model_for_provider("local", ModelTier.FRONTIER),
            "qwen2.5:72b-instruct",
        )


if __name__ == "__main__":
    unittest.main()
