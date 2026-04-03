from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from skill_publish_policy import SkillPublishPolicy  # noqa: E402


class SkillPublishPolicyTestCase(unittest.TestCase):
    def test_missing_required_field_is_rejected(self) -> None:
        policy = SkillPublishPolicy()
        violations = policy.validate(
            {"id": "demo", "lobster_id": "radar", "name": "Demo", "publish_status": "draft"},
            ["prompt-kit/system.prompt.md"],
        )
        self.assertIn("required field 'description' missing", violations)

    def test_radar_requires_industry_tags(self) -> None:
        policy = SkillPublishPolicy()
        violations = policy.validate(
            {
                "id": "radar_signal_discovery",
                "lobster_id": "radar",
                "name": "信号发现",
                "description": "desc",
                "publish_status": "draft",
                "industry_tags": [],
            },
            ["prompt-kit/system.prompt.md"],
        )
        self.assertIn("industry_tags required for lobster 'radar'", violations)

    def test_extension_whitelist_rejects_unknown_file(self) -> None:
        policy = SkillPublishPolicy()
        violations = policy.validate(
            {
                "id": "demo",
                "lobster_id": "echoer",
                "name": "Demo",
                "description": "desc",
                "publish_status": "draft",
            },
            ["payload.exe"],
        )
        self.assertTrue(any("not allowed" in item for item in violations))


if __name__ == "__main__":
    unittest.main()
