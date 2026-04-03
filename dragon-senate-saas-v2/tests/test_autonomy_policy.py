"""Tests for autonomy_policy."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from autonomy_policy import AutonomyLevel  # noqa: E402
from autonomy_policy import AutonomyPolicy  # noqa: E402
from autonomy_policy import AutonomyPolicyManager  # noqa: E402


class TestAutonomyPolicy(unittest.TestCase):
    def test_l0_requires_approval(self) -> None:
        policy = AutonomyPolicy(default_level=AutonomyLevel.L0_OBSERVE)
        self.assertTrue(policy.should_require_approval({}, "radar"))

    def test_l2_allows_reversible_actions(self) -> None:
        policy = AutonomyPolicy(default_level=AutonomyLevel.L2_EXECUTE)
        self.assertFalse(policy.should_require_approval({"irreversible": False, "affects_shared_state": False}, "radar"))
        self.assertTrue(policy.should_require_approval({"irreversible": True}, "radar"))

    def test_l3_disables_approval_but_requires_full_audit(self) -> None:
        policy = AutonomyPolicy(default_level=AutonomyLevel.L3_AUTONOMOUS)
        self.assertFalse(policy.should_require_approval({"irreversible": True}, "echoer"))
        self.assertEqual(policy.get_audit_level(AutonomyLevel.L3_AUTONOMOUS), "full_audit")

    def test_manager_persists_updates(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        manager = AutonomyPolicyManager(state_path=str(Path(tmpdir.name) / "autonomy.json"))
        snapshot = manager.update_policy(
            "tenant-a",
            default_level=1,
            per_lobster_overrides={"dispatcher": 3},
            updated_by="tester",
            reason="unit_test",
        )
        self.assertEqual(snapshot["tenant_id"], "tenant-a")
        self.assertEqual(snapshot["default_level"], 1)
        self.assertEqual(snapshot["per_lobster_overrides"]["dispatcher"], 3)
        reloaded = AutonomyPolicyManager(state_path=str(Path(tmpdir.name) / "autonomy.json"))
        self.assertEqual(reloaded.get_snapshot("tenant-a")["per_lobster_overrides"]["dispatcher"], 3)


if __name__ == "__main__":
    unittest.main()
