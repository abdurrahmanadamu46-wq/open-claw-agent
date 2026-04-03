from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api_snapshot_audit import SnapshotAuditStore  # noqa: E402


class SnapshotAuditStoreTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.store = SnapshotAuditStore(db_path=os.path.join(self.tmpdir.name, "snapshots.sqlite"))

    def test_store_list_detail_and_replay(self) -> None:
        report = {
            "snapshot_id": "snap_001",
            "tenant_id": "tenant-a",
            "node_id": "node-1",
            "account_id": "acc-1",
            "platform": "xiaohongshu",
            "action_type": "publish",
            "task_id": "task-1",
            "status": "success",
            "duration_ms": 1234,
            "total_steps": 2,
            "steps": [{"index": 1, "name": "navigate"}],
            "replay": {"frames": ["/tmp/a.png"], "timeline": [{"type": "step", "name": "navigate"}]},
        }
        stored = self.store.store_report(report)
        self.assertEqual(stored["snapshot_id"], "snap_001")

        items = self.store.list_snapshots(tenant_id="tenant-a", limit=10)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["status"], "success")

        detail = self.store.get_snapshot("snap_001", tenant_id="tenant-a")
        self.assertIsNotNone(detail)
        assert detail is not None
        self.assertEqual(detail["platform"], "xiaohongshu")

        replay = self.store.get_replay("snap_001", tenant_id="tenant-a")
        self.assertIsNotNone(replay)
        assert replay is not None
        self.assertEqual(replay["replay"]["frames"][0], "/tmp/a.png")


if __name__ == "__main__":
    unittest.main()
