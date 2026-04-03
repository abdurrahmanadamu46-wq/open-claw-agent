"""
Chart annotation model for observability charts.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

AnnotationType = Literal[
    "prompt_change",
    "config_change",
    "lobster_online",
    "deployment",
    "edge_scale",
    "incident",
]

SeverityType = Literal["info", "warning", "critical"]


ANNOTATION_COLORS: dict[str, str] = {
    "prompt_change": "#6366f1",
    "config_change": "#f59e0b",
    "lobster_online": "#10b981",
    "deployment": "#3b82f6",
    "edge_scale": "#06b6d4",
    "incident": "#ef4444",
}


@dataclass(slots=True)
class ChartAnnotation:
    id: str
    timestamp: str
    label: str
    description: str
    annotation_type: AnnotationType
    severity: SeverityType = "info"
    lobster_id: str | None = None
    tenant_id: str | None = None
    source_audit_log_id: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        payload = asdict(self)
        payload["color"] = ANNOTATION_COLORS.get(self.annotation_type, "#888888")
        return payload
