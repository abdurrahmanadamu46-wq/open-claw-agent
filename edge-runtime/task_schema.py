"""
EdgeTaskBundle — 边缘执行任务包 JSON Schema
=============================================
灵感来源：MoneyPrinterTurbo VideoParams（Pydantic 模型）
借鉴要点：用强类型 Pydantic 模型定义云端→边缘的任务数据契约

⚠️ 架构铁律：
  - 云端 visualizer 龙虾合成视频 → 上传 OSS → 得到 oss_url
  - 云端 dispatcher 龙虾生成此 EdgeTaskBundle JSON → 推送给边缘节点
  - 边缘 MarionetteExecutor 接收 JSON → 下载 oss_url → 发布到平台账号
  - 边缘层不做视频合成，只做下载 + 发布 + 回传结果

使用方式（dispatcher 龙虾）：
    bundle = EdgeTaskBundle(
        task_id="task-abc123",
        oss_url="https://oss.example.com/videos/abc123.mp4",
        platform="douyin",
        account_id="account-001",
        publish_time="2026-04-01T08:00:00+08:00",
        title="辣魂火锅 | 成都最值得排队的火锅",
        cover_url="https://oss.example.com/covers/abc123.jpg",
        tags=["火锅", "成都美食", "打卡"],
    )
    json_str = bundle.model_dump_json()
    # → 推送到边缘节点（Redis / WebSocket / WSS）

使用方式（边缘 MarionetteExecutor）：
    bundle = EdgeTaskBundle.model_validate_json(json_str)
    # → 下载 bundle.oss_url
    # → 调用平台 API 发布
    result = EdgeTaskResult(
        task_id=bundle.task_id,
        status="published",
        post_id="7xxxxxx",
        post_url="https://www.douyin.com/video/7xxxxxx",
    )
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

try:
    from pydantic import BaseModel, Field
    PYDANTIC_AVAILABLE = True
except ImportError:
    # fallback to dataclass if pydantic not available
    from dataclasses import dataclass as _dc
    BaseModel = object
    Field = lambda *a, **kw: None
    PYDANTIC_AVAILABLE = False


# ─────────────────────────────────────────────────────────────────
# 平台枚举
# ─────────────────────────────────────────────────────────────────

class Platform(str, Enum):
    douyin = "douyin"           # 抖音
    xiaohongshu = "xiaohongshu" # 小红书
    kuaishou = "kuaishou"       # 快手
    shipinhao = "shipinhao"     # 微信视频号
    bilibili = "bilibili"       # B站
    weibo = "weibo"             # 微博


class PublishMode(str, Enum):
    immediate = "immediate"     # 立即发布
    scheduled = "scheduled"     # 定时发布
    draft = "draft"             # 存草稿


class TaskPriority(str, Enum):
    urgent = "urgent"           # P0 紧急（立刻执行）
    normal = "normal"           # P1 正常
    low = "low"                 # P2 低优先级


# ─────────────────────────────────────────────────────────────────
# EdgeTaskBundle — 云端→边缘任务包
# ─────────────────────────────────────────────────────────────────

class EdgeTaskBundle(BaseModel):
    """
    dispatcher 龙虾生成，推送给边缘 MarionetteExecutor。
    包含下载视频所需的全部信息 + 发布参数。
    """

    # ── 任务标识 ──────────────────────────────────────
    task_id: str = Field(..., description="全局唯一任务 ID，格式 task-{uuid}")
    workflow_run_id: Optional[str] = Field(None, description="来源工作流执行 ID")
    trace_id: Optional[str] = Field(None, description="分布式追踪 Trace ID")
    parent_span_id: Optional[str] = Field(None, description="父级 Span ID（边缘执行可挂到同一链路）")
    tenant_id: str = Field("tenant_main", description="租户 ID（多租户隔离）")
    created_at: str = Field(
        default_factory=lambda: datetime.now().isoformat(),
        description="任务创建时间 ISO8601"
    )

    # ── 视频下载 ──────────────────────────────────────
    oss_url: str = Field(..., description="云端 OSS/CDN 视频文件 URL，边缘层从此下载")
    cover_url: Optional[str] = Field(None, description="封面图 URL（可选）")
    video_duration_sec: Optional[float] = Field(None, description="视频时长（秒），用于进度显示")
    video_size_mb: Optional[float] = Field(None, description="视频文件大小（MB），用于下载超时估算")
    download_timeout_sec: int = Field(300, description="下载超时时长（秒）")
    checksum_md5: Optional[str] = Field(None, description="视频 MD5 校验值（可选，下载后验证）")

    # ── 发布目标 ──────────────────────────────────────
    platform: Platform = Field(..., description="目标发布平台")
    account_id: str = Field(..., description="目标账号 ID（对应边缘节点已登录的账号）")
    publish_mode: PublishMode = Field(PublishMode.scheduled, description="发布模式")
    publish_time: Optional[str] = Field(
        None,
        description="定时发布时间 ISO8601（publish_mode=scheduled 时必填）"
    )

    # ── 内容元数据 ────────────────────────────────────
    title: str = Field(..., description="视频标题（不超过 55 字）")
    description: Optional[str] = Field(None, description="视频描述/正文（抖音/小红书用）")
    tags: list[str] = Field(default_factory=list, description="话题标签列表（不含 #）")
    location: Optional[str] = Field(None, description="地理位置标签（可选）")
    mentions: list[str] = Field(default_factory=list, description="@提及账号列表（可选）")
    is_original: bool = Field(True, description="是否声明原创")
    allow_duet: bool = Field(False, description="是否允许合拍（抖音专属）")
    allow_comment: bool = Field(True, description="是否开启评论")
    allow_download: bool = Field(False, description="是否允许下载")

    # ── 调度控制 ──────────────────────────────────────
    priority: TaskPriority = Field(TaskPriority.normal, description="任务优先级")
    retry_limit: int = Field(3, description="发布失败最大重试次数")
    retry_delay_sec: int = Field(60, description="重试间隔（秒）")
    edge_node_id: Optional[str] = Field(None, description="指定边缘节点 ID（不填则由调度器分配）")

    # ── 扩展字段 ──────────────────────────────────────
    meta: dict[str, Any] = Field(default_factory=dict, description="扩展元数据（供龙虾传递上下文）")

    class Config:
        use_enum_values = True

    def to_edge_json(self) -> str:
        """序列化为 JSON 字符串，用于推送到边缘节点。"""
        return self.model_dump_json(indent=None)

    @classmethod
    def from_edge_json(cls, json_str: str) -> "EdgeTaskBundle":
        """从边缘节点收到的 JSON 字符串反序列化。"""
        return cls.model_validate_json(json_str)

    def validate_for_publish(self) -> list[str]:
        """
        发布前校验，返回错误列表（空列表=通过）。
        边缘 MarionetteExecutor 下载完成后调用。
        """
        errors = []
        if not self.oss_url:
            errors.append("oss_url is required")
        if not self.account_id:
            errors.append("account_id is required")
        if not self.title:
            errors.append("title is required")
        if len(self.title) > 55:
            errors.append(f"title too long: {len(self.title)} chars (max 55)")
        if self.publish_mode == PublishMode.scheduled and not self.publish_time:
            errors.append("publish_time required when publish_mode=scheduled")
        if len(self.tags) > 10:
            errors.append(f"too many tags: {len(self.tags)} (max 10)")
        return errors


# ─────────────────────────────────────────────────────────────────
# EdgeTaskResult — 边缘节点回传的执行结果
# ─────────────────────────────────────────────────────────────────

class EdgeTaskStatus(str, Enum):
    pending = "pending"         # 等待执行
    downloading = "downloading" # 正在下载视频
    publishing = "publishing"   # 正在发布
    published = "published"     # 发布成功
    scheduled = "scheduled"     # 已设为定时发布（待平台发出）
    failed = "failed"           # 失败
    retrying = "retrying"       # 重试中
    cancelled = "cancelled"     # 已取消


class EdgeTaskResult(BaseModel):
    """
    MarionetteExecutor 执行完毕后回传给云端的结果。
    云端 dispatcher/echoer 龙虾据此触发后续流程。
    """
    task_id: str
    account_id: str
    platform: str
    status: EdgeTaskStatus
    post_id: Optional[str] = None       # 平台帖子 ID
    post_url: Optional[str] = None      # 帖子链接
    published_at: Optional[str] = None  # 实际发布时间
    error_message: Optional[str] = None # 失败原因
    retry_count: int = 0
    duration_sec: Optional[float] = None # 整个执行耗时（下载+发布）
    reported_at: str = Field(
        default_factory=lambda: datetime.now().isoformat()
    )
    meta: dict[str, Any] = Field(default_factory=dict)

    class Config:
        use_enum_values = True

    @property
    def is_success(self) -> bool:
        return self.status in (EdgeTaskStatus.published, EdgeTaskStatus.scheduled)

    def to_webhook_payload(self) -> dict[str, Any]:
        """转为 webhook 推送格式（供 echoer/catcher 龙虾接收）。"""
        return {
            "event": "edge_task_result",
            "task_id": self.task_id,
            "account_id": self.account_id,
            "platform": self.platform,
            "status": self.status,
            "post_id": self.post_id,
            "post_url": self.post_url,
            "published_at": self.published_at,
            "ok": self.is_success,
            "error": self.error_message,
            "reported_at": self.reported_at,
        }


# ─────────────────────────────────────────────────────────────────
# EdgeTaskProgress — 边缘节点实时进度上报（借鉴 MPT progress 0-100 规范）
# ─────────────────────────────────────────────────────────────────

class EdgeTaskProgress(BaseModel):
    """
    边缘节点执行过程中的实时进度上报（通过 WSS 推送给云端）。
    借鉴 MPT progress 字段 0-100 线性规范。
    """
    task_id: str
    status: EdgeTaskStatus
    progress: int = Field(0, ge=0, le=100, description="0-100 整数进度")
    message: str = ""           # 人类可读的进度描述
    timestamp: str = Field(
        default_factory=lambda: datetime.now().isoformat()
    )

    # 标准进度里程碑（边缘执行器参考）
    PROGRESS_MILESTONES: dict[str, int] = {
        "task_received":    5,
        "download_start":   10,
        "download_50pct":   30,
        "download_done":    50,
        "publish_start":    55,
        "publish_uploading": 70,
        "publish_submitted": 85,
        "publish_confirmed": 95,
        "done":             100,
    }
