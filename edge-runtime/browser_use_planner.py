from __future__ import annotations

from typing import Any


class BrowserUsePlanner:
    async def plan_task(self, goal: str, *, platform: str = "") -> list[dict[str, Any]]:
        normalized_goal = str(goal or "").strip()
        if not normalized_goal:
            return []
        try:  # pragma: no cover - optional dependency
            import browser_use  # noqa: F401

            # Placeholder: keep API boundary ready for real browser-use integration.
            return [{"action": "act", "instruction": normalized_goal, "source": "browser_use"}]
        except Exception:
            return self._fallback_plan(normalized_goal, platform=platform)

    @staticmethod
    def _fallback_plan(goal: str, *, platform: str = "") -> list[dict[str, Any]]:
        steps: list[dict[str, Any]] = []
        if "xiaohongshu" in platform or "小红书" in goal:
            steps.append({"action": "navigate", "url": "https://creator.xiaohongshu.com/publish/publish"})
        elif "douyin" in platform or "抖音" in goal:
            steps.append({"action": "navigate", "url": "https://creator.douyin.com/"})
        steps.append({"action": "act", "instruction": goal, "source": "heuristic"})
        return steps
