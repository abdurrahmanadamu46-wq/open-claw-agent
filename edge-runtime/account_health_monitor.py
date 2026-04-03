from __future__ import annotations

from typing import Any


class AccountHealthMonitor:
    RISK_SIGNALS = {
        "xiaohongshu": [
            "您的账号存在异常",
            "内容审核中",
            "请完成验证",
            "账号已被限制",
        ],
        "douyin": [
            "账号异常",
            "滑动验证",
            "操作频繁",
        ],
        "weibo": [
            "账号异常",
            "操作频繁",
        ],
    }

    async def check_after_action(self, session: Any, platform: str) -> dict[str, Any]:
        page = getattr(session, "page", None)
        if page is None or not hasattr(page, "evaluate"):
            return {"healthy": True, "risks": [], "action": "continue"}
        try:
            page_text = await page.evaluate("() => document.body.innerText")
        except Exception:
            return {"healthy": True, "risks": [], "action": "continue"}
        signals = self.RISK_SIGNALS.get(str(platform or "").strip(), [])
        detected = [item for item in signals if item in str(page_text or "")]
        if detected:
            return {
                "healthy": False,
                "risks": detected,
                "action": "pause_account",
                "alert": True,
            }
        return {"healthy": True, "risks": [], "action": "continue"}
