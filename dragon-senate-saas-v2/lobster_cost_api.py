"""
Per-lobster cost analytics API helpers inspired by Manifest.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from llm_call_logger import get_llm_call_logger


class TimeRange(str, Enum):
    DAY_1 = "1d"
    DAY_7 = "7d"
    DAY_30 = "30d"


LOBSTER_IDS = [
    "commander",
    "radar",
    "strategist",
    "inkwriter",
    "visualizer",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
]


@dataclass(slots=True)
class LobsterCostSummary:
    lobster_id: str
    tenant_id: str
    range: str
    total_cost_usd: float
    total_input_tokens: int
    total_output_tokens: int
    call_count: int
    avg_cost_per_call: float
    max_cost_call_id: str | None
    max_cost_usd: float
    trend_pct: float
    trend_direction: str

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["total_cost_usd"] = round(self.total_cost_usd, 6)
        payload["avg_cost_per_call"] = round(self.avg_cost_per_call, 6)
        payload["max_cost_usd"] = round(self.max_cost_usd, 6)
        payload["trend_pct"] = round(self.trend_pct, 2)
        payload["total_tokens"] = self.total_input_tokens + self.total_output_tokens
        return payload


@dataclass(slots=True)
class CostTimeseriesPoint:
    timestamp: str
    cost_usd: float
    input_tokens: int
    output_tokens: int
    call_count: int

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["cost_usd"] = round(self.cost_usd, 6)
        return payload


@dataclass(slots=True)
class LlmCallRecord:
    call_id: str
    lobster_id: str
    tenant_id: str
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    route_tier: str | None
    latency_ms: int
    created_at: datetime
    status: str

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["cost_usd"] = round(self.cost_usd, 6)
        payload["created_at"] = self.created_at.isoformat()
        return payload


class LobsterCostAnalyzer:
    def __init__(self) -> None:
        self._logger = get_llm_call_logger()

    def _range_to_days(self, range_str: str) -> int:
        return {"1d": 1, "7d": 7, "30d": 30}.get(str(range_str or "7d"), 7)

    def _compute_trend(self, current: float, previous: float) -> tuple[float, str]:
        if previous == 0:
            return (0.0, "flat") if current == 0 else (100.0, "up")
        pct = ((current - previous) / previous) * 100
        direction = "up" if pct > 2 else ("down" if pct < -2 else "flat")
        return pct, direction

    def _fetch_records(
        self,
        tenant_id: str,
        lobster_id: str,
        *,
        since: datetime,
    ) -> list[LlmCallRecord]:
        conn = self._logger._conn()  # noqa: SLF001
        try:
            rows = conn.execute(
                """
                SELECT g.gen_id, g.tenant_id, g.model, g.provider, g.prompt_tokens,
                       g.completion_tokens, g.cost_usd, g.latency_ms, g.created_at,
                       g.status, s.lobster, g.meta
                FROM llm_generations g
                LEFT JOIN llm_spans s ON g.span_id = s.span_id
                WHERE g.tenant_id = ? AND g.created_at >= ? AND COALESCE(s.lobster, '') = ?
                ORDER BY g.created_at DESC
                """,
                (tenant_id, since.isoformat(), lobster_id),
            ).fetchall()
            records: list[LlmCallRecord] = []
            for row in rows:
                meta = {}
                try:
                    meta = json.loads(str(row["meta"] or "{}"))
                except Exception:
                    meta = {}
                created_at = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
                records.append(
                    LlmCallRecord(
                        call_id=str(row["gen_id"]),
                        lobster_id=str(row["lobster"] or lobster_id),
                        tenant_id=str(row["tenant_id"]),
                        model=str(row["model"] or ""),
                        provider=str(row["provider"] or ""),
                        input_tokens=int(row["prompt_tokens"] or 0),
                        output_tokens=int(row["completion_tokens"] or 0),
                        cost_usd=float(row["cost_usd"] or 0.0),
                        route_tier=str(meta.get("route_tier") or meta.get("tier") or "") or None,
                        latency_ms=int(row["latency_ms"] or 0),
                        created_at=created_at,
                        status=str(row["status"] or ""),
                    )
                )
            return records
        finally:
            conn.close()

    def get_lobster_summary(self, tenant_id: str, lobster_id: str, range_str: str = "7d") -> LobsterCostSummary:
        days = self._range_to_days(range_str)
        now = datetime.now(timezone.utc)
        current_since = now - timedelta(days=days)
        previous_since = current_since - timedelta(days=days)
        records = self._fetch_records(tenant_id, lobster_id, since=previous_since)
        current = [r for r in records if r.created_at >= current_since]
        previous = [r for r in records if previous_since <= r.created_at < current_since]

        def _agg(recs: list[LlmCallRecord]) -> dict[str, Any]:
            if not recs:
                return {"cost": 0.0, "in_tok": 0, "out_tok": 0, "count": 0, "max_cost": 0.0, "max_id": None}
            costs = [r.cost_usd for r in recs]
            max_idx = costs.index(max(costs))
            return {
                "cost": sum(costs),
                "in_tok": sum(r.input_tokens for r in recs),
                "out_tok": sum(r.output_tokens for r in recs),
                "count": len(recs),
                "max_cost": max(costs),
                "max_id": recs[max_idx].call_id,
            }

        cur = _agg(current)
        prev = _agg(previous)
        trend_pct, trend_direction = self._compute_trend(cur["cost"], prev["cost"])
        return LobsterCostSummary(
            lobster_id=lobster_id,
            tenant_id=tenant_id,
            range=range_str,
            total_cost_usd=cur["cost"],
            total_input_tokens=cur["in_tok"],
            total_output_tokens=cur["out_tok"],
            call_count=cur["count"],
            avg_cost_per_call=(cur["cost"] / cur["count"]) if cur["count"] else 0.0,
            max_cost_call_id=cur["max_id"],
            max_cost_usd=cur["max_cost"],
            trend_pct=trend_pct,
            trend_direction=trend_direction,
        )

    def get_all_lobsters_summary(self, tenant_id: str, range_str: str = "7d") -> list[dict[str, Any]]:
        rows = [self.get_lobster_summary(tenant_id, lobster_id, range_str).to_dict() for lobster_id in LOBSTER_IDS]
        rows.sort(key=lambda item: float(item["total_cost_usd"]), reverse=True)
        return rows

    def get_timeseries(self, tenant_id: str, lobster_id: str, range_str: str = "7d") -> list[dict[str, Any]]:
        days = self._range_to_days(range_str)
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=days)
        records = self._fetch_records(tenant_id, lobster_id, since=since)
        buckets: dict[str, list[LlmCallRecord]] = {}
        for offset in range(days):
            day = (now - timedelta(days=offset)).strftime("%Y-%m-%d")
            buckets[day] = []
        for row in records:
            day = row.created_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
            if day in buckets:
                buckets[day].append(row)
        result: list[dict[str, Any]] = []
        for day in sorted(buckets.keys()):
            recs = buckets[day]
            point = CostTimeseriesPoint(
                timestamp=day,
                cost_usd=sum(r.cost_usd for r in recs),
                input_tokens=sum(r.input_tokens for r in recs),
                output_tokens=sum(r.output_tokens for r in recs),
                call_count=len(recs),
            )
            result.append(point.to_dict())
        return result

    def get_top_cost_calls(self, tenant_id: str, lobster_id: str, range_str: str = "7d", limit: int = 10) -> list[dict[str, Any]]:
        days = self._range_to_days(range_str)
        since = datetime.now(timezone.utc) - timedelta(days=days)
        rows = self._fetch_records(tenant_id, lobster_id, since=since)
        rows.sort(key=lambda item: item.cost_usd, reverse=True)
        return [row.to_dict() for row in rows[: max(1, int(limit))]]

    def get_tenant_budget_usage(self, tenant_id: str, range_str: str = "30d") -> dict[str, Any]:
        rows = self.get_all_lobsters_summary(tenant_id, range_str)
        total_cost = sum(float(item["total_cost_usd"]) for item in rows)
        return {
            "tenant_id": tenant_id,
            "range": range_str,
            "total_cost_usd": round(total_cost, 6),
            "lobster_count": len(rows),
            "top_lobster": rows[0]["lobster_id"] if rows else None,
        }


_analyzer: LobsterCostAnalyzer | None = None


def get_lobster_cost_analyzer() -> LobsterCostAnalyzer:
    global _analyzer
    if _analyzer is None:
        _analyzer = LobsterCostAnalyzer()
    return _analyzer
