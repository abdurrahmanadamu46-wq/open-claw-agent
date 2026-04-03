"""
FollowUp 🦐 回访虾 — 推进成交、二次激活、跟进 SOP

Primary Artifact: FollowUpActionPlan
Upstream: Abacus / HumanApprovalGate
Downstream: Feedback

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from lobsters.base_lobster import BaseLobster
from lobsters.shared import (
    agent_log as _agent_log,
    bool_env as _bool_env,
    int_env as _int_env,
    invoke_clawhub_skill as _invoke_clawhub_skill,
)
from prompt_asset_loader import get_prompt_loader

_instance: FollowUpLobster | None = None


class FollowUpLobster(BaseLobster):
    role_id = "followup"


def _get() -> FollowUpLobster:
    global _instance
    if _instance is None:
        _instance = FollowUpLobster()
    return _instance


def _build_followup_spawn_plan(
    *,
    leads: list[dict[str, Any]],
    trace_id: str,
) -> dict[str, Any]:
    from followup_subagent_store import plan_deterministic_subagents

    threshold = max(1, _int_env("FOLLOWUP_SUBAGENT_THRESHOLD", 6))
    max_children = max(1, _int_env("FOLLOWUP_MAX_CHILDREN", 10))
    leads_per_child = max(1, _int_env("FOLLOWUP_LEADS_PER_CHILD", 2))
    child_concurrency = max(1, _int_env("FOLLOWUP_CHILD_CONCURRENCY", 4))
    deterministic_enabled = _bool_env("FOLLOWUP_DETERMINISTIC_SPAWN_ENABLED", True)

    if (not deterministic_enabled) or len(leads) < threshold:
        return {
            "enabled": deterministic_enabled,
            "mode": "single",
            "threshold": threshold,
            "max_children": max_children,
            "leads_per_child": leads_per_child,
            "child_concurrency": 1,
            "plan": {
                "trace_id": trace_id,
                "lead_count": len(leads),
                "child_count": 1 if leads else 0,
                "leads_per_child": max(1, len(leads) or 1),
                "shards": (
                    [
                        {
                            "child_id": "sub_01_single",
                            "child_index": 1,
                            "lead_ids": [
                                str(item.get("lead_id") or f"lead_{idx + 1}")
                                for idx, item in enumerate(leads)
                            ],
                            "leads": leads,
                        }
                    ]
                    if leads
                    else []
                ),
            },
        }

    plan = plan_deterministic_subagents(
        leads=leads,
        trace_id=trace_id or "followup",
        max_children=max_children,
        leads_per_child=leads_per_child,
    )
    return {
        "enabled": True,
        "mode": "deterministic_subagents",
        "threshold": threshold,
        "max_children": max_children,
        "leads_per_child": leads_per_child,
        "child_concurrency": child_concurrency,
        "plan": plan,
    }


async def _run_followup_child(
    *,
    shard: dict[str, Any],
    user_id: str,
    tenant_id: str,
    score: float,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    from llm_router import RouteMeta, llm_router

    child_id = str(shard.get("child_id") or "sub_00")
    worker_id = f"followup:{child_id}"
    leads = shard.get("leads", [])
    if not isinstance(leads, list):
        leads = []
    lead_ids = [str(item) for item in (shard.get("lead_ids") or []) if str(item).strip()]
    started_at = datetime.now(timezone.utc)
    error_text: str | None = None
    llm_brief: str | None = None
    actions: list[dict[str, Any]] = []
    for idx, lead in enumerate(leads):
        fallback_id = lead_ids[idx] if idx < len(lead_ids) else f"lead_{idx + 1}"
        lead_id = str(lead.get("lead_id") or fallback_id)
        actions.append(
            {
                "lead_id": lead_id,
                "action": "call_now" if str(lead.get("grade", "")).upper() == "A" else "dm_then_call",
                "worker_id": worker_id,
            }
        )

    try:
        async with semaphore:
            prompt_id = (
                "followup.closing.objection-handling.v1"
                if score >= 0.75 or any(str(item.get("grade", "")).upper() == "A" for item in leads)
                else "followup.reactivation.gentle-reminder.v1"
            )
            prompt = get_prompt_loader().get_prompt(prompt_id) or get_prompt_loader().get_best_for(
                "followup_multi_touch",
                None,
            )
            rendered_prompt = (
                prompt.fill(
                    lead_name=(leads[0].get("lead_name") or leads[0].get("name") or "朋友") if leads else "朋友",
                    stage="high_intent" if score >= 0.75 else "reactivation",
                    objection=(leads[0].get("objection") or "再考虑") if leads else "再考虑",
                    next_step="call_now" if score >= 0.75 else "warm_reengage",
                    last_contact=(leads[0].get("last_contact") or "7天前") if leads else "7天前",
                    value_hook=(leads[0].get("value_hook") or "新方案") if leads else "新方案",
                    cta="回复即可安排",
                )
                if prompt
                else ""
            )
            llm_brief = await llm_router.routed_ainvoke_text(
                system_prompt=(
                    "You are FollowUp sub-agent. Return one short call-brief sentence in plain text, <= 40 words."
                ),
                user_prompt="\n\n".join(
                    part
                    for part in [
                        rendered_prompt.strip(),
                        json.dumps(
                            {
                                "child_id": child_id,
                                "lead_count": len(leads),
                                "avg_score": score,
                                "actions": actions,
                            },
                            ensure_ascii=False,
                        ),
                    ]
                    if part
                ),
                meta=RouteMeta(
                    critical=True,
                    est_tokens=450,
                    tenant_tier="basic",
                    user_id=user_id,
                    tenant_id=tenant_id,
                    task_type="followup_voice",
                ),
                temperature=0.2,
            )
    except Exception as exc:  # noqa: BLE001
        error_text = str(exc)[:300]

    finished_at = datetime.now(timezone.utc)
    duration_ms = max(0, int((finished_at - started_at).total_seconds() * 1000))
    status = "failed" if error_text else "completed"
    return {
        "child_id": child_id,
        "worker_id": worker_id,
        "lead_ids": lead_ids,
        "status": status,
        "action_count": len(actions),
        "actions": actions,
        "call_brief": (llm_brief or "").strip()[:220] or None,
        "error": error_text,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_ms": duration_ms,
    }


async def followup(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full followup implementation.

    Supports deterministic sub-agent spawning for large lead batches and
    writes child-run telemetry back into followup_subagent_store.
    """
    from clawteam_inbox import claim_ready_tasks, enqueue_inbox_tasks, mark_many_completed, mark_many_failed
    from followup_subagent_store import (
        create_spawn_run as create_followup_spawn_run,
        finish_spawn_run as finish_followup_spawn_run,
        get_spawn_run as get_followup_spawn_run,
        record_child_run as record_followup_child_run,
    )

    leads = state.get("leads", [])
    await _invoke_clawhub_skill("followup", "openai-whisper", {"lead_count": len(leads)})
    user_id = str(state.get("user_id") or "shared")
    tenant_id = str(state.get("tenant_id") or "tenant_main")
    trace_id = str(state.get("trace_id") or f"trace_{uuid.uuid4().hex[:8]}")
    avg_score = float(state.get("score", 0) or 0.0)

    spawn_cfg = _build_followup_spawn_plan(leads=leads, trace_id=trace_id)
    plan = spawn_cfg.get("plan", {}) if isinstance(spawn_cfg.get("plan"), dict) else {}
    shards = plan.get("shards", []) if isinstance(plan.get("shards"), list) else []
    mode = str(spawn_cfg.get("mode", "single"))
    child_concurrency = max(1, int(spawn_cfg.get("child_concurrency", 1) or 1))
    max_concurrency = min(max(1, int(plan.get("child_count", len(shards) or 1))), child_concurrency)

    spawn_run_id = create_followup_spawn_run(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
        mode=mode,
        parent_agent="followup",
        plan=plan,
        max_concurrency=max_concurrency,
    )

    queue_inserted: list[dict[str, Any]] = []
    if trace_id and shards:
        queue_inserted = enqueue_inbox_tasks(
            user_id=user_id,
            trace_id=trace_id,
            tasks=[
                {
                    "task_key": f"followup_child_{str(shard.get('child_id') or idx + 1)}",
                    "lane": "followup_call",
                    "priority": 65,
                    "depends_on": [],
                    "payload": {
                        "spawn_run_id": spawn_run_id,
                        "child_id": str(shard.get("child_id") or ""),
                        "lead_ids": list(shard.get("lead_ids") or []),
                        "lead_count": len(shard.get("leads") or []),
                    },
                }
                for idx, shard in enumerate(shards)
            ],
        )

    child_runs: list[dict[str, Any]] = []
    if shards:
        semaphore = asyncio.Semaphore(max_concurrency)
        child_runs = await asyncio.gather(
            *[
                _run_followup_child(
                    shard=shard,
                    user_id=user_id,
                    tenant_id=tenant_id,
                    score=avg_score,
                    semaphore=semaphore,
                )
                for shard in shards
            ]
        )

    claimed_count = 0
    queue_completed = 0
    queue_failed = 0
    if trace_id and shards:
        claimed = claim_ready_tasks(
            user_id=user_id,
            trace_id=trace_id,
            worker_id=f"{trace_id}:followup_orchestrator",
            lanes=["followup_call"],
            limit=max(1, len(shards) + 4),
        )
        claimed_count = len(claimed)
        by_child_id: dict[str, str] = {}
        for task in claimed:
            payload = task.get("payload", {}) if isinstance(task.get("payload"), dict) else {}
            child_id = str(payload.get("child_id") or "").strip()
            task_key = str(task.get("task_key") or "").strip()
            if child_id and task_key:
                by_child_id[child_id] = task_key
        completed_task_keys: list[str] = []
        failed_task_keys: list[str] = []
        for run in child_runs:
            key = by_child_id.get(str(run.get("child_id") or ""))
            if not key:
                continue
            if str(run.get("status")) == "completed":
                completed_task_keys.append(key)
            else:
                failed_task_keys.append(key)
        if completed_task_keys:
            queue_completed = mark_many_completed(
                trace_id=trace_id,
                task_keys=completed_task_keys,
                worker_id=f"{trace_id}:followup_orchestrator",
            )
        if failed_task_keys:
            queue_failed = mark_many_failed(
                trace_id=trace_id,
                task_keys=failed_task_keys,
                worker_id=f"{trace_id}:followup_orchestrator",
                error="followup_child_failed",
            )

    actions: list[dict[str, Any]] = []
    child_failures = 0
    for run in child_runs:
        actions.extend(run.get("actions", []) if isinstance(run.get("actions"), list) else [])
        if str(run.get("status")) != "completed":
            child_failures += 1
        record_followup_child_run(
            spawn_run_id=spawn_run_id,
            child_id=str(run.get("child_id") or ""),
            worker_id=str(run.get("worker_id") or ""),
            lead_ids=[str(x) for x in run.get("lead_ids", []) if str(x).strip()],
            status=str(run.get("status") or "unknown"),
            action_count=int(run.get("action_count", 0) or 0),
            started_at=str(run.get("started_at") or datetime.now(timezone.utc).isoformat()),
            finished_at=str(run.get("finished_at") or datetime.now(timezone.utc).isoformat()),
            duration_ms=int(run.get("duration_ms", 0) or 0),
            error=(str(run.get("error"))[:300] if run.get("error") else None),
            detail={
                "call_brief": run.get("call_brief"),
                "action_count": int(run.get("action_count", 0) or 0),
            },
        )

    if not actions:
        actions = [
            {
                "lead_id": lead.get("lead_id"),
                "action": "call_now" if str(lead.get("grade", "")).upper() == "A" else "dm_then_call",
            }
            for lead in leads
        ]

    child_briefs = [
        str(run.get("call_brief") or "").strip()
        for run in child_runs
        if str(run.get("call_brief") or "").strip()
    ]
    merged_brief = " | ".join(child_briefs[:3]) if child_briefs else None

    run_status = "completed" if child_failures == 0 else ("partial_failed" if actions else "failed")
    spawn_summary = {
        "spawn_run_id": spawn_run_id,
        "mode": mode,
        "lead_count": len(leads),
        "child_count": int(plan.get("child_count", len(shards) or 0) or 0),
        "max_concurrency": max_concurrency,
        "queue_inserted_count": len(queue_inserted),
        "queue_claimed_count": claimed_count,
        "queue_completed_count": queue_completed,
        "queue_failed_count": queue_failed,
        "child_failure_count": child_failures,
        "status": run_status,
    }
    finish_followup_spawn_run(
        spawn_run_id=spawn_run_id,
        status=run_status,
        summary=spawn_summary,
    )
    persisted_spawn = get_followup_spawn_run(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
    )

    return {
        "followup_output": {
            "actions": actions,
            "call_brief": merged_brief,
            "subagent_spawn": {
                **spawn_summary,
                "children": persisted_spawn.get("children", [])[:20]
                if isinstance(persisted_spawn, dict)
                else [],
            },
        },
        "followup_spawn": spawn_summary,
        "clawteam_queue": {
            **(state.get("clawteam_queue", {}) or {}),
            "followup_inserted_count": len(queue_inserted),
            "followup_claimed_count": claimed_count,
            "followup_completed_count": queue_completed,
            "followup_failed_count": queue_failed,
            "followup_spawn_run_id": spawn_run_id,
        },
        "call_log": _agent_log(
            "followup",
            "Follow-up plan generated with deterministic sub-agent spawning",
            {
                "action_count": len(actions),
                "child_count": int(plan.get("child_count", len(shards) or 0) or 0),
                "max_concurrency": max_concurrency,
                "child_failure_count": child_failures,
            },
        ),
    }


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
