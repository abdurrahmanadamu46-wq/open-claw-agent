"""Tests for HeartbeatEngine 7-step management meeting."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from heartbeat_engine import HeartbeatEngine  # noqa: E402


class TestHeartbeatEngine(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.reg_path = self.tmpdir / "lobsters-registry.json"
        self.working_dir = self.tmpdir / "lobsters"
        registry = {"radar": {}, "strategist": {}, "inkwriter": {}}
        self.reg_path.write_text(json.dumps(registry), encoding="utf-8")
        for role in registry:
            d = self.working_dir / f"lobster-{role}"
            d.mkdir(parents=True)
            (d / "working.json").write_text(
                json.dumps({"current_task": None, "blocked_by": []}),
                encoding="utf-8",
            )
            (d / "heartbeat.json").write_text(
                json.dumps({"periodic": [{"action": "test_action", "interval_minutes": 60}]}),
                encoding="utf-8",
            )
        self.engine = HeartbeatEngine(
            lobster_registry_path=self.reg_path,
            working_dir=self.working_dir,
            interval_sec=300,
        )

    async def test_heartbeat_ok_when_all_idle(self):
        report = await self.engine.run_heartbeat()
        self.assertEqual(report["status"], "HEARTBEAT_OK")

    async def test_detects_blocked_lobster(self):
        working_path = self.working_dir / "lobster-radar" / "working.json"
        working_path.write_text(
            json.dumps(
                {
                    "current_task": {"task_id": "t1", "task_type": "finite", "started_at": "2026-03-31T00:00:00Z"},
                    "blocked_by": ["waiting_for_api_key"],
                }
            ),
            encoding="utf-8",
        )
        report = await self.engine.run_heartbeat()
        warnings = [f for f in report["findings"] if f["severity"] == "warning"]
        self.assertTrue(any("阻塞" in w["message"] for w in warnings))

    async def test_capacity_assessment(self):
        report = await self.engine.run_heartbeat()
        cap = report["metrics"]["capacity"]
        self.assertEqual(cap["total_lobsters"], 3)
        self.assertEqual(cap["idle"], 3)
        self.assertEqual(cap["busy"], 0)

    async def test_periodic_task_detection(self):
        report = await self.engine.run_heartbeat()
        periodic_findings = [f for f in report["findings"] if f.get("action") == "trigger_periodic"]
        self.assertGreaterEqual(len(periodic_findings), 1)

    def test_format_report_ok(self):
        report = {
            "timestamp": "2026-03-31T08:00:00Z",
            "status": "HEARTBEAT_OK",
            "findings": [],
            "metrics": {"capacity": {"total_lobsters": 9, "busy": 0, "idle": 9, "utilization_pct": 0}},
        }
        text = self.engine._format_report(report)
        self.assertIn("全部正常", text)

    def test_format_report_with_errors(self):
        report = {
            "timestamp": "2026-03-31T08:00:00Z",
            "status": "HEARTBEAT_ALERT",
            "findings": [{"severity": "error", "lobster": "radar", "message": "超时"}],
            "metrics": {"capacity": {"total_lobsters": 9, "busy": 1, "idle": 8, "utilization_pct": 11.1}},
        }
        text = self.engine._format_report(report)
        self.assertIn("异常", text)
        self.assertIn("radar", text)


if __name__ == "__main__":
    unittest.main()
