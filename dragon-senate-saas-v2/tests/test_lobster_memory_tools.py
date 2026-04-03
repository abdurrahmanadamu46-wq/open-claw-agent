"""Tests for lobster_memory_tools."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_memory_tools import kb_describe  # noqa: E402
from lobster_memory_tools import kb_expand_query  # noqa: E402
from lobster_memory_tools import kb_grep  # noqa: E402


class LobsterMemoryToolsTestCase(unittest.IsolatedAsyncioTestCase):
    def test_kb_grep_returns_hits(self) -> None:
        results = kb_grep("inkwriter", "钩子", scope="skills", limit=5)
        self.assertTrue(results)

    def test_kb_describe_returns_entry(self) -> None:
        result = kb_describe("ink_hook_v3_001", "inkwriter")
        self.assertIsNotNone(result)
        assert result is not None
        self.assertIn("entry", result)

    async def test_kb_expand_query_returns_ranked_entries(self) -> None:
        results = await kb_expand_query("inkwriter", "我想写一个吸引人的标题", top_k=2)
        self.assertLessEqual(len(results), 2)
        self.assertTrue(all("entry_id" in item for item in results))


if __name__ == "__main__":
    unittest.main()
