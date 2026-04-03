from __future__ import annotations

import re
from typing import Any


_SAFE_PART = re.compile(r"[^a-zA-Z0-9_-]+")


def safe_subject_part(value: Any, *, allow_wildcards: bool = False) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "unknown"
    if allow_wildcards and raw in {"*", ">"}:
        return raw
    return _SAFE_PART.sub("_", raw).strip("_").lower() or "unknown"


def format_subject(template: str, **kwargs: Any) -> str:
    safe_kwargs = {key: safe_subject_part(value) for key, value in kwargs.items()}
    return str(template or "").format(**safe_kwargs)


def subject_matches(pattern: str, subject: str) -> bool:
    normalized_pattern = str(pattern or "").strip()
    normalized_subject = str(subject or "").strip()
    if not normalized_pattern or not normalized_subject:
        return False
    if normalized_pattern == normalized_subject:
        return True
    pattern_parts = normalized_pattern.split(".")
    subject_parts = normalized_subject.split(".")
    pi = 0
    si = 0
    while pi < len(pattern_parts) and si < len(subject_parts):
        token = pattern_parts[pi]
        if token == ">":
            return True
        if token != "*" and token != subject_parts[si]:
            return False
        pi += 1
        si += 1
    if pi < len(pattern_parts) and pattern_parts[pi] == ">":
        return True
    return pi == len(pattern_parts) and si == len(subject_parts)


class EventSubjects:
    TASK_EXECUTION_STARTED = "task.{tenant_id}.{workflow_id}.execution.started"
    TASK_EXECUTION_COMPLETED = "task.{tenant_id}.{workflow_id}.execution.completed"
    TASK_EXECUTION_FAILED = "task.{tenant_id}.{workflow_id}.execution.failed"
    TASK_EXECUTION_DUPLICATE = "task.{tenant_id}.{workflow_id}.execution.duplicate"
    TASK_STEP_STARTED = "task.{tenant_id}.{workflow_id}.step.{step_id}.started"
    TASK_STEP_COMPLETED = "task.{tenant_id}.{workflow_id}.step.{step_id}.completed"
    TASK_STEP_FAILED = "task.{tenant_id}.{workflow_id}.step.{step_id}.failed"
    TASK_STEP_SKIPPED = "task.{tenant_id}.{workflow_id}.step.{step_id}.skipped"
    TASK_LOBSTER_COMPLETED = "task.{tenant_id}.{task_id}.lobster.{lobster_id}.completed"
    TASK_ARTIFACT_CREATED = "task.{tenant_id}.{run_id}.artifact.{artifact_type}.created"

    LOBSTER_STATUS_READY = "lobster.{lobster_id}.status.ready"
    LOBSTER_STATUS_BUSY = "lobster.{lobster_id}.status.busy"
    LOBSTER_STATUS_ERROR = "lobster.{lobster_id}.status.error"
    LOBSTER_SKILL_INVOKED = "lobster.{lobster_id}.skill.{skill_name}.invoked"

    EDGE_CONNECTED = "edge.{edge_id}.connection.connected"
    EDGE_DISCONNECTED = "edge.{edge_id}.connection.disconnected"
    EDGE_TASK_ASSIGNED = "edge.{edge_id}.task.assigned"
    EDGE_TASK_COMPLETED = "edge.{edge_id}.task.completed"
    EDGE_HEARTBEAT = "edge.{edge_id}.heartbeat"
    EDGE_CONFIG_BROADCAST = "edge.all.config.broadcast"

    TENANT_QUOTA_EXCEEDED = "tenant.{tenant_id}.quota.exceeded"
    TENANT_CONCURRENCY_LIMIT = "tenant.{tenant_id}.concurrency.limit_reached"
    TENANT_PLAN_UPGRADED = "tenant.{tenant_id}.plan.upgraded"
    TENANT_BILLING_SUBSCRIPTION_UPDATED = "tenant.{tenant_id}.billing.subscription.updated"

    SYSTEM_ALERT_TRIGGERED = "system.alert.triggered"
    SYSTEM_PROVIDER_HEALTH = "system.provider.health_changed"

    @staticmethod
    def format(template: str, **kwargs: Any) -> str:
        return format_subject(template, **kwargs)


class SubjectPatterns:
    ALL_EDGE_EVENTS = "edge.>"
    ALL_TASK_EVENTS = "task.>"
    TENANT_ALL_TASKS = "task.{tenant_id}.>"
    ALL_LOBSTER_STATUS = "lobster.*.status.*"
    ALL_EDGE_CONNECTIONS = "edge.*.connection.*"


def infer_subject(event_type: str, tenant_id: str, payload: dict[str, Any] | None = None) -> str:
    data = payload or {}
    event_key = str(event_type or "").strip()
    tenant = tenant_id or str(data.get("tenant_id") or "unknown")

    if event_key == "lobster.task.completed":
        return EventSubjects.format(
            EventSubjects.TASK_LOBSTER_COMPLETED,
            tenant_id=tenant,
            task_id=data.get("task_id"),
            lobster_id=data.get("lobster_id"),
        )
    if event_key == "artifact.created":
        return EventSubjects.format(
            EventSubjects.TASK_ARTIFACT_CREATED,
            tenant_id=tenant,
            run_id=data.get("run_id"),
            artifact_type=data.get("artifact_type"),
        )
    if event_key == "billing.subscription.updated":
        return EventSubjects.format(
            EventSubjects.TENANT_BILLING_SUBSCRIPTION_UPDATED,
            tenant_id=tenant,
        )
    return safe_subject_part(event_key).replace("_", ".")
