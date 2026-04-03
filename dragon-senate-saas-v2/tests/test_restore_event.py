"""Tests for restore_event."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import restore_event  # noqa: E402


class RestoreEventTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        os.environ["RESTORE_EVENT_DB_PATH"] = os.path.join(self.tmpdir.name, "restore.sqlite")
        os.environ["AUTH_NOTIFICATION_MODE"] = "file"
        os.environ["AUTH_NOTIFICATION_DIR"] = os.path.join(self.tmpdir.name, "notifications")

    def test_report_restore_complete_is_idempotent(self) -> None:
        first = asyncio.run(
            restore_event.report_restore_complete(
                tenant_id="tenant-a",
                backup_file="edge-backup_a.tar.gz",
                operator="tester",
                status="completed",
                items_restored=3,
                duration_seconds=1.2,
                started_at=12345.0,
                trigger_followup_report=False,
            )
        )
        second = asyncio.run(
            restore_event.report_restore_complete(
                tenant_id="tenant-a",
                backup_file="edge-backup_a.tar.gz",
                operator="tester",
                status="completed",
                items_restored=3,
                duration_seconds=1.2,
                started_at=12345.0,
                trigger_followup_report=False,
            )
        )
        self.assertTrue(first["is_new"])
        self.assertFalse(second["is_new"])
        events = restore_event.list_restore_events("tenant-a", limit=10)
        self.assertEqual(len(events), 1)


if __name__ == "__main__":
    unittest.main()
