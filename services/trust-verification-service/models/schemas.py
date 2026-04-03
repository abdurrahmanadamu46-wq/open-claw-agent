"""
零信任安全审计 — 严格数据协议
只有符合规范的载荷才能进入前置/后置审计流水线。
"""
from pydantic import BaseModel, Field
from typing import List, Optional


# ---------- 前置审计：行为剧本 ----------
class BehaviorStep(BaseModel):
    action: str = Field(
        ...,
        description="动作类型: scroll, click, like, comment, pause",
    )
    duration: Optional[float] = Field(None, description="持续时间/滑动时长")
    delay: Optional[float] = Field(None, description="执行此动作前的停顿延迟")
    target: Optional[str] = Field(None, description="动作目标对象")


class BehaviorPlan(BaseModel):
    session_id: str = Field(..., description="会话 ID，用于审计追溯")
    target_platform: str = Field(..., description="目标平台标识")
    steps: List[BehaviorStep] = Field(..., description="行为步骤序列")


# ---------- 后置审计：边缘遥测 ----------
class TelemetryData(BaseModel):
    node_id: str = Field(..., description="边缘节点 ID")
    session_id: str = Field(..., description="对应执行会话 ID")
    hardware_concurrency: int = Field(..., description="CPU 核心数")
    webdriver_present: bool = Field(
        ...,
        description="是否检测到自动化驱动 (如 ChromeDriver)",
    )
    canvas_hash: str = Field(..., description="Canvas 指纹哈希")
    actual_execution_time: float = Field(..., description="实际执行总时长（秒）")
    mouse_trajectory_variance: float = Field(
        ...,
        description="鼠标轨迹的贝塞尔曲线方差，人类应有明显波动",
    )


# ---------- 审计结果（前后置共用） ----------
class VerificationResult(BaseModel):
    is_safe: bool = Field(..., description="是否通过审计")
    risk_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="风险分 0~1，越高越可疑",
    )
    reason: str = Field(..., description="判定原因/告警码")
    action_taken: str = Field(
        ...,
        description="建议动作: ALLOW, BLOCK_AND_REGENERATE, BAN_NODE, FLAG_NODE_FOR_REVIEW, SETTLE_REWARD 等",
    )
