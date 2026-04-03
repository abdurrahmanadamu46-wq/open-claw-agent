"""Tests for edge security audit."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from memory_store import EdgeMemoryStore  # noqa: E402
from security_audit import AuditLevel, EdgeSecurityAudit  # noqa: E402


class _DummyWssClient:
    def __init__(self) -> None:
        self.connected = True
        self._last_heartbeat = datetime.now(timezone.utc) - timedelta(minutes=2)

    @property
    def last_heartbeat_at(self):
        return self._last_heartbeat

    def is_connected(self) -> bool:
        return self.connected


class TestEdgeSecurityAudit(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.workspace = Path(self.tmpdir.name) / "workspace"
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.memory = EdgeMemoryStore(db_path=str(self.workspace / "edge_memory.db"))
        self.audit = EdgeSecurityAudit(
            node_id="test-node",
            workspace_dir=self.workspace,
            wss_client=_DummyWssClient(),
            memory_store=self.memory,
        )

    async def test_generates_baseline_on_first_run(self) -> None:
        (self.workspace / "cookies.json").write_text('{"session": "abc123"}', encoding="utf-8")
        await self.audit.check_4_credential_integrity()
        result = self.audit.results[0]
        self.assertEqual(result.level, AuditLevel.OK)
        self.assertTrue((self.workspace / ".credential-baseline.sha256").exists())

    async def test_detects_credential_tampering(self) -> None:
        cookie = self.workspace / "cookies.json"
        cookie.write_text('{"session": "original"}', encoding="utf-8")
        await self.audit.check_4_credential_integrity()
        self.audit.results.clear()
        cookie.write_text('{"session": "tampered"}', encoding="utf-8")
        await self.audit.check_4_credential_integrity()
        result = self.audit.results[0]
        self.assertEqual(result.level, AuditLevel.CRIT)

    async def test_detects_plaintext_token(self) -> None:
        logs_dir = self.workspace / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "debug.json").write_text(
            '{"access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6Ikp1234567890"}',
            encoding="utf-8",
        )
        await self.audit.check_5_dlp_scan()
        result = self.audit.results[0]
        self.assertEqual(result.level, AuditLevel.CRIT)

    async def test_clean_logs_pass(self) -> None:
        logs_dir = self.workspace / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "access.log").write_text("task completed successfully", encoding="utf-8")
        await self.audit.check_5_dlp_scan()
        result = self.audit.results[0]
        self.assertEqual(result.level, AuditLevel.OK)

    async def test_run_full_audit_writes_report(self) -> None:
        report = await self.audit.run_full_audit()
        self.assertIn("summary", report)
        self.assertTrue((self.workspace / "security-reports").exists())

    async def test_old_reports_are_rotated(self) -> None:
        old_date = (datetime.now() - timedelta(days=31)).strftime("%Y-%m-%d")
        old_report = self.audit.report_dir / f"report-{old_date}.txt"
        self.audit.report_dir.mkdir(parents=True, exist_ok=True)
        old_report.write_text("old", encoding="utf-8")
        self.audit._rotate_reports()
        self.assertFalse(old_report.exists())


if __name__ == "__main__":
    unittest.main()
