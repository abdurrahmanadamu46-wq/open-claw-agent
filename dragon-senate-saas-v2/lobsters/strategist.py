"""
Strategist 🦐 脑虫虾 — 目标拆解、策略路由、优先级与证据融合

Primary Artifact: StrategyRoute
Upstream: Radar
Downstream: InkWriter, Visualizer, Dispatcher

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from lobsters.base_lobster import BaseLobster
from smart_routing import ModelTier
from lobsters.shared import (
    STORYBOARD_OPTIONS,
    agent_log as _agent_log,
    extract_industry_kb_reference as _extract_industry_kb_reference,
    extract_rag_reference as _extract_rag_reference,
    invoke_clawhub_skill as _invoke_clawhub_skill,
    safe_json_parse as _safe_json_parse,
)

_instance: StrategistLobster | None = None
_daily_rag_scan_cache: dict[str, dict[str, Any]] = {}


class StrategistLobster(BaseLobster):
    role_id = "strategist"
    DEFAULT_TIER = ModelTier.PRO


def _get() -> StrategistLobster:
    global _instance
    if _instance is None:
        _instance = StrategistLobster()
    return _instance


async def strategist(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full strategist implementation.

    Combines radar signals, vector/formula references, multimodal RAG answers,
    memory coverage, and policy bandit hints into a strategy package.
    """
    from llm_router import RouteMeta, llm_router
    from lossless_memory import append_event as append_lossless_event
    from multimodal_rag_adapter import query_raganything_hybrid
    from policy_bandit import recommend_policy
    from qdrant_config import fetch_recent_formula_documents, search_formula_documents
    from senate_kernel import build_memory_context as kernel_build_memory_context
    from senate_kernel import compute_source_credibility as kernel_compute_source_credibility
    from senate_kernel import estimate_strategy_confidence as kernel_estimate_strategy_confidence

    hot_topics = state.get("hot_topics", [])
    task = state.get("task_description", "")
    user_id = str(state.get("user_id") or "shared")
    tenant_id = str(state.get("tenant_id") or f"tenant_{user_id}")
    industry_tag = str(state.get("industry_tag") or "general").strip().lower() or "general"
    radar_data = state.get("radar_data", {})
    source_credibility = state.get("source_credibility", {}) or kernel_compute_source_credibility(radar_data)
    memory_context = state.get("memory_context", {})
    if not isinstance(memory_context, dict) or "coverage" not in memory_context:
        memory_context = kernel_build_memory_context(
            tenant_id=tenant_id,
            user_id=user_id,
            task_description=task,
            hot_topics=[str(x) for x in hot_topics[:4]],
        )

    await _invoke_clawhub_skill("strategist", "ontology", {"hot_topics": hot_topics, "task": task})

    utc_day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    user_digest = _daily_rag_scan_cache.get(user_id, {"scan_day": "", "digest": []})
    if user_digest.get("scan_day") != utc_day:
        recent_docs = fetch_recent_formula_documents(limit=12, since_hours=24, user_id=user_id)
        digest = [_extract_rag_reference(doc) for doc in recent_docs[:6]]
        _daily_rag_scan_cache[user_id] = {"scan_day": utc_day, "digest": digest}
        await _invoke_clawhub_skill(
            "strategist",
            "proactive-agent",
            {"scan_day": utc_day, "new_formula_count": len(recent_docs), "user_id": user_id},
        )
    else:
        digest = user_digest.get("digest", [])

    query_text = " ".join([task] + hot_topics).strip() or "generic conversion script"
    similar_docs = search_formula_documents(query_text, k=4, user_id=user_id)
    vector_refs = [_extract_rag_reference(doc) for doc in similar_docs]
    industry_kb_context = state.get("industry_kb_context", [])
    industry_refs = [
        _extract_industry_kb_reference(item)
        for item in industry_kb_context
        if isinstance(item, dict)
    ][:6]
    graph_runtime = await query_raganything_hybrid(query_text, top_k=4, user_id=user_id)
    graph_refs = graph_runtime.get("graph_refs", []) if graph_runtime.get("enabled") else []
    rag_runtime_fail_closed = bool(graph_runtime.get("fail_closed", False))
    if rag_runtime_fail_closed:
        graph_refs = []
    rag_refs = (industry_refs + vector_refs + graph_refs)[:10]
    source_overall = float(source_credibility.get("overall", 0.5) or 0.5)
    source_gate_applied = source_overall < 0.6
    if source_gate_applied:
        rag_refs = rag_refs[:1]

    preferred_storyboard = next(
        (int(ref.get("storyboard_count")) for ref in rag_refs if ref.get("storyboard_count")),
        7,
    )
    preferred_storyboard = preferred_storyboard if preferred_storyboard in STORYBOARD_OPTIONS else 7
    bandit_policy = recommend_policy(user_id)
    if bool(bandit_policy.get("enabled", True)):
        suggested_storyboard = int(
            bandit_policy.get("storyboard_count", preferred_storyboard) or preferred_storyboard
        )
        if suggested_storyboard in STORYBOARD_OPTIONS:
            if preferred_storyboard == suggested_storyboard:
                preferred_storyboard = suggested_storyboard
            else:
                preferred_storyboard = suggested_storyboard if len(rag_refs) <= 1 else preferred_storyboard

    llm_strategy: dict[str, Any] = {}
    llm_route = "rule_only"
    llm_error: str | None = None
    trace_id = str(state.get("trace_id") or "")
    try:
        llm_raw = await llm_router.routed_ainvoke_text(
            system_prompt=(
                "You are the strategist agent in a multi-agent marketing OS. "
                "Return strict JSON only with keys: strategy_summary (string), "
                "primary_topics (array of strings), publish_window (string), "
                "cta (string), tone (string), preferred_storyboard_count (number)."
            ),
            user_prompt=json.dumps(
                {
                    "task": task,
                    "hot_topics": hot_topics,
                    "rag_references": rag_refs,
                    "daily_digest": digest,
                },
                ensure_ascii=False,
            ),
            meta=RouteMeta(
                critical=True,
                est_tokens=1800,
                tenant_tier="basic",
                user_id=user_id,
                tenant_id=str(state.get("tenant_id") or "tenant_main"),
                task_type="strategy_planning",
            ),
            temperature=0.2,
            force_tier=ModelTier.PRO,
        )
        parsed = _safe_json_parse(llm_raw)
        if isinstance(parsed, dict):
            llm_strategy = parsed
            llm_route = "llm_routed"
    except Exception as exc:  # noqa: BLE001
        llm_error = str(exc)

    strategy = {
        "persona": "conversion_operator",
        "campaign_type": "short_video_plus_dm_conversion",
        "goal": "increase qualified DM leads",
        "primary_topics": hot_topics[:3],
        "preferred_storyboard_count": preferred_storyboard,
        "rag_references": rag_refs,
        "rag_vector_reference_count": len(vector_refs),
        "rag_graph_reference_count": len(graph_refs),
        "rag_graph_answer": graph_runtime.get("answer", ""),
        "rag_runtime_mode": graph_runtime.get("mode", "fallback_disabled"),
        "rag_runtime_used_query_mode": graph_runtime.get("used_query_mode"),
        "rag_runtime_query_mode_chain": graph_runtime.get("query_mode_chain", []),
        "rag_runtime_fail_closed": rag_runtime_fail_closed,
        "rag_runtime_error": graph_runtime.get("error"),
        "daily_rag_digest": digest,
        "llm_route": llm_route,
        "policy_bandit_mode": bandit_policy.get("mode"),
        "policy_bandit_tone": bandit_policy.get("tone"),
        "source_gate_applied": source_gate_applied,
        "source_credibility_overall": round(source_overall, 4),
        "memory_coverage": float(memory_context.get("coverage", 0.0) or 0.0),
        "industry_tag": industry_tag,
        "industry_kb_reference_count": len(industry_refs),
    }
    if llm_strategy:
        if isinstance(llm_strategy.get("primary_topics"), list):
            strategy["primary_topics"] = [
                str(x) for x in llm_strategy.get("primary_topics", [])
            ][:3] or strategy["primary_topics"]
        storyboard_candidate = llm_strategy.get("preferred_storyboard_count")
        if isinstance(storyboard_candidate, int) and storyboard_candidate in STORYBOARD_OPTIONS:
            strategy["preferred_storyboard_count"] = storyboard_candidate
        strategy["strategy_summary"] = str(llm_strategy.get("strategy_summary", "")).strip()[:800]
        strategy["publish_window"] = str(
            llm_strategy.get("publish_window", "19:00-22:00 Asia/Shanghai")
        ).strip()
        strategy["cta"] = str(llm_strategy.get("cta", "DM for details")).strip()
        strategy["tone"] = str(llm_strategy.get("tone", "friendly_trustworthy")).strip()
    elif bandit_policy.get("tone"):
        strategy["tone"] = str(bandit_policy.get("tone"))
    if llm_error:
        strategy["llm_error"] = llm_error[:300]

    confidence_interval = kernel_estimate_strategy_confidence(
        rag_reference_count=len(rag_refs),
        rag_graph_reference_count=len(graph_refs),
        llm_route=llm_route,
        llm_error=llm_error,
        source_overall=source_overall,
        memory_coverage=float(memory_context.get("coverage", 0.0) or 0.0),
    )
    strategy["confidence_interval"] = confidence_interval
    strategy["memory_context"] = {
        "coverage": memory_context.get("coverage", 0.0),
        "episode_count": memory_context.get("episode_count", 0),
        "policy_count": memory_context.get("policy_count", 0),
        "tenant_memory_count": memory_context.get("tenant_memory_count", 0),
    }

    await _invoke_clawhub_skill(
        "strategist",
        "self-improving-agent",
        {
            "task": task,
            "rag_reference_count": len(rag_refs),
            "daily_digest_count": len(digest),
        },
    )
    try:
        append_lossless_event(
            user_id=user_id,
            trace_id=trace_id or None,
            node="strategist",
            event_type="strategy_generated",
            payload={
                "rag_reference_count": len(rag_refs),
                "industry_kb_reference_count": len(industry_refs),
                "llm_route": llm_route,
                "rag_runtime_mode": graph_runtime.get("mode", "fallback_disabled"),
                "llm_error": llm_error,
                "confidence_interval": confidence_interval,
                "memory_coverage": memory_context.get("coverage", 0.0),
                "source_credibility_overall": source_overall,
            },
            level="error" if bool(llm_error) else "info",
        )
    except Exception:  # noqa: BLE001
        pass

    return {
        "strategy": strategy,
        "source_credibility": source_credibility,
        "memory_context": memory_context,
        "strategy_confidence": confidence_interval,
        "policy_bandit": bandit_policy,
        "rag_recent_digest": digest,
        "call_log": _agent_log(
            "strategist",
            "Strategy completed with RAG references",
            {
                "rag_reference_count": len(rag_refs),
                "industry_kb_reference_count": len(industry_refs),
                "rag_vector_reference_count": len(vector_refs),
                "rag_graph_reference_count": len(graph_refs),
                "user_id": user_id,
                "rag_runtime_mode": graph_runtime.get("mode", "fallback_disabled"),
                "rag_runtime_used_query_mode": graph_runtime.get("used_query_mode"),
                "rag_runtime_fail_closed": rag_runtime_fail_closed,
                "preferred_storyboard_count": preferred_storyboard,
                "confidence_low": confidence_interval.get("low"),
                "confidence_high": confidence_interval.get("high"),
                "source_gate_applied": source_gate_applied,
            },
        ),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
