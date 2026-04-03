"""
基于无监督聚类的女巫攻击检测器 (DBSCAN)
机房节点难以伪造底层网络物理特征（统一 TTL、同云厂商 IP 段）与高度一致的高效执行率，
通过密度聚类抓出「团伙」。
"""
import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
from typing import List, Dict

from models.schemas import NodeTelemetryEvent


class SybilAttackDetector:
    """
    对节点遥测做特征提取与 DBSCAN 聚类；
    cluster_id = -1 表示噪音（散户），>= 0 表示高度相似的机房群组。
    """

    def __init__(self, eps: float = 0.5, min_samples: int = 5):
        """
        eps、min_samples 需根据实际边缘节点规模在生产环境调优。
        生产环境近期节点画像应存 Redis 滑动窗口，此处仅对当前批次聚类。
        """
        self.clustering_model = DBSCAN(eps=eps, min_samples=min_samples)
        self.scaler = StandardScaler()
        self._node_cache: List[NodeTelemetryEvent] = []

    def ingest_telemetry_batch(
        self,
        telemetry_batch: List[NodeTelemetryEvent],
    ) -> Dict[str, int]:
        """
        接收一批节点遥测，构建特征矩阵、标准化后 DBSCAN 聚类。
        返回: { node_id: cluster_id }，cluster_id=-1 为散户。
        """
        if len(telemetry_batch) < 5:
            return {t.node_id: -1 for t in telemetry_batch}

        feature_matrix: List[List[float]] = []
        node_ids: List[str] = []

        for t in telemetry_batch:
            features = [
                float(t.tasks_completed_per_hour),
                t.avg_execution_time_ms,
                float(t.network.ttl),
                float(t.network.tcp_window_size),
            ]
            feature_matrix.append(features)
            node_ids.append(t.node_id)

        X = np.array(feature_matrix, dtype=np.float64)
        X_scaled = self.scaler.fit_transform(X)
        cluster_labels = self.clustering_model.fit_predict(X_scaled)

        return {node_ids[i]: int(cluster_labels[i]) for i in range(len(node_ids))}
