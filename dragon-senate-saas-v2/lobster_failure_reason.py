"""
Precise lobster failure reason classification inspired by ZeroLeaks.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any


class LobsterFailureReason(str, Enum):
    LEAD_NOT_FOUND = "lead_not_found"
    CHANNEL_BLOCKED = "channel_blocked"
    MESSAGE_FILTERED = "message_filtered"
    RATE_LIMITED = "rate_limited"
    LEAD_REJECTED = "lead_rejected"
    TIMEOUT = "timeout"
    LLM_ERROR = "llm_error"
    BOUNDARY_VIOLATION = "boundary_violation"
    PARSE_ERROR = "parse_error"
    KNOWLEDGE_MISSING = "knowledge_missing"
    PERMISSION_DENIED = "permission_denied"
    DEPENDENCY_FAILED = "dependency_failed"
    PENDING_APPROVAL = "pending_approval"
    MAX_ITERATIONS = "max_iterations"
    UNKNOWN = "unknown_failure"


FAILURE_ACTION_MAP: dict[LobsterFailureReason, str] = {
    LobsterFailureReason.LEAD_NOT_FOUND: "archive_lead",
    LobsterFailureReason.CHANNEL_BLOCKED: "switch_channel",
    LobsterFailureReason.MESSAGE_FILTERED: "rewrite_message",
    LobsterFailureReason.RATE_LIMITED: "retry_after_cooldown",
    LobsterFailureReason.LEAD_REJECTED: "mark_lost_update_status",
    LobsterFailureReason.TIMEOUT: "retry_with_simpler_task",
    LobsterFailureReason.LLM_ERROR: "retry_with_fallback_model",
    LobsterFailureReason.BOUNDARY_VIOLATION: "alert_admin_no_retry",
    LobsterFailureReason.PARSE_ERROR: "retry_with_structured_prompt",
    LobsterFailureReason.KNOWLEDGE_MISSING: "request_knowledge_update",
    LobsterFailureReason.PERMISSION_DENIED: "notify_tenant_admin",
    LobsterFailureReason.DEPENDENCY_FAILED: "retry_after_dependency",
    LobsterFailureReason.PENDING_APPROVAL: "wait_for_human_review",
    LobsterFailureReason.MAX_ITERATIONS: "split_task_and_retry",
    LobsterFailureReason.UNKNOWN: "manual_diagnosis",
}


@dataclass(slots=True)
class FailureRecord:
    task_id: str
    lobster_id: str
    reason: LobsterFailureReason
    detail: str
    suggested_action: str
    auto_retried: bool
    occurred_at: str

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["reason"] = self.reason.value
        return payload


def classify_failure(
    *,
    task_id: str,
    lobster_id: str,
    stop_reason: str,
    error: str | None,
    tools_used: list[str] | None = None,
    auto_retried: bool = False,
    occurred_at: str = "",
) -> FailureRecord:
    text = f"{stop_reason or ''} {error or ''}".lower()
    tools = " ".join(tools_used or []).lower()
    reason = LobsterFailureReason.UNKNOWN

    if "not found" in text and "lead" in text:
        reason = LobsterFailureReason.LEAD_NOT_FOUND
    elif "pending_approval" in text or "approval" in text:
        reason = LobsterFailureReason.PENDING_APPROVAL
    elif "timeout" in text or "timed out" in text:
        reason = LobsterFailureReason.TIMEOUT
    elif "rate limit" in text or "429" in text:
        reason = LobsterFailureReason.RATE_LIMITED
    elif "filtered" in text or "dlp" in text or "sensitive" in text:
        reason = LobsterFailureReason.MESSAGE_FILTERED
    elif "permission" in text or "forbidden" in text or "unauthorized" in text:
        reason = LobsterFailureReason.PERMISSION_DENIED
    elif "boundary" in text or "guardrail" in text or "redline" in text or "yellowline" in text:
        reason = LobsterFailureReason.BOUNDARY_VIOLATION
    elif "parse" in text or "jsondecodeerror" in text:
        reason = LobsterFailureReason.PARSE_ERROR
    elif "knowledge" in text and ("missing" in text or "not found" in text):
        reason = LobsterFailureReason.KNOWLEDGE_MISSING
    elif "dependency" in text or "upstream" in text:
        reason = LobsterFailureReason.DEPENDENCY_FAILED
    elif "reject" in text or "不需要" in text or "unsubscribe" in text:
        reason = LobsterFailureReason.LEAD_REJECTED
    elif "max_iterations" in text:
        reason = LobsterFailureReason.MAX_ITERATIONS
    elif "llm" in text or "provider" in text or "model" in text:
        reason = LobsterFailureReason.LLM_ERROR
    elif any(token in tools for token in ("send_message", "wechat", "feishu", "dingtalk", "channel")):
        reason = LobsterFailureReason.CHANNEL_BLOCKED

    return FailureRecord(
        task_id=task_id,
        lobster_id=lobster_id,
        reason=reason,
        detail=str(error or stop_reason or "")[:500],
        suggested_action=FAILURE_ACTION_MAP[reason],
        auto_retried=bool(auto_retried),
        occurred_at=occurred_at,
    )
