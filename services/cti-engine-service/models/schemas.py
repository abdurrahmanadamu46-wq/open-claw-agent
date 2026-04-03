"""
CTI 威胁情报引擎 — 网络特征与遥测数据模型
边缘节点上报心跳时必须携带的底层网络与硬件元数据。
"""
from pydantic import BaseModel, Field
from typing import List, Optional


class NetworkFingerprint(BaseModel):
    ip_address: str = Field(..., description="节点出口 IP")
    subnet_prefix: str = Field(
        ...,
        description="IP C 段，例如 192.168.1",
    )
    ttl: int = Field(
        ...,
        description="网络数据包 Time To Live，机房机器常高度一致",
    )
    tcp_window_size: int = Field(..., description="TCP 窗口大小")
    isp: str = Field(
        default="Unknown",
        description="运营商/云厂商归属",
    )


class NodeTelemetryEvent(BaseModel):
    node_id: str = Field(..., description="边缘节点 ID")
    network: NetworkFingerprint = Field(..., description="网络指纹")
    tasks_completed_per_hour: int = Field(
        ...,
        description="节点每小时完成的并发任务数",
    )
    avg_execution_time_ms: float = Field(
        ...,
        description="任务平均执行耗时（毫秒）",
    )
    success_rate: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="任务成功率 0~1",
    )


class ThreatAlert(BaseModel):
    node_id: str = Field(..., description="被评估节点 ID")
    threat_level: str = Field(
        ...,
        description="SAFE | SUSPICIOUS | CRITICAL",
    )
    sybil_cluster_id: Optional[int] = Field(
        None,
        description="命中的黑产聚类群组 ID，-1 或缺失表示散户",
    )
    reason: str = Field(..., description="判定原因")
    action_taken: str = Field(
        ...,
        description="熔断动作: ALLOW, BAN_NODE_PERMANENTLY, CONFISCATE_REWARDS, TRIGGER_HONEYPOT_PROTOCOL 等",
    )
