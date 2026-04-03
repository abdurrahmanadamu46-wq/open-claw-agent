"""
Convert audit events into chart annotations.
"""

from __future__ import annotations

from typing import Any

from chart_annotation import ChartAnnotation


def _infer_annotation_type(audit_log: dict[str, Any]) -> tuple[str, str]:
    event_type = str(audit_log.get("event_type") or "").strip().upper()
    details = audit_log.get("details") if isinstance(audit_log.get("details"), dict) else {}
    if event_type.startswith("LOBSTER_CONFIG_UPDATE"):
        prompt_keys = {"prompt_version", "new_prompt_version", "openclaw/prompt-version"}
        if prompt_keys & set(details.keys()):
            return "prompt_change", "warning"
        return "config_change", "info"
    if event_type in {"PROVIDER_ADD", "PROVIDER_REMOVE", "SYSTEM_CONFIG_UPDATE"}:
        return "deployment", "info"
    if event_type in {"EDGE_REGISTER", "EDGE_RECONNECT"}:
        return "edge_scale", "info"
    if event_type in {"LOBSTER_ENABLE", "LOBSTER_BOOTSTRAP_COMPLETE"}:
        return "lobster_online", "info"
    if event_type in {
        "LOBSTER_EXECUTE_FAILED",
        "WORKFLOW_EXECUTE_FAILED",
        "CHANNEL_POST_FAILED",
        "MCP_TOOL_CALL_FAILED",
        "SUSPICIOUS_ACTIVITY",
        "DLP_TRIGGERED",
    }:
        return "incident", "critical"
    return "config_change", "info"


def audit_log_to_annotation(audit_log: dict[str, Any]) -> ChartAnnotation | None:
    event_type = str(audit_log.get("event_type") or "").strip()
    if not event_type:
        return None

    annotation_type, severity = _infer_annotation_type(audit_log)
    details = audit_log.get("details") if isinstance(audit_log.get("details"), dict) else {}
    resource_name = str(
        details.get("entity_name")
        or details.get("name")
        or audit_log.get("resource_id")
        or event_type
    ).strip()

    label_map = {
        "prompt_change": f"{resource_name} Prompt",
        "config_change": f"{resource_name} 配置",
        "lobster_online": f"{resource_name} 上线",
        "deployment": f"{resource_name} 部署",
        "edge_scale": f"{resource_name} 扩容",
        "incident": resource_name,
    }

    description = str(
        details.get("reason")
        or details.get("message")
        or details.get("summary")
        or event_type
    ).strip()

    lobster_id = None
    if str(audit_log.get("resource_type") or "").strip().lower() == "lobster":
      lobster_id = str(audit_log.get("resource_id") or "").strip() or None

    return ChartAnnotation(
        id=f"ann_{audit_log.get('id')}",
        timestamp=str(audit_log.get("created_at") or ""),
        label=label_map.get(annotation_type, resource_name or event_type),
        description=description,
        annotation_type=annotation_type,  # type: ignore[arg-type]
        severity=severity,  # type: ignore[arg-type]
        lobster_id=lobster_id,
        tenant_id=str(audit_log.get("tenant_id") or "").strip() or None,
        source_audit_log_id=str(audit_log.get("id") or "").strip() or None,
    )


def build_annotations(
    audit_logs: list[dict[str, Any]],
    *,
    lobster_id: str | None = None,
    annotation_types: set[str] | None = None,
) -> list[ChartAnnotation]:
    rows: list[ChartAnnotation] = []
    for item in audit_logs:
        annotation = audit_log_to_annotation(item)
        if annotation is None:
            continue
        if lobster_id and annotation.lobster_id not in {None, lobster_id}:
            continue
        if annotation_types and annotation.annotation_type not in annotation_types:
            continue
        rows.append(annotation)
    return rows
