"""Tests for lobster registry manager."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_registry_manager import (  # noqa: E402
    get_lobster_summary,
    increment_token_usage,
    load_registry,
    record_error,
    record_heartbeat,
    record_task_complete,
    reset_daily_token_usage,
    save_registry,
    update_lobster_status,
)


class TestLobsterRegistryManager(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.path = self.tmpdir / "lobsters-registry.json"
        self.registry = {
            "$schema": "lobsters-registry-v1",
            "updated_at": None,
            "lobsters": {
                "radar": {
                    "display_name": "Radar",
                    "zh_name": "触须虾",
                    "status": "idle",
                    "phase": "① 信号发现",
                    "last_heartbeat": None,
                    "last_task_id": None,
                    "error_count": 0,
                    "run_count": 0,
                    "token_usage_today": 0,
                }
            },
        }
        save_registry(self.registry, self.path)

    def test_load_and_save_registry(self):
        reg = load_registry(self.path)
        self.assertIn("lobsters", reg)
        self.assertIn("radar", reg["lobsters"])

    def test_update_lobster_status(self):
        ok = update_lobster_status("radar", "busy", self.path)
        self.assertTrue(ok)
        reg = load_registry(self.path)
        self.assertEqual(reg["lobsters"]["radar"]["status"], "busy")

    def test_record_heartbeat(self):
        ok = record_heartbeat("radar", self.path)
        self.assertTrue(ok)
        reg = load_registry(self.path)
        self.assertIsNotNone(reg["lobsters"]["radar"]["last_heartbeat"])

    def test_record_task_complete(self):
        ok = record_task_complete("radar", "task_1", self.path)
        self.assertTrue(ok)
        reg = load_registry(self.path)
        self.assertEqual(reg["lobsters"]["radar"]["last_task_id"], "task_1")
        self.assertEqual(reg["lobsters"]["radar"]["run_count"], 1)
        self.assertEqual(reg["lobsters"]["radar"]["status"], "idle")

    def test_record_error(self):
        ok = record_error("radar", self.path)
        self.assertTrue(ok)
        reg = load_registry(self.path)
        self.assertEqual(reg["lobsters"]["radar"]["error_count"], 1)
        self.assertEqual(reg["lobsters"]["radar"]["status"], "error")

    def test_increment_and_reset_token_usage(self):
        ok = increment_token_usage("radar", 123, self.path)
        self.assertTrue(ok)
        reg = load_registry(self.path)
        self.assertEqual(reg["lobsters"]["radar"]["token_usage_today"], 123)
        reset_daily_token_usage(self.path)
        reg = load_registry(self.path)
        self.assertEqual(reg["lobsters"]["radar"]["token_usage_today"], 0)

    def test_get_lobster_summary(self):
        items = get_lobster_summary(self.path)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["role_id"], "radar")
        self.assertEqual(items[0]["status"], "idle")


if __name__ == "__main__":
    unittest.main()
