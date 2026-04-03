"""
Visualizer 🦐 幻影虾 — 分镜结构、视觉生成与引擎回退

Primary Artifact: StoryboardPack
Upstream: InkWriter, Strategist
Downstream: Dispatcher

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

from typing import Any

from lobsters.base_lobster import BaseLobster
from lobsters.shared import (
    agent_log as _agent_log,
    invoke_clawhub_skill as _invoke_clawhub_skill,
)

_instance: VisualizerLobster | None = None


class VisualizerLobster(BaseLobster):
    role_id = "visualizer"


def _get() -> VisualizerLobster:
    global _instance
    if _instance is None:
        _instance = VisualizerLobster()
    return _instance


async def visualizer(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full visualizer implementation.

    Converts script scenes into prompts, chooses workflow templates, and
    attempts local ComfyUI render first with LibTV fallback.
    """
    from comfyui_adapter import generate_storyboard_video_local
    from comfyui_capability_matrix import (
        build_comfyui_generation_plan,
        inspect_comfyui_capabilities,
    )
    from industry_workflows import detect_industry, resolve_workflow
    from libtv_skill_adapter import generate_storyboard_video
    from policy_bandit import recommend_policy
    from workflow_template_registry import list_templates_by_industry, resolve_template

    scenes = state.get("inkwriter_output", {}).get("scenes", [])
    await _invoke_clawhub_skill("visualizer", "nano-banana-pro", {"scene_count": len(scenes)})
    raw_task_text = str(state.get("task_description", "")).strip()
    task_text = raw_task_text.lower()
    strategy_obj = state.get("strategy", {}) if isinstance(state.get("strategy"), dict) else {}
    industry_policy = (
        strategy_obj.get("industry_policy", {})
        if isinstance(strategy_obj.get("industry_policy"), dict)
        else {}
    )
    digital_human_tuning = (
        strategy_obj.get("digital_human_tuning", {})
        if isinstance(strategy_obj.get("digital_human_tuning"), dict)
        else {}
    )
    vlog_tuning = (
        strategy_obj.get("vlog_tuning", {})
        if isinstance(strategy_obj.get("vlog_tuning"), dict)
        else {}
    )
    customer_requirements = [
        str(item).strip()
        for item in industry_policy.get("customer_requirements", [])
        if str(item).strip()
    ]
    micro_tuning = (
        strategy_obj.get("customer_micro_tuning", {})
        if isinstance(strategy_obj.get("customer_micro_tuning"), dict)
        else {}
    )
    voice_profile = {
        "style": str(micro_tuning.get("tone", "neutral") or "neutral"),
        "pace": str(micro_tuning.get("pace", "medium") or "medium"),
    }
    digital_human_mode = any(
        token in task_text for token in ["口播", "数字人", "主播", "talking head", "avatar"]
    ) or bool(digital_human_tuning)
    vlog_mode = any(
        token in task_text for token in ["vlog", "旁白", "第一视角", "日常记录", "探店"]
    ) or bool(vlog_tuning)
    style_tokens: list[str] = []
    if digital_human_mode:
        style_tokens.append("digital human talking-head, strong lip-sync alignment, clean studio voiceover")
    if vlog_mode:
        style_tokens.append("first-person vlog narration, cinematic b-roll transitions, natural handheld rhythm")
    style_suffix = "; ".join(style_tokens) if style_tokens else "short-video marketing style"
    prompts = [
        {
            "scene": item.get("scene", idx + 1),
            "prompt": f"Commercial social scene {idx + 1}, realistic style, conversion CTA in frame, {style_suffix}",
        }
        for idx, item in enumerate(scenes)
    ]
    tenant_id = str(state.get("tenant_id") or f"tenant_{state.get('user_id') or 'shared'}")
    user_id = str(state.get("user_id") or "shared")
    industry = detect_industry(
        raw_task_text,
        [str(item) for item in state.get("hot_topics", []) if isinstance(item, str)],
    )
    capability_snapshot = inspect_comfyui_capabilities()
    generation_plan = build_comfyui_generation_plan(
        task_description=raw_task_text,
        industry=industry,
        capability_snapshot=capability_snapshot,
        policy_context={
            "strategy_version": industry_policy.get("strategy_version"),
            "customer_requirements": customer_requirements,
            "digital_human_tuning": digital_human_tuning,
            "vlog_tuning": vlog_tuning,
        },
        force_human_approval=True,
    )
    workflow = resolve_workflow(industry)
    template_rows = list_templates_by_industry(industry)
    template_candidates = [
        str(row.get("name", "")).strip()
        for row in template_rows
        if str(row.get("name", "")).strip()
    ]
    active_template = next(
        (str(row.get("name", "")).strip() for row in template_rows if row.get("is_active")),
        "",
    )
    template_scope = f"workflow_template:{industry}"
    template_policy = recommend_policy(
        user_id,
        template_scope=template_scope,
        template_candidates=template_candidates,
        default_template=active_template or (template_candidates[0] if template_candidates else ""),
    )
    selected_template = str(template_policy.get("workflow_template", "")).strip()
    selected_template_row = resolve_template(industry, selected_template) if selected_template else {}
    if bool(selected_template_row.get("has_workflow")):
        workflow = {
            "industry": industry,
            "env_key": "",
            "workflow_path": str(selected_template_row.get("workflow_path", "")),
            "has_workflow": True,
            "source": str(selected_template_row.get("source", "registry_named")),
        }

    comfyui_result = await generate_storyboard_video_local(
        task_description=raw_task_text,
        scenes=[item for item in scenes if isinstance(item, dict)],
        tenant_id=tenant_id,
        user_id=user_id,
        reference_assets=state.get("competitor_multimodal_assets", []),
        digital_human_tuning=digital_human_tuning,
        vlog_tuning=vlog_tuning,
        voice_profile=voice_profile,
        customer_requirements=customer_requirements,
        workflow_path_override=str(workflow.get("workflow_path", "")).strip() or None,
    )
    media_pack: list[dict[str, Any]] = []
    engine = "nano-banana-pro"

    comfy_urls = comfyui_result.get("result_urls", [])
    if isinstance(comfy_urls, list):
        for idx, url in enumerate(comfy_urls):
            clean_url = str(url).strip()
            if not clean_url:
                continue
            media_pack.append(
                {
                    "scene": idx + 1,
                    "url": clean_url,
                    "type": "video"
                    if clean_url.lower().endswith((".mp4", ".mov", ".webm"))
                    else "image",
                    "source": "comfyui",
                }
            )
    if media_pack:
        engine = "comfyui-local"

    libtv_result: dict[str, Any] = {"ok": False, "mode": "skipped", "reason": "comfyui_success"}
    if not media_pack:
        libtv_result = await generate_storyboard_video(
            task_description=str(state.get("task_description", "")).strip(),
            scenes=[item for item in scenes if isinstance(item, dict)],
            tenant_id=tenant_id,
            user_id=user_id,
            reference_assets=state.get("competitor_multimodal_assets", []),
            digital_human_tuning=digital_human_tuning,
            vlog_tuning=vlog_tuning,
            customer_requirements=customer_requirements,
        )
        urls = libtv_result.get("result_urls", [])
        if isinstance(urls, list):
            for idx, url in enumerate(urls):
                clean_url = str(url).strip()
                if not clean_url:
                    continue
                media_pack.append(
                    {
                        "scene": idx + 1,
                        "url": clean_url,
                        "type": "video"
                        if clean_url.lower().endswith((".mp4", ".mov", ".webm"))
                        else "image",
                        "source": "libtv",
                    }
                )
        if media_pack:
            engine = "libtv-skill"

    return {
        "visualizer_output": {
            "prompt_pack": prompts,
            "media_pack": media_pack,
            "engine": engine,
            "style_profile": {
                "digital_human_mode": digital_human_mode,
                "vlog_narration_mode": vlog_mode,
                "style_tokens": style_tokens,
                "strategy_version": industry_policy.get("strategy_version", "general_safe_v1"),
                "customer_requirements": customer_requirements[:5],
                "digital_human_tuning": digital_human_tuning,
                "vlog_tuning": vlog_tuning,
                "voice_profile": voice_profile,
            },
            "industry": industry,
            "workflow_template": workflow,
            "template_selection": {
                "scope": template_scope,
                "selected": selected_template,
                "active": active_template,
                "candidates": template_candidates[:20],
                "mode": template_policy.get("workflow_template_mode", "fallback"),
            },
            "capability_snapshot": capability_snapshot,
            "generation_plan": generation_plan,
            "comfyui_render": comfyui_result,
            "libtv_session": libtv_result,
        },
        "call_log": _agent_log(
            "visualizer",
            "Visual prompts generated; local ComfyUI first and LibTV fallback",
            {
                "prompt_count": len(prompts),
                "media_count": len(media_pack),
                "comfyui_ok": bool(comfyui_result.get("ok")),
                "comfyui_mode": comfyui_result.get("mode"),
                "comfyui_prompt_id": comfyui_result.get("prompt_id"),
                "industry": industry,
                "workflow_env_key": workflow.get("env_key"),
                "workflow_path": workflow.get("workflow_path"),
                "template_scope": template_scope,
                "template_selected": selected_template,
                "template_mode": template_policy.get("workflow_template_mode", "fallback"),
                "generation_plan_fallback_required": bool(
                    generation_plan.get("fallback_required", False)
                ),
                "generation_plan_readiness": generation_plan.get("readiness", 0),
                "libtv_ok": bool(libtv_result.get("ok")),
                "libtv_mode": libtv_result.get("mode"),
                "engine_selected": engine,
                "digital_human_mode": digital_human_mode,
                "vlog_narration_mode": vlog_mode,
                "strategy_version": industry_policy.get("strategy_version", "general_safe_v1"),
            },
        ),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
