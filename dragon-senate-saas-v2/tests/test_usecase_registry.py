"""Tests for usecase_registry."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from usecase_registry import UsecaseRegistry  # noqa: E402


class TestUsecaseRegistry(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = UsecaseRegistry()

    def test_loads_all_seeded_usecases(self) -> None:
        usecases = self.registry.list_usecases()
        self.assertGreaterEqual(len(usecases), 15)
        ids = {item["id"] for item in usecases}
        self.assertIn("uc-xiaohongshu-autopilot", ids)
        self.assertIn("uc-inventory-alert", ids)

    def test_can_filter_by_category(self) -> None:
        social_media = self.registry.list_usecases(category="social_media")
        self.assertTrue(social_media)
        self.assertTrue(all(item["category"] == "social_media" for item in social_media))

    def test_can_filter_by_difficulty(self) -> None:
        advanced = self.registry.list_usecases(difficulty="advanced")
        self.assertTrue(advanced)
        self.assertTrue(all(item["difficulty"] == "advanced" for item in advanced))

    def test_categories_summary(self) -> None:
        categories = self.registry.get_categories()
        self.assertTrue(categories)
        flat = {item["category"]: item["count"] for item in categories}
        self.assertIn("customer_service", flat)
        self.assertGreaterEqual(flat["customer_service"], 3)

    def test_get_single_usecase(self) -> None:
        usecase = self.registry.get_usecase("uc-content-factory")
        self.assertIsNotNone(usecase)
        assert usecase is not None
        self.assertEqual(usecase["difficulty"], "advanced")
        self.assertIn("dispatcher", usecase["lobsters"])


if __name__ == "__main__":
    unittest.main()
