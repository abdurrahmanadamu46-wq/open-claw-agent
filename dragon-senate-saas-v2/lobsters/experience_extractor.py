"""
Reusable experience extractor inspired by memU's memorize & extract step.
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable


class ExperienceExtractor:
    def __init__(self, llm_call_fn: Callable[[str, int], Awaitable[str]]):
        self._llm = llm_call_fn

    async def extract(self, session_log: str, lobster_id: str) -> list[dict[str, str]]:
        prompt = (
            f"你是 {lobster_id} 的经验提炼器。\n"
            "从以下会话日志中提取最多 5 条可复用经验，分类限定为 preferences / knowledge / skills。\n"
            "只输出 JSON 数组，每项包含 category, key, value。\n\n"
            f"{session_log[:5000]}"
        )
        try:
            response = await self._llm(prompt, 600)
            payload = json.loads(response)
        except Exception:
            return []
        if not isinstance(payload, list):
            return []
        results: list[dict[str, str]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            category = str(item.get("category") or "").strip()
            key = str(item.get("key") or "").strip()
            value = str(item.get("value") or "").strip()
            if category not in {"preferences", "knowledge", "skills"} or not key or not value:
                continue
            results.append({"category": category, "key": key, "value": value})
        return results[:5]
