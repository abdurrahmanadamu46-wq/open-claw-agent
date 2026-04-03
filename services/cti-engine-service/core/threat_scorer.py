"""
CTI 综合威胁评分与熔断引擎
结合聚类结果与硬性安全基线做出最终裁决。
"""
from typing import Set

from models.schemas import NodeTelemetryEvent, ThreatAlert


# 正常用户不应使用数据中心 IP 做众包任务
DEFAULT_BLACKLISTED_ISPS: Set[str] = {
    "Alibaba Cloud",
    "Tencent Cloud",
    "DigitalOcean",
    "AWS",
    "GCP",
    "Azure",
    "Huawei Cloud",
}


class CTIThreatScorer:
    """综合评估节点威胁等级并输出熔断决策。"""

    def __init__(
        self,
        sybil_detector,  # SybilAttackDetector
        blacklisted_isps: Set[str] | None = None,
        superhuman_tasks_per_hour: int = 300,
        superhuman_success_rate: float = 0.99,
    ):
        self.sybil_detector = sybil_detector
        self.blacklisted_isps = blacklisted_isps or DEFAULT_BLACKLISTED_ISPS
        self.superhuman_tasks_per_hour = superhuman_tasks_per_hour
        self.superhuman_success_rate = superhuman_success_rate

    def evaluate_node(
        self,
        node_event: NodeTelemetryEvent,
        cluster_id: int,
    ) -> ThreatAlert:
        """综合评估单节点，返回威胁等级与建议动作。"""
        # 1. 基线：机房 IP 拦截
        if node_event.network.isp in self.blacklisted_isps:
            return ThreatAlert(
                node_id=node_event.node_id,
                threat_level="CRITICAL",
                sybil_cluster_id=None,
                reason=f"Data Center IP Detected ({node_event.network.isp})",
                action_taken="BAN_NODE_PERMANENTLY",
            )

        # 2. 基线：反人类执行效率（超人检测）
        if (
            node_event.tasks_completed_per_hour > self.superhuman_tasks_per_hour
            and node_event.success_rate >= self.superhuman_success_rate
        ):
            return ThreatAlert(
                node_id=node_event.node_id,
                threat_level="CRITICAL",
                sybil_cluster_id=None,
                reason="Superhuman execution efficiency. Probable RPA hack.",
                action_taken="CONFISCATE_REWARDS",
            )

        # 3. 聚类结果：女巫攻击机房
        if cluster_id >= 0:
            return ThreatAlert(
                node_id=node_event.node_id,
                threat_level="CRITICAL",
                sybil_cluster_id=cluster_id,
                reason=(
                    f"Sybil Attack Detected. Node exhibits identical physical network "
                    f"and behavioral fingerprints to cluster {cluster_id}."
                ),
                action_taken="TRIGGER_HONEYPOT_PROTOCOL",
            )

        return ThreatAlert(
            node_id=node_event.node_id,
            threat_level="SAFE",
            sybil_cluster_id=None,
            reason="Behavior aligns with expected human variance.",
            action_taken="ALLOW",
        )
