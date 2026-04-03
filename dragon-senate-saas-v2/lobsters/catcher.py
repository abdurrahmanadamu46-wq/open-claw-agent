"""
Catcher 🦐 铁网虾 — 高意向识别、风险过滤、预算判断

Primary Artifact: LeadAssessment
Upstream: Echoer, Dispatcher
Downstream: Abacus

借鉴 CLAWTEAM 多龙虾协作体系 + LobsterRunner 统一执行引擎模式。
从 echoer_output / 评论/私信数据中识别高意向信号，LLM 结构化输出 LeadAssessment。
"""

from __future__ import annotations

import json
from typing import Any

from lobsters.base_lobster import BaseLobster
from smart_routing import ModelTier
from lobsters.shared import agent_log, invoke_clawhub_skill, safe_json_parse
from prompt_asset_loader import get_prompt_loader

_instance: CatcherLobster | None = None


class CatcherLobster(BaseLobster):
    role_id = "catcher"
    DEFAULT_TIER = ModelTier.STANDARD


def _get() -> CatcherLobster:
    global _instance
    if _instance is None:
        _instance = CatcherLobster()
    return _instance


def _extract_raw_signals(state: dict[str, Any]) -> list[dict[str, Any]]:
    """从 state 中汇总所有待判断的原始信号（评论、私信、互动回复）。"""
    signals: list[dict[str, Any]] = []

    # 来自 echoer 的互动回复
    echoer_output = state.get("echoer_output") or {}
    for reply in echoer_output.get("seed_replies", []):
        if isinstance(reply, str) and reply.strip():
            signals.append({"source": "echoer_reply", "text": reply, "channel": "comment"})

    # 来自 state 直接携带的评论/私信列表
    for item in state.get("comments", []) or []:
        if isinstance(item, dict):
            signals.append({
                "source": "comment",
                "text": str(item.get("text") or item.get("content") or ""),
                "channel": item.get("channel", "comment"),
                "author": item.get("author", ""),
            })
        elif isinstance(item, str):
            signals.append({"source": "comment", "text": item, "channel": "comment"})

    # 来自 dm_text（DM 入口的私信）
    dm_text = state.get("dm_text") or ""
    if dm_text:
        signals.append({"source": "dm", "text": str(dm_text), "channel": "dm"})

    # 兜底：task_description 也作为信号
    if not signals:
        task = str(state.get("task_description") or "")
        if task:
            signals.append({"source": "task_description", "text": task, "channel": "unknown"})

    return signals[:20]  # 最多处理20条，防止 token 爆炸


async def catcher(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — 铁网虾完整实现。

    用 LLM 对评论/私信/互动信号做意向识别：
    - 输出 LeadAssessment（意向等级 hot/warm/cold + 风险标记 + 预算信号）
    - 结构化 JSON 输出，兜底到规则评分
    """
    from llm_router import RouteMeta, llm_router

    await invoke_clawhub_skill("catcher", "summarize", {"source": "campaign_signals"})
    await invoke_clawhub_skill("catcher", "ontology", {"extract": ["price", "buy", "contact", "urgent"]})

    raw_signals = _extract_raw_signals(state)
    industry = str(
        state.get("industry_tag")
        or state.get("industry")
        or (state.get("industry_context") or {}).get("industry")
        or "general"
    ).strip() or "general"

    # 规则兜底 leads（LLM 失败时使用）
    fallback_leads = [
        {
            "lead_id": f"lead_{i}",
            "text": sig["text"][:120],
            "channel": sig["channel"],
            "intent": "warm",
            "risk": "low",
            "budget_signal": False,
        }
        for i, sig in enumerate(raw_signals)
    ]

    llm_error: str | None = None
    leads = fallback_leads

    if raw_signals:
        try:
            prompt = get_prompt_loader().get_best_for("catcher_lead_assess", industry)
            rendered = (
                prompt.fill(
                    signals=json.dumps(raw_signals, ensure_ascii=False),
                    industry=industry,
                    task=state.get("task_description", ""),
                )
                if prompt
                else ""
            )

            signals_block = json.dumps(raw_signals, ensure_ascii=False, indent=2)
            user_prompt = "\n\n".join(filter(None, [
                rendered.strip(),
                f"行业：{industry}",
                f"原始信号列表（共{len(raw_signals)}条）：\n{signals_block}",
            ]))

            llm_raw = await llm_router.routed_ainvoke_text(
                system_prompt=(
                    "你是铁网虾（Catcher），专职线索捕获与意向识别。\n"
                    "对每条信号判断：\n"
                    "  - intent: hot（明确购买意图）/ warm（有兴趣但未决策）/ cold（无意向）\n"
                    "  - risk: high（竞品/投诉/薅羊毛）/ medium / low\n"
                    "  - budget_signal: true/false（是否提到价格/预算）\n"
                    "  - contact_intent: true/false（是否想要联系方式）\n"
                    "严格返回 JSON 数组，每项包含字段：lead_id, text, channel, intent, risk, budget_signal, contact_intent, reason\n"
                    "不要解释，只返回 JSON。"
                ),
                user_prompt=user_prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=1200,
                    tenant_tier="basic",
                    user_id=str(state.get("user_id") or "shared"),
                    tenant_id=str(state.get("tenant_id") or "tenant_main"),
                    task_type="lead_classification",
                ),
                temperature=0.2,
                force_tier=ModelTier.STANDARD,
            )

            parsed = safe_json_parse(llm_raw)
            if isinstance(parsed, list) and parsed:
                enriched: list[dict[str, Any]] = []
                for i, item in enumerate(parsed):
                    if not isinstance(item, dict):
                        continue
                    # 补充 lead_id（如果 LLM 没输出）
                    if not item.get("lead_id"):
                        item["lead_id"] = f"lead_{i}"
                    enriched.append(item)
                if enriched:
                    leads = enriched

        except Exception as exc:  # noqa: BLE001
            llm_error = str(exc)

    hot_count = sum(1 for ld in leads if ld.get("intent") == "hot")
    warm_count = sum(1 for ld in leads if ld.get("intent") == "warm")

    return {
        "catcher_output": {
            "captured_leads": leads,
            "hot_count": hot_count,
            "warm_count": warm_count,
            "total": len(leads),
            "industry": industry,
            "llm_error": llm_error[:280] if llm_error else None,
        },
        "leads": leads,
        "call_log": agent_log(
            "catcher",
            "Lead assessment completed",
            {"total": len(leads), "hot": hot_count, "warm": warm_count},
        ),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
