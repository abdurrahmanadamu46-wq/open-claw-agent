from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import lobster_skill_registry  # noqa: E402
from skill_manifest_loader import load_all_skill_manifests  # noqa: E402
from skill_manifest_loader import load_skill_manifest  # noqa: E402


class SkillManifestLoaderTestCase(unittest.TestCase):
    def test_loads_ten_manifests(self) -> None:
        manifests = load_all_skill_manifests()
        self.assertEqual(len(manifests), 10)
        self.assertIn("radar", manifests)
        self.assertEqual(manifests["radar"].publish_status, "approved")

    def test_registry_skills_expose_publish_status(self) -> None:
        registry = lobster_skill_registry.get_skill_registry()
        skill = registry.get("radar_web_search")
        self.assertIsNotNone(skill)
        assert skill is not None
        payload = skill.to_api_dict()
        self.assertIn("publish_status", payload)
        self.assertIn("priority", payload)
        self.assertIn("max_tokens_budget", payload)

    def test_status_persistence_overrides_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            os.environ["SKILL_REGISTRY_STATE_PATH"] = str(Path(tmpdir) / "skill_registry_state.json")
            lobster_skill_registry.LobsterSkillRegistry._instance = None
            registry = lobster_skill_registry.get_skill_registry()
            ok = registry.update_publish_status("radar_web_search", "draft", note="needs review", updated_by="tester")
            self.assertTrue(ok)
            lobster_skill_registry.LobsterSkillRegistry._instance = None
            registry2 = lobster_skill_registry.get_skill_registry()
            skill = registry2.get("radar_web_search")
            self.assertIsNotNone(skill)
            assert skill is not None
            self.assertEqual(skill.publish_status, "draft")
        os.environ.pop("SKILL_REGISTRY_STATE_PATH", None)
        lobster_skill_registry.LobsterSkillRegistry._instance = None

    def test_manifest_scan_report_can_be_updated(self) -> None:
        record = load_skill_manifest("radar")
        self.assertIsNotNone(record)
        assert record is not None
        self.assertTrue(record.manifest_path.endswith("skill.manifest.yaml"))


if __name__ == "__main__":
    unittest.main()
