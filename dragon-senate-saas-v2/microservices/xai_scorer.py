"""
xai_scorer.py — 可解释性评分微服务 (port 8040)

XAI = eXplainable AI Scoring
对龙虾决策（abacus ROI 分、strategy 推荐、catcher 意向判断）
提供可解释的评分证明，供客户审计和前端展示。
"""
from __future__ import annotations

import os
import time
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="XAIScorer", version="1.0.0")

DRAGON_SENATE_URL = os.getenv("DRAGON_SENATE_URL", "http://app:8000")


class ScoreExplainRequest(BaseModel):
    artifact_type: str  # lead_assessment | value_score_card | strategy | content
    artifact_id: str = ""
    artifact_data: dict[str, Any] = {}
    tenant_id: str = ""
    audience: str = "customer"  # customer | internal | audit


class ScoreExplanation(BaseModel):
    artifact_type: str
    artifact_id: str
    score: float
    grade: str
    explanation: str
    contributing_factors: list[dict[str, Any]] = []
    confidence: float = 0.8
    explained_at: float = 0.0


def _explain_lead(data: dict[str, Any]) -> ScoreExplanation:
    """对 LeadAssessment 生成可解释说明。"""
    intent = str(data.get("intent") or "cold")
    risk = str(data.get("risk") or "low")
    budget_signal = bool(data.get("budget_signal"))
    score = float(data.get("score") or 0.0)
    grade = str(data.get("grade") or "C")

    factors = [
        {"factor": "意向等级", "value": intent, "weight": 0.5,
         "contribution": {"hot": 0.9, "warm": 0.65, "cold": 0.3}.get(intent, 0.3)},
        {"factor": "风险水平", "value": risk, "weight": 0.3,
         "contribution": {"low": 0.0, "medium": -0.08, "high": -0.2}.get(risk, 0.0)},
        {"factor": "预算信号", "value": str(budget_signal), "weight": 0.2,
         "contribution": 0.06 if budget_signal else 0.0},
    ]

    explanation = (
        f"该线索意向等级为【{intent}】"
        f"，风险水平为【{risk}】"
        f"{'，并包含预算信号' if budget_signal else ''}"
        f"，综合评分 {score:.2f}（等级 {grade}）。"
    )

    return ScoreExplanation(
        artifact_type="lead_assessment",
        artifact_id=str(data.get("lead_id") or ""),
        score=score,
        grade=grade,
        explanation=explanation,
        contributing_factors=factors,
        confidence=0.85,
        explained_at=time.time(),
    )


def _explain_value_score_card(data: dict[str, Any]) -> ScoreExplanation:
    """对 ValueScoreCard 生成可解释说明。"""
    avg_score = float(data.get("avg_score") or 0.0)
    roi = float(data.get("avg_roi_estimate") or 0.0)
    grade_dist = data.get("grade_distribution") or {}
    total = int(data.get("total") or 0)
    grade_a = int(grade_dist.get("A") or 0)

    grade = "A" if avg_score >= 0.80 else ("B" if avg_score >= 0.55 else "C")
    explanation = (
        f"本次活动共处理 {total} 条线索，"
        f"A级线索 {grade_a} 条，平均评分 {avg_score:.2f}，"
        f"预期 ROI {roi:.1f}x。"
    )

    factors = [
        {"factor": "A级线索占比", "value": f"{grade_a}/{total}", "weight": 0.4,
         "contribution": grade_a / max(total, 1)},
        {"factor": "平均评分", "value": f"{avg_score:.2f}", "weight": 0.4,
         "contribution": avg_score},
        {"factor": "ROI预估", "value": f"{roi:.1f}x", "weight": 0.2,
         "contribution": min(roi / 5.0, 1.0)},
    ]

    return ScoreExplanation(
        artifact_type="value_score_card",
        artifact_id=str(data.get("campaign_id") or ""),
        score=avg_score,
        grade=grade,
        explanation=explanation,
        contributing_factors=factors,
        confidence=0.75,
        explained_at=time.time(),
    )


@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": "xai-scorer"}


@app.post("/xai/explain", response_model=ScoreExplanation)
async def explain_score(req: ScoreExplainRequest) -> ScoreExplanation:
    """对指定 artifact 生成可解释评分报告。"""
    if req.artifact_type == "lead_assessment":
        return _explain_lead(req.artifact_data)
    if req.artifact_type == "value_score_card":
        return _explain_value_score_card(req.artifact_data)

    # 通用兜底
    score = float(req.artifact_data.get("score") or 0.5)
    return ScoreExplanation(
        artifact_type=req.artifact_type,
        artifact_id=req.artifact_id,
        score=score,
        grade="B",
        explanation=f"{req.artifact_type} 评分 {score:.2f}，暂无详细解释。",
        contributing_factors=[],
        confidence=0.5,
        explained_at=time.time(),
    )


@app.post("/xai/batch-explain")
async def batch_explain(items: list[ScoreExplainRequest]) -> dict[str, Any]:
    results = []
    for item in items[:100]:
        r = await explain_score(item)
        results.append(r.model_dump())
    return {"ok": True, "total": len(results), "explanations": results}
