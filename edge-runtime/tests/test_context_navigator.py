"""
Unit tests for ContextNavigator and selector parsing.
Run with: python -m pytest edge-runtime/tests/ -v
"""
import asyncio
import sys
import os
import unittest

# Add parent dir so imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from context_navigator import (
    ContextNavigator,
    TargetResolution,
    SelectorHint,
    parse_selector_hint,
)


class TestSelectorHintParsing(unittest.TestCase):
    """Test parse_selector_hint for various selector formats."""

    def test_empty_string(self):
        hint = parse_selector_hint("")
        self.assertEqual(hint.selector_type, "empty")
        self.assertEqual(hint.value, "")

    def test_none_input(self):
        hint = parse_selector_hint(None)  # type: ignore[arg-type]
        self.assertEqual(hint.selector_type, "empty")

    def test_css_class(self):
        hint = parse_selector_hint(".submit-btn")
        self.assertEqual(hint.selector_type, "css")
        self.assertEqual(hint.value, ".submit-btn")

    def test_css_id(self):
        hint = parse_selector_hint("#main-form")
        self.assertEqual(hint.selector_type, "css")
        self.assertEqual(hint.value, "#main-form")

    def test_css_attribute(self):
        hint = parse_selector_hint('[data-testid="publish"]')
        self.assertEqual(hint.selector_type, "css")

    def test_xpath_double_slash(self):
        hint = parse_selector_hint("//div[@class='editor']")
        self.assertEqual(hint.selector_type, "xpath")
        self.assertEqual(hint.value, "//div[@class='editor']")

    def test_xpath_parenthesized(self):
        hint = parse_selector_hint("(//button)[1]")
        self.assertEqual(hint.selector_type, "xpath")

    def test_text_match(self):
        hint = parse_selector_hint("text:Submit")
        self.assertEqual(hint.selector_type, "text")
        self.assertEqual(hint.value, "Submit")

    def test_text_match_chinese(self):
        hint = parse_selector_hint("text:\u53d1\u5e03")
        self.assertEqual(hint.selector_type, "text")
        self.assertEqual(hint.value, "\u53d1\u5e03")

    def test_coordinate_hint(self):
        hint = parse_selector_hint("xy:100,200")
        self.assertEqual(hint.selector_type, "coordinate")
        self.assertEqual(hint.value, "100,200")

    def test_coordinate_with_spaces(self):
        hint = parse_selector_hint("xy: 100 , 200")
        self.assertEqual(hint.selector_type, "coordinate")


class TestTargetResolution(unittest.TestCase):
    """Test TargetResolution data class."""

    def test_center_calculation(self):
        res = TargetResolution(x=100, y=200, width=50, height=30)
        self.assertEqual(res.center_x, 125.0)
        self.assertEqual(res.center_y, 215.0)

    def test_as_dict(self):
        res = TargetResolution(
            x=10, y=20, width=100, height=50,
            selector=".btn", method="css", confidence=0.95,
        )
        d = res.as_dict()
        self.assertEqual(d["x"], 10)
        self.assertEqual(d["center_x"], 60.0)
        self.assertEqual(d["method"], "css")
        self.assertEqual(d["confidence"], 0.95)


class TestContextNavigator(unittest.TestCase):
    """Test ContextNavigator resolution pipeline."""

    def test_coordinate_resolution(self):
        nav = ContextNavigator()
        result = asyncio.get_event_loop().run_until_complete(
            nav.resolve("xy:300,400")
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.x, 300.0)
        self.assertEqual(result.y, 400.0)
        self.assertEqual(result.method, "coordinate_hint")
        self.assertEqual(nav.stats["resolved"], 1)

    def test_css_without_page_fails(self):
        nav = ContextNavigator()
        result = asyncio.get_event_loop().run_until_complete(
            nav.resolve(".some-class")
        )
        self.assertIsNone(result)
        self.assertEqual(nav.stats["failures"], 1)

    def test_cache_eviction(self):
        nav = ContextNavigator()
        # Resolve a coordinate to populate cache
        asyncio.get_event_loop().run_until_complete(nav.resolve("xy:10,20"))
        # Coordinate hints don't get cached (direct return), so cache should be 0
        evicted = nav.clear_cache()
        self.assertEqual(evicted, 0)

    def test_describe(self):
        nav = ContextNavigator(viewport=(1280, 720))
        desc = nav.describe()
        self.assertEqual(desc["viewport"], [1280, 720])
        self.assertIn("stats", desc)


if __name__ == "__main__":
    unittest.main()
