"""Tests for expects validation and escalation flow in LobsterRunner."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from commander_router import clear_strategy_intensity_manager_cache  # noqa: E402
from lobster_runner import LobsterRunSpec  # noqa: E402
from lobster_runner import LobsterRunner  # noqa: E402


class MockLLMRouter:
    def __init__(self, responses: list[str]):
        self.responses = list(responses)
        self.calls: list[dict[str, str]] = []

    async def routed_ainvoke_text(self, *, system_prompt, user_prompt, meta=None, temperature=None, model_override=None, force_tier=None):
        self.calls.append({"system_prompt": system_prompt, "user_prompt": user_prompt})
        if self.responses:
            return self.responses.pop(0)
        return "STATUS: done"


class ExpectsValidationTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        os.environ["ESCALATION_DB_PATH"] = os.path.join(self.tmpdir.name, "escalations.sqlite")
        os.environ["AUTH_NOTIFICATION_MODE"] = "file"
        os.environ["AUTH_NOTIFICATION_DIR"] = os.path.join(self.tmpdir.name, "notifications")
        os.environ["MEMORY_COMPRESSION_ENABLED"] = "false"
        os.environ["LOBSTER_FILE_MEMORY_ENABLED"] = "false"
        os.environ["LOBSTER_MEMORY_AUTO_EXTRACT"] = "false"
        # Use a fresh feature-flags DB so all lobsters are enabled by default
        os.environ["FEATURE_FLAGS_DB"] = os.path.join(self.tmpdir.name, "feature_flags.sqlite")
        import feature_flags as _ff_mod
        _ff_mod._cache = None
        self.addCleanup(lambda: setattr(_ff_mod, "_cache", None))
        clear_strategy_intensity_manager_cache()

    async def test_validate_expects_helper(self) -> None:
        runner = LobsterRunner(MockLLMRouter(["STATUS: done"]))
        passed, reason = runner._validate_expects("SignalBrief: test", "SignalBrief:")
        self.assertTrue(passed)
        self.assertIn("matched", reason)

    async def test_retry_until_expects_passes(self) -> None:
        runner = LobsterRunner(MockLLMRouter(["bad output", "STATUS: done\nhello"]))
        with patch.object(LobsterRunner, "_persist_session_messages", return_value=None):
            result = await runner.run(
                LobsterRunSpec(
                    role_id="radar",
                    system_prompt="sys",
                    user_prompt="usr",
                    expects="STATUS: done",
                    max_retries=1,
                    meta={"tenant_id": "tenant-a", "task_id": "task-1", "approved": True},
                )
            )
        self.assertTrue(result.expects_passed)
        self.assertEqual(result.retry_count, 1)

    async def test_exhausted_retries_escalates(self) -> None:
        # Provide enough bad responses to cover all LLM calls across both attempts.
        # The runner makes ~3 LLM calls per attempt (user + internal side calls).
        runner = LobsterRunner(MockLLMRouter(["bad output"] * 6))
        with patch.object(LobsterRunner, "_persist_session_messages", return_value=None):
            result = await runner.run(
                LobsterRunSpec(
                    role_id="radar",
                    system_prompt="sys",
                    user_prompt="usr",
                    expects="STATUS: done",
                    max_retries=1,
                    meta={"tenant_id": "tenant-a", "task_id": "task-2", "approved": True},
                )
            )
        self.assertFalse(result.expects_passed)
        self.assertEqual(result.stop_reason, "expects_failed")
        self.assertTrue(str(result.escalation_id or "").startswith("esc_"))


if __name__ == "__main__":
    unittest.main()
