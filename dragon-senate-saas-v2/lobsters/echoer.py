"""
Echoer 🦐 回声虾 — 真人感回复、情绪承接、互动转化

Primary Artifact: EngagementReplyPack
Upstream: Dispatcher
Downstream: Catcher, Abacus

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

import json
from typing import Any

from lobsters.base_lobster import BaseLobster
from smart_routing import ModelTier
from lobsters.shared import agent_log, invoke_clawhub_skill, safe_json_parse
from prompt_asset_loader import get_prompt_loader

_instance: EchoerLobster | None = None


class EchoerLobster(BaseLobster):
    role_id = "echoer"
    DEFAULT_TIER = ModelTier.STANDARD


def _get() -> EchoerLobster:
    global _instance
    if _instance is None:
        _instance = EchoerLobster()
    return _instance


async def _enrich_context_with_trends(platform: str, topic: str) -> str:
    """用 Agent Reach 搜索当前热点，丰富回复上下文。"""
    from tools.agent_reach import agent_reach_tool

    if not agent_reach_tool.enabled:
        return ""

    results = await agent_reach_tool.search(platform, topic, count=3, sort_by="hot", time_range="24h")
    if not results:
        return ""

    trends_summary = "\n".join(
        [
            f"- {result.title}: {result.content[:100]}（{result.likes}赞/{result.comments}评）"
            for result in results[:3]
        ]
    )
    return f"\n\n[当前{platform}热点参考]\n{trends_summary}"


async def echoer(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full echoer implementation.

    Generates human-feel engagement replies using LLM,
    with rule-based fallback if LLM fails.
    """
    from llm_router import RouteMeta, llm_router

    await invoke_clawhub_skill("echoer", "humanizer", {"mode": "engagement_seed"})

    replies = [
        "This method worked for us, start with a small test batch.",
        "Happy to share details in DM if you need pricing breakdown.",
    ]

    llm_error: str | None = None
    try:
        platform = str(
            state.get("platform")
            or state.get("channel")
            or ((state.get("radar_data") or {}).get("platforms") or ["xiaohongshu"])[0]
        ).strip().lower() or "xiaohongshu"
        industry = str(
            state.get("industry_tag")
            or state.get("industry")
            or (state.get("industry_context") or {}).get("industry")
            or "beauty"
        ).strip() or "beauty"
        topic = str((state.get("hot_topics") or [state.get("task_description", "")])[0] or state.get("task_description", "")).strip()
        trend_context = await _enrich_context_with_trends(platform, topic) if topic else ""
        task_text = " ".join(
            [
                str(state.get("task_description", "")),
                str(state.get("user_message", "")),
                str(state.get("comment", "")),
            ]
        ).lower()
        if any(token in task_text for token in ["投诉", "不满", "退款", "差评", "angry", "complaint"]):
            prompt_id = "echoer.negative-comment.empathy-defuse.v1"
        elif platform in {"dm", "private_message", "private"} or state.get("dm_context"):
            prompt_id = "echoer.dm-conversation.need-discovery.v1"
        else:
            prompt_id = "echoer.positive-comment.gratitude-reply.v1"
        prompt = get_prompt_loader().get_prompt(prompt_id) or get_prompt_loader().get_best_for(
            "echoer_reply_generate",
            industry,
        )
        rendered_prompt = (
            prompt.fill(
                user_message=state.get("user_message") or state.get("comment") or state.get("task_description", ""),
                platform=platform,
                tone=state.get("strategy", {}).get("tone", "friendly_trustworthy"),
                goal=state.get("reply_goal", "continue_conversation"),
                trend_context=trend_context,
                industry=industry,
            )
            if prompt
            else ""
        )
        llm_raw = await llm_router.routed_ainvoke_text(
            system_prompt=(
                "You are Echoer agent for social engagement. "
                "Return strict JSON array of 2 short replies, each <= 24 words."
            ),
            user_prompt="\n\n".join(
                part
                for part in [
                    rendered_prompt.strip(),
                    json.dumps(
                        {
                            "task": state.get("task_description", ""),
                            "topics": state.get("hot_topics", []),
                            "tone": state.get("strategy", {}).get("tone", "friendly_trustworthy"),
                            "trend_context": trend_context,
                        },
                        ensure_ascii=False,
                    ),
                ]
                if part
            ),
            meta=RouteMeta(
                critical=False,
                est_tokens=800,
                tenant_tier="basic",
                user_id=str(state.get("user_id") or "shared"),
                tenant_id=str(state.get("tenant_id") or "tenant_main"),
                task_type="engagement_copy",
            ),
            temperature=0.7,
            force_tier=ModelTier.STANDARD,
        )
        parsed = safe_json_parse(llm_raw)
        if isinstance(parsed, list):
            refined = [str(item).strip() for item in parsed if str(item).strip()]
            if refined:
                replies = refined[:3]
    except Exception as exc:  # noqa: BLE001
        llm_error = str(exc)

    return {
        "echoer_output": {
            "seed_replies": replies,
            "llm_error": llm_error[:280] if llm_error else None,
        },
        "call_log": agent_log("echoer", "Engagement prompts prepared", {"count": len(replies)}),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
