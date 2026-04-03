"""
金算虾 XAI 评分 — FastAPI 服务总入口
线索打分 + 反事实解释，供 SaaS CRM 与超级海港 Dashboard 调用。
"""
from fastapi import FastAPI

from models.schemas import LeadFeature, AnalyzedLeadResponse, ScoringResult
from core.lead_scorer import LeadScorer
from core.cf_explainer import CounterfactualExplainer

app = FastAPI(
    title="Lobster XAI Scorer (金算虾引擎)",
    description="线索评分 + 反事实解释：差在哪里、补齐什么条件就能成交。",
)

scorer = LeadScorer()
explainer = CounterfactualExplainer(scorer=scorer)


@app.post("/api/v1/scoring/analyze-lead", response_model=AnalyzedLeadResponse)
async def analyze_and_explain_lead(feature: LeadFeature):
    """
    SaaS CRM 调用：对收集到的用户评论/私信进行打分，并生成 XAI 解释。
    非 Hot 线索会附带「挽回路径」解释，便于业务员与回声虾策略联动。
    """
    score = scorer.calculate_score(feature)
    is_hot = score >= 80.0

    result = ScoringResult(
        lead_id=feature.user_id,
        current_score=score,
        is_hot_lead=is_hot,
    )

    explanation = None
    if not is_hot:
        explanation = explainer.generate_explanation(feature, score)

    return AnalyzedLeadResponse(result=result, explanation=explanation)


if __name__ == "__main__":
    import os
    import uvicorn
    host = os.environ.get("XAI_HOST", "0.0.0.0")
    port = int(os.environ.get("XAI_PORT", "8040"))
    uvicorn.run(app, host=host, port=port)
