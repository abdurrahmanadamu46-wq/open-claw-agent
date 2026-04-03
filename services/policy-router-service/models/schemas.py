"""
策略张量与上下文路由器 — Pydantic 数据模型（输入输出校验）
"""
from pydantic import BaseModel, Field
from typing import List, Optional


class PolicyTensor(BaseModel):
    """三维策略张量，所有维度 ∈ [0, 1]"""
    aggressiveness: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="激进度：决定动作频率和话术直接程度",
    )
    authenticity: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="拟真度：决定加入多少人类噪音和冗余动作",
    )
    conversion_focus: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="转化导向：内容结构偏短平快还是深度长文",
    )


class FeedbackEvent(BaseModel):
    """闭环反馈事件：转化/风控告警驱动张量更新"""
    source_agent: str = Field(..., description="上报来源 Agent ID，如 ink-writer / Echoer")
    conversion_score: float = Field(default=0.0, ge=0.0, le=1.0, description="转化侧收益")
    risk_score: float = Field(default=0.0, ge=0.0, le=1.0, description="风控/审计侧风险")


class AgentPromptRequest(BaseModel):
    """Agent 领取动态 Prompt 的请求"""
    agent_id: str = Field(..., description="Agent ID，如 ink-writer 或 InkWriter")
    base_task: str = Field(..., description="当前要执行的任务描述")
    current_campaign_id: str = Field(default="", description="当前大促/活动 ID，可选")


class AgentPromptResponse(BaseModel):
    """返回给 Agent 的注入后 Prompt 与当前张量"""
    agent_id: str
    applied_tensor: PolicyTensor
    injected_prompt: str
