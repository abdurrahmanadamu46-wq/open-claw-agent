"""
Abacus 🦐 金算虾 — 评分、ROI、归因、反馈回写

Primary Artifact: ValueScoreCard
Upstream: Catcher
Downstream: FollowUp / Feedback

借鉴 CLAWTEAM 多龙虾协作体系 + LobsterRunner 统一执行引擎模式。
从 catcher_output 线索中做 LLM 驱动的 ROI 评分与归因，输出 ValueScoreCard。
"""

from __future__ import annotations

import json
from typing import Any

from lobsters.base_lobster import BaseLobster
from smart_routing import ModelTier
from lobsters.shared import agent_log, invoke_clawhub_skill, safe_json_parse
from prompt_asset_loader import get_prompt_loader

_instance: AbacusLobster | None = None


class AbacusLobster(BaseLobster):
    role_id = "abacus"
    DEFAULT_TIER = ModelTier.STANDARD


def _get() -> AbacusLobster:
    global _instance
    if _instance is None:
        _instance = AbacusLobster()
    return _instance


def _extract_campaign_context(state: dict[str, Any]) -> dict[str, Any]:
    """从 state 中提取活动/投放上下文，用于 ROI 归因。"""
    return {
        "campaign_id": state.get("campaign_id") or state.get("task_id") or "",
        "budget": state.get("budget") or state.get("campaign_budget") or 0,
        "platform": state.get("platform") or state.get("channel") or "unknown",
        "content_type": state.get("content_type") or state.get("post_type") or "post",
        "industry": str(
            state.get("industry_tag")
            or state.get("industry")
            or (state.get("industry_context") or {}).get("industry")
            or "general"
        ).strip() or "general",
        "task_description": str(state.get("task_description") or "")[:200],
    }


def _rule_score_lead(lead: dict[str, Any]) -> dict[str, Any]:
    """规则兜底：基于 intent + risk + budget_signal 计算评分。"""
    intent = str(lead.get("intent") or "cold").lower()
    risk = str(lead.get("risk") or "low").lower()
    budget_signal = bool(lead.get("budget_signal"))
    contact_intent = bool(lead.get("contact_intent"))

    base = {"hot": 0.90, "warm": 0.65, "cold": 0.30}.get(intent, 0.30)
    risk_penalty = {"high": -0.20, "medium": -0.08, "low": 0.0}.get(risk, 0.0)
    budget_bonus = 0.06 if budget_signal else 0.0
    contact_bonus = 0.04 if contact_intent else 0.0

    score = max(0.0, min(1.0, base + risk_penalty + budget_bonus + contact_bonus))
    grade = "A" if score >= 0.80 else ("B" if score >= 0.55 else "C")
    roi_estimate = round(score * 3.5, 2)  # 简单线性估算倍数

    return {
        **lead,
        "score": round(score, 4),
        "grade": grade,
        "roi_estimate": roi_estimate,
        "attribution": "rule_based",
    }


async def abacus(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — 金算虾完整实现。

    用 LLM 对 catcher_output 线索做 ROI 评分与归因：
    - 输出 ValueScoreCard（scored_leads, avg_score, roi_summary, conversion_funnel）
    - 结构化 JSON 输出，兜底到规则评分
    """
    from llm_router import RouteMeta, llm_router

    await invoke_clawhub_skill("abacus", "api-gateway", {"source": "lead_scoring"})
    await invoke_clawhub_skill("abacus", "roi-attribution", {"mode": "llm_enhanced"})

    # 优先从 catcher_output 取，兜底到 state.leads
    catcher_output = state.get("catcher_output") or {}
    leads: list[dict[str, Any]] = (
        catcher_output.get("captured_leads")
        or state.get("leads")
        or []
    )
    campaign_ctx = _extract_campaign_context(state)
    industry = campaign_ctx["industry"]

    # 规则兜底评分
    fallback_scored = [_rule_score_lead(ld) for ld in leads]

    llm_error: str | None = None
    scored = fallback_scored

    if leads:
        try:
            prompt = get_prompt_loader().get_best_for("abacus_roi_score", industry)
            rendered = (
                prompt.fill(
                    leads=json.dumps(leads, ensure_ascii=False),
                    industry=industry,
                    campaign=json.dumps(campaign_ctx, ensure_ascii=False),
                )
                if prompt
                else ""
            )

            leads_block = json.dumps(leads, ensure_ascii=False, indent=2)
            campaign_block = json.dumps(campaign_ctx, ensure_ascii=False, indent=2)
            user_prompt = "\n\n".join(filter(None, [
                rendered.strip(),
                f"行业：{industry}",
                f"活动上下文：\n{campaign_block}",
                f"线索列表（共{len(leads)}条）：\n{leads_block}",
            ]))

            llm_raw = await llm_router.routed_ainvoke_text(
                system_prompt=(
                    "你是金算虾（Abacus），专职线索价值评分与 ROI 归因。\n"
                    "对每条线索计算：\n"
                    "  - score: 0.0-1.0（综合商业价值，考虑意向、风险、预算信号）\n"
                    "  - grade: A（>=0.80）/ B（0.55-0.79）/ C（<0.55）\n"
                    "  - roi_estimate: 预期 ROI 倍数（浮点数，如 2.5 表示 250%）\n"
                    "  - attribution: 归因来源（organic/paid/referral/dm/unknown）\n"
                    "  - action_priority: high/medium/low（建议跟进优先级）\n"
                    "  - reason: 评分理由（1句话）\n"
                    "严格返回 JSON 数组，每项包含所有字段，保留原始 lead_id/intent/risk/channel。\n"
                    "不要解释，只返回 JSON。"
                ),
                user_prompt=user_prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=1400,
                    tenant_tier="basic",
                    user_id=str(state.get("user_id") or "shared"),
                    tenant_id=str(state.get("tenant_id") or "tenant_main"),
                    task_type="roi_scoring",
                ),
                temperature=0.15,
                force_tier=ModelTier.STANDARD,
            )

            parsed = safe_json_parse(llm_raw)
            if isinstance(parsed, list) and parsed:
                enriched: list[dict[str, Any]] = []
                for i, item in enumerate(parsed):
                    if not isinstance(item, dict):
                        continue
                    if not item.get("lead_id"):
                        item["lead_id"] = leads[i]["lead_id"] if i < len(leads) else f"lead_{i}"
                    enriched.append(item)
                if enriched:
                    scored = enriched

        except Exception as exc:  # noqa: BLE001
            llm_error = str(exc)

    avg_score = sum(float(ld.get("score") or 0) for ld in scored) / len(scored) if scored else 0.0
    grade_a = sum(1 for ld in scored if ld.get("grade") == "A")
    grade_b = sum(1 for ld in scored if ld.get("grade") == "B")
    grade_c = sum(1 for ld in scored if ld.get("grade") == "C")
    avg_roi = (
        sum(float(ld.get("roi_estimate") or 0) for ld in scored) / len(scored)
        if scored else 0.0
    )
    high_priority = sum(1 for ld in scored if ld.get("action_priority") == "high")

    return {
        "abacus_output": {
            "scored_leads": scored,
            "avg_score": round(avg_score, 4),
            "avg_roi_estimate": round(avg_roi, 2),
            "grade_distribution": {"A": grade_a, "B": grade_b, "C": grade_c},
            "high_priority_count": high_priority,
            "total": len(scored),
            "industry": industry,
            "llm_error": llm_error[:280] if llm_error else None,
        },
        "leads": scored,
        "score": round(avg_score, 4),
        "call_log": agent_log(
            "abacus",
            "Lead ROI scoring completed",
            {"total": len(scored), "avg_score": round(avg_score, 4), "grade_A": grade_a},
        ),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
