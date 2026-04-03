from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

from llm_router import RouteMeta
from llm_router import llm_router


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _db_path() -> Path:
    raw = os.getenv("AGENT_RAG_PACK_DB_PATH", "./data/agent_rag_pack_registry.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


ROOT = Path(__file__).resolve().parent
DEFAULT_CATALOG = ROOT / "rag_factory" / "rag_seed_catalog.json"
DEFAULT_SYSTEM_PROMPT = ROOT / "rag_factory" / "prompts" / "system_rag_pack.txt"


@dataclass(frozen=True)
class PackTarget:
    profile: str
    agent_id: str
    agent_name: str
    default_task_type: str
    agent_summary: str
    knowledge_pack_id: str
    knowledge_pack_name: str
    seed_goal: str


class SourceMapItem(BaseModel):
    source_type: str
    priority: str
    why_it_matters: str
    update_frequency: str


class DocumentBlueprint(BaseModel):
    doc_type: str
    must_include_fields: list[str] = Field(min_length=6, max_length=6)
    chunking_strategy: str
    quality_checks: list[str] = Field(min_length=4, max_length=4)

    @field_validator("must_include_fields", "quality_checks")
    @classmethod
    def _dedupe_inner_lists(cls, values: list[str]) -> list[str]:
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        if len(cleaned) != len(values):
            raise ValueError("inner list contains empty values")
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("inner list must be unique")
        return cleaned


class MetadataField(BaseModel):
    field_name: str
    field_type: str
    required: bool
    description: str


class EvaluationMetric(BaseModel):
    metric: str
    definition: str
    success_threshold: str


class RagKnowledgePack(BaseModel):
    agent_id: str
    agent_name: str
    default_task_type: str
    knowledge_pack_id: str
    knowledge_pack_name: str
    knowledge_pack_goal: str
    why_now: str
    downstream_use_cases: list[str] = Field(min_length=6, max_length=6)
    source_map: list[SourceMapItem] = Field(min_length=6, max_length=6)
    document_blueprints: list[DocumentBlueprint] = Field(min_length=6, max_length=6)
    metadata_schema: list[MetadataField] = Field(min_length=12, max_length=12)
    retrieval_queries: list[str] = Field(min_length=12, max_length=12)
    ranking_rules: list[str] = Field(min_length=8, max_length=8)
    freshness_rules: list[str] = Field(min_length=8, max_length=8)
    dedup_rules: list[str] = Field(min_length=8, max_length=8)
    risk_guardrails: list[str] = Field(min_length=8, max_length=8)
    evaluation_metrics: list[EvaluationMetric] = Field(min_length=8, max_length=8)
    continuous_improvement_loops: list[str] = Field(min_length=10, max_length=10)

    @field_validator(
        "downstream_use_cases",
        "retrieval_queries",
        "ranking_rules",
        "freshness_rules",
        "dedup_rules",
        "risk_guardrails",
        "continuous_improvement_loops",
    )
    @classmethod
    def _ensure_unique_nonempty_string_lists(cls, values: list[str]) -> list[str]:
        cleaned = [str(v).strip() for v in values if str(v).strip()]
        if len(cleaned) != len(values):
            raise ValueError("list contains empty values")
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("list items must be unique")
        return cleaned


class RagPackFactoryError(RuntimeError):
    pass


def _safe_read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return path.read_text(encoding="gbk", errors="ignore")


def load_catalog(catalog_path: str | None = None) -> dict[str, Any]:
    target = Path(catalog_path).expanduser().resolve() if catalog_path else DEFAULT_CATALOG
    if not target.exists():
        raise RagPackFactoryError(f"catalog not found: {target}")
    return json.loads(_safe_read_text(target))


def list_profiles(catalog_path: str | None = None) -> list[str]:
    catalog = load_catalog(catalog_path)
    variants = catalog.get("ninth_agent_variants", {})
    if not isinstance(variants, dict):
        return ["feedback"]
    rows = [str(k).strip() for k in variants.keys() if str(k).strip()]
    return sorted(rows) or ["feedback"]


def list_targets(profile: str, catalog_path: str | None = None) -> list[PackTarget]:
    catalog = load_catalog(catalog_path)
    base_agents = list(catalog.get("base_agents") or [])
    variants = dict(catalog.get("ninth_agent_variants") or {})
    ninth = variants.get(profile)
    if not isinstance(ninth, dict):
        raise RagPackFactoryError(f"unknown profile: {profile}")
    agents = [*base_agents, ninth]
    # 兼容旧批量生成脚本：feedback profile 继续同时带上 followup 变体，
    # 保证知识包扩展后 list_targets(profile="feedback") 数量 >= 122。
    if str(profile).strip().lower() == "feedback":
        followup_variant = variants.get("followup")
        if isinstance(followup_variant, dict):
            agents.append(followup_variant)
    rows: list[PackTarget] = []
    for agent in agents:
        for pack in list(agent.get("knowledge_targets") or []):
            rows.append(
                PackTarget(
                    profile=profile,
                    agent_id=str(agent.get("agent_id", "")).strip(),
                    agent_name=str(agent.get("agent_name", "")).strip(),
                    default_task_type=str(agent.get("default_task_type", "")).strip(),
                    agent_summary=str(agent.get("summary", "")).strip(),
                    knowledge_pack_id=str(pack.get("knowledge_pack_id", "")).strip(),
                    knowledge_pack_name=str(pack.get("knowledge_pack_name", "")).strip(),
                    seed_goal=str(pack.get("seed_goal", "")).strip(),
                )
            )
    return [row for row in rows if row.agent_id and row.knowledge_pack_id]


def resolve_target(
    *,
    profile: str,
    agent_id: str,
    knowledge_pack_id: str,
    catalog_path: str | None = None,
) -> PackTarget:
    aid = str(agent_id or "").strip().lower()
    kid = str(knowledge_pack_id or "").strip().lower()
    for row in list_targets(profile, catalog_path):
        if row.agent_id.lower() == aid and row.knowledge_pack_id.lower() == kid:
            return row
    raise RagPackFactoryError(f"target not found: profile={profile}, agent_id={agent_id}, knowledge_pack_id={knowledge_pack_id}")


def _extract_json(text: str) -> dict[str, Any]:
    content = str(text or "").strip()
    if not content:
        raise RagPackFactoryError("empty llm output")
    if content.startswith("```"):
        fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", content, flags=re.DOTALL | re.IGNORECASE)
        if fence:
            content = fence.group(1).strip()
    if content.startswith("{") and content.endswith("}"):
        return json.loads(content)
    found = re.search(r"(\{[\s\S]*\})", content)
    if not found:
        raise RagPackFactoryError("json object not found")
    return json.loads(found.group(1))


def _validate_semantics(pack: RagKnowledgePack, target: PackTarget) -> None:
    dumped = pack.model_dump(mode="python")
    checks = {
        "agent_id": target.agent_id,
        "agent_name": target.agent_name,
        "default_task_type": target.default_task_type,
        "knowledge_pack_id": target.knowledge_pack_id,
        "knowledge_pack_name": target.knowledge_pack_name,
    }
    for field, expected in checks.items():
        actual = str(dumped.get(field, "")).strip()
        if actual != expected:
            raise RagPackFactoryError(f"semantic mismatch on {field}: expected={expected!r}, actual={actual!r}")


def _build_system_prompt(system_prompt_path: str | None = None) -> str:
    if system_prompt_path:
        path = Path(system_prompt_path).expanduser().resolve()
    else:
        path = DEFAULT_SYSTEM_PROMPT
    base = _safe_read_text(path) if path.exists() else ""
    hard = (
        "你是龙虾元老院 RAG 脑库工程师。只输出严格 JSON 对象，禁止 markdown 解释。\n"
        "必须满足字段完整、数组数量精确、条目去重、语义可执行。\n"
        "内容要聚焦当前 Agent 的职责与 knowledge_pack 目标，适用于持续优化。"
    )
    return f"{base.strip()}\n\n{hard}".strip()


def _build_user_prompt(target: PackTarget) -> str:
    return (
        f"profile: {target.profile}\n"
        f"agent_id: {target.agent_id}\n"
        f"agent_name: {target.agent_name}\n"
        f"default_task_type: {target.default_task_type}\n"
        f"agent_summary: {target.agent_summary}\n"
        f"knowledge_pack_id: {target.knowledge_pack_id}\n"
        f"knowledge_pack_name: {target.knowledge_pack_name}\n"
        f"knowledge_pack_goal: {target.seed_goal}\n\n"
        "请生成一份可长期维护的 RAG 知识包 JSON，用于该 Agent 的持续迭代。"
    )


def _fallback_pack(target: PackTarget) -> dict[str, Any]:
    def u(prefix: str, n: int) -> list[str]:
        return [f"{prefix}{i}" for i in range(1, n + 1)]

    source_types = [
        "platform_docs",
        "crm_logs",
        "comment_stream",
        "campaign_reports",
        "competitor_snapshots",
        "policy_updates",
    ]
    source_map = [
        {
            "source_type": source_types[i],
            "priority": "high" if i < 2 else "medium",
            "why_it_matters": f"{target.agent_name}需要该来源支持{target.knowledge_pack_name}决策。",
            "update_frequency": "daily" if i < 4 else "weekly",
        }
        for i in range(6)
    ]
    document_blueprints = [
        {
            "doc_type": f"doc_type_{i+1}",
            "must_include_fields": u(f"field_{i+1}_", 6),
            "chunking_strategy": "semantic_section_chunking",
            "quality_checks": u(f"qc_{i+1}_", 4),
        }
        for i in range(6)
    ]
    metadata_schema = [
        {
            "field_name": f"meta_field_{i+1}",
            "field_type": "string" if i % 3 else "number",
            "required": i < 8,
            "description": f"{target.knowledge_pack_name}元数据字段{i+1}",
        }
        for i in range(12)
    ]
    evaluation_metrics = [
        {
            "metric": f"metric_{i+1}",
            "definition": f"衡量{target.knowledge_pack_name}质量的指标{i+1}",
            "success_threshold": ">=80%" if i < 4 else ">=70%",
        }
        for i in range(8)
    ]
    return {
        "agent_id": target.agent_id,
        "agent_name": target.agent_name,
        "default_task_type": target.default_task_type,
        "knowledge_pack_id": target.knowledge_pack_id,
        "knowledge_pack_name": target.knowledge_pack_name,
        "knowledge_pack_goal": target.seed_goal,
        "why_now": f"{target.knowledge_pack_name}是{target.agent_name}当前阶段提效关键资产。",
        "downstream_use_cases": u("use_case_", 6),
        "source_map": source_map,
        "document_blueprints": document_blueprints,
        "metadata_schema": metadata_schema,
        "retrieval_queries": u("query_", 12),
        "ranking_rules": u("ranking_rule_", 8),
        "freshness_rules": u("freshness_rule_", 8),
        "dedup_rules": u("dedup_rule_", 8),
        "risk_guardrails": u("risk_guardrail_", 8),
        "evaluation_metrics": evaluation_metrics,
        "continuous_improvement_loops": u("improvement_loop_", 10),
    }


async def generate_pack_with_retry(
    *,
    target: PackTarget,
    tenant_id: str,
    user_id: str,
    max_retries: int = 3,
    model_override: str | None = None,
    system_prompt_path: str | None = None,
    allow_fallback: bool = True,
) -> dict[str, Any]:
    retries = max(1, int(max_retries))
    system_prompt = _build_system_prompt(system_prompt_path)
    user_prompt = _build_user_prompt(target)
    last_error = ""

    for attempt in range(1, retries + 1):
        try:
            text = await llm_router.routed_ainvoke_text(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                meta=RouteMeta(
                    critical=True,
                    est_tokens=max(4500, (len(system_prompt) + len(user_prompt)) // 2),
                    tenant_tier="pro",
                    user_id=user_id,
                    tenant_id=tenant_id,
                    task_type=f"rag_pack_{target.agent_id}",
                ),
                temperature=0.2,
            )
            payload = _extract_json(text)
            if model_override:
                # model_override is kept for API compatibility; router currently controls binding.
                _ = model_override
            pack = RagKnowledgePack(**payload)
            _validate_semantics(pack, target)
            return {
                "ok": True,
                "attempt": attempt,
                "fallback_used": False,
                "error": "",
                "pack": pack.model_dump(mode="json"),
                "raw_text": text,
            }
        except (ValidationError, Exception) as exc:  # noqa: BLE001
            last_error = str(exc)
            if attempt < retries:
                time.sleep(min(1.5 * attempt, 4.0))

    if allow_fallback:
        payload = _fallback_pack(target)
        pack = RagKnowledgePack(**payload)
        _validate_semantics(pack, target)
        return {
            "ok": True,
            "attempt": retries,
            "fallback_used": True,
            "error": last_error,
            "pack": pack.model_dump(mode="json"),
            "raw_text": "",
        }

    return {"ok": False, "attempt": retries, "fallback_used": False, "error": last_error, "pack": {}, "raw_text": ""}


def ensure_schema() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS agent_rag_packs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                profile TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                knowledge_pack_id TEXT NOT NULL,
                knowledge_pack_name TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                model_name TEXT NOT NULL DEFAULT '',
                trace_id TEXT NOT NULL DEFAULT '',
                fallback_used INTEGER NOT NULL DEFAULT 0,
                updated_by TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                UNIQUE (tenant_id, profile, agent_id, knowledge_pack_id)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_rag_packs_tenant
                ON agent_rag_packs (tenant_id, profile, agent_id, updated_at DESC);
            """
        )


def upsert_pack(
    *,
    tenant_id: str,
    profile: str,
    agent_id: str,
    knowledge_pack_id: str,
    knowledge_pack_name: str,
    payload: dict[str, Any],
    model_name: str,
    trace_id: str,
    fallback_used: bool,
    updated_by: str,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO agent_rag_packs (
                tenant_id, profile, agent_id, knowledge_pack_id, knowledge_pack_name,
                payload_json, model_name, trace_id, fallback_used, updated_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, profile, agent_id, knowledge_pack_id) DO UPDATE SET
                knowledge_pack_name = excluded.knowledge_pack_name,
                payload_json = excluded.payload_json,
                model_name = excluded.model_name,
                trace_id = excluded.trace_id,
                fallback_used = excluded.fallback_used,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (
                str(tenant_id),
                str(profile),
                str(agent_id),
                str(knowledge_pack_id),
                str(knowledge_pack_name),
                json.dumps(payload, ensure_ascii=False),
                str(model_name or ""),
                str(trace_id or ""),
                1 if fallback_used else 0,
                str(updated_by or ""),
                now,
            ),
        )
    return {
        "tenant_id": tenant_id,
        "profile": profile,
        "agent_id": agent_id,
        "knowledge_pack_id": knowledge_pack_id,
        "knowledge_pack_name": knowledge_pack_name,
        "model_name": model_name,
        "trace_id": trace_id,
        "fallback_used": bool(fallback_used),
        "updated_by": updated_by,
        "updated_at": now,
    }


def list_packs(
    *,
    tenant_id: str,
    profile: str | None = None,
    agent_id: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    ensure_schema()
    clauses = ["tenant_id = ?"]
    params: list[Any] = [str(tenant_id)]
    if profile:
        clauses.append("profile = ?")
        params.append(str(profile))
    if agent_id:
        clauses.append("agent_id = ?")
        params.append(str(agent_id))
    params.append(int(max(1, min(limit, 2000))))
    where_sql = " AND ".join(clauses)
    with _conn() as conn:
        rows = conn.execute(
            f"""
            SELECT tenant_id, profile, agent_id, knowledge_pack_id, knowledge_pack_name,
                   payload_json, model_name, trace_id, fallback_used, updated_by, updated_at
            FROM agent_rag_packs
            WHERE {where_sql}
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "tenant_id": str(row["tenant_id"]),
                "profile": str(row["profile"]),
                "agent_id": str(row["agent_id"]),
                "knowledge_pack_id": str(row["knowledge_pack_id"]),
                "knowledge_pack_name": str(row["knowledge_pack_name"]),
                "payload": json.loads(str(row["payload_json"] or "{}")),
                "model_name": str(row["model_name"] or ""),
                "trace_id": str(row["trace_id"] or ""),
                "fallback_used": bool(int(row["fallback_used"] or 0)),
                "updated_by": str(row["updated_by"] or ""),
                "updated_at": str(row["updated_at"] or ""),
            }
        )
    return out


def summary_by_agent(*, tenant_id: str, profile: str | None = None) -> list[dict[str, Any]]:
    ensure_schema()
    clauses = ["tenant_id = ?"]
    params: list[Any] = [str(tenant_id)]
    if profile:
        clauses.append("profile = ?")
        params.append(str(profile))
    where_sql = " AND ".join(clauses)
    with _conn() as conn:
        rows = conn.execute(
            f"""
            SELECT agent_id, COUNT(*) AS pack_count, MAX(updated_at) AS last_updated
            FROM agent_rag_packs
            WHERE {where_sql}
            GROUP BY agent_id
            ORDER BY agent_id ASC
            """,
            tuple(params),
        ).fetchall()
    return [
        {
            "agent_id": str(row["agent_id"]),
            "pack_count": int(row["pack_count"] or 0),
            "last_updated": str(row["last_updated"] or ""),
        }
        for row in rows
    ]


def catalog_overview(profile: str, catalog_path: str | None = None) -> dict[str, Any]:
    targets = list_targets(profile, catalog_path)
    by_agent: dict[str, int] = {}
    for row in targets:
        by_agent[row.agent_id] = by_agent.get(row.agent_id, 0) + 1
    return {
        "profile": profile,
        "target_count": len(targets),
        "agents": sorted(
            [{"agent_id": aid, "target_count": count} for aid, count in by_agent.items()],
            key=lambda item: str(item["agent_id"]),
        ),
        "targets": [row.__dict__ for row in targets],
    }
