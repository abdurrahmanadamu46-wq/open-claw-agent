"""
MCP tool monitoring and in-memory dashboard stats.
"""

from __future__ import annotations

import time
from collections import defaultdict
from collections import deque
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from typing import Any


@dataclass(slots=True)
class ToolCallRecord:
    lobster_name: str
    tool_name: str
    tenant_id: str
    server_id: str = ""
    success: bool = True
    latency_ms: int = 0
    error: str | None = None
    denied: bool = False
    params_hash: str = ""
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class McpToolMonitor:
    WINDOW_SIZE = 2000

    def __init__(self) -> None:
        self._records: deque[ToolCallRecord] = deque(maxlen=self.WINDOW_SIZE)
        self._stats: dict[str, dict[str, Any]] = defaultdict(
            lambda: {
                "total": 0,
                "success": 0,
                "failed": 0,
                "denied": 0,
                "latencies": deque(maxlen=200),
            }
        )
        self._pending: dict[str, dict[str, Any]] = {}

    def start_call(self, lobster_name: str, tool_name: str, tenant_id: str, server_id: str = "") -> str:
        token = f"mcpmon_{time.time_ns()}"
        self._pending[token] = {
            "lobster_name": lobster_name,
            "tool_name": tool_name,
            "tenant_id": tenant_id,
            "server_id": server_id,
            "start_time": time.time(),
        }
        return token

    def end_call(self, token: str, *, success: bool = True, error: str | None = None, params_hash: str = "") -> None:
        ctx = self._pending.pop(token, None)
        if not ctx:
            return
        latency_ms = int((time.time() - float(ctx["start_time"])) * 1000)
        self._append_record(
            ToolCallRecord(
                lobster_name=str(ctx["lobster_name"]),
                tool_name=str(ctx["tool_name"]),
                tenant_id=str(ctx["tenant_id"]),
                server_id=str(ctx.get("server_id") or ""),
                success=success,
                latency_ms=latency_ms,
                error=error,
                params_hash=params_hash,
            )
        )

    def record_denied_call(
        self,
        *,
        lobster_name: str,
        tool_name: str,
        tenant_id: str,
        server_id: str = "",
        reason: str = "",
    ) -> None:
        self._append_record(
            ToolCallRecord(
                lobster_name=lobster_name,
                tool_name=tool_name,
                tenant_id=tenant_id,
                server_id=server_id,
                success=False,
                latency_ms=0,
                error=reason,
                denied=True,
            )
        )

    def _append_record(self, record: ToolCallRecord) -> None:
        self._records.append(record)
        key = f"{record.lobster_name}:{record.tool_name}"
        stat = self._stats[key]
        stat["total"] += 1
        if record.denied:
            stat["denied"] += 1
            stat["failed"] += 1
        elif record.success:
            stat["success"] += 1
        else:
            stat["failed"] += 1
        stat["latencies"].append(int(record.latency_ms))

    def _iter_records(self, tenant_id: str | None = None) -> list[ToolCallRecord]:
        rows = list(self._records)
        if tenant_id:
            rows = [row for row in rows if row.tenant_id == tenant_id]
        return rows

    def get_top_tools(self, limit: int = 10, tenant_id: str | None = None) -> list[dict[str, Any]]:
        counts: dict[str, int] = defaultdict(int)
        for record in self._iter_records(tenant_id):
            counts[record.tool_name] += 1
        return [
            {"tool": tool, "count": count}
            for tool, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
        ]

    def get_lobster_heatmap(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        heat: dict[tuple[str, str], int] = defaultdict(int)
        for record in self._iter_records(tenant_id):
            heat[(record.lobster_name, record.tool_name)] += 1
        return [
            {"lobster": lobster, "tool": tool, "count": count}
            for (lobster, tool), count in sorted(heat.items(), key=lambda item: (-item[1], item[0][0], item[0][1]))
        ]

    def get_failure_rates(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        aggregated: dict[tuple[str, str], dict[str, Any]] = defaultdict(
            lambda: {"total": 0, "failed": 0, "denied": 0, "latencies": []}
        )
        for record in self._iter_records(tenant_id):
            key = (record.lobster_name, record.tool_name)
            row = aggregated[key]
            row["total"] += 1
            if not record.success or record.denied:
                row["failed"] += 1
            if record.denied:
                row["denied"] += 1
            row["latencies"].append(record.latency_ms)
        results = []
        for (lobster, tool), row in aggregated.items():
            total = max(1, int(row["total"]))
            avg_latency = round(sum(row["latencies"]) / max(1, len(row["latencies"])))
            results.append(
                {
                    "lobster": lobster,
                    "tool": tool,
                    "total": row["total"],
                    "failed": row["failed"],
                    "denied": row["denied"],
                    "failure_rate_pct": round((row["failed"] / total) * 100, 1),
                    "avg_latency_ms": avg_latency,
                }
            )
        return sorted(results, key=lambda item: (-item["failure_rate_pct"], -item["total"], item["tool"]))

    def get_recent_calls(self, limit: int = 50, tenant_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._iter_records(tenant_id)[-max(1, limit):]
        return [record.to_dict() for record in reversed(rows)]


_default_monitor: McpToolMonitor | None = None


def get_mcp_tool_monitor() -> McpToolMonitor:
    global _default_monitor
    if _default_monitor is None:
        _default_monitor = McpToolMonitor()
    return _default_monitor
