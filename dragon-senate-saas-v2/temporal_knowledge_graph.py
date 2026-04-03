"""
Temporal knowledge graph inspired by graphiti.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from graph_namespace import GraphNamespace

logger = logging.getLogger("temporal_knowledge_graph")

DB_PATH = (Path(__file__).resolve().parent / "data" / "temporal_knowledge_graph.sqlite").resolve()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class GraphEntity:
    entity_id: str = field(default_factory=lambda: f"ent_{uuid.uuid4().hex[:16]}")
    name: str = ""
    entity_type: str = "entity"
    namespace: str = ""
    attributes: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class TemporalEdge:
    edge_id: str = field(default_factory=lambda: f"edge_{uuid.uuid4().hex[:16]}")
    source_id: str = ""
    target_id: str = ""
    relation: str = ""
    fact: str = ""
    namespace: str = ""
    valid_at: str = field(default_factory=_utc_now)
    expired_at: str | None = None
    episode_id: str = ""
    confidence: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class Episode:
    episode_id: str = field(default_factory=lambda: f"ep_{uuid.uuid4().hex[:16]}")
    name: str = ""
    content: str = ""
    source_type: str = "conversation"
    reference_time: str = field(default_factory=_utc_now)
    namespace: str = ""
    lead_id: str | None = None
    lobster_id: str | None = None
    created_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


ENTITY_EXTRACTION_PROMPT = """
从下面文本中提取知识图谱实体和关系。
文本：
{content}

输出 JSON：
{{
  "entities": [{{"name":"张总","type":"person","attributes":{{}}}}],
  "relations": [{{"source":"张总","target":"ABC科技","relation":"任职于","fact":"张总在ABC科技任职"}}]
}}
"""


class TemporalKnowledgeGraphStore:
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
                CREATE TABLE IF NOT EXISTS graph_entities (
                    entity_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    namespace TEXT NOT NULL,
                    attributes_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_entity_unique
                    ON graph_entities(namespace, lower(name), entity_type);

                CREATE TABLE IF NOT EXISTS graph_edges (
                    edge_id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    relation TEXT NOT NULL,
                    fact TEXT NOT NULL DEFAULT '',
                    namespace TEXT NOT NULL,
                    valid_at TEXT NOT NULL,
                    expired_at TEXT,
                    episode_id TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 1.0
                );
                CREATE INDEX IF NOT EXISTS idx_graph_edges_lookup
                    ON graph_edges(namespace, source_id, target_id, relation, valid_at DESC);

                CREATE TABLE IF NOT EXISTS graph_episodes (
                    episode_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    reference_time TEXT NOT NULL,
                    namespace TEXT NOT NULL,
                    lead_id TEXT,
                    lobster_id TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_graph_episodes_namespace
                    ON graph_episodes(namespace, reference_time DESC);
                """
            )
            conn.commit()

    def find_entity(self, *, name: str, entity_type: str, namespace: str) -> GraphEntity | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM graph_entities
                WHERE namespace = ? AND lower(name) = lower(?) AND entity_type = ?
                """,
                (namespace, name, entity_type),
            ).fetchone()
        return self._row_to_entity(row) if row else None

    def save_entity(self, entity: GraphEntity) -> GraphEntity:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO graph_entities(entity_id, name, entity_type, namespace, attributes_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entity.entity_id,
                    entity.name,
                    entity.entity_type,
                    entity.namespace,
                    json.dumps(entity.attributes, ensure_ascii=False),
                    entity.created_at,
                    entity.updated_at,
                ),
            )
            conn.commit()
        return entity

    def update_entity(self, entity_id: str, attributes: dict[str, Any]) -> None:
        with self._connect() as conn:
            row = conn.execute("SELECT attributes_json FROM graph_entities WHERE entity_id = ?", (entity_id,)).fetchone()
            current = json.loads(str(row["attributes_json"] or "{}")) if row else {}
            current.update(attributes or {})
            conn.execute(
                "UPDATE graph_entities SET attributes_json = ?, updated_at = ? WHERE entity_id = ?",
                (json.dumps(current, ensure_ascii=False), _utc_now(), entity_id),
            )
            conn.commit()

    def expire_edge(self, *, source_id: str, target_id: str, relation: str, namespace: str, expired_at: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE graph_edges
                   SET expired_at = ?
                 WHERE namespace = ? AND source_id = ? AND target_id = ? AND relation = ? AND expired_at IS NULL
                """,
                (expired_at, namespace, source_id, target_id, relation),
            )
            conn.commit()

    def save_edge(self, edge: TemporalEdge) -> TemporalEdge:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO graph_edges(edge_id, source_id, target_id, relation, fact, namespace, valid_at, expired_at, episode_id, confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    edge.edge_id,
                    edge.source_id,
                    edge.target_id,
                    edge.relation,
                    edge.fact,
                    edge.namespace,
                    edge.valid_at,
                    edge.expired_at,
                    edge.episode_id,
                    edge.confidence,
                ),
            )
            conn.commit()
        return edge

    def save_episode(self, episode: Episode) -> Episode:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO graph_episodes(episode_id, name, content, source_type, reference_time, namespace, lead_id, lobster_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    episode.episode_id,
                    episode.name,
                    episode.content,
                    episode.source_type,
                    episode.reference_time,
                    episode.namespace,
                    episode.lead_id,
                    episode.lobster_id,
                    episode.created_at,
                ),
            )
            conn.commit()
        return episode

    def get_entity_timeline(self, *, entity_name: str, namespace: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT entity_id FROM graph_entities WHERE namespace = ? AND lower(name) = lower(?)",
                (namespace, entity_name),
            ).fetchone()
            if row is None:
                return []
            entity_id = str(row["entity_id"])
            rows = conn.execute(
                """
                SELECT * FROM graph_edges
                WHERE namespace = ? AND (source_id = ? OR target_id = ?)
                ORDER BY valid_at DESC
                """,
                (namespace, entity_id, entity_id),
            ).fetchall()
        return [self._row_to_edge(item).to_dict() for item in rows]

    def get_graph_snapshot(
        self,
        *,
        namespace: str,
        reference_time: str | None = None,
    ) -> dict[str, Any]:
        ref = reference_time or _utc_now()
        with self._connect() as conn:
            entities = conn.execute(
                "SELECT * FROM graph_entities WHERE namespace = ? ORDER BY updated_at DESC",
                (namespace,),
            ).fetchall()
            edges = conn.execute(
                """
                SELECT * FROM graph_edges
                WHERE namespace = ? AND valid_at <= ? AND (expired_at IS NULL OR expired_at > ?)
                ORDER BY valid_at DESC
                """,
                (namespace, ref, ref),
            ).fetchall()
        return {
            "namespace": namespace,
            "entities": [self._row_to_entity(row).to_dict() for row in entities],
            "edges": [self._row_to_edge(row).to_dict() for row in edges],
            "reference_time": ref,
        }

    def _row_to_entity(self, row: sqlite3.Row) -> GraphEntity:
        return GraphEntity(
            entity_id=str(row["entity_id"]),
            name=str(row["name"]),
            entity_type=str(row["entity_type"]),
            namespace=str(row["namespace"]),
            attributes=json.loads(str(row["attributes_json"] or "{}")),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def _row_to_edge(self, row: sqlite3.Row) -> TemporalEdge:
        return TemporalEdge(
            edge_id=str(row["edge_id"]),
            source_id=str(row["source_id"]),
            target_id=str(row["target_id"]),
            relation=str(row["relation"]),
            fact=str(row["fact"]),
            namespace=str(row["namespace"]),
            valid_at=str(row["valid_at"]),
            expired_at=str(row["expired_at"]) if row["expired_at"] else None,
            episode_id=str(row["episode_id"]),
            confidence=float(row["confidence"] or 1.0),
        )


class TemporalGraphBuilder:
    def __init__(
        self,
        llm_call_fn: Callable[[str, int], Awaitable[str]] | None = None,
        store: TemporalKnowledgeGraphStore | None = None,
    ) -> None:
        self._llm_call_fn = llm_call_fn
        self.store = store or TemporalKnowledgeGraphStore()

    async def add_episode(
        self,
        *,
        tenant_id: str,
        name: str,
        content: str,
        source_type: str,
        reference_time: str | None = None,
        lead_id: str | None = None,
        lobster_id: str | None = None,
    ) -> dict[str, Any]:
        namespace = GraphNamespace.lead_ns(tenant_id, lead_id) if lead_id else GraphNamespace.tenant_ns(tenant_id)
        episode = Episode(
            name=name,
            content=content[:12000],
            source_type=source_type,
            reference_time=reference_time or _utc_now(),
            namespace=namespace,
            lead_id=lead_id,
            lobster_id=lobster_id,
        )
        entities_raw, relations_raw = await self._extract_entities_relations(content)
        entity_map: dict[str, GraphEntity] = {}
        for raw in entities_raw:
            entity_name = str(raw.get("name") or "").strip()
            entity_type = str(raw.get("type") or "entity").strip() or "entity"
            if not entity_name:
                continue
            existing = self.store.find_entity(name=entity_name, entity_type=entity_type, namespace=namespace)
            if existing is not None:
                self.store.update_entity(existing.entity_id, dict(raw.get("attributes") or {}))
                entity_map[entity_name] = existing
                continue
            entity = GraphEntity(
                name=entity_name,
                entity_type=entity_type,
                namespace=namespace,
                attributes=dict(raw.get("attributes") or {}),
            )
            self.store.save_entity(entity)
            entity_map[entity_name] = entity

        edges_saved = 0
        for raw in relations_raw:
            source_name = str(raw.get("source") or "").strip()
            target_name = str(raw.get("target") or "").strip()
            relation = str(raw.get("relation") or "").strip()
            fact = str(raw.get("fact") or "").strip() or f"{source_name} {relation} {target_name}".strip()
            if not source_name or not target_name or not relation:
                continue
            src = entity_map.get(source_name)
            tgt = entity_map.get(target_name)
            if src is None or tgt is None:
                continue
            self.store.expire_edge(
                source_id=src.entity_id,
                target_id=tgt.entity_id,
                relation=relation,
                namespace=namespace,
                expired_at=episode.reference_time,
            )
            self.store.save_edge(
                TemporalEdge(
                    source_id=src.entity_id,
                    target_id=tgt.entity_id,
                    relation=relation,
                    fact=fact,
                    namespace=namespace,
                    valid_at=episode.reference_time,
                    episode_id=episode.episode_id,
                    confidence=float(raw.get("confidence") or 1.0),
                )
            )
            edges_saved += 1

        self.store.save_episode(episode)
        return {
            "episode_id": episode.episode_id,
            "namespace": namespace,
            "entities_added": len(entity_map),
            "edges_added": edges_saved,
        }

    async def get_entity_timeline(
        self,
        *,
        tenant_id: str,
        entity_name: str,
        lead_id: str | None = None,
    ) -> list[dict[str, Any]]:
        namespace = GraphNamespace.lead_ns(tenant_id, lead_id) if lead_id else GraphNamespace.tenant_ns(tenant_id)
        return self.store.get_entity_timeline(entity_name=entity_name, namespace=namespace)

    async def get_graph_snapshot(
        self,
        *,
        tenant_id: str,
        lead_id: str | None = None,
        reference_time: str | None = None,
    ) -> dict[str, Any]:
        namespace = GraphNamespace.lead_ns(tenant_id, lead_id) if lead_id else GraphNamespace.tenant_ns(tenant_id)
        return self.store.get_graph_snapshot(namespace=namespace, reference_time=reference_time)

    async def _extract_entities_relations(self, content: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        text = str(content or "").strip()
        if not text:
            return [], []
        if self._llm_call_fn is not None:
            try:
                raw = await self._llm_call_fn(ENTITY_EXTRACTION_PROMPT.format(content=text[:5000]), 1200)
                parsed = self._parse_llm(raw)
                if parsed[0] or parsed[1]:
                    return parsed
            except Exception as exc:
                logger.warning("TemporalGraphBuilder llm extraction failed, fallback to heuristic: %s", exc)
        return self._heuristic_extract(text)

    def _parse_llm(self, raw: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        match = re.search(r"\{.*\}", str(raw or ""), re.DOTALL)
        if not match:
            return [], []
        payload = json.loads(match.group(0))
        entities = payload.get("entities", [])
        relations = payload.get("relations", [])
        return (
            [item for item in entities if isinstance(item, dict)],
            [item for item in relations if isinstance(item, dict)],
        )

    def _heuristic_extract(self, text: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        entities: dict[str, dict[str, Any]] = {}
        relations: list[dict[str, Any]] = []
        person_pattern = re.compile("[\u4e00-\u9fa5A-Za-z]{1,8}(?:总|经理|总监|老板|创始人|老师|医生)")
        company_pattern = re.compile("[\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:公司|科技|集团|工作室|门店|美容院|诊所)")

        for name in person_pattern.findall(text):
            entities.setdefault(name, {"name": name, "type": "person", "attributes": {}})
        for name in company_pattern.findall(text):
            entities.setdefault(name, {"name": name, "type": "company", "attributes": {}})

        sentences = [piece.strip() for piece in re.split(r"[。！？\n]", text) if piece.strip()]
        for sentence in sentences:
            people = person_pattern.findall(sentence)
            companies = company_pattern.findall(sentence)
            if len(people) >= 2 and "推荐" in sentence:
                relations.append(
                    {
                        "source": people[0],
                        "target": people[1],
                        "relation": "推荐",
                        "fact": sentence[:120],
                        "confidence": 0.65,
                    }
                )
            if people and companies and any(token in sentence for token in ("在", "任职", "担任", "来自")):
                relations.append(
                    {
                        "source": people[0],
                        "target": companies[0],
                        "relation": "任职于",
                        "fact": sentence[:120],
                        "confidence": 0.6,
                    }
                )
            if len(companies) >= 2 and any(token in sentence for token in ("合作", "竞品", "供应")):
                relation = "合作"
                if "竞品" in sentence:
                    relation = "竞品"
                elif "供应" in sentence:
                    relation = "供应"
                relations.append(
                    {
                        "source": companies[0],
                        "target": companies[1],
                        "relation": relation,
                        "fact": sentence[:120],
                        "confidence": 0.55,
                    }
                )
        return list(entities.values()), relations


_graph_builder: TemporalGraphBuilder | None = None


def get_temporal_graph_builder() -> TemporalGraphBuilder:
    global _graph_builder
    if _graph_builder is None:
        _graph_builder = TemporalGraphBuilder()
    return _graph_builder
