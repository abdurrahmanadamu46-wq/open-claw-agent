"""Tests for Agent OS file loading."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobsters.base_lobster import (  # noqa: E402
    BaseLobster,
    load_agents_rules,
    load_heartbeat,
    load_soul,
    load_working,
    save_working,
)


class TestAgentOSFiles(unittest.TestCase):
    def test_load_soul(self):
        content = load_soul("radar")
        self.assertIsInstance(content, str)
        self.assertIn("Agent Soul", content)

    def test_load_agents_rules(self):
        content = load_agents_rules("radar")
        self.assertIsInstance(content, str)
        self.assertIn("AGENTS.md", content)

    def test_load_heartbeat(self):
        heartbeat = load_heartbeat("radar")
        self.assertIsInstance(heartbeat, dict)
        self.assertIn("on_wake", heartbeat)
        self.assertIn("periodic", heartbeat)

    def test_load_and_save_working(self):
        working = load_working("radar")
        self.assertIsInstance(working, dict)
        original = dict(working)
        working["updated_at"] = "2026-03-31T00:00:00Z"
        save_working("radar", working)
        reloaded = load_working("radar")
        self.assertEqual(reloaded["updated_at"], "2026-03-31T00:00:00Z")
        save_working("radar", original)

    def test_system_prompt_full(self):
        class RadarLobster(BaseLobster):
            role_id = "radar"

        lobster = RadarLobster()
        self.assertTrue(lobster.system_prompt_full)
        self.assertIn("---", lobster.system_prompt_full)
        self.assertTrue(isinstance(lobster.heartbeat, dict))
        self.assertTrue(isinstance(lobster.working, dict))


if __name__ == "__main__":
    unittest.main()
