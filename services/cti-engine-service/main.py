"""
CTI 威胁情报引擎 — FastAPI 服务总入口
接收 WSS Hub 推送的节点遥测流，进行女巫聚类与综合威胁评分；
与蜜罐调度联动，对女巫集群触发蜜罐协议而非直接封号。
"""
import logging
from typing import List

from fastapi import FastAPI, BackgroundTasks

from core.sybil_detector import SybilAttackDetector
from core.threat_scorer import CTIThreatScorer
from core.honeypot_manager import HoneypotManager
from models.schemas import NodeTelemetryEvent, ThreatAlert

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

sybil_detector = SybilAttackDetector()
cti_scorer = CTIThreatScorer(sybil_detector=sybil_detector)
honeypot_manager = HoneypotManager()

# 缓存近期遥测，凑够一批再触发聚类（生产环境改为 Redis 滑动窗口）
recent_telemetry_batch: List[NodeTelemetryEvent] = []


def _on_critical_alert(alert: ThreatAlert) -> None:
    """CRITICAL 时：写日志、登记蜜罐、可触发 CRM 冻结提现。"""
    logger.warning("[CTI ALERT] %s", alert.model_dump_json())
    if alert.action_taken == "TRIGGER_HONEYPOT_PROTOCOL" and alert.sybil_cluster_id is not None:
        honeypot_manager.register_honeypot_target(alert.node_id, alert.sybil_cluster_id)


app = FastAPI(
    title="Lobster CTI Engine",
    description="威胁情报与女巫攻击检测：DBSCAN 聚类 + 机房/超人基线 + 蜜罐协议联动。",
)


@app.post("/api/v1/cti/analyze", response_model=List[ThreatAlert])
async def analyze_telemetry_stream(
    events: List[NodeTelemetryEvent],
    background_tasks: BackgroundTasks,
):
    """
    接收 WSS Hub 推送的节点遥测流，进行 CTI 聚类与评分。
    当积攒足够样本（>= 10）时触发全局聚类；否则返回对当前事件的基线评估（无聚类）。
    """
    global recent_telemetry_batch
    recent_telemetry_batch.extend(events)
    alerts: List[ThreatAlert] = []

    if len(recent_telemetry_batch) >= 10:
        cluster_map = sybil_detector.ingest_telemetry_batch(recent_telemetry_batch)

        for event in recent_telemetry_batch:
            cluster_id = cluster_map.get(event.node_id, -1)
            alert = cti_scorer.evaluate_node(event, cluster_id)
            if alert.threat_level == "CRITICAL":
                background_tasks.add_task(_on_critical_alert, alert)
            alerts.append(alert)

        recent_telemetry_batch = []
    else:
        # 样本不足时仅做基线评估（无聚类，cluster_id=-1）
        for event in events:
            alert = cti_scorer.evaluate_node(event, -1)
            if alert.threat_level == "CRITICAL":
                background_tasks.add_task(_on_critical_alert, alert)
            alerts.append(alert)

    return alerts


@app.get("/api/v1/cti/honeypot/targets")
async def list_honeypot_targets():
    """查询当前蜜罐目标节点（调度/金算虾可据此下发垃圾任务、结算置零）。"""
    return {"node_ids": list(honeypot_manager.list_honeypot_nodes())}


@app.delete("/api/v1/cti/honeypot/targets/{node_id}")
async def remove_honeypot_target(node_id: str):
    """人工复核后解除某节点的蜜罐标记。"""
    honeypot_manager.unregister(node_id)
    return {"status": "removed", "node_id": node_id}


if __name__ == "__main__":
    import os
    import uvicorn
    host = os.environ.get("CTI_HOST", "0.0.0.0")
    port = int(os.environ.get("CTI_PORT", "8030"))
    uvicorn.run(app, host=host, port=port)
