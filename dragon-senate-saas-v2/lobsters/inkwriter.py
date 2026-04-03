"""
InkWriter 🦐 吐墨虾 — 成交导向文案、行业口吻、结构稳定性

Primary Artifact: CopyPack
Upstream: Strategist
Downstream: Visualizer, Dispatcher

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

import json
from typing import Any

from lobsters.base_lobster import BaseLobster
from smart_routing import ModelTier
from lobsters.shared import (
    STORYBOARD_OPTIONS,
    agent_log,
    invoke_clawhub_skill,
    safe_json_parse,
)
from prompt_asset_loader import get_prompt_loader

_instance: InkWriterLobster | None = None


class InkWriterLobster(BaseLobster):
    role_id = "inkwriter"
    DEFAULT_TIER = ModelTier.STANDARD


def _get() -> InkWriterLobster:
    global _instance
    if _instance is None:
        _instance = InkWriterLobster()
    return _instance


async def inkwriter(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full inkwriter implementation.

    Generates video script scenes using LLM with RAG formula references,
    with rule-based template fallback if LLM fails.
    """
    from llm_router import RouteMeta, llm_router

    strategy = state.get("strategy", {})
    topics = strategy.get("primary_topics", [])
    storyboard_count = int(strategy.get("preferred_storyboard_count", 7) or 7)
    storyboard_count = storyboard_count if storyboard_count in STORYBOARD_OPTIONS else 7
    rag_refs = strategy.get("rag_references", [])
    top_ref = rag_refs[0] if rag_refs else {}

    await invoke_clawhub_skill(
        "inkwriter",
        "humanizer",
        {
            "topics": topics,
            "storyboard_count": storyboard_count,
            "top_category": top_ref.get("category"),
        },
    )
    await invoke_clawhub_skill("inkwriter", "summarize", {"rag_reference_count": len(rag_refs)})

    # Rule-based fallback scripts
    scripts = [
        {
            "scene": idx + 1,
            "copy": f"Scene {idx + 1}: {topics[idx % len(topics)] if topics else 'core_offer'} story beat",
            "hook": top_ref.get("category", "generic"),
        }
        for idx in range(storyboard_count)
    ]

    llm_script_error: str | None = None
    try:
        platform = str(state.get("platform") or state.get("channel") or "xiaohongshu").strip().lower() or "xiaohongshu"
        industry = str(
            state.get("industry_tag")
            or state.get("industry")
            or (state.get("industry_context") or {}).get("industry")
            or "beauty"
        ).strip() or "beauty"
        prompt_id = {
            "douyin": "inkwriter.douyin.short-script.v1",
            "wechat": "inkwriter.wechat.moments.soft-sell.v1",
            "xiaohongshu": "inkwriter.xiaohongshu.product-review.v1",
        }.get(platform, "inkwriter.generic.pain-point-mining.v1")
        prompt = get_prompt_loader().get_prompt(prompt_id) or get_prompt_loader().get_best_for(
            "inkwriter_copy_generate",
            industry,
        )
        rendered_prompt = (
            prompt.fill(
                task_description=state.get("task_description", ""),
                platform=platform,
                industry=industry,
                tone=state.get("strategy", {}).get("tone", "trustworthy"),
                offer=state.get("strategy", {}).get("core_offer", "核心方案"),
                audience=state.get("strategy", {}).get("target_audience", "目标客群"),
            )
            if prompt
            else ""
        )
        llm_raw = await llm_router.routed_ainvoke_text(
            system_prompt=(
                "You are InkWriter agent. Follow the user prompt exactly and return strict JSON array only. "
                "Each item must include scene(number), copy(string), hook(string)."
            ),
            user_prompt="\n\n".join(
                part
                for part in [
                    rendered_prompt.strip(),
                    json.dumps(
                        {
                            "storyboard_count": storyboard_count,
                            "topics": topics,
                            "rag_reference": top_ref,
                            "task_description": state.get("task_description", ""),
                        },
                        ensure_ascii=False,
                    ),
                    "Runtime output contract: return strict JSON array only; each item must include scene, copy, hook.",
                ]
                if part
            ),
            meta=RouteMeta(
                critical=False,
                est_tokens=2200,
                tenant_tier="basic",
                user_id=str(state.get("user_id") or "shared"),
                tenant_id=str(state.get("tenant_id") or "tenant_main"),
                task_type="content_generation",
            ),
            temperature=0.55,
            force_tier=ModelTier.STANDARD,
        )
        parsed = safe_json_parse(llm_raw)
        if isinstance(parsed, list):
            llm_scenes: list[dict[str, Any]] = []
            for idx, item in enumerate(parsed[:storyboard_count]):
                if not isinstance(item, dict):
                    continue
                llm_scenes.append(
                    {
                        "scene": int(item.get("scene", idx + 1)),
                        "copy": str(item.get("copy", "")).strip() or scripts[idx]["copy"],
                        "hook": str(item.get("hook", top_ref.get("category", "generic"))).strip(),
                    }
                )
            if llm_scenes:
                scripts = llm_scenes
    except Exception as exc:  # noqa: BLE001
        llm_script_error = str(exc)

    return {
        "inkwriter_output": {
            "format": "video_script_json",
            "template": "strict_template_map",
            "storyboard_count": storyboard_count,
            "scenes": scripts,
            "rag_formula_reference": top_ref,
            "llm_error": llm_script_error[:280] if llm_script_error else None,
        },
        "call_log": agent_log(
            "inkwriter",
            "Script package generated",
            {"scene_count": storyboard_count, "rag_reference_used": bool(top_ref)},
        ),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
