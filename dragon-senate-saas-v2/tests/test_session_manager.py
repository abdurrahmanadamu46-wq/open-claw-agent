"""Tests for session_manager and session-aware runner behavior."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_runner import LobsterRunSpec  # noqa: E402
from lobster_runner import LobsterRunner  # noqa: E402
from session_manager import reset_session_manager  # noqa: E402
from session_manager import SessionManager  # noqa: E402


class MockLLMRouter:
    def __init__(self, responses: list[str] | None = None):
        self.responses = responses or ["ok"]
        self.calls: list[dict[str, object]] = []
        self._call_count = 0

    async def routed_ainvoke_text(self, *, system_prompt, user_prompt, meta=None, temperature=None):
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "meta": meta,
                "temperature": temperature,
            }
        )
        idx = min(self._call_count, len(self.responses) - 1)
        self._call_count += 1
        return self.responses[idx]


class SessionManagerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        reset_session_manager()
        self.manager = SessionManager(storage_dir=self.tmpdir.name)

    def test_per_peer_keeps_users_isolated(self) -> None:
        s1 = self.manager.get_or_create(peer_id="user-a", lobster_id="echoer", mode="per-peer", tenant_id="tenant-1")
        s2 = self.manager.get_or_create(peer_id="user-b", lobster_id="echoer", mode="per-peer", tenant_id="tenant-1")
        self.assertNotEqual(s1.session_id, s2.session_id)

        self.manager.append_message(s1.session_id, role="user", content="hello a")
        self.manager.append_message(s2.session_id, role="user", content="hello b")

        self.assertEqual(self.manager.get_history(s1.session_id)[0]["content"], "hello a")
        self.assertEqual(self.manager.get_history(s2.session_id)[0]["content"], "hello b")

    def test_shared_mode_reuses_one_session(self) -> None:
        s1 = self.manager.get_or_create(peer_id="user-a", lobster_id="echoer", mode="shared", tenant_id="tenant-1")
        s2 = self.manager.get_or_create(peer_id="user-b", lobster_id="echoer", mode="shared", tenant_id="tenant-1")
        self.assertEqual(s1.session_id, s2.session_id)

    def test_isolated_mode_never_persists(self) -> None:
        s1 = self.manager.get_or_create(peer_id="cron-job", lobster_id="dispatcher", mode="isolated", tenant_id="tenant-1")
        self.manager.append_message(s1.session_id, role="user", content="run once")
        files = [name for name in os.listdir(self.tmpdir.name) if name.endswith(".json")]
        self.assertEqual(files, [])

    def test_non_isolated_sessions_survive_reload(self) -> None:
        s1 = self.manager.get_or_create(peer_id="user-a", lobster_id="echoer", mode="per-peer", tenant_id="tenant-1")
        self.manager.append_message(s1.session_id, role="user", content="persist me")

        reloaded = SessionManager(storage_dir=self.tmpdir.name)
        restored = reloaded.get_or_create(peer_id="user-a", lobster_id="echoer", mode="per-peer", tenant_id="tenant-1")
        self.assertEqual(restored.session_id, s1.session_id)
        self.assertEqual(reloaded.get_history(restored.session_id)[0]["content"], "persist me")


class SessionAwareRunnerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        os.environ["SESSIONS_STORAGE_DIR"] = self.tmpdir.name
        os.environ["MEMORY_COMPRESSION_ENABLED"] = "false"
        reset_session_manager()

    def tearDown(self) -> None:
        os.environ.pop("SESSIONS_STORAGE_DIR", None)
        os.environ.pop("MEMORY_COMPRESSION_ENABLED", None)
        reset_session_manager()

    def test_runner_injects_previous_session_history(self) -> None:
        router = MockLLMRouter(["first answer", "second answer"])
        runner = LobsterRunner(router)

        asyncio.run(
            runner.run(
                LobsterRunSpec(
                    role_id="radar",
                    system_prompt="sys",
                    user_prompt="first question",
                    session_mode="per-peer",
                    peer_id="user-a",
                    meta={"tenant_id": "tenant-1", "action_type": "analysis"},
                )
            )
        )
        asyncio.run(
            runner.run(
                LobsterRunSpec(
                    role_id="radar",
                    system_prompt="sys",
                    user_prompt="second question",
                    session_mode="per-peer",
                    peer_id="user-a",
                    meta={"tenant_id": "tenant-1", "action_type": "analysis"},
                )
            )
        )

        self.assertGreaterEqual(len(router.calls), 2)
        second_prompt = str(router.calls[-1]["user_prompt"])
        self.assertIn("[Previous response]: first answer", second_prompt)
        self.assertIn("second question", second_prompt)

    def test_runner_isolated_session_does_not_bleed_history(self) -> None:
        router = MockLLMRouter(["first isolated", "second isolated"])
        runner = LobsterRunner(router)

        asyncio.run(
            runner.run(
                LobsterRunSpec(
                    role_id="dispatcher",
                    system_prompt="sys",
                    user_prompt="one-off task",
                    session_mode="isolated",
                    peer_id="cron-a",
                    meta={"tenant_id": "tenant-1", "action_type": "analysis"},
                )
            )
        )
        asyncio.run(
            runner.run(
                LobsterRunSpec(
                    role_id="dispatcher",
                    system_prompt="sys",
                    user_prompt="another one-off task",
                    session_mode="isolated",
                    peer_id="cron-a",
                    meta={"tenant_id": "tenant-1", "action_type": "analysis"},
                )
            )
        )

        second_prompt = str(router.calls[-1]["user_prompt"])
        self.assertNotIn("[Previous response]: first isolated", second_prompt)
        self.assertIn("another one-off task", second_prompt)


if __name__ == "__main__":
    unittest.main()
