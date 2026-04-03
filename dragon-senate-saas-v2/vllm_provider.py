from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx


VLLM_TASK_TYPES: dict[str, set[str]] = {
    "inkwriter": {"copywriting", "content_generation", "image_caption", "hashtag"},
    "echoer": {"comment_reply", "dm_reply", "engagement_copy"},
    "radar": {"signal_brief", "trend_summary", "signal_briefing"},
    "followup": {"followup_script", "dm_proactive", "followup_voice"},
    "catcher": {"lead_score", "dm_script", "lead_capture"},
}

CLAUDE_ONLY_TASKS: dict[str, set[str]] = {
    "commander": {"route_plan", "task_decompose", "general"},
    "strategist": {"campaign_strategy", "growth_plan", "campaign"},
    "abacus": {"performance_report", "roi_analysis", "financial_analysis"},
}


@dataclass(slots=True)
class VLLMProvider:
    base_url: str = "http://127.0.0.1:8000"
    model: str = "Qwen/Qwen3-72B-Instruct"
    timeout_seconds: float = 60.0
    api_key: str = "EMPTY"
    _is_available: bool = True

    def __post_init__(self) -> None:
        self.base_url = str(os.getenv("VLLM_BASE_URL", self.base_url)).strip() or self.base_url
        self.model = str(os.getenv("VLLM_MODEL", self.model)).strip() or self.model
        self.api_key = str(os.getenv("VLLM_API_KEY", self.api_key)).strip() or self.api_key

    async def chat_complete(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        async with httpx.AsyncClient(timeout=self.timeout_seconds, follow_redirects=True) as client:
            response = await client.post(
                f"{self.base_url.rstrip('/')}/v1/chat/completions",
                headers=headers,
                json={
                    "model": str(model or self.model),
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": False,
                },
            )
            response.raise_for_status()
            return response.json()

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                resp = await client.get(f"{self.base_url.rstrip('/')}/health")
            self._is_available = resp.status_code == 200
        except Exception:
            self._is_available = False
        return self._is_available

    @property
    def is_available(self) -> bool:
        return self._is_available


class HybridLLMRouter:
    def __init__(self, vllm: VLLMProvider | None = None) -> None:
        self.vllm = vllm or VLLMProvider()
        self._total_seats = 0

    async def refresh_total_seats(self) -> int:
        try:
            from seat_subscription_service import get_seat_billing_service

            subscriptions = await get_seat_billing_service().list_subscriptions()
            self._total_seats = sum(
                int(item.get("seat_count") or 0)
                for item in subscriptions
                if str(item.get("status") or "").lower() in {"active", "trial", "trialing"}
            )
        except Exception:
            pass
        return self._total_seats

    def should_use_vllm(
        self,
        lobster_name: str,
        task_type: str,
        quality_required: str = "standard",
        *,
        total_seats: int | None = None,
    ) -> bool:
        effective_total = int(total_seats if total_seats is not None else self._total_seats)
        if effective_total < 1000:
            return False
        lobster = str(lobster_name or "").strip().lower()
        task = str(task_type or "").strip().lower()
        if lobster in CLAUDE_ONLY_TASKS and (not task or task in CLAUDE_ONLY_TASKS[lobster]):
            return False
        if not self.vllm.is_available:
            return False
        if str(quality_required or "standard").strip().lower() == "premium":
            return False
        allowed_tasks = VLLM_TASK_TYPES.get(lobster, set())
        return bool(allowed_tasks) and (task in allowed_tasks or task == lobster or not task)

    async def pick_target(
        self,
        *,
        lobster_name: str,
        task_type: str,
        quality_required: str = "standard",
    ) -> dict[str, Any] | None:
        total_seats = await self.refresh_total_seats()
        await self.vllm.health_check()
        if not self.should_use_vllm(lobster_name, task_type, quality_required, total_seats=total_seats):
            return None
        return {
            "provider_name": "vllm_self_hosted",
            "route": "local",
            "base_url": self.vllm.base_url.rstrip("/") + "/v1",
            "model": self.vllm.model,
            "api_key": self.vllm.api_key,
            "total_seats": total_seats,
        }

    @staticmethod
    def estimate_vllm_cost(response: dict[str, Any]) -> float:
        tokens = int(response.get("usage", {}).get("total_tokens", 0) or 0)
        cost_per_token = 36_000 / 500_000_000
        return round(tokens * cost_per_token, 6)


def vllm_roi_analysis(seat_count: int) -> dict[str, Any]:
    normalized = max(0, int(seat_count or 0))
    claude_cost_per_seat = 41
    claude_monthly = claude_cost_per_seat * normalized
    vllm_fixed_monthly = 28_000 + 8_000
    vllm_per_seat = (vllm_fixed_monthly / normalized) if normalized else 0.0
    monthly_savings = claude_monthly - vllm_fixed_monthly
    breakeven = vllm_fixed_monthly / claude_cost_per_seat if claude_cost_per_seat else 0.0
    recommendation = "继续使用 Claude API"
    if normalized >= 1000:
        recommendation = "强烈建议启动 vLLM 迁移"
    elif normalized >= 500:
        recommendation = "开始评估 vLLM"
    return {
        "seat_count": normalized,
        "claude_api_monthly": claude_monthly,
        "vllm_monthly_fixed": vllm_fixed_monthly,
        "vllm_per_seat": round(vllm_per_seat),
        "monthly_savings": monthly_savings,
        "annual_savings": monthly_savings * 12,
        "breakeven_seats": round(breakeven),
        "recommendation": recommendation,
    }


_router: HybridLLMRouter | None = None


def get_hybrid_llm_router() -> HybridLLMRouter:
    global _router
    if _router is None:
        _router = HybridLLMRouter()
    return _router
