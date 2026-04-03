"""Tests for escalation_manager."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import escalation_manager  # noqa: E402


class EscalationManagerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        os.environ["ESCALATION_DB_PATH"] = os.path.join(self.tmpdir.name, "escalations.sqlite")

    def test_escalate_and_resolve(self) -> None:
        event = asyncio.run(
            escalation_manager.escalate(
                tenant_id="tenant-a",
                task_id="task-1",
                lobster_id="radar",
                error_summary="validation failed",
                retry_count=2,
                context={"task_type": "signal_scan"},
            )
        )
        self.assertTrue(event.escalation_id.startswith("esc_"))

        pending = escalation_manager.list_escalations("tenant-a", status="pending_human_review")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["lobster_id"], "radar")

        resolved = escalation_manager.resolve_escalation(event.escalation_id, resolution="skip", note="manual skip")
        self.assertEqual(resolved["status"], "resolved_skip")
        self.assertEqual(resolved["resolution"], "skip")


if __name__ == "__main__":
    unittest.main()
