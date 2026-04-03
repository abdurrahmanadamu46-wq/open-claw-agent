"""Tests for token_budget helpers."""

from __future__ import annotations

import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from token_budget import apply_fresh_context  # noqa: E402
from token_budget import estimate_tokens  # noqa: E402
from token_budget import truncate_history  # noqa: E402


class TokenBudgetTestCase(unittest.TestCase):
    def test_estimate_tokens_returns_positive_value(self) -> None:
        self.assertGreaterEqual(estimate_tokens("你好世界"), 1)

    def test_truncate_history_keeps_recent_messages(self) -> None:
        messages = [{"role": "user", "content": f"msg-{index}"} for index in range(100)]
        trimmed, was_truncated = truncate_history(messages, max_messages=10, max_tokens=1000)
        self.assertTrue(was_truncated)
        self.assertEqual(len(trimmed), 10)
        self.assertEqual(trimmed[-1]["content"], "msg-99")

    def test_apply_fresh_context_drops_history(self) -> None:
        spec = SimpleNamespace(fresh_context=True, max_history_messages=50, max_context_tokens=8000)
        messages = [
            {"role": "assistant", "content": "历史1"},
            {"role": "user", "content": "历史2"},
        ]
        self.assertEqual(apply_fresh_context(spec, messages), [])


if __name__ == "__main__":
    unittest.main()
