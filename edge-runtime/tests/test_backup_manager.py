"""Tests for edge backup manager."""

from __future__ import annotations

import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backup_manager import EdgeBackupManager  # noqa: E402


class TestEdgeBackupManager(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.home = Path(self.tmpdir.name) / ".openclaw"
        self.home.mkdir(parents=True, exist_ok=True)
        (self.home / "credentials").mkdir(parents=True, exist_ok=True)
        (self.home / "tasks").mkdir(parents=True, exist_ok=True)
        (self.home / "cron").mkdir(parents=True, exist_ok=True)
        (self.home / "workspace").mkdir(parents=True, exist_ok=True)
        (self.home / "edge.json").write_text(json.dumps({"node_id": "node-test"}), encoding="utf-8")
        (self.home / "edge_memory.db").write_text("sqlite-data", encoding="utf-8")
        (self.home / "credentials" / "cookie.json").write_text("{}", encoding="utf-8")
        (self.home / "tasks" / "history.json").write_text("[]", encoding="utf-8")
        (self.home / "pending_tasks.json").write_text("[]", encoding="utf-8")
        (self.home / "cron" / "job.json").write_text("{}", encoding="utf-8")
        (self.home / "scheduler_config.json").write_text("{}", encoding="utf-8")
        self.backup_dir = Path(self.tmpdir.name) / "backups"
        self.manager = EdgeBackupManager(openclaw_home=self.home)

    def test_backup_creates_archive_and_manifest(self) -> None:
        result = self.manager.backup(self.backup_dir)
        self.assertTrue(result["success"])
        archive = Path(result["archive"])
        self.assertTrue(archive.exists())

        with tarfile.open(archive, "r:gz") as tar:
            names = tar.getnames()
        self.assertTrue(any(name.endswith("MANIFEST.json") for name in names))
        self.assertTrue(any("credentials/cookie.json" in name for name in names))
        self.assertTrue(any("tasks/history.json" in name for name in names))

    def test_list_backups_returns_latest_archive(self) -> None:
        self.manager.backup(self.backup_dir)
        rows = self.manager.list_backups(self.backup_dir)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["name"].endswith(".tar.gz"))

    def test_restore_dry_run_does_not_write_marker(self) -> None:
        result = self.manager.backup(self.backup_dir)
        archive = result["archive"]
        restore_result = self.manager.restore(archive, dry_run=True)
        self.assertTrue(restore_result["success"])
        marker = self.home / "workspace" / ".restore-complete.json"
        self.assertFalse(marker.exists())

    def test_restore_live_writes_marker_and_restores_files(self) -> None:
        result = self.manager.backup(self.backup_dir)
        archive = result["archive"]

        # remove source files to prove restore works
        (self.home / "credentials" / "cookie.json").unlink()
        (self.home / "tasks" / "history.json").unlink()

        restore_result = self.manager.restore(archive, dry_run=False)
        self.assertTrue(restore_result["success"])
        self.assertTrue((self.home / "credentials" / "cookie.json").exists())
        self.assertTrue((self.home / "tasks" / "history.json").exists())
        marker = self.home / "workspace" / ".restore-complete.json"
        self.assertTrue(marker.exists())

        payload = self.manager.check_restore_complete()
        self.assertIsNotNone(payload)
        self.assertEqual(payload["node_id"], "node-test")
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
