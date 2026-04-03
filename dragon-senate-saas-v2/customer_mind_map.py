"""
Customer Mind Map inspired by Stanford Co-STORM MindMap.
"""

from __future__ import annotations

import copy
import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

DB_PATH = (Path(__file__).resolve().parent / "data" / "customer_mind_map.sqlite").resolve()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ExploreStatus(str, Enum):
    UNEXPLORED = "unexplored"
    PARTIAL = "partial"
    EXPLORED = "explored"


@dataclass(slots=True)
class MindMapNode:
    node_id: str
    dimension: str
    label_cn: str
    status: ExploreStatus = ExploreStatus.UNEXPLORED
    known_facts: list[str] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    confidence: float = 0.0
    last_updated: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["status"] = self.status.value
        return payload


STANDARD_DIMENSIONS: dict[str, MindMapNode] = {
    "basic_info": MindMapNode(
        node_id="basic_info",
        dimension="basic_info",
        label_cn="基本信息",
        open_questions=["公司规模？", "所在行业？", "主营业务？", "成立时间？"],
    ),
    "pain_points": MindMapNode(
        node_id="pain_points",
        dimension="pain_points",
        label_cn="痛点需求",
        open_questions=["当前最大痛点？", "为什么现在解决？", "已尝试的解决方案？"],
    ),
    "budget": MindMapNode(
        node_id="budget",
        dimension="budget",
        label_cn="预算情况",
        open_questions=["年度预算规模？", "谁审批采购？", "采购周期？", "付款方式偏好？"],
    ),
    "decision_process": MindMapNode(
        node_id="decision_process",
        dimension="decision_process",
        label_cn="决策流程",
        open_questions=["谁是最终决策人？", "还有哪些评估人？", "决策时间线？", "评估标准？"],
    ),
    "competitor": MindMapNode(
        node_id="competitor",
        dimension="competitor",
        label_cn="竞品情况",
        open_questions=["是否已在使用竞品？", "竞品名称？", "对竞品的不满？", "迁移门槛？"],
    ),
    "timeline": MindMapNode(
        node_id="timeline",
        dimension="timeline",
        label_cn="时机窗口",
        open_questions=["期望上线时间？", "为什么是现在而非以后？", "触发采购的事件？"],
    ),
    "risk": MindMapNode(
        node_id="risk",
        dimension="risk",
        label_cn="风险信号",
        open_questions=["是否有抵触信号？", "合同障碍？", "内部阻力？"],
    ),
}


@dataclass(slots=True)
class CustomerMindMap:
    lead_id: str
    tenant_id: str
    nodes: dict[str, MindMapNode] = field(default_factory=dict)
    human_injections: list[dict[str, Any]] = field(default_factory=list)
    updated_at: str = field(default_factory=_utc_now)

    def __post_init__(self) -> None:
        if not self.nodes:
            self.nodes = copy.deepcopy(STANDARD_DIMENSIONS)

    def update_node(
        self,
        *,
        dimension: str,
        new_facts: list[str],
        answered_questions: list[str],
        source: str,
        confidence: float = 0.8,
    ) -> MindMapNode | None:
        if dimension not in self.nodes:
            return None
        node = self.nodes[dimension]
        for fact in new_facts:
            text = str(fact or "").strip()
            if text and text not in node.known_facts:
                node.known_facts.append(text)
        normalized_answered = {str(item or "").strip() for item in answered_questions if str(item or "").strip()}
        node.open_questions = [item for item in node.open_questions if item not in normalized_answered]
        if source and source not in node.sources:
            node.sources.append(source)
        node.confidence = max(float(node.confidence or 0.0), max(0.0, min(float(confidence), 1.0)))
        node.status = self._infer_status(node)
        node.last_updated = _utc_now()
        self.updated_at = node.last_updated
        return node

    def get_unexplored_dimensions(self) -> list[MindMapNode]:
        unexplored = [node for node in self.nodes.values() if node.status == ExploreStatus.UNEXPLORED]
        partial = [node for node in self.nodes.values() if node.status == ExploreStatus.PARTIAL]
        return unexplored + partial

    def get_next_questions_for_lobster(self, max_questions: int = 3) -> list[str]:
        priority_order = ["budget", "decision_process", "pain_points", "competitor", "timeline", "risk", "basic_info"]
        questions: list[str] = []
        for dim in priority_order:
            node = self.nodes.get(dim)
            if node is None or not node.open_questions:
                continue
            questions.extend(node.open_questions[:2])
            if len(questions) >= max_questions:
                break
        return questions[:max_questions]

    def get_exploration_progress(self) -> dict[str, Any]:
        total = len(self.nodes)
        explored = sum(1 for item in self.nodes.values() if item.status == ExploreStatus.EXPLORED)
        partial = sum(1 for item in self.nodes.values() if item.status == ExploreStatus.PARTIAL)
        return {
            "total_dimensions": total,
            "explored": explored,
            "partial": partial,
            "unexplored": total - explored - partial,
            "completion_pct": round((explored + partial * 0.5) / max(total, 1) * 100, 1),
            "dimensions": {
                dim: {
                    "status": node.status.value,
                    "label": node.label_cn,
                    "known_count": len(node.known_facts),
                    "open_questions": len(node.open_questions),
                }
                for dim, node in self.nodes.items()
            },
        }

    def inject_human_context(self, content: str, injected_by: str) -> None:
        text = str(content or "").strip()
        if not text:
            return
        self.human_injections.append(
            {
                "content": text,
                "injected_by": str(injected_by or "operator").strip() or "operator",
                "timestamp": _utc_now(),
            }
        )
        self.updated_at = _utc_now()

    def to_susi_briefing(self) -> str:
        lines = ["# 客户知识地图简报"]
        for dim, node in self.nodes.items():
            emoji = {
                ExploreStatus.UNEXPLORED: "❓",
                ExploreStatus.PARTIAL: "🔄",
                ExploreStatus.EXPLORED: "✅",
            }[node.status]
            lines.append(f"\n## {emoji} {node.label_cn}")
            if node.known_facts:
                lines.append("已知：")
                lines.extend(f"- {fact}" for fact in node.known_facts)
            if node.open_questions:
                lines.append("待探索：")
                lines.extend(f"- {question}" for question in node.open_questions)
        if self.human_injections:
            lines.append("\n## 👤 运营补充信息")
            lines.extend(f"- [{item['injected_by']}] {item['content']}" for item in self.human_injections)
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {
            "lead_id": self.lead_id,
            "tenant_id": self.tenant_id,
            "nodes": {key: node.to_dict() for key, node in self.nodes.items()},
            "human_injections": list(self.human_injections),
            "progress": self.get_exploration_progress(),
            "updated_at": self.updated_at,
        }

    @staticmethod
    def _infer_status(node: MindMapNode) -> ExploreStatus:
        if len(node.open_questions) == 0:
            return ExploreStatus.EXPLORED
        if len(node.known_facts) > 0:
            return ExploreStatus.PARTIAL
        return ExploreStatus.UNEXPLORED


class CustomerMindMapStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or DB_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS customer_mind_maps (
                    tenant_id TEXT NOT NULL,
                    lead_id TEXT NOT NULL,
                    nodes_json TEXT NOT NULL DEFAULT '{}',
                    human_injections_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, lead_id)
                );
                CREATE INDEX IF NOT EXISTS idx_customer_mind_maps_updated
                    ON customer_mind_maps(tenant_id, updated_at DESC);
                """
            )
            conn.commit()

    def get_or_create(self, tenant_id: str, lead_id: str) -> CustomerMindMap:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM customer_mind_maps WHERE tenant_id = ? AND lead_id = ?",
                (tenant_id, lead_id),
            ).fetchone()
        if row is None:
            mind_map = CustomerMindMap(lead_id=lead_id, tenant_id=tenant_id)
            self.save(mind_map)
            return mind_map
        nodes_payload = json.loads(str(row["nodes_json"] or "{}"))
        nodes: dict[str, MindMapNode] = {}
        for key, default_node in copy.deepcopy(STANDARD_DIMENSIONS).items():
            item = dict(nodes_payload.get(key) or {})
            if item:
                item["status"] = _coerce_status(item.get("status"))
                nodes[key] = MindMapNode(**{**default_node.to_dict(), **item})
                nodes[key].status = _coerce_status(item.get("status"))
            else:
                nodes[key] = default_node
        return CustomerMindMap(
            lead_id=lead_id,
            tenant_id=tenant_id,
            nodes=nodes,
            human_injections=json.loads(str(row["human_injections_json"] or "[]")),
            updated_at=str(row["updated_at"]),
        )

    def save(self, mind_map: CustomerMindMap) -> CustomerMindMap:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO customer_mind_maps(tenant_id, lead_id, nodes_json, human_injections_json, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, lead_id) DO UPDATE SET
                    nodes_json=excluded.nodes_json,
                    human_injections_json=excluded.human_injections_json,
                    updated_at=excluded.updated_at
                """,
                (
                    mind_map.tenant_id,
                    mind_map.lead_id,
                    json.dumps({key: node.to_dict() for key, node in mind_map.nodes.items()}, ensure_ascii=False),
                    json.dumps(mind_map.human_injections, ensure_ascii=False),
                    mind_map.updated_at,
                ),
            )
            conn.commit()
        return mind_map


_store: CustomerMindMapStore | None = None


def get_customer_mind_map_store() -> CustomerMindMapStore:
    global _store
    if _store is None:
        _store = CustomerMindMapStore()
    return _store


def _coerce_status(value: Any) -> ExploreStatus:
    raw = str(value or ExploreStatus.UNEXPLORED.value)
    if raw.startswith("ExploreStatus."):
        raw = raw.split(".", 1)[1].lower()
    return ExploreStatus(raw)
