"""Tests for lobster output format templates."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["MEMORY_COMPRESSION_ENABLED"] = "false"
os.environ["LOBSTER_FILE_MEMORY_ENABLED"] = "false"
os.environ["LOBSTER_MEMORY_AUTO_EXTRACT"] = "false"

from lobsters.base_lobster import BaseLobster  # noqa: E402
from lobster_runner import LobsterRunSpec, LobsterRunner, select_output_format  # noqa: E402


class RadarLobster(BaseLobster):
    role_id = "radar"


class VisualizerLobster(BaseLobster):
    role_id = "visualizer"


class DummyRouter:
    async def routed_ainvoke_text(self, **kwargs):
        return "ok"


class TestOutputFormatTemplates(unittest.TestCase):
    def test_radar_has_four_standard_formats(self):
        lobster = RadarLobster()
        self.assertEqual(set(lobster.output_formats.keys()), {"alert", "digest", "comparison", "analysis"})

    def test_visualizer_has_four_standard_formats(self):
        lobster = VisualizerLobster()
        self.assertEqual(set(lobster.output_formats.keys()), {"alert", "digest", "comparison", "analysis"})

    def test_select_output_format_alert(self):
        lobster = RadarLobster()
        template = select_output_format(lobster, "risk_event")
        self.assertIsInstance(template, str)
        self.assertIn("{", template)

    def test_select_output_format_comparison(self):
        lobster = RadarLobster()
        template = select_output_format(lobster, "competitor_compare")
        self.assertIsInstance(template, str)
        self.assertIn("|", template)

    def test_runner_result_contains_output_format_template(self):
        runner = LobsterRunner(DummyRouter())
        lobster = RadarLobster()

        result = asyncio.run(
            runner.run(
                LobsterRunSpec(
                    role_id="radar",
                    system_prompt="sys",
                    user_prompt="usr",
                    lobster=lobster,
                    meta={"task_type": "weekly_report"},
                )
            )
        )
        self.assertIsNotNone(result.output_format_template)
        self.assertIn("##", result.output_format_template)


if __name__ == "__main__":
    unittest.main()
