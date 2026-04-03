"""Integration tests for LobsterRunner smart routing handoff."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_runner import LobsterRunSpec, LobsterRunner  # noqa: E402
from smart_routing import ModelTier  # noqa: E402


class _DummyRouter:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def routed_ainvoke_text(self, **kwargs):
        self.calls.append(kwargs)
        return "ok"


class TestLobsterRunnerSmartRouting(unittest.IsolatedAsyncioTestCase):
    async def test_default_tier_from_lobster_is_forwarded(self) -> None:
        router = _DummyRouter()
        runner = LobsterRunner(router)
        lobster = type("StrategistRuntime", (), {"DEFAULT_TIER": ModelTier.PRO, "role_id": "strategist"})()
        spec = LobsterRunSpec(
            role_id="strategist",
            system_prompt="system",
            user_prompt="user",
            lobster=lobster,
        )

        result = await runner._invoke_llm(
            spec,
            [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "user"},
            ],
        )

        self.assertEqual(result, "ok")
        self.assertEqual(router.calls[-1]["force_tier"], ModelTier.PRO)

    async def test_explicit_model_override_is_forwarded(self) -> None:
        router = _DummyRouter()
        runner = LobsterRunner(router)
        spec = LobsterRunSpec(
            role_id="strategist",
            system_prompt="system",
            user_prompt="user",
            model_override="deepseek-reasoner",
            force_tier=ModelTier.FRONTIER,
        )

        await runner._invoke_llm(
            spec,
            [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "user"},
            ],
        )

        self.assertEqual(router.calls[-1]["model_override"], "deepseek-reasoner")
        self.assertEqual(router.calls[-1]["force_tier"], ModelTier.FRONTIER)


if __name__ == "__main__":
    unittest.main()
