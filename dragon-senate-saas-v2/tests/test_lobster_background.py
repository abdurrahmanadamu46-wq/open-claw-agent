from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_pool_manager import TaskNotification  # noqa: E402
from lobster_pool_manager import get_foreground_registry  # noqa: E402
from lobster_runner import LobsterExecutionMode  # noqa: E402
from lobster_runner import LobsterRunResult  # noqa: E402
from lobster_runner import LobsterRunSpec  # noqa: E402
from lobster_runner import LobsterRunner  # noqa: E402
from lobster_runner import run_lobster_with_background_support  # noqa: E402


class _FastRunner(LobsterRunner):
    def __init__(self) -> None:
        super().__init__(llm_router=object())

    async def run(self, spec: LobsterRunSpec) -> LobsterRunResult:  # type: ignore[override]
        return LobsterRunResult(
            final_content="done",
            messages=[],
            usage={"prompt_tokens": 1, "completion_tokens": 1},
            stop_reason="completed",
            elapsed_ms=10.0,
        )


class _SlowRunner(LobsterRunner):
    def __init__(self) -> None:
        super().__init__(llm_router=object())

    async def run(self, spec: LobsterRunSpec) -> LobsterRunResult:  # type: ignore[override]
        await asyncio.sleep(0.05)
        return LobsterRunResult(
            final_content="done-background",
            messages=[],
            usage={"prompt_tokens": 2, "completion_tokens": 2},
            stop_reason="completed",
            elapsed_ms=50.0,
        )


class LobsterBackgroundTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.registry = get_foreground_registry()
        for row in list(self.registry.list_foreground()):
            self.registry.unregister(row.run_id)

    async def test_foreground_registry_methods(self) -> None:
        task = self.registry.register("run-1", "radar", "desc")
        self.assertEqual(len(self.registry.list_foreground()), 1)
        self.assertTrue(self.registry.background_one("run-1"))
        self.assertTrue(task.background_event.is_set())
        self.assertTrue(self.registry.cancel("run-1"))
        self.assertTrue(task.cancel_event.is_set())
        self.assertEqual(self.registry.background_all(), 0)
        self.registry.unregister("run-1")
        self.assertEqual(len(self.registry.list_foreground()), 0)

    async def test_background_support_returns_sync_if_fast(self) -> None:
        runner = _FastRunner()
        spec = LobsterRunSpec(role_id="radar", system_prompt="sys", user_prompt="prompt")
        result = await run_lobster_with_background_support(
            runner,
            spec,
            "quick task",
            mode=LobsterExecutionMode.FOREGROUND,
        )
        self.assertIsInstance(result, LobsterRunResult)

    async def test_background_support_returns_async_launch_and_notification(self) -> None:
        runner = _SlowRunner()
        spec = LobsterRunSpec(role_id="radar", system_prompt="sys", user_prompt="prompt")
        queue: asyncio.Queue[TaskNotification] = asyncio.Queue()
        result = await run_lobster_with_background_support(
            runner,
            spec,
            "slow task",
            mode=LobsterExecutionMode.BACKGROUND,
            notification_queue=queue,
        )
        self.assertEqual(result.to_dict()["type"], "async_launched")
        notification = await asyncio.wait_for(queue.get(), timeout=1.0)
        self.assertEqual(notification.status, "completed")
        self.assertIn("<task-notification>", notification.to_xml())


if __name__ == "__main__":
    unittest.main()
