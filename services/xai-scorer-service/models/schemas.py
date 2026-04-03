"""
金算虾 XAI 评分 — 业务线索与解释数据模型
从铁网虾（意图捕捉）传入的线索结构，以及输出给 SaaS CRM 前端的可视化解释结构。
"""
from pydantic import BaseModel, Field
from typing import List, Dict, Optional


class LeadFeature(BaseModel):
    """单条线索的特征（评论/私信 + 互动深度 + 人设）"""
    user_id: str = Field(..., description="用户/线索 ID")
    content: str = Field(
        ...,
        description="用户发布的评论或私信原文",
    )
    interaction_depth: int = Field(
        ...,
        ge=1,
        le=10,
        description="互动深度，如观看时长、翻阅主页次数等级 1-10",
    )
    persona_tag: str = Field(
        ...,
        description="人设标签，如 DealHunter, ValueResearcher",
    )


class ScoringResult(BaseModel):
    """金算虾打分结果"""
    lead_id: str = Field(..., description="线索 ID")
    current_score: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="当前线索得分 0-100",
    )
    is_hot_lead: bool = Field(
        ...,
        description="是否达到立刻推送给人工回访的阈值",
    )


class CounterfactualExplanation(BaseModel):
    """反事实解释：差在哪里、补齐什么条件就能成交"""
    original_score: float = Field(..., description="当前得分")
    target_score: float = Field(..., description="目标阈值（如 80 为 Hot Lead）")
    minimal_changes_required: Dict[str, str] = Field(
        ...,
        description="需要改变的特征字典，如 content_keyword / interaction_depth",
    )
    human_readable_explanation: str = Field(
        ...,
        description="输出给业务员的大白话解释",
    )


class AnalyzedLeadResponse(BaseModel):
    """单条线索分析结果：打分 + 可选反事实解释"""
    result: ScoringResult
    explanation: Optional[CounterfactualExplanation] = Field(
        None,
        description="非 Hot 时给出挽回路径解释",
    )
