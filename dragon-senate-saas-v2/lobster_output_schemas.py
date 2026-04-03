from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class OutputQuality(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ToolInvocation(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    arguments: dict = Field(default_factory=dict)


class RoutePlan(BaseModel):
    route: Literal["answer", "tool", "delegate", "blocked"] = "answer"
    reasoning: str = Field(max_length=500)
    final_answer: str | None = Field(default=None, max_length=4000)
    tool_calls: list[ToolInvocation] = Field(default_factory=list, max_length=8)
    next_role: str | None = Field(default=None, max_length=40)
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)


class MarketSignal(BaseModel):
    title: str = Field(max_length=120)
    insight: str = Field(max_length=300)
    urgency: Literal["low", "medium", "high"] = "medium"


class RadarReport(BaseModel):
    summary: str = Field(max_length=500)
    signals: list[MarketSignal] = Field(default_factory=list, max_length=10)
    opportunities: list[str] = Field(default_factory=list, max_length=5)
    risks: list[str] = Field(default_factory=list, max_length=5)


class StrategyPlan(BaseModel):
    campaign_theme: str = Field(max_length=100)
    target_audience: str = Field(max_length=200)
    key_messages: list[str] = Field(default_factory=list, max_length=5)
    content_mix: dict = Field(default_factory=lambda: {"video": 60, "image_post": 30, "text": 10})
    kpi_targets: dict = Field(default_factory=dict)
    risk_factors: list[str] | None = Field(default=None, max_length=5)


class ContentPiece(BaseModel):
    content_type: Literal["video_script", "image_caption", "comment_reply", "dm_message"]
    title: str | None = Field(default=None, max_length=80)
    body: str = Field(max_length=3000)
    hashtags: list[str] = Field(default_factory=list, max_length=12)
    cta: str | None = Field(default=None, max_length=80)
    tone: Literal["professional", "casual", "emotional", "humorous"] = "casual"


class CopyPack(BaseModel):
    pieces: list[ContentPiece] = Field(default_factory=list, min_length=1, max_length=20)
    brand_voice_compliance: float = Field(ge=0.0, le=1.0, default=0.8)
    quality: OutputQuality = OutputQuality.HIGH
    revision_notes: str | None = Field(default=None, max_length=500)


class VisualBrief(BaseModel):
    video_concept: str | None = Field(default=None, max_length=500)
    image_prompts: list[str] = Field(default_factory=list, max_length=10)
    cover_style: str | None = Field(default=None, max_length=200)
    color_palette: list[str] = Field(default_factory=list, max_length=5)
    reference_urls: list[str] | None = Field(default=None, max_length=5)


class ExecutionPlan(BaseModel):
    platform: Literal["xiaohongshu", "douyin", "weixin_video", "weixin_gzh"]
    content_type: Literal["video", "image_post", "text_post"]
    publish_time: str = Field(description="ISO8601 publish time")
    steps: list[str] = Field(default_factory=list, min_length=1, max_length=20)
    media_asset_ids: list[str] = Field(default_factory=list, min_length=1, max_length=10)
    fallback_action: Literal["retry", "skip", "notify"] = "retry"
    priority: int = Field(ge=1, le=10, default=5)


class InteractionResponse(BaseModel):
    target_id: str = Field(max_length=100)
    reply_text: str = Field(max_length=1000)
    sentiment: Literal["positive", "neutral", "negative"] = "neutral"
    escalation_needed: bool = False


class LeadCandidate(BaseModel):
    lead_id: str = Field(max_length=100)
    score: float = Field(ge=0.0, le=100.0)
    reason: str = Field(max_length=300)
    next_action: str = Field(max_length=120)


class LeadBatch(BaseModel):
    leads: list[LeadCandidate] = Field(default_factory=list, max_length=20)
    summary: str = Field(max_length=500)


class FinancialBreakdown(BaseModel):
    roi: float = Field(default=0.0)
    estimated_gmv: float = Field(default=0.0)
    estimated_cost: float = Field(default=0.0)
    recommended_budget: float = Field(default=0.0)
    assumptions: list[str] = Field(default_factory=list, max_length=10)


class FollowupAction(BaseModel):
    channel: Literal["dm", "wechat", "email", "phone"] = "dm"
    message: str = Field(max_length=1000)
    wait_hours: int = Field(ge=0, le=168, default=24)


class FollowupPlan(BaseModel):
    lead_id: str = Field(max_length=100)
    actions: list[FollowupAction] = Field(default_factory=list, min_length=1, max_length=10)
    goal: str = Field(max_length=200)


LOBSTER_OUTPUT_SCHEMAS: dict[str, type[BaseModel]] = {
    "commander": RoutePlan,
    "radar": RadarReport,
    "strategist": StrategyPlan,
    "inkwriter": CopyPack,
    "visualizer": VisualBrief,
    "dispatcher": ExecutionPlan,
    "echoer": InteractionResponse,
    "catcher": LeadBatch,
    "abacus": FinancialBreakdown,
    "followup": FollowupPlan,
}


def get_output_schema_for_lobster(lobster_id: str) -> type[BaseModel] | None:
    return LOBSTER_OUTPUT_SCHEMAS.get(str(lobster_id or "").strip())
