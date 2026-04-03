"""
Natural language analytics query engine inspired by PostHog Max.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from attribution_engine import AttributionModel, get_attribution_engine
from funnel_analyzer import get_funnel_analyzer
from lobster_pool_manager import pool_metrics
from survey_engine import get_survey_engine


@dataclass(slots=True)
class NLQueryPlan:
    query_type: str
    filters: dict[str, Any]
    metrics: list[str]
    group_by: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "query_type": self.query_type,
            "filters": dict(self.filters),
            "metrics": list(self.metrics),
            "group_by": list(self.group_by),
        }


class NLQueryEngine:
    def analyze(self, question: str, tenant_id: str) -> dict[str, Any]:
        normalized = str(question or "").strip()
        lower = normalized.lower()
        plan = self._plan(lower, tenant_id)
        data = self._execute(plan, normalized)
        summary = self._summarize(plan.query_type, data)
        return {"plan": plan.to_dict(), "summary": summary, "data": data}

    def _plan(self, lower: str, tenant_id: str) -> NLQueryPlan:
        if any(token in lower for token in ("归因", "roi", "渠道", "first touch", "last touch")):
            return NLQueryPlan("channel_attribution", {"tenant_id": tenant_id, "model": AttributionModel.U_SHAPE.value}, ["credit"], ["channel", "lobster"])
        if any(token in lower for token in ("漏斗", "转化", "流失", "funnel")):
            return NLQueryPlan("lead_funnel", {"tenant_id": tenant_id}, ["count", "conversion_rate"], ["step"])
        if any(token in lower for token in ("满意", "nps", "调研", "调查", "survey")):
            return NLQueryPlan("survey_results", {"tenant_id": tenant_id}, ["avg_score", "nps"], ["survey"])
        return NLQueryPlan("lobster_stats", {"tenant_id": tenant_id}, ["runs", "cost", "tokens"], ["lobster"])

    def _execute(self, plan: NLQueryPlan, question: str) -> dict[str, Any]:
        tenant_id = str(plan.filters.get("tenant_id") or "tenant_main")
        if plan.query_type == "channel_attribution":
            return get_attribution_engine().attribute(
                tenant_id=tenant_id,
                model=AttributionModel(str(plan.filters.get("model") or AttributionModel.U_SHAPE.value)),
            )
        if plan.query_type == "lead_funnel":
            return get_funnel_analyzer().build_funnel(tenant_id=tenant_id)
        if plan.query_type == "survey_results":
            surveys = get_survey_engine().list_surveys()
            return {
                "items": [get_survey_engine().get_results(str(item["survey_id"]), tenant_id=tenant_id) for item in surveys],
                "survey_count": len(surveys),
            }
        return pool_metrics(tenant_id=tenant_id, range_hours=24 * 7, granularity="day")

    def _summarize(self, query_type: str, data: dict[str, Any]) -> str:
        if query_type == "channel_attribution":
            top = (data.get("channel_rollup") or [{}])[0]
            return f"当前归因贡献最高的渠道是 {top.get('key', '-')}，累计 credit={top.get('credit', 0)}。"
        if query_type == "lead_funnel":
            steps = data.get("steps") or []
            if not steps:
                return "当前没有足够的漏斗数据。"
            worst = min(steps, key=lambda item: float(item.get("conversion_rate", 0)))
            return f"当前漏斗最明显的流失点在 {worst.get('step_name', '-') }，转化率约 {round(float(worst.get('conversion_rate', 0))*100, 1)}%。"
        if query_type == "survey_results":
            items = data.get("items") or []
            if not items:
                return "当前还没有调查数据。"
            top = items[0]
            return f"当前最近调查 {top.get('survey_id', '-') } 已收集 {top.get('response_count', 0)} 份回复。"
        by_lobster = data.get("by_lobster") or []
        if by_lobster:
            top = by_lobster[0]
            return f"最近周期运行最多的龙虾是 {top.get('lobster_id', '-')}，runs={top.get('runs', 0)}。"
        return "当前没有足够的数据生成结论。"


_nl_query_engine: NLQueryEngine | None = None


def get_nl_query_engine() -> NLQueryEngine:
    global _nl_query_engine
    if _nl_query_engine is None:
        _nl_query_engine = NLQueryEngine()
    return _nl_query_engine
