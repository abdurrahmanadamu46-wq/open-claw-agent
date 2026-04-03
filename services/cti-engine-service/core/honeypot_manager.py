"""
蜜罐策略调度（可选）：诱骗黑客持续消耗算力而非直接封号
对 TRIGGER_HONEYPOT_PROTOCOL 的节点：下发脱敏/无商业价值任务，结算时余额置 0。
"""
from typing import Dict, Set, Optional


class HoneypotManager:
    """
    维护蜜罐目标节点与集群；实际「下发假任务」「结算置零」由 Dispatcher / 金算虾对接本模块查询。
    """

    def __init__(self):
        self._honeypot_nodes: Set[str] = set()
        self._node_to_cluster: Dict[str, int] = {}

    def register_honeypot_target(self, node_id: str, cluster_id: int) -> None:
        """将节点标记为蜜罐目标，后续调度与结算层可据此放行任务但不计酬劳。"""
        self._honeypot_nodes.add(node_id)
        self._honeypot_nodes.discard("")  # 防御空串
        self._node_to_cluster[node_id] = cluster_id

    def unregister(self, node_id: str) -> None:
        """解除蜜罐标记（如人工复核后放行）。"""
        self._honeypot_nodes.discard(node_id)
        self._node_to_cluster.pop(node_id, None)

    def is_honeypot_target(self, node_id: str) -> bool:
        """调度/结算前查询：是否应对该节点走蜜罐流程（下发垃圾任务、余额置 0）。"""
        return node_id in self._honeypot_nodes

    def get_cluster_for_node(self, node_id: str) -> Optional[int]:
        """返回节点所属女巫集群 ID，便于统计与报表。"""
        return self._node_to_cluster.get(node_id)

    def list_honeypot_nodes(self) -> Set[str]:
        """返回当前所有蜜罐目标节点 ID。"""
        return set(self._honeypot_nodes)
