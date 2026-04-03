"""Tests for smart routing audit persistence."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["LLM_LOG_DB"] = os.path.join(tempfile.mkdtemp(), "test_smart_routing.sqlite")

import provider_registry as provider_registry_module  # noqa: E402

provider_registry_module = importlib.reload(provider_registry_module)

from provider_registry import log_smart_routing_decision, smart_routing_stats  # noqa: E402


class TestSmartRoutingLog(unittest.TestCase):
    def test_log_and_stats(self) -> None:
        route_id = log_smart_routing_decision(
            tenant_id="tenant-a",
            user_id="user-a",
            task_type="strategy_planning",
            tier="pro",
            model="deepseek-reasoner",
            provider_name="deepseek",
            route="cloud",
            method="complexity_score",
            score=58,
            pattern=None,
            input_len=128,
            dim_scores={"reasoning_words": 75},
        )
        self.assertIsInstance(route_id, str)

        stats = smart_routing_stats()
        self.assertGreaterEqual(stats.get("total", 0), 1)
        self.assertGreaterEqual(int(stats.get("by_tier", {}).get("pro", 0)), 1)
        self.assertGreaterEqual(int(stats.get("by_method", {}).get("complexity_score", 0)), 1)


if __name__ == "__main__":
    unittest.main()
