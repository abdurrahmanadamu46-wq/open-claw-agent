"""
Dispatcher 🦐 点兵虾 — 拆包、依赖、灰度、止损

Primary Artifact: ExecutionPlan
Upstream: Strategist, InkWriter, Visualizer
Downstream: DiscoverEdgeSkills

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from lobsters.base_lobster import BaseLobster
from lobsters.lobster_memory import LobsterMemory
from lobsters.shared import (
    agent_log as _agent_log,
    invoke_clawhub_skill as _invoke_clawhub_skill,
)
from lobsters.task_continuity import TaskContinuityManager

_instance: DispatcherLobster | None = None


class DispatcherLobster(BaseLobster):
    role_id = "dispatcher"


def _get() -> DispatcherLobster:
    global _instance
    if _instance is None:
        _instance = DispatcherLobster()
    return _instance


def _build_clawteam_tasks(*, user_id: str, trace_id: str, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    publish_keys: list[str] = []
    for idx, job in enumerate(jobs, start=1):
        base = f"job_{idx}"
        prepare_key = f"{base}.prepare"
        render_key = f"{base}.render"
        publish_key = f"{base}.publish"
        publish_keys.append(publish_key)

        tasks.append(
            {
                "task_key": prepare_key,
                "lane": "planner",
                "priority": 10 + idx,
                "depends_on": [],
                "payload": {
                    "job_id": job.get("job_id"),
                    "step": "prepare",
                    "script": job.get("script"),
                },
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/planner/{base}",
            }
        )
        tasks.append(
            {
                "task_key": render_key,
                "lane": "content",
                "priority": 30 + idx,
                "depends_on": [prepare_key],
                "payload": {
                    "job_id": job.get("job_id"),
                    "step": "render",
                    "prompt": job.get("prompt"),
                },
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/content/{base}",
            }
        )
        tasks.append(
            {
                "task_key": publish_key,
                "lane": "delivery",
                "priority": 60 + idx,
                "depends_on": [render_key],
                "payload": {
                    "job_id": job.get("job_id"),
                    "step": "publish",
                },
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/delivery/{base}",
            }
        )

    if publish_keys:
        tasks.append(
            {
                "task_key": "campaign.audit",
                "lane": "audit",
                "priority": 90,
                "depends_on": publish_keys,
                "payload": {"step": "audit_campaign_delivery"},
                "worktree_path": f"./worktrees/{user_id}/{trace_id}/audit/campaign",
            }
        )
    return tasks


async def dispatcher(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full dispatcher implementation.

    Packages content jobs, generates post-production plan, and writes tasks
    into ClawTeam inbox lanes.
    """
    from clawteam_inbox import claim_ready_tasks, enqueue_inbox_tasks, get_ready_tasks, mark_many_completed
    from clawteam_inbox import summary as clawteam_summary
    from lossless_memory import append_event as append_lossless_event
    from media_post_pipeline import build_post_production_plan

    scenes = state.get("inkwriter_output", {}).get("scenes", [])
    prompts = state.get("visualizer_output", {}).get("prompt_pack", [])
    media = state.get("visualizer_output", {}).get("media_pack", [])
    visualizer_industry = state.get("visualizer_output", {}).get("industry")
    visualizer_workflow = state.get("visualizer_output", {}).get("workflow_template", {})
    visualizer_generation_plan = state.get("visualizer_output", {}).get("generation_plan", {})
    visualizer_style_profile = state.get("visualizer_output", {}).get("style_profile", {})
    comfyui_render = state.get("visualizer_output", {}).get("comfyui_render", {})
    libtv_session = state.get("visualizer_output", {}).get("libtv_session", {})
    hot_topics = state.get("hot_topics", [])
    user_id = str(state.get("user_id") or "shared")
    tenant_id = str(state.get("tenant_id") or user_id or "tenant_main")
    trace_id = str(state.get("trace_id") or f"trace_{uuid.uuid4().hex[:12]}")
    continuity = TaskContinuityManager(LobsterMemory("dispatcher", tenant_id))

    jobs: list[dict[str, Any]] = []
    for idx in range(max(len(scenes), len(prompts), len(media))):
        jobs.append(
            {
                "job_id": f"content_job_{idx + 1}",
                "script": scenes[idx] if idx < len(scenes) else None,
                "prompt": prompts[idx] if idx < len(prompts) else None,
                "media": media[idx] if idx < len(media) else None,
            }
        )

    content_package = {
        "package_id": f"pkg_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "topics": hot_topics,
        "jobs": jobs,
        "ops_instruction": {
            "publish_window": "19:00-22:00 Asia/Shanghai",
            "cta": "DM for pricing and details",
            "tone": "friendly_trustworthy",
            "rag_boost": {
                "formula_count": int(state.get("rag_ingested_count", 0) or 0),
                "reference_count": len(state.get("strategy", {}).get("rag_references", [])),
            },
            "visual_delivery": {
                "engine": state.get("visualizer_output", {}).get("engine", "nano-banana-pro"),
                "industry": visualizer_industry,
                "workflow_template": visualizer_workflow,
                "generation_plan": visualizer_generation_plan,
                "style_profile": visualizer_style_profile,
                "media_count": len(media),
                "comfyui_prompt_id": comfyui_render.get("prompt_id"),
                "comfyui_mode": comfyui_render.get("mode"),
                "libtv_session_id": libtv_session.get("session_id"),
                "libtv_project_url": libtv_session.get("project_url"),
            },
        },
    }
    await continuity.save_pending_task(
        tenant_id=tenant_id,
        lobster_id="dispatcher",
        task={
            "task_id": content_package["package_id"],
            "trace_id": trace_id,
            "description": f"Dispatch package {content_package['package_id']}",
            "priority": 7,
            "job_count": len(jobs),
        },
    )
    post_plan = build_post_production_plan(
        media_urls=[
            str(item.get("url", "")).strip()
            for item in media
            if isinstance(item, dict) and str(item.get("url", "")).strip()
        ],
        industry=str(visualizer_industry or "general"),
        auto_image_retouch=bool(
            (visualizer_generation_plan.get("auto_post_production", {}) or {}).get(
                "auto_image_retouch", True
            )
        ),
        auto_video_edit=bool(
            (visualizer_generation_plan.get("auto_post_production", {}) or {}).get(
                "auto_video_edit", True
            )
        ),
        auto_clip_cut=bool(
            (visualizer_generation_plan.get("auto_post_production", {}) or {}).get(
                "auto_clip_cut", True
            )
        ),
        digital_human_mode=bool((visualizer_generation_plan or {}).get("digital_human_mode", False)),
        vlog_narration_mode=bool((visualizer_generation_plan or {}).get("vlog_narration_mode", False)),
        digital_human_tuning=(
            visualizer_style_profile.get("digital_human_tuning", {})
            if isinstance(visualizer_style_profile, dict)
            else {}
        ),
        vlog_tuning=(
            visualizer_style_profile.get("vlog_tuning", {})
            if isinstance(visualizer_style_profile, dict)
            else {}
        ),
    )
    content_package["ops_instruction"]["post_production"] = post_plan

    await _invoke_clawhub_skill("dispatcher", "proactive-agent", {"job_count": len(jobs)})
    clawteam_tasks = _build_clawteam_tasks(user_id=user_id, trace_id=trace_id, jobs=jobs)
    inserted = enqueue_inbox_tasks(user_id=user_id, trace_id=trace_id, tasks=clawteam_tasks)

    planner_worker = f"{trace_id}:planner"
    planner_claimed = claim_ready_tasks(
        user_id=user_id,
        trace_id=trace_id,
        worker_id=planner_worker,
        lanes=["planner"],
        limit=max(1, len(jobs) + 4),
    )
    planner_completed = mark_many_completed(
        trace_id=trace_id,
        task_keys=[item["task_key"] for item in planner_claimed],
        worker_id=planner_worker,
    )

    content_worker = f"{trace_id}:content"
    content_claimed = claim_ready_tasks(
        user_id=user_id,
        trace_id=trace_id,
        worker_id=content_worker,
        lanes=["content"],
        limit=max(1, len(jobs) + 4),
    )
    content_completed = mark_many_completed(
        trace_id=trace_id,
        task_keys=[item["task_key"] for item in content_claimed],
        worker_id=content_worker,
    )

    ready = [
        task
        for task in get_ready_tasks(user_id=user_id, trace_id=trace_id, limit=30)
        if str(task.get("lane", "")).lower() == "delivery"
    ][:15]
    queue_summary = clawteam_summary(user_id=user_id, trace_id=trace_id)
    queue_snapshot = {
        "trace_id": trace_id,
        "inserted_count": len(inserted),
        "planner_claimed_count": len(planner_claimed),
        "planner_completed_count": planner_completed,
        "content_claimed_count": len(content_claimed),
        "content_completed_count": content_completed,
        "ready_count": len(ready),
        "ready_tasks": ready[:10],
        "summary": queue_summary,
    }

    try:
        append_lossless_event(
            user_id=user_id,
            trace_id=trace_id,
            node="dispatcher",
            event_type="clawteam_queue_enqueued",
            payload={
                "job_count": len(jobs),
                "inserted_count": len(inserted),
                "planner_completed": planner_completed,
                "content_completed": content_completed,
                "ready_count": len(ready),
                "queue_summary": queue_summary,
            },
            level="info",
        )
    except Exception:  # noqa: BLE001
        pass

    await continuity.mark_task_completed(
        tenant_id=tenant_id,
        lobster_id="dispatcher",
        task_id=content_package["package_id"],
    )

    return {
        "content_package": content_package,
        "dispatch_plan": {
            "queue": "edge_content_distribution",
            "edge_count": len(state.get("edge_targets", [])),
            "job_count": len(jobs),
            "clawteam_trace_id": trace_id,
            "clawteam_ready_count": len(ready),
            "clawteam_planner_completed": planner_completed,
            "clawteam_content_completed": content_completed,
        },
        "clawteam_queue": queue_snapshot,
        "call_log": _agent_log("dispatcher", "Dispatch plan built", {"job_count": len(jobs)}),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
