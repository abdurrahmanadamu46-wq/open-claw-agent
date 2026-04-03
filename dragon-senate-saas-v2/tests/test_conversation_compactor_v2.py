"""Tests for layered conversation compactor v2."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conversation_compactor_v2 import ConversationCompactorV2  # noqa: E402
from conversation_compactor_v2 import check_integrity  # noqa: E402


class DummyRouter:
    async def routed_ainvoke_text(self, *, system_prompt, user_prompt, meta=None, temperature=None):
        if "会话摘要" in system_prompt:
            return "会话层摘要\n【会话摘要完毕】"
        return "Leaf 摘要\n【摘要完毕】"


class ConversationCompactorV2TestCase(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_tail_protected(self) -> None:
        messages = [{"role": "user", "content": f"msg-{index}"} for index in range(60)]
        result = await ConversationCompactorV2(DummyRouter()).compact_lobster_session("inkwriter", messages)
        self.assertEqual(len(result.fresh_tail), 32)
        self.assertTrue(result.leaves)

    async def test_integrity_check(self) -> None:
        self.assertTrue(check_integrity("摘要\n【摘要完毕】"))
        self.assertFalse(check_integrity("摘要未完成"))


if __name__ == "__main__":
    unittest.main()
