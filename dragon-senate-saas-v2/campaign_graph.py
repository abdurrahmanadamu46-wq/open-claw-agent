from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_seed(text: str) -> int:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _extract_keywords(text: str, limit: int = 8) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    token: list[str] = []
    for char in text.lower():
        if char.isalnum() or "\u4e00" <= char <= "\u9fff":
            token.append(char)
            continue
        if token:
            word = "".join(token)
            token = []
            if len(word) >= 2 and word not in seen:
                seen.add(word)
                output.append(word)
    if token:
        word = "".join(token)
        if len(word) >= 2 and word not in seen:
            output.append(word)
    return output[:limit]


@dataclass(slots=True)
class CampaignGraphInput:
    user_id: str
    task_description: str
    competitor_handles: list[str]
    edge_targets: list[dict[str, Any]]


@dataclass(slots=True)
class PlannerBranch:
    branch_id: str
    model_route: str
    retrieval_route: str
    channel_route: str
    followup_route: str
    depth: int
    expected_quality: float
    expected_cost: float
    expected_risk: float
    expected_replay_success: float
    final_score: float
    score_breakdown: dict[str, float]
    reasons: list[str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "branch_id": self.branch_id,
            "model_route": self.model_route,
            "retrieval_route": self.retrieval_route,
            "channel_route": self.channel_route,
            "followup_route": self.followup_route,
            "depth": self.depth,
            "expected_quality": round(self.expected_quality, 4),
            "expected_cost": round(self.expected_cost, 4),
            "expected_risk": round(self.expected_risk, 4),
            "expected_replay_success": round(self.expected_replay_success, 4),
            "final_score": round(self.final_score, 4),
            "score_breakdown": {key: round(value, 4) for key, value in self.score_breakdown.items()},
            "reasons": self.reasons,
        }


MODEL_ROUTE_PROFILES = {
    "local_fast": {"quality": -0.04, "cost": -0.05, "risk": 0.02, "replay": -0.03},
    "local_balanced": {"quality": 0.02, "cost": -0.02, "risk": -0.02, "replay": 0.02},
    "cloud_reasoning": {"quality": 0.08, "cost": 0.08, "risk": -0.01, "replay": 0.03},
    "hybrid_escalation": {"quality": 0.06, "cost": 0.02, "risk": -0.03, "replay": 0.05},
}

RETRIEVAL_ROUTE_PROFILES = {
    "fast_minimal": {"quality": -0.05, "cost": -0.04, "risk": 0.03, "replay": -0.03},
    "tenant_kb_focus": {"quality": 0.04, "cost": -0.01, "risk": -0.03, "replay": 0.03},
    "hybrid_multisource": {"quality": 0.08, "cost": 0.03, "risk": -0.02, "replay": 0.04},
    "deep_competitor": {"quality": 0.07, "cost": 0.05, "risk": 0.01, "replay": 0.01},
}

CHANNEL_ROUTE_PROFILES = {
    "single_edge_safe": {"quality": -0.03, "cost": -0.02, "risk": -0.04, "replay": 0.02},
    "phased_multi_edge": {"quality": 0.04, "cost": 0.01, "risk": -0.01, "replay": 0.04},
    "parallel_burst": {"quality": 0.02, "cost": 0.04, "risk": 0.06, "replay": -0.02},
    "approval_first": {"quality": 0.03, "cost": 0.02, "risk": -0.07, "replay": 0.05},
}

FOLLOWUP_ROUTE_PROFILES = {
    "tag_only": {"quality": -0.05, "cost": -0.03, "risk": -0.02, "replay": 0.01},
    "hitl_priority_queue": {"quality": 0.05, "cost": 0.01, "risk": -0.05, "replay": 0.05},
    "multi_touch_standard": {"quality": 0.06, "cost": 0.03, "risk": 0.01, "replay": 0.03},
    "phone_followup": {"quality": 0.08, "cost": 0.06, "risk": 0.03, "replay": 0.02},
}


def _confidence_band(structural_risk: float, visual_erm: float, replay_success: float) -> str:
    signal = _clamp((1.0 - structural_risk) * 0.45 + visual_erm * 0.35 + replay_success * 0.20, 0.0, 1.0)
    if signal >= 0.82:
        return "high"
    if signal >= 0.68:
        return "medium"
    if signal >= 0.52:
        return "low"
    return "very_low"


def _contains_any(text: str, words: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in words)


def _candidate_model_routes(text: str, complexity: float) -> list[str]:
    candidates = ["local_balanced", "hybrid_escalation"]
    if complexity < 0.55:
        candidates.insert(0, "local_fast")
    if complexity >= 0.55 or _contains_any(text, ("strategy", "plan", "campaign", "matrix", "workflow")):
        candidates.append("cloud_reasoning")
    return list(dict.fromkeys(candidates))[:4]


def _candidate_retrieval_routes(payload: CampaignGraphInput, complexity: float) -> list[str]:
    candidates = ["tenant_kb_focus", "hybrid_multisource"]
    if payload.competitor_handles:
        candidates.append("deep_competitor")
    if complexity < 0.48:
        candidates.insert(0, "fast_minimal")
    return list(dict.fromkeys(candidates))[:4]


def _candidate_channel_routes(payload: CampaignGraphInput, complexity: float, structural_risk: float) -> list[str]:
    edge_count = max(1, len(payload.edge_targets) or 1)
    candidates = ["single_edge_safe", "phased_multi_edge"]
    if edge_count >= 3:
        candidates.append("parallel_burst")
    if structural_risk > 0.28 or _contains_any(payload.task_description, ("approval", "compliance", "high risk", "review")):
        candidates.append("approval_first")
    if complexity > 0.72 and "parallel_burst" not in candidates:
        candidates.append("parallel_burst")
    return list(dict.fromkeys(candidates))[:4]


def _candidate_followup_routes(payload: CampaignGraphInput, complexity: float) -> list[str]:
    candidates = ["tag_only", "hitl_priority_queue"]
    if complexity >= 0.45:
        candidates.append("multi_touch_standard")
    if _contains_any(payload.task_description, ("phone", "dial", "call", "followup")):
        candidates.append("phone_followup")
    return list(dict.fromkeys(candidates))[:4]


def _branch_penalty_reasons(score_breakdown: dict[str, float], branch: PlannerBranch) -> list[str]:
    reasons: list[str] = []
    if score_breakdown["risk_component"] < 0.18:
        reasons.append("risk pressure kept this branch from winning")
    if score_breakdown["cost_component"] < 0.09:
        reasons.append("cost pressure kept this branch from winning")
    if branch.channel_route == "parallel_burst":
        reasons.append("parallel burst raises complaint and replay risk")
    if branch.model_route == "cloud_reasoning":
        reasons.append("cloud reasoning improved quality but raised cost")
    if branch.retrieval_route == "fast_minimal":
        reasons.append("fast retrieval lowered context quality")
    if branch.followup_route == "phone_followup":
        reasons.append("phone followup improves conversion but increases operational cost")
    return reasons[:3] or ["branch lost to a better balanced candidate"]


def _score_branch(
    *,
    branch_id: str,
    depth: int,
    model_route: str,
    retrieval_route: str,
    channel_route: str,
    followup_route: str,
    base_quality: float,
    base_cost: float,
    base_risk: float,
    base_replay_success: float,
) -> PlannerBranch:
    model_profile = MODEL_ROUTE_PROFILES[model_route]
    retrieval_profile = RETRIEVAL_ROUTE_PROFILES[retrieval_route]
    channel_profile = CHANNEL_ROUTE_PROFILES[channel_route]
    followup_profile = FOLLOWUP_ROUTE_PROFILES[followup_route]

    expected_quality = _clamp(
        base_quality
        + model_profile["quality"]
        + retrieval_profile["quality"]
        + channel_profile["quality"]
        + followup_profile["quality"],
        0.45,
        0.98,
    )
    expected_cost = _clamp(
        base_cost
        + model_profile["cost"]
        + retrieval_profile["cost"]
        + channel_profile["cost"]
        + followup_profile["cost"],
        0.04,
        0.95,
    )
    expected_risk = _clamp(
        base_risk
        + model_profile["risk"]
        + retrieval_profile["risk"]
        + channel_profile["risk"]
        + followup_profile["risk"],
        0.03,
        0.90,
    )
    expected_replay_success = _clamp(
        base_replay_success
        + model_profile["replay"]
        + retrieval_profile["replay"]
        + channel_profile["replay"]
        + followup_profile["replay"],
        0.55,
        0.99,
    )

    normalized_cost = _clamp(expected_cost, 0.0, 1.0)
    score_breakdown = {
        "quality_component": expected_quality * 0.38,
        "replay_component": expected_replay_success * 0.24,
        "risk_component": (1.0 - expected_risk) * 0.23,
        "cost_component": (1.0 - normalized_cost) * 0.15,
    }
    final_score = sum(score_breakdown.values())

    reasons = [
        f"model={model_route}",
        f"retrieval={retrieval_route}",
        f"channel={channel_route}",
        f"followup={followup_route}",
    ]

    return PlannerBranch(
        branch_id=branch_id,
        model_route=model_route,
        retrieval_route=retrieval_route,
        channel_route=channel_route,
        followup_route=followup_route,
        depth=depth,
        expected_quality=expected_quality,
        expected_cost=expected_cost,
        expected_risk=expected_risk,
        expected_replay_success=expected_replay_success,
        final_score=final_score,
        score_breakdown=score_breakdown,
        reasons=reasons,
    )


def _run_tooltree_lite(
    payload: CampaignGraphInput,
    *,
    complexity: float,
    base_quality: float,
    base_cost: float,
    base_risk: float,
    base_replay_success: float,
) -> dict[str, Any]:
    branch_cap = 4
    depth_cap = 3
    time_budget_ms = 300
    started_at = time.perf_counter()

    model_options = _candidate_model_routes(payload.task_description, complexity)
    retrieval_options = _candidate_retrieval_routes(payload, complexity)
    channel_options = _candidate_channel_routes(payload, complexity, base_risk)
    followup_options = _candidate_followup_routes(payload, complexity)

    expanded_nodes = 0
    stage1: list[dict[str, Any]] = []
    for model_route in model_options:
        expanded_nodes += 1
        seed_score = base_quality + MODEL_ROUTE_PROFILES[model_route]["quality"] - MODEL_ROUTE_PROFILES[model_route]["cost"] * 0.2
        stage1.append({"model_route": model_route, "seed_score": round(seed_score, 4)})
    stage1.sort(key=lambda item: item["seed_score"], reverse=True)
    stage1 = stage1[:branch_cap]

    stage2: list[dict[str, Any]] = []
    for partial in stage1:
        for retrieval_route in retrieval_options:
            for channel_route in channel_options:
                expanded_nodes += 1
                partial_score = (
                    partial["seed_score"]
                    + RETRIEVAL_ROUTE_PROFILES[retrieval_route]["quality"]
                    + CHANNEL_ROUTE_PROFILES[channel_route]["quality"]
                    - RETRIEVAL_ROUTE_PROFILES[retrieval_route]["cost"] * 0.2
                    - CHANNEL_ROUTE_PROFILES[channel_route]["risk"] * 0.4
                )
                stage2.append(
                    {
                        "model_route": partial["model_route"],
                        "retrieval_route": retrieval_route,
                        "channel_route": channel_route,
                        "partial_score": round(partial_score, 4),
                    }
                )
    stage2.sort(key=lambda item: item["partial_score"], reverse=True)
    stage2 = stage2[:branch_cap]

    final_candidates: list[PlannerBranch] = []
    for partial in stage2:
        for followup_route in followup_options:
            expanded_nodes += 1
            branch = _score_branch(
                branch_id=f"plan_{len(final_candidates) + 1}",
                depth=depth_cap,
                model_route=partial["model_route"],
                retrieval_route=partial["retrieval_route"],
                channel_route=partial["channel_route"],
                followup_route=followup_route,
                base_quality=base_quality,
                base_cost=base_cost,
                base_risk=base_risk,
                base_replay_success=base_replay_success,
            )
            final_candidates.append(branch)
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            if elapsed_ms >= time_budget_ms:
                break
        if int((time.perf_counter() - started_at) * 1000) >= time_budget_ms:
            break

    final_candidates.sort(key=lambda item: item.final_score, reverse=True)
    final_candidates = final_candidates[:branch_cap]
    selected_branch = final_candidates[0]
    rejected_branches = []
    for branch in final_candidates[1:]:
        branch_dict = branch.as_dict()
        branch_dict["rejection_reason"] = _branch_penalty_reasons(branch.score_breakdown, branch)
        rejected_branches.append(branch_dict)

    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    return {
        "engine": "ToolTree-lite",
        "selected_branch": selected_branch.as_dict(),
        "rejected_branches": rejected_branches,
        "candidate_routes": {
            "model_routes": model_options,
            "retrieval_routes": retrieval_options,
            "channel_routes": channel_options,
            "followup_routes": followup_options,
        },
        "search_stats": {
            "depth_cap": depth_cap,
            "branch_cap": branch_cap,
            "time_budget_ms": time_budget_ms,
            "elapsed_ms": elapsed_ms,
            "within_budget": elapsed_ms <= time_budget_ms,
            "expanded_nodes": expanded_nodes,
            "stage_counts": {
                "model_stage": len(stage1),
                "route_stage": len(stage2),
                "final_stage": len(final_candidates),
            },
        },
    }


def simulate_campaign_graph(payload: CampaignGraphInput) -> dict[str, Any]:
    """
    CampaignGraph simulator with ToolTree-lite planning.
    Goal: verify flow feasibility/risk/cost quickly while exposing branch reasoning.
    """
    normalized_handles = [str(x).strip() for x in payload.competitor_handles if str(x).strip()][:8]
    edge_count = max(1, len(payload.edge_targets) or 1)
    keywords = _extract_keywords(payload.task_description)
    seed = _hash_seed(f"{payload.user_id}|{payload.task_description}|{'|'.join(normalized_handles)}|{edge_count}")

    complexity = _clamp(0.35 + len(keywords) * 0.03 + len(normalized_handles) * 0.04, 0.2, 0.95)
    base_quality = _clamp(0.62 + complexity * 0.12, 0.50, 0.88)
    base_cost = _clamp(0.14 + complexity * 0.14 + edge_count * 0.01, 0.08, 0.55)
    base_risk = _clamp(0.11 + edge_count * 0.01 + len(normalized_handles) * 0.02, 0.06, 0.42)
    base_replay_success = _clamp(0.90 - base_risk * 0.18, 0.72, 0.98)

    planner_state = _run_tooltree_lite(
        payload,
        complexity=complexity,
        base_quality=base_quality,
        base_cost=base_cost,
        base_risk=base_risk,
        base_replay_success=base_replay_success,
    )
    selected_branch = planner_state["selected_branch"]

    action_nodes = [
        ("radar_scan", "Trend scan"),
        ("competitor_decompose", "Competitor decompose"),
        ("rag_ingest", "Knowledge ingest"),
        ("content_factory", "Content package"),
        ("dispatch_edge", "Edge dispatch"),
        ("engagement_followup", "Lead followup"),
    ]

    steps: list[dict[str, Any]] = []
    base_ms = 380
    for idx, (node, title) in enumerate(action_nodes, start=1):
        jitter = ((seed >> (idx * 2)) % 190) - 60
        est_ms = max(120, base_ms + idx * 75 + jitter)
        step_risk = _clamp(0.08 + (idx * 0.02) + ((seed % (idx + 9)) / 200), 0.05, 0.65)
        if node == "rag_ingest":
            est_ms += 40 if selected_branch["retrieval_route"] == "hybrid_multisource" else 0
            est_ms += 75 if selected_branch["retrieval_route"] == "deep_competitor" else 0
        if node == "dispatch_edge":
            est_ms += 65 if selected_branch["channel_route"] == "parallel_burst" else 0
            est_ms += 30 if selected_branch["channel_route"] == "approval_first" else 0
        if node == "engagement_followup":
            est_ms += 55 if selected_branch["followup_route"] == "phone_followup" else 0
        steps.append(
            {
                "step": idx,
                "node": node,
                "title": title,
                "estimated_ms": est_ms,
                "risk_score": round(step_risk, 4),
                "depends_on": [] if idx == 1 else [action_nodes[idx - 2][0]],
                "status": "simulated",
                "planner_route": {
                    "model_route": selected_branch["model_route"],
                    "retrieval_route": selected_branch["retrieval_route"],
                    "channel_route": selected_branch["channel_route"],
                    "followup_route": selected_branch["followup_route"],
                },
            }
        )

    structural_risk = selected_branch["expected_risk"]
    replay_success = selected_branch["expected_replay_success"]
    visual_erm = _clamp(
        selected_branch["expected_quality"] * 0.72 + (1.0 - selected_branch["expected_risk"]) * 0.24,
        0.5,
        0.97,
    )
    conversion_rate = _clamp(
        0.08
        + (1 - structural_risk) * 0.24
        + selected_branch["expected_quality"] * 0.11
        + replay_success * 0.03,
        0.05,
        0.46,
    )
    complaint_rate = _clamp(
        0.015
        + structural_risk * 0.16
        + math.log(edge_count + 1, 10) * 0.02
        + (0.02 if selected_branch["channel_route"] == "parallel_burst" else 0.0)
        - (0.015 if selected_branch["channel_route"] == "approval_first" else 0.0),
        0.01,
        0.24,
    )
    cloud_tokens_m = _clamp(0.05 + selected_branch["expected_cost"] * 0.28, 0.03, 0.42)
    local_gpu_hours = _clamp(
        0.01 + edge_count * 0.002 + (0.03 if selected_branch["channel_route"] == "parallel_burst" else 0.0),
        0.01,
        0.5,
    )
    estimate_cost_cny = round(
        cloud_tokens_m * 0.45 + local_gpu_hours * 0.18 + edge_count * 0.012 + selected_branch["expected_cost"] * 0.4,
        4,
    )

    recommendation = "approve" if structural_risk <= 0.32 and complaint_rate <= 0.09 else "manual_review"
    confidence_band = _confidence_band(structural_risk, visual_erm, replay_success)

    reason_codes: list[str] = []
    warnings: list[str] = []
    if structural_risk > 0.32:
        reason_codes.append("risk.structural_high")
        warnings.append("Structural risk is elevated. Start with a canary rollout.")
    if complaint_rate > 0.09:
        reason_codes.append("risk.complaint_high")
        warnings.append("Complaint risk is elevated. Route this plan through HITL approval.")
    if visual_erm < 0.70:
        reason_codes.append("quality.visual_erm_low")
    if replay_success < 0.80:
        reason_codes.append("stability.replay_low")
    if confidence_band in {"low", "very_low"}:
        reason_codes.append("confidence.band_low")
    if edge_count > 30:
        reason_codes.append("ops.edge_scale_large")
        warnings.append("Edge fleet is large. Prefer staged release by tenant or channel.")

    reason_codes.append(f"planner.model.{selected_branch['model_route']}")
    reason_codes.append(f"planner.retrieval.{selected_branch['retrieval_route']}")
    reason_codes.append(f"planner.channel.{selected_branch['channel_route']}")
    reason_codes.append(f"planner.followup.{selected_branch['followup_route']}")

    publish_allowed = (
        recommendation == "approve"
        and confidence_band in {"high", "medium"}
        and complaint_rate <= 0.09
        and visual_erm >= 0.70
    )
    if not publish_allowed and not warnings:
        warnings.append("Automatic publish threshold not reached. Approval is required.")
    if not reason_codes:
        reason_codes.append("ok.ready_for_publish")

    preview_assets = [
        {
            "asset_type": "video_preview",
            "title": "Simulation video preview",
            "description": "Preview card for approval",
            "url": f"/assets/campaign-preview/{seed % 10000}.mp4",
        },
        {
            "asset_type": "storyboard_snapshot",
            "title": "Storyboard snapshot",
            "description": "Evidence for Visual-ERM review",
            "url": f"/assets/campaign-preview/{seed % 10000}.png",
        },
    ]

    return {
        "simulation_id": f"sim_{seed % 10_000_000}",
        "created_at": _utc_now_iso(),
        "user_id": payload.user_id,
        "task_description": payload.task_description,
        "competitor_handles": normalized_handles,
        "edge_target_count": edge_count,
        "keywords": keywords,
        "selected_routes": {
            "model_route": selected_branch["model_route"],
            "retrieval_route": selected_branch["retrieval_route"],
            "channel_route": selected_branch["channel_route"],
            "followup_route": selected_branch["followup_route"],
        },
        "planner_state": planner_state,
        "graph": {
            "engine": "CampaignGraph-P2-ToolTreeLite",
            "topology": "action_level_dag",
            "steps": steps,
        },
        "scores": {
            "structural_risk": round(structural_risk, 4),
            "pred_conversion_rate": round(conversion_rate, 4),
            "pred_complaint_rate": round(complaint_rate, 4),
            "pred_replay_success_rate": round(replay_success, 4),
            "visual_erm": round(visual_erm, 4),
            "planner_branch_score": round(selected_branch["final_score"], 4),
        },
        "cost_estimate": {
            "cloud_tokens_m": round(cloud_tokens_m, 4),
            "local_gpu_hours": round(local_gpu_hours, 4),
            "estimate_cny": estimate_cost_cny,
        },
        "recommendation": recommendation,
        "publish_allowed": publish_allowed,
        "reason_codes": sorted(set(reason_codes)),
        "confidence_band": confidence_band,
        "warnings": warnings,
        "preview_assets": preview_assets,
    }


def summarize_simulation_for_chat(simulation: dict[str, Any]) -> str:
    scores = simulation.get("scores", {})
    cost = simulation.get("cost_estimate", {})
    routes = simulation.get("selected_routes", {})
    return (
        "Campaign simulation complete\n"
        f"- risk: {scores.get('structural_risk', 0)}\n"
        f"- conversion: {scores.get('pred_conversion_rate', 0)}\n"
        f"- complaint: {scores.get('pred_complaint_rate', 0)}\n"
        f"- visual_erm: {scores.get('visual_erm', 0)}\n"
        f"- planner_score: {scores.get('planner_branch_score', 0)}\n"
        f"- confidence_band: {simulation.get('confidence_band', 'low')}\n"
        f"- auto_publish: {simulation.get('publish_allowed', False)}\n"
        f"- estimate_cny: {cost.get('estimate_cny', 0)}\n"
        f"- routes: model={routes.get('model_route', '-')}, retrieval={routes.get('retrieval_route', '-')}, "
        f"channel={routes.get('channel_route', '-')}, followup={routes.get('followup_route', '-')}\n"
        f"- recommendation: {simulation.get('recommendation', 'manual_review')}"
    )
