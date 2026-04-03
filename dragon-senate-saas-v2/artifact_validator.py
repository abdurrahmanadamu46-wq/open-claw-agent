from __future__ import annotations

from typing import Any

STATUS_ENUM = {"draft", "review", "approved", "rejected", "final", "expired"}
RISK_LEVEL_ENUM = {"L0", "L1", "L2", "L3"}
ARTIFACT_TYPE_ENUM = {
    "MissionPlan",
    "SignalBrief",
    "StrategyRoute",
    "CopyPack",
    "StoryboardPack",
    "ExecutionPlan",
    "LeadAssessment",
    "ValueScoreCard",
    "FollowUpActionPlan",
}
SOURCE_TYPE_ENUM = {
    "internal_report",
    "crm",
    "conversation",
    "external_scan",
    "playbook",
    "manual_input",
}


def _ensure(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(reason)


def make_artifact_envelope(
    *,
    artifact_type: str,
    artifact_id: str,
    mission_id: str,
    tenant_id: str,
    workspace_id: str,
    role_id: str,
    run_id: str,
    step_id: str,
    status: str,
    goal: str,
    assumptions: list[str],
    evidence: list[dict[str, Any]],
    confidence: float,
    risk_level: str,
    dependencies: list[str],
    success_criteria: list[str],
    fallback_plan: str,
    next_action: str,
    payload: dict[str, Any],
    owner_role: str | None = None,
) -> dict[str, Any]:
    envelope = {
        "schema_version": "lobsterpool.artifact.v0.1",
        "artifact_type": artifact_type,
        "artifact_id": artifact_id,
        "mission_id": mission_id,
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "produced_by": {
            "role_id": role_id,
            "run_id": run_id,
            "step_id": step_id,
        },
        "produced_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "status": status,
        "goal": goal,
        "assumptions": assumptions,
        "evidence": evidence,
        "confidence": confidence,
        "risk_level": risk_level,
        "dependencies": dependencies,
        "success_criteria": success_criteria,
        "fallback_plan": fallback_plan,
        "next_action": next_action,
        "owner_role": owner_role or role_id,
        "payload": payload,
    }
    return validate_artifact(envelope)


def validate_artifact_envelope(envelope: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(envelope, dict), "artifact envelope must be an object")
    _ensure(str(envelope.get("schema_version") or "") == "lobsterpool.artifact.v0.1", "schema_version invalid")
    artifact_type = str(envelope.get("artifact_type") or "").strip()
    _ensure(artifact_type in ARTIFACT_TYPE_ENUM, "artifact_type invalid")
    _ensure(str(envelope.get("artifact_id") or "").strip() != "", "artifact_id required")
    _ensure(str(envelope.get("mission_id") or "").strip() != "", "mission_id required")
    _ensure(str(envelope.get("tenant_id") or "").strip() != "", "tenant_id required")
    _ensure(str(envelope.get("workspace_id") or "").strip() != "", "workspace_id required")
    produced_by = envelope.get("produced_by", {})
    _ensure(isinstance(produced_by, dict), "produced_by required")
    _ensure(str(produced_by.get("role_id") or "").strip() != "", "produced_by.role_id required")
    _ensure(str(produced_by.get("run_id") or "").strip() != "", "produced_by.run_id required")
    _ensure(str(produced_by.get("step_id") or "").strip() != "", "produced_by.step_id required")
    _ensure(str(envelope.get("status") or "").strip() in STATUS_ENUM, "status invalid")
    _ensure(str(envelope.get("goal") or "").strip() != "", "goal required")
    _ensure(isinstance(envelope.get("assumptions", []), list), "assumptions required")
    evidence = envelope.get("evidence", [])
    _ensure(isinstance(evidence, list), "evidence must be array")
    if artifact_type != "MissionPlan":
        _ensure(len(evidence) > 0, "evidence required")
    for item in evidence:
        _ensure(isinstance(item, dict), "evidence items must be objects")
        source_type = str(item.get("source_type") or "").strip()
        _ensure(source_type in SOURCE_TYPE_ENUM, "evidence.source_type invalid")
        _ensure(str(item.get("source_ref") or "").strip() != "", "evidence.source_ref required")
        _ensure(str(item.get("summary") or "").strip() != "", "evidence.summary required")
    confidence = envelope.get("confidence")
    _ensure(isinstance(confidence, (int, float)) and 0 <= float(confidence) <= 1, "confidence must be in 0..1")
    _ensure(str(envelope.get("risk_level") or "").strip() in RISK_LEVEL_ENUM, "risk_level invalid")
    _ensure(isinstance(envelope.get("dependencies", []), list), "dependencies required")
    _ensure(isinstance(envelope.get("success_criteria", []), list), "success_criteria required")
    _ensure(str(envelope.get("fallback_plan") or "").strip() != "", "fallback_plan required")
    _ensure(str(envelope.get("next_action") or "").strip() != "", "next_action required")
    _ensure(isinstance(envelope.get("payload", {}), dict), "payload required")
    return envelope


def validate_artifact(envelope: dict[str, Any]) -> dict[str, Any]:
    validate_artifact_envelope(envelope)
    artifact_type = str(envelope.get("artifact_type") or "")
    payload = envelope.get("payload", {})
    if artifact_type == "MissionPlan":
        validate_mission_plan(payload)
    elif artifact_type == "SignalBrief":
        validate_signal_brief(payload)
    elif artifact_type == "StrategyRoute":
        validate_strategy_route(payload)
    elif artifact_type == "CopyPack":
        validate_copy_pack(payload)
    elif artifact_type == "StoryboardPack":
        validate_storyboard_pack(payload)
    elif artifact_type == "ExecutionPlan":
        validate_execution_plan(payload)
    elif artifact_type == "LeadAssessment":
        validate_lead_assessment(payload)
    elif artifact_type == "ValueScoreCard":
        validate_value_score_card(payload)
    elif artifact_type == "FollowUpActionPlan":
        validate_followup_action_plan(payload)
    return envelope


def validate_mission_plan(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "mission_plan must be an object")
    _ensure(str(payload.get("mission_type") or "").strip() != "", "mission_type required")
    _ensure(str(payload.get("objective") or "").strip() != "", "objective required")
    lineup = payload.get("selected_lineup", [])
    _ensure(isinstance(lineup, list) and len(lineup) > 0, "selected_lineup required")
    budget_plan = payload.get("budget_plan", {})
    _ensure(isinstance(budget_plan, dict), "budget_plan required")
    _ensure("token_budget" in budget_plan, "budget_plan.token_budget required")
    _ensure("tool_budget" in budget_plan, "budget_plan.tool_budget required")
    _ensure("latency_budget_sec" in budget_plan, "budget_plan.latency_budget_sec required")
    risk_gate_plan = payload.get("risk_gate_plan", {})
    _ensure(isinstance(risk_gate_plan, dict), "risk_gate_plan required")
    _ensure(isinstance(risk_gate_plan.get("approval_required_for", []), list), "risk_gate_plan.approval_required_for required")
    _ensure(str(risk_gate_plan.get("max_risk_level_without_approval") or "") in {"L0", "L1", "L2", "L3"}, "risk_gate_plan.max_risk_level_without_approval invalid")
    stop_loss_rule = payload.get("stop_loss_rule", {})
    _ensure(isinstance(stop_loss_rule, dict), "stop_loss_rule required")
    _ensure("max_retry" in stop_loss_rule, "stop_loss_rule.max_retry required")
    _ensure("max_budget_overrun_ratio" in stop_loss_rule, "stop_loss_rule.max_budget_overrun_ratio required")
    _ensure("kill_on_repeated_failure" in stop_loss_rule, "stop_loss_rule.kill_on_repeated_failure required")
    return payload


def validate_execution_plan(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "execution_plan must be an object")
    _ensure(str(payload.get("execution_goal") or "").strip() != "", "execution_goal required")
    task_graph = payload.get("task_graph", [])
    _ensure(isinstance(task_graph, list) and len(task_graph) > 0, "task_graph required")
    _ensure(isinstance(payload.get("retry_policy", {}), dict), "retry_policy required")
    _ensure(isinstance(payload.get("fallback_plan", {}), dict), "fallback_plan required")
    _ensure(isinstance(payload.get("approval_checkpoints", []), list), "approval_checkpoints required")
    trace = payload.get("trace", {})
    _ensure(isinstance(trace, dict), "trace required")
    _ensure(str(trace.get("trace_id") or "").strip() != "", "trace.trace_id required")
    _ensure(str(trace.get("idempotency_key") or "").strip() != "", "trace.idempotency_key required")
    return payload


def validate_lead_assessment(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "lead_assessment must be an object")
    _ensure(str(payload.get("lead_id") or "").strip() != "", "lead_id required")
    _ensure(str(payload.get("source_channel") or "").strip() != "", "source_channel required")
    for key in ["intent_score", "fit_score", "risk_score"]:
        value = payload.get(key)
        _ensure(isinstance(value, (int, float)), f"{key} required")
        _ensure(0 <= float(value) <= 1, f"{key} must be in 0..1")
    _ensure(str(payload.get("lead_tier") or "").strip() != "", "lead_tier required")
    _ensure(isinstance(payload.get("reason_codes", []), list) and len(payload.get("reason_codes", [])) > 0, "reason_codes required")
    return payload


def validate_strategy_route(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "strategy_route must be an object")
    _ensure(isinstance(payload.get("primary_route", {}), dict), "primary_route required")
    _ensure(isinstance(payload.get("priority_order", []), list) and len(payload.get("priority_order", [])) > 0, "priority_order required")
    _ensure(isinstance(payload.get("resource_estimate", {}), dict), "resource_estimate required")
    _ensure(isinstance(payload.get("risk_tradeoff", {}), dict), "risk_tradeoff required")
    return payload


def validate_copy_pack(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "copy_pack must be an object")
    _ensure(str(payload.get("copy_goal") or "").strip() != "", "copy_goal required")
    _ensure(str(payload.get("core_message") or "").strip() != "", "core_message required")
    _ensure(isinstance(payload.get("hooks", []), list) and len(payload.get("hooks", [])) > 0, "hooks required")
    _ensure(isinstance(payload.get("script_body", []), list) and len(payload.get("script_body", [])) > 0, "script_body required")
    _ensure(isinstance(payload.get("cta", []), list) and len(payload.get("cta", [])) > 0, "cta required")
    _ensure(isinstance(payload.get("risk_phrases", []), list) and len(payload.get("risk_phrases", [])) > 0, "risk_phrases required")
    return payload


def validate_storyboard_pack(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "storyboard_pack must be an object")
    _ensure(str(payload.get("visual_goal") or "").strip() != "", "visual_goal required")
    _ensure(isinstance(payload.get("cover_direction", {}), dict), "cover_direction required")
    _ensure(isinstance(payload.get("shot_list", []), list) and len(payload.get("shot_list", [])) > 0, "shot_list required")
    _ensure(isinstance(payload.get("asset_dependencies", []), list) and len(payload.get("asset_dependencies", [])) > 0, "asset_dependencies required")
    score = payload.get("execution_feasibility_score")
    _ensure(isinstance(score, (int, float)), "execution_feasibility_score required")
    _ensure(0 <= float(score) <= 1, "execution_feasibility_score must be in 0..1")
    return payload


def validate_value_score_card(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "value_score_card must be an object")
    _ensure(str(payload.get("subject_type") or "").strip() != "", "subject_type required")
    _ensure(str(payload.get("subject_id") or "").strip() != "", "subject_id required")
    for key in ["short_term_score", "long_term_score"]:
        value = payload.get(key)
        _ensure(isinstance(value, (int, float)), f"{key} required")
        _ensure(0 <= float(value) <= 1, f"{key} must be in 0..1")
    _ensure(isinstance(payload.get("roi_estimate", {}), dict), "roi_estimate required")
    _ensure(isinstance(payload.get("reward_signal", {}), dict), "reward_signal required")
    return payload


def validate_followup_action_plan(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "followup_action_plan must be an object")
    _ensure(str(payload.get("lead_id") or "").strip() != "", "lead_id required")
    _ensure(str(payload.get("followup_stage") or "").strip() != "", "followup_stage required")
    _ensure(isinstance(payload.get("contact_plan", []), list) and len(payload.get("contact_plan", [])) > 0, "contact_plan required")
    _ensure(isinstance(payload.get("cadence_rule", {}), dict), "cadence_rule required")
    _ensure(isinstance(payload.get("approval_requirements", []), list), "approval_requirements required")
    _ensure(isinstance(payload.get("success_signal", []), list) and len(payload.get("success_signal", [])) > 0, "success_signal required")
    return payload


def validate_signal_brief(payload: dict[str, Any]) -> dict[str, Any]:
    _ensure(isinstance(payload, dict), "signal_brief must be an object")
    _ensure(str(payload.get("scan_scope") or "").strip() != "", "scan_scope required")
    _ensure(str(payload.get("time_window") or "").strip() != "", "time_window required")
    top_signals = payload.get("top_signals", [])
    _ensure(isinstance(top_signals, list) and len(top_signals) > 0, "top_signals required")
    for item in top_signals:
        _ensure(isinstance(item, dict), "top_signals items must be objects")
        _ensure(str(item.get("signal_id") or "").strip() != "", "signal_id required")
        reliability = item.get("source_reliability")
        _ensure(isinstance(reliability, (int, float)), "source_reliability required")
        _ensure(0 <= float(reliability) <= 1, "source_reliability must be in 0..1")
    _ensure(str(payload.get("recommended_attention_level") or "").strip() != "", "recommended_attention_level required")
    return payload
