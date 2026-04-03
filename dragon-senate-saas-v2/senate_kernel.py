from __future__ import annotations

import json
import os
from typing import Any

from constitutional_policy import build_policy_context
from constitutional_policy import evaluate_policy_context
from memory_governor import append_episode_event
from memory_governor import fold_reasoning_card
from memory_governor import memory_snapshot
from memory_governor import upsert_campaign_memory
from memory_governor import upsert_policy_memory
from memory_governor import upsert_playbook_memory
from memory_governor import upsert_role_memory
from memory_governor import upsert_tenant_memory


SOURCE_CREDIBILITY = {
    "openalex": 0.88,
    "paperswithcode": 0.91,
    "github_projects": 0.74,
    "github_repos": 0.74,
    "huggingface_papers": 0.79,
    "qbitai": 0.66,
    "zhihu": 0.57,
    "manual": 0.68,
    "unknown": 0.50,
}

# Unicode-escaped literals avoid Windows console/file encoding issues.
BLOCK_KEYWORDS = {
    "\u9ed1\u4ea7",  # illicit operation
    "\u8bc8\u9a97",  # fraud
    "\u7ed5\u8fc7\u98ce\u63a7",  # bypass risk control
    "\u6279\u91cf\u6ce8\u518c\u8d26\u53f7",  # batch account registration
    "\u4f2a\u9020\u8eab\u4efd",  # forged identity
}
REVIEW_KEYWORDS = {
    "\u81ea\u52a8\u79c1\u4fe1",  # auto-DM
    "\u81ea\u52a8\u8bc4\u8bba",  # auto-comment
    "\u81ea\u52a8\u62e8\u53f7",  # auto-dial
    "\u4e00\u952e\u7fa4\u53d1",  # one-click mass send
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(v, hi))


def compute_source_credibility(radar_data: dict[str, Any]) -> dict[str, Any]:
    source_hits: list[str] = []
    for key in ("sources", "source_signals", "platforms"):
        raw = radar_data.get(key)
        if isinstance(raw, list):
            for item in raw:
                source_hits.append(str(item).strip().lower())
    if not source_hits:
        source_hits = ["unknown"]

    scores: list[dict[str, Any]] = []
    for src in source_hits:
        base = SOURCE_CREDIBILITY.get(src, SOURCE_CREDIBILITY["unknown"])
        scores.append({"source": src, "score": round(base, 4)})
    overall = sum(x["score"] for x in scores) / len(scores)
    weak = [x for x in scores if x["score"] < 0.62]
    return {
        "overall": round(overall, 4),
        "weak_sources": weak,
        "source_scores": scores,
        "trusted": overall >= 0.60,
    }


def build_memory_context(*, tenant_id: str, user_id: str, task_description: str, hot_topics: list[str]) -> dict[str, Any]:
    keys = [task_description] + hot_topics
    return memory_snapshot(
        tenant_id=tenant_id,
        user_id=user_id,
        topic_keys=keys,
        episode_limit=12,
        role_budgets={
            "strategist": 3,
            "dispatcher": 3,
            "visualizer": 2,
            "followup": 3,
        },
    )


def estimate_strategy_confidence(
    *,
    rag_reference_count: int,
    rag_graph_reference_count: int,
    llm_route: str,
    llm_error: str | None,
    source_overall: float,
    memory_coverage: float,
) -> dict[str, Any]:
    base = 0.42
    base += min(0.24, 0.04 * max(0, rag_reference_count))
    base += min(0.12, 0.03 * max(0, rag_graph_reference_count))
    base += 0.08 if llm_route == "llm_routed" else -0.04
    base += _clamp(source_overall - 0.5, -0.15, 0.2)
    base += _clamp(memory_coverage * 0.18, 0.0, 0.18)
    if llm_error:
        base -= 0.10

    center = _clamp(base, 0.20, 0.95)
    low = _clamp(center - 0.12, 0.05, 0.90)
    high = _clamp(center + 0.08, 0.10, 0.99)
    return {"low": round(low, 4), "high": round(high, 4), "center": round(center, 4)}


def classify_risk_taxonomy(
    *,
    task_description: str,
    strategy: dict[str, Any],
    guardian: dict[str, Any],
    verification: dict[str, Any],
    edge_target_count: int = 0,
    competitor_count: int = 0,
) -> dict[str, Any]:
    text_blob = f"{task_description}\n{json.dumps(strategy, ensure_ascii=False)}".lower()
    compliance_risk = float(((guardian.get("scores") or {}).get("compliance_risk")) or 0.0)
    confidence_risk = float(((guardian.get("scores") or {}).get("confidence_risk")) or 0.0)
    total_risk = float(((guardian.get("scores") or {}).get("total_risk")) or 0.0)
    observed = verification.get("observed", {})
    confidence_center = float(observed.get("center", 0.0) or 0.0) if isinstance(observed, dict) else 0.0

    single_agent_score = _clamp(
        0.20
        + compliance_risk * 0.45
        + (0.12 if any(term in text_blob for term in ("comment", "reply", "post", "dm")) else 0.0)
        + (0.08 if str(guardian.get("decision", "")) == "block" else 0.0),
        0.0,
        1.0,
    )
    inter_agent_score = _clamp(
        0.10
        + min(edge_target_count, 12) * 0.035
        + min(competitor_count, 6) * 0.025
        + (0.12 if any(term in text_blob for term in ("dispatch", "queue", "handoff", "approval", "edge")) else 0.0)
        + confidence_risk * 0.18,
        0.0,
        1.0,
    )
    system_emergent_score = _clamp(
        0.08
        + (0.18 if any(term in text_blob for term in ("batch", "parallel", "mass", "full-auto", "automatic")) else 0.0)
        + (0.14 if edge_target_count >= 5 else 0.0)
        + total_risk * 0.22
        + (0.10 if confidence_center < 0.65 else 0.0),
        0.0,
        1.0,
    )

    family_scores = {
        "single_agent": round(single_agent_score, 4),
        "inter_agent": round(inter_agent_score, 4),
        "system_emergent": round(system_emergent_score, 4),
    }
    primary_family = max(family_scores.items(), key=lambda item: item[1])[0]
    active_families = [family for family, score in family_scores.items() if score >= 0.35]
    if not active_families:
        active_families = [primary_family]

    family_monitor_rules = {
        "single_agent": [
            {
                "rule_key": "single_agent_content_reject_rate",
                "metric": "content_reject_rate",
                "operator": ">=",
                "threshold": 0.18,
                "window": "30m",
                "action": "tighten review gate and sample recent outputs",
            },
            {
                "rule_key": "single_agent_policy_violation",
                "metric": "guardian_block_ratio",
                "operator": ">=",
                "threshold": 0.08,
                "window": "60m",
                "action": "pause affected template and inspect blocked terms",
            },
        ],
        "inter_agent": [
            {
                "rule_key": "inter_agent_handoff_failures",
                "metric": "queue_handoff_failures",
                "operator": ">=",
                "threshold": 3,
                "window": "15m",
                "action": "freeze downstream dispatch and inspect queue state",
            },
            {
                "rule_key": "inter_agent_delivery_divergence",
                "metric": "edge_dispatch_mismatch_ratio",
                "operator": ">=",
                "threshold": 0.12,
                "window": "30m",
                "action": "switch to phased rollout and validate edge acknowledgements",
            },
        ],
        "system_emergent": [
            {
                "rule_key": "system_emergent_complaint_spike",
                "metric": "complaint_spike_ratio",
                "operator": ">=",
                "threshold": 0.10,
                "window": "30m",
                "action": "disable burst channels and escalate to manual approval",
            },
            {
                "rule_key": "system_emergent_approval_backlog",
                "metric": "approval_backlog",
                "operator": ">=",
                "threshold": 5,
                "window": "30m",
                "action": "reduce rollout ratio and push mobile approval notifications",
            },
        ],
    }
    rollback_presets = {
        "single_agent": {
            "recommended_stage": "preflight",
            "rollback_mode": "pause_template_and_reapprove",
            "operator_play": "Freeze the affected content lane, inspect recent outputs, and re-run with stricter prompt or policy terms.",
        },
        "inter_agent": {
            "recommended_stage": "postgraph",
            "rollback_mode": "freeze_dispatch_and_replay",
            "operator_play": "Stop downstream queue handoffs, validate edge acknowledgements, and replay after queue health recovers.",
        },
        "system_emergent": {
            "recommended_stage": "postgraph",
            "rollback_mode": "reduce_rollout_and_disable_burst",
            "operator_play": "Cut rollout ratio, disable burst channels, and switch all high-risk actions to HITL until metrics stabilize.",
        },
    }

    reasons: list[str] = []
    if single_agent_score >= 0.35:
        reasons.append("single-agent execution risk is material")
    if inter_agent_score >= 0.35:
        reasons.append("inter-agent coordination risk is material")
    if system_emergent_score >= 0.35:
        reasons.append("system-level emergent risk is material")

    return {
        "primary_family": primary_family,
        "families": active_families,
        "scores": family_scores,
        "reasons": reasons[:4],
        "monitor_rules": family_monitor_rules.get(primary_family, []),
        "rollback_preset": rollback_presets.get(primary_family, rollback_presets["single_agent"]),
    }


def constitutional_guardian(
    *,
    task_description: str,
    strategy: dict[str, Any],
    source_credibility: dict[str, Any],
    memory_context: dict[str, Any],
    industry_hint: str | None = None,
    hot_topics: list[str] | None = None,
) -> dict[str, Any]:
    policy_context = build_policy_context(
        task_description=task_description,
        strategy=strategy,
        hot_topics=hot_topics or [],
        industry_hint=industry_hint,
    )
    policy_eval = evaluate_policy_context(
        task_description=task_description,
        strategy=strategy,
        policy_context=policy_context,
    )
    text_blob = f"{task_description}\n{json.dumps(strategy, ensure_ascii=False)}".lower()
    block_hits = [kw for kw in BLOCK_KEYWORDS if kw in text_blob]
    review_hits = [kw for kw in REVIEW_KEYWORDS if kw in text_blob]

    source_risk = 1.0 - float(source_credibility.get("overall", 0.5) or 0.5)
    weak_source_cnt = len(source_credibility.get("weak_sources", []) or [])
    memory_gap = 1.0 - float(memory_context.get("coverage", 0.0) or 0.0)

    compliance_risk = _clamp((len(block_hits) * 0.5) + (len(review_hits) * 0.15), 0.0, 1.0)
    compliance_risk = max(compliance_risk, float(policy_eval.get("policy_risk", 0.0) or 0.0))
    confidence_risk = _clamp((source_risk * 0.45) + (memory_gap * 0.35) + (weak_source_cnt * 0.1), 0.0, 1.0)
    total_risk = _clamp((compliance_risk * 0.65) + (confidence_risk * 0.35), 0.0, 1.0)
    reason_codes = list(policy_eval.get("reason_codes", []))

    if block_hits or str(policy_eval.get("decision", "")) == "block":
        decision = "block"
        reason = "High-risk keywords detected. Action blocked."
        reason_codes.append("guardian.block")
    elif total_risk >= 0.62 or review_hits or str(policy_eval.get("decision", "")) == "review":
        decision = "review"
        reason = "Risk is elevated. Human review required."
        reason_codes.append("guardian.review")
    else:
        decision = "allow"
        reason = "Risk within threshold. Continue to verification gate."
        reason_codes.append("guardian.allow")

    return {
        "decision": decision,
        "reason": reason,
        "industry": policy_context.get("industry", "general"),
        "strategy_version": policy_context.get("strategy_version", "general_safe_v1"),
        "reason_codes": sorted(set(reason_codes)),
        "scores": {
            "compliance_risk": round(compliance_risk, 4),
            "confidence_risk": round(confidence_risk, 4),
            "total_risk": round(total_risk, 4),
            "policy_risk": round(float(policy_eval.get("policy_risk", 0.0) or 0.0), 4),
        },
        "hits": {
            "block_keywords": block_hits,
            "review_keywords": review_hits,
            "weak_source_count": weak_source_cnt,
            "policy_blocked_terms": policy_eval.get("blocked_terms", []),
            "policy_review_terms": policy_eval.get("review_terms", []),
            "policy_missing_required_points": policy_eval.get("missing_required_points", []),
        },
        "policy_context": policy_context,
    }


def verification_gate(
    *,
    confidence: dict[str, Any],
    guardian: dict[str, Any],
    source_credibility: dict[str, Any],
) -> dict[str, Any]:
    min_low = float(os.getenv("KERNEL_VERIFICATION_MIN_LOW", "0.55"))
    min_source = float(os.getenv("KERNEL_VERIFICATION_MIN_SOURCE", "0.60"))
    min_center = float(os.getenv("KERNEL_VERIFICATION_MIN_CENTER", "0.85"))
    low = float(confidence.get("low", 0.0) or 0.0)
    center = float(confidence.get("center", low) or low)
    source = float(source_credibility.get("overall", 0.0) or 0.0)
    guardian_decision = str(guardian.get("decision", "review"))
    reason_codes: list[str] = []
    if center >= 0.85:
        confidence_band = "high"
    elif center >= 0.70:
        confidence_band = "medium"
    elif center >= 0.55:
        confidence_band = "low"
    else:
        confidence_band = "very_low"

    accepted = guardian_decision == "allow" and low >= min_low and source >= min_source and center >= min_center
    if guardian_decision == "block":
        route = "reject"
        reason = "Blocked by constitutional guardian."
        reason_codes.append("verification.guardian_block")
    elif accepted:
        route = "continue"
        reason = "Verification passed. Continue execution."
        reason_codes.append("verification.pass")
    elif guardian_decision == "review":
        route = "review"
        reason = "Constitutional policy requests human review."
        reason_codes.append("verification.guardian_review")
    else:
        route = "reject"
        if center < min_center:
            reason = "Strategy confidence center below threshold."
            reason_codes.append("verification.center_below_threshold")
        elif low < min_low:
            reason = "Strategy confidence lower-bound below threshold."
            reason_codes.append("verification.low_below_threshold")
        else:
            reason = "Source credibility below threshold."
            reason_codes.append("verification.source_below_threshold")

    return {
        "accepted": accepted,
        "publish_allowed": accepted,
        "route": route,
        "reason": reason,
        "reason_codes": sorted(set(reason_codes)),
        "confidence_band": confidence_band,
        "thresholds": {"min_low": min_low, "min_source": min_source, "min_center": min_center},
        "observed": {"low": round(low, 4), "center": round(center, 4), "source": round(source, 4)},
    }


def persist_kernel_memory(
    *,
    tenant_id: str,
    user_id: str,
    trace_id: str,
    task_description: str,
    strategy: dict[str, Any],
    guardian: dict[str, Any],
    verification: dict[str, Any],
    confidence: dict[str, Any],
) -> dict[str, Any]:
    outcome = "success" if verification.get("accepted") else "failure"
    episode_payload = {
        "task_description": task_description,
        "strategy_summary": strategy.get("strategy_summary"),
        "guardian_decision": guardian.get("decision"),
        "verification_passed": verification.get("accepted"),
        "confidence": confidence,
    }
    episode_id = append_episode_event(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=trace_id,
        episode_key="senate_kernel_run",
        payload=episode_payload,
        importance=0.70 if verification.get("accepted") else 0.55,
    )
    policy_state = {
        "last_guardian": guardian,
        "last_verification": verification,
        "last_confidence": confidence,
    }
    policy_row = upsert_policy_memory(
        tenant_id=tenant_id,
        user_id=user_id,
        policy_key="senate_kernel_policy",
        policy=policy_state,
        bump_version=True,
    )
    industry = str((guardian.get("policy_context", {}) or {}).get("industry", "general"))
    tenant_row = upsert_tenant_memory(
        tenant_id=tenant_id,
        memory_key=f"industry_policy:{industry}",
        value={
            "updated_trace_id": trace_id,
            "industry": industry,
            "strategy_version": (guardian.get("policy_context", {}) or {}).get("strategy_version"),
            "decision": guardian.get("decision"),
            "reason_codes": guardian.get("reason_codes", []),
            "confidence_band": verification.get("confidence_band"),
            "updated_at": policy_state.get("last_confidence", {}),
        },
    )
    role_names = ["strategist", "dispatcher", "visualizer", "followup"]
    role_results: dict[str, bool] = {}
    playbook_results: dict[str, bool] = {}
    for role_name in role_names:
        card = fold_reasoning_card(
            role_name=role_name,
            trace_id=trace_id,
            task_description=task_description,
            strategy=strategy,
            guardian=guardian,
            verification=verification,
            confidence=confidence,
            outcome=outcome,
        )
        role_memory_key = f"{role_name}:{trace_id}"
        role_row = upsert_role_memory(
            tenant_id=tenant_id,
            user_id=user_id,
            role_name=role_name,
            memory_key=role_memory_key,
            card=card,
            importance=0.78 if outcome == "success" else 0.62,
        )
        role_results[role_name] = bool(role_row.get("inserted"))
        playbook_key = f"{industry}:{role_name}:{verification.get('confidence_band', 'unknown')}"
        playbook_row = upsert_playbook_memory(
            tenant_id=tenant_id,
            role_name=role_name,
            playbook_key=playbook_key,
            card=card,
            score=float(confidence.get("center", 0.0) or 0.0),
            outcome=outcome,
        )
        playbook_results[role_name] = bool(playbook_row.get("inserted"))

    campaign_row = upsert_campaign_memory(
        tenant_id=tenant_id,
        user_id=user_id,
        campaign_key=trace_id,
        outcome=outcome,
        card={
            "trace_id": trace_id,
            "industry": industry,
            "strategy_summary": strategy.get("strategy_summary"),
            "guardian_decision": guardian.get("decision"),
            "verification_route": verification.get("route"),
            "confidence_band": verification.get("confidence_band"),
            "reason_codes": sorted(
                set(
                    list(guardian.get("reason_codes", []) or [])
                    + list(verification.get("reason_codes", []) or [])
                )
            ),
            "updated_at": confidence.get("center"),
        },
        importance=0.74 if outcome == "success" else 0.58,
    )
    return {
        "episode_id": episode_id,
        "policy_version": int(policy_row.get("version") or 1),
        "tenant_memory_inserted": bool(tenant_row.get("inserted")),
        "industry": industry,
        "outcome": outcome,
        "role_memory_inserted": role_results,
        "campaign_memory_inserted": bool(campaign_row.get("inserted")),
        "playbook_inserted": playbook_results,
    }
