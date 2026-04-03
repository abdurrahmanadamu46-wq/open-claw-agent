"""
Structured log enrich pipeline before persistence.
"""

from __future__ import annotations

import os
import time
from typing import Any


STANDARD_LOG_FIELDS = {
    "tenant_id",
    "lobster_name",
    "session_id",
    "node_id",
    "timestamp",
    "level",
}

HIGH_COST_TOOLS = {"image_generate", "voice_synthesize", "edge_browser_screenshot"}
SLOW_THRESHOLD_MS = 5000
HIGH_COST_USD = 0.05


class LogEnrichPipeline:
    def __init__(self, env: str = "production", debug_filter: bool = True) -> None:
        self.env = env
        self.debug_filter = debug_filter

    def enrich(self, record: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any] | None:
        ctx = dict(context or {})
        enriched = dict(record)
        enriched = self._inject_standard_fields(enriched, ctx)
        enriched = self._compute_derived_fields(enriched)
        enriched = self._sanitize(enriched)
        if self.debug_filter and self.env == "production" and str(enriched.get("level") or "").lower() == "debug":
            return None
        return enriched

    def _inject_standard_fields(self, record: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
        if not record.get("tenant_id"):
            record["tenant_id"] = str(ctx.get("tenant_id") or "tenant_main")
        if not record.get("lobster_name"):
            record["lobster_name"] = str(
                ctx.get("lobster_name") or ctx.get("lobster") or ctx.get("role_id") or ""
            ).strip()
        if not record.get("session_id"):
            record["session_id"] = str(ctx.get("session_id") or ctx.get("peer_id") or "").strip()
        if not record.get("node_id"):
            record["node_id"] = str(
                ctx.get("node_id") or ctx.get("edge_node_id") or ctx.get("nodeId") or ""
            ).strip()
        if not record.get("timestamp"):
            record["timestamp"] = float(time.time())
        if not record.get("level"):
            record["level"] = "info"
        return record

    def _compute_derived_fields(self, record: dict[str, Any]) -> dict[str, Any]:
        latency_ms = int(record.get("latency_ms") or 0)
        status = str(record.get("status") or "").lower()
        tool_name = str(record.get("tool_name") or "").strip()
        cost_usd = float(record.get("cost_usd") or 0.0)
        record["is_slow"] = latency_ms > SLOW_THRESHOLD_MS
        record["is_error"] = status in {"error", "failed", "timeout", "denied"}
        record["is_high_cost"] = cost_usd > HIGH_COST_USD or tool_name in HIGH_COST_TOOLS
        return record

    def _sanitize(self, record: dict[str, Any]) -> dict[str, Any]:
        for sensitive in ("api_key", "secret", "authorization", "token"):
            record.pop(sensitive, None)
        if "prompt" in record and len(str(record["prompt"])) > 500:
            record["prompt"] = str(record["prompt"])[:500] + "...[truncated]"
        if "input_text" in record and len(str(record["input_text"])) > 1000:
            record["input_text"] = str(record["input_text"])[:1000] + "...[truncated]"
        if "output_text" in record and len(str(record["output_text"])) > 1000:
            record["output_text"] = str(record["output_text"])[:1000] + "...[truncated]"
        return record


log_enrich_pipeline = LogEnrichPipeline(
    env=str(os.getenv("APP_ENV", "production") or "production").strip().lower() or "production"
)
