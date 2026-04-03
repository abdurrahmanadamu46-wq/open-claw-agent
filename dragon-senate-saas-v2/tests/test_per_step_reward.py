"""Tests for per-step reward framework (CODEX-RL-02 + CODEX-RL-03)."""

from __future__ import annotations

import asyncio
import importlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["LOBSTER_POOL_DB_PATH"] = os.path.join(tempfile.mkdtemp(), "test_lobster_pool.sqlite")
os.environ["MEMORY_COMPRESSION_ENABLED"] = "false"
os.environ["AUTONOMY_DEFAULT_LEVEL"] = "3"
os.environ["LOBSTER_FILE_MEMORY_ENABLED"] = "false"
os.environ["LOBSTER_MEMORY_AUTO_EXTRACT"] = "false"

import lobster_pool_manager as lobster_pool_manager_module  # noqa: E402

lobster_pool_manager_module = importlib.reload(lobster_pool_manager_module)

from lobster_pool_manager import (  # noqa: E402
    ensure_lobster_pool_schema,
    lobster_reward_analysis,
    record_step_rewards,
)
from lobster_runner import LobsterRunSpec, LobsterRunner, RewardHook, StepActivity, StepTracker  # noqa: E402


class MockLLMRouter:
    """Mock LLM router that returns predictable responses."""

    def __init__(self, responses: list[str] | None = None):
        self.responses = responses or ["Test response from LLM"]
        self._call_count = 0

    async def routed_ainvoke_text(self, *, system_prompt, user_prompt, meta=None, temperature=None):
        idx = min(self._call_count, len(self.responses) - 1)
        self._call_count += 1
        return self.responses[idx]


class TestStepActivity(unittest.TestCase):
    def test_to_dict(self):
        step = StepActivity(
            step_index=1,
            lobster_id="radar",
            activity_type="main_line",
            action="scan_trends",
            reward_score=0.8,
        )
        data = step.to_dict()
        self.assertTrue(data["is_trainable"])
        self.assertEqual(data["reward_score"], 0.8)

    def test_side_step_not_trainable(self):
        step = StepActivity(
            step_index=1,
            lobster_id="radar",
            activity_type="side_system",
            action="load_prompt",
        )
        self.assertFalse(step.to_dict()["is_trainable"])


class TestStepTracker(unittest.TestCase):
    def test_begin_end_step(self):
        tracker = StepTracker("radar")
        tracker.begin_step("scan", activity_type="main_line", input_summary="query")
        step = tracker.end_step(output_summary="result", reward_score=0.9)
        self.assertIsNotNone(step)
        self.assertEqual(step.reward_score, 0.9)
        self.assertGreaterEqual(step.duration_ms, 0)
        self.assertEqual(len(tracker.steps), 1)

    def test_record_side_step(self):
        tracker = StepTracker("radar")
        step = tracker.record_side_step("load_role_card", activity_type="side_system")
        self.assertEqual(step.activity_type, "side_system")
        self.assertEqual(len(tracker.steps), 1)

    def test_summary(self):
        tracker = StepTracker("radar", task_id="t1")
        tracker.begin_step("scan", activity_type="main_line")
        tracker.end_step(reward_score=0.8, tokens_used=100)
        tracker.record_side_step("load_rag", activity_type="side_rag")
        tracker.begin_step("generate", activity_type="main_line")
        tracker.end_step(reward_score=0.6, tokens_used=200)

        summary = tracker.summary()
        self.assertEqual(summary["total_steps"], 3)
        self.assertEqual(summary["main_line_steps"], 2)
        self.assertEqual(summary["side_steps"], 1)
        self.assertEqual(summary["scored_steps"], 2)
        self.assertEqual(summary["avg_reward"], 0.7)
        self.assertEqual(summary["total_tokens"], 300)
        self.assertEqual(summary["weakest_step"]["reward_score"], 0.6)

    def test_auto_end_previous_step(self):
        tracker = StepTracker("radar")
        tracker.begin_step("step1")
        tracker.begin_step("step2")
        tracker.end_step()
        self.assertEqual(len(tracker.steps), 2)

    def test_empty_summary(self):
        tracker = StepTracker("radar")
        summary = tracker.summary()
        self.assertEqual(summary["total_steps"], 0)
        self.assertIsNone(summary["avg_reward"])


class TestRewardHook(unittest.TestCase):
    def test_on_start_creates_tracker(self):
        hook = RewardHook()
        hook.on_start("radar", task_id="t1")
        self.assertIn("radar", hook.trackers)

    def test_on_step_main_line_with_output(self):
        hook = RewardHook()
        hook.on_start("radar")
        hook.on_step(
            "radar",
            "generate_brief",
            activity_type="main_line",
            output_data='{"trends": ["ai", "saas"]}',
            duration_ms=5000,
        )
        summary = hook.on_end("radar")
        self.assertIsNotNone(summary)
        self.assertEqual(summary["main_line_steps"], 1)
        step = summary["steps"][0]
        self.assertGreater(step["reward_score"], 0.5)
        self.assertTrue(step["is_trainable"])

    def test_on_step_side_step(self):
        hook = RewardHook()
        hook.on_start("radar")
        hook.on_step(
            "radar",
            "load_system_prompt",
            activity_type="side_system",
            output_data="loaded",
            duration_ms=10,
        )
        summary = hook.on_end("radar")
        self.assertEqual(summary["side_steps"], 1)
        self.assertFalse(summary["steps"][0]["is_trainable"])

    def test_on_step_error_gives_zero_reward(self):
        hook = RewardHook()
        hook.on_start("radar")
        hook.on_step(
            "radar",
            "generate_brief",
            activity_type="main_line",
            error="LLM timeout",
        )
        summary = hook.on_end("radar")
        self.assertEqual(summary["steps"][0]["reward_score"], 0.0)

    def test_on_error_records_in_tracker(self):
        hook = RewardHook()
        hook.on_start("inkwriter")
        tracker = hook.get_tracker("inkwriter")
        tracker.begin_step("generate_copy", activity_type="main_line")
        hook.on_error("inkwriter", error="API failed")
        self.assertEqual(len(tracker.steps), 1)
        self.assertEqual(tracker.steps[0].reward_score, 0.0)

    def test_runner_integration_with_reward_hook(self):
        ensure_lobster_pool_schema()
        router = MockLLMRouter(["## 标题\n\n成交型文案内容..."])
        hook = RewardHook()
        runner = LobsterRunner(router)

        spec = LobsterRunSpec(
            role_id="inkwriter",
            system_prompt="You are inkwriter.",
            user_prompt="Write copy.",
            hook=hook,
            meta={"task_id": "task_001"},
        )
        run_result = asyncio.run(runner.run(spec))
        self.assertIsNotNone(run_result.step_summary)
        self.assertGreaterEqual(run_result.step_summary["main_line_steps"], 1)


class TestStepRewardPersistence(unittest.TestCase):
    def test_record_step_rewards(self):
        ensure_lobster_pool_schema()
        steps = [
            {
                "step_index": 1,
                "action": "generate_copy",
                "activity_type": "main_line",
                "reward_score": 0.8,
                "reward_reason": "has_output+structured",
                "duration_ms": 1000,
                "tokens_used": 120,
                "llm_call_id": "call_1",
            }
        ]
        record_step_rewards("inkwriter", "task_x", steps)
        analysis = lobster_reward_analysis("inkwriter")
        self.assertGreaterEqual(analysis["total_steps"], 1)

    def test_lobster_reward_analysis(self):
        ensure_lobster_pool_schema()
        steps = [
            {
                "step_index": 1,
                "action": "generate_copy",
                "activity_type": "main_line",
                "reward_score": 0.4,
                "reward_reason": "has_output",
                "duration_ms": 1000,
                "tokens_used": 100,
                "llm_call_id": None,
            },
            {
                "step_index": 2,
                "action": "refine_copy",
                "activity_type": "main_line",
                "reward_score": 0.9,
                "reward_reason": "has_output+structured+on_time+no_error",
                "duration_ms": 900,
                "tokens_used": 120,
                "llm_call_id": None,
            },
            {
                "step_index": 3,
                "action": "load_role_card",
                "activity_type": "side_system",
                "reward_score": None,
                "reward_reason": "",
                "duration_ms": 10,
                "tokens_used": 0,
                "llm_call_id": None,
            },
        ]
        record_step_rewards("radar", "task_y", steps)
        analysis = lobster_reward_analysis("radar")
        self.assertEqual(analysis["lobster_id"], "radar")
        self.assertGreaterEqual(analysis["total_steps"], 3)
        self.assertGreaterEqual(analysis["main_line_count"], 2)
        self.assertGreaterEqual(len(analysis["by_action"]), 2)


if __name__ == "__main__":
    unittest.main()
