from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


AGENT_IDS: tuple[str, ...] = (
    "radar",
    "strategist",
    "inkwriter",
    "visualizer",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("AGENT_EXTENSION_DB_PATH", "./data/agent_extension_registry.sqlite").strip()
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


def _norm_agent(agent_id: str) -> str:
    value = str(agent_id or "").strip().lower()
    return value


def _safe_json_load(raw: str | None, fallback: Any) -> Any:
    text = str(raw or "").strip()
    if not text:
        return fallback
    try:
        parsed = json.loads(text)
    except Exception:  # noqa: BLE001
        return fallback
    return parsed


def _skill(skill_id: str, name: str, capability: str, node_id: str, *, required: bool = False) -> dict[str, Any]:
    return {
        "skill_id": skill_id,
        "name": name,
        "capability": capability,
        "node_id": node_id,
        "required": bool(required),
        "enabled": True,
        "runtime": "python",
        "entrypoint": "",
        "description": "",
        "config": {},
    }


def _node(node_id: str, node_type: str, title: str) -> dict[str, Any]:
    return {
        "node_id": node_id,
        "type": node_type,
        "title": title,
        "enabled": True,
        "timeout_sec": 120,
        "retry_limit": 2,
        "config": {},
    }


def default_profile(agent_id: str) -> dict[str, Any]:
    aid = _norm_agent(agent_id)
    if aid not in AGENT_IDS:
        raise ValueError("unsupported_agent_id")

    base = {
        "agent_id": aid,
        "enabled": True,
        "profile_version": "openclaw-native-v1",
        "runtime_mode": "hybrid",
        "role_prompt": "",
        "skills": [],
        "nodes": [],
        "hooks": {"pre_guard": True, "post_audit": True},
        "limits": {"max_parallel": 2, "max_tokens": 0},
        "tags": ["openclaw-native", "lobster-senate"],
        "source": "default",
        "updated_at": None,
        "updated_by": None,
    }

    if aid == "radar":
        base["skills"] = [
            _skill("agent-browser", "Agent Browser", "web_automation", "radar.fetch", required=True),
            _skill("summarize", "Summarize", "content_cleaning", "radar.clean"),
            _skill("ontology", "Ontology", "entity_extract", "radar.struct"),
        ]
        base["nodes"] = [
            _node("radar.fetch", "fetch", "抓取对标内容"),
            _node("radar.clean", "transform", "清洗页面与评论"),
            _node("radar.struct", "transform", "结构化标签与实体"),
        ]
    elif aid == "strategist":
        base["skills"] = [
            _skill("self-improving-agent", "Self Improving Agent", "memory_loop", "strategist.memory", required=True),
            _skill("ontology", "Ontology", "knowledge_graph", "strategist.graph"),
            _skill("proactive-agent", "Proactive Agent", "trend_watch", "strategist.plan"),
        ]
        base["nodes"] = [
            _node("strategist.memory", "memory", "读取治理记忆层"),
            _node("strategist.graph", "reasoning", "图谱关系推理"),
            _node("strategist.plan", "reasoning", "策略参数生成"),
        ]
    elif aid == "inkwriter":
        base["skills"] = [
            _skill("humanizer", "Humanizer", "tone_humanize", "inkwriter.polish", required=True),
            _skill("summarize", "Summarize", "outline_sanitize", "inkwriter.guard"),
            _skill("template-map", "Template Map", "json_struct", "inkwriter.render"),
        ]
        base["nodes"] = [
            _node("inkwriter.guard", "guard", "模板合规检查"),
            _node("inkwriter.render", "generation", "脚本与文案生成"),
            _node("inkwriter.polish", "generation", "口吻人设润色"),
        ]
    elif aid == "visualizer":
        base["skills"] = [
            _skill("comfyui", "ComfyUI", "multimodal_generation", "visualizer.generate", required=True),
            _skill("controlnet", "ControlNet", "pose_control", "visualizer.pose"),
            _skill("vibevoice", "VibeVoice", "voice_tts", "visualizer.voice"),
        ]
        base["nodes"] = [
            _node("visualizer.pose", "transform", "姿态与分镜控制"),
            _node("visualizer.generate", "generation", "图像/视频生成"),
            _node("visualizer.voice", "generation", "旁白语音合成"),
        ]
    elif aid == "dispatcher":
        base["skills"] = [
            _skill("clawteam", "ClawTeam", "dependency_queue", "dispatcher.queue", required=True),
            _skill("wss-hub", "WSS Hub", "edge_dispatch", "dispatcher.push", required=True),
            _skill("task-replay", "Task Replay", "local_replay", "dispatcher.replay"),
        ]
        base["nodes"] = [
            _node("dispatcher.queue", "orchestrator", "动作级依赖排队"),
            _node("dispatcher.push", "orchestrator", "边缘任务派发"),
            _node("dispatcher.replay", "orchestrator", "局部重放与补偿"),
        ]
    elif aid == "echoer":
        base["skills"] = [
            _skill("humanizer", "Humanizer", "comment_style", "echoer.reply", required=True),
            _skill("policy-lexicon", "Policy Lexicon", "compliance_filter", "echoer.guard"),
            _skill("ab-test", "AB Test", "response_experiment", "echoer.experiment"),
        ]
        base["nodes"] = [
            _node("echoer.guard", "guard", "评论风险过滤"),
            _node("echoer.reply", "generation", "互动话术生成"),
            _node("echoer.experiment", "feedback", "A/B 话术反馈"),
        ]
    elif aid == "catcher":
        base["skills"] = [
            _skill("ontology", "Ontology", "intent_extract", "catcher.extract", required=True),
            _skill("regex-router", "Regex Router", "pattern_match", "catcher.classify"),
            _skill("lead-gate", "Lead Gate", "high_intent_gate", "catcher.forward", required=True),
        ]
        base["nodes"] = [
            _node("catcher.extract", "transform", "线索实体提取"),
            _node("catcher.classify", "reasoning", "意图分层"),
            _node("catcher.forward", "orchestrator", "高意向线索转发"),
        ]
    elif aid == "abacus":
        base["skills"] = [
            _skill("lead-scoring", "Lead Scoring", "score_rank", "abacus.score", required=True),
            _skill("webhook", "Webhook Gateway", "crm_push", "abacus.push"),
            _skill("multi-objective-bandit", "Bandit", "policy_reward", "abacus.reward"),
        ]
        base["nodes"] = [
            _node("abacus.score", "reasoning", "线索分层打分"),
            _node("abacus.push", "orchestrator", "CRM 推送"),
            _node("abacus.reward", "feedback", "多目标奖励回写"),
        ]
    elif aid == "followup":
        base["skills"] = [
            _skill("voice-call", "Voice Call", "call_followup", "followup.call", required=True),
            _skill("deterministic-spawn", "Deterministic Spawn", "sub_agent_spawn", "followup.spawn", required=True),
            _skill("hitl-approval", "HITL Approval", "manual_gate", "followup.approval", required=True),
        ]
        base["nodes"] = [
            _node("followup.spawn", "orchestrator", "按线索量生成子龙虾"),
            _node("followup.approval", "guard", "高风险动作审批"),
            _node("followup.call", "execution", "并发电话跟进"),
        ]
    return base


def extension_catalog() -> dict[str, Any]:
    profiles = [default_profile(agent_id) for agent_id in AGENT_IDS]
    capabilities = sorted(
        {
            str(skill.get("capability"))
            for row in profiles
            for skill in row.get("skills", [])
            if str(skill.get("capability")).strip()
        }
    )
    return {
        "agent_ids": list(AGENT_IDS),
        "capabilities": capabilities,
        "default_profiles": profiles,
        "schema_version": "openclaw-native-v1",
    }


def ensure_schema() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS agent_extension_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                profile_version TEXT NOT NULL DEFAULT 'openclaw-native-v1',
                runtime_mode TEXT NOT NULL DEFAULT 'hybrid',
                role_prompt TEXT NOT NULL DEFAULT '',
                skills_json TEXT NOT NULL DEFAULT '[]',
                nodes_json TEXT NOT NULL DEFAULT '[]',
                hooks_json TEXT NOT NULL DEFAULT '{}',
                limits_json TEXT NOT NULL DEFAULT '{}',
                tags_json TEXT NOT NULL DEFAULT '[]',
                updated_by TEXT,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, agent_id)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_extension_profiles_tenant
                ON agent_extension_profiles (tenant_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS agent_extension_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                action TEXT NOT NULL,
                detail_json TEXT NOT NULL DEFAULT '{}',
                actor_user_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_agent_extension_audit_tenant
                ON agent_extension_audit (tenant_id, created_at DESC);
            """
        )


def _audit(*, conn: sqlite3.Connection, tenant_id: str, agent_id: str, action: str, detail: dict[str, Any], actor_user_id: str | None) -> None:
    conn.execute(
        """
        INSERT INTO agent_extension_audit
            (tenant_id, agent_id, action, detail_json, actor_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            str(tenant_id),
            str(agent_id),
            str(action),
            json.dumps(detail, ensure_ascii=False),
            str(actor_user_id or "").strip(),
            _utc_now(),
        ),
    )


def _normalize_profile(raw: dict[str, Any], *, source: str) -> dict[str, Any]:
    aid = _norm_agent(str(raw.get("agent_id", "")))
    default = default_profile(aid)
    normalized = {
        "agent_id": aid,
        "enabled": bool(raw.get("enabled", default["enabled"])),
        "profile_version": str(raw.get("profile_version", default["profile_version"]) or default["profile_version"]).strip(),
        "runtime_mode": str(raw.get("runtime_mode", default["runtime_mode"]) or default["runtime_mode"]).strip().lower(),
        "role_prompt": str(raw.get("role_prompt", default["role_prompt"]) or "")[:4000],
        "skills": raw.get("skills", default["skills"]),
        "nodes": raw.get("nodes", default["nodes"]),
        "hooks": raw.get("hooks", default["hooks"]),
        "limits": raw.get("limits", default["limits"]),
        "tags": raw.get("tags", default["tags"]),
        "source": source,
        "updated_at": raw.get("updated_at"),
        "updated_by": raw.get("updated_by"),
    }
    if normalized["runtime_mode"] not in {"local", "cloud", "hybrid"}:
        normalized["runtime_mode"] = default["runtime_mode"]
    if not isinstance(normalized["skills"], list):
        normalized["skills"] = default["skills"]
    if not isinstance(normalized["nodes"], list):
        normalized["nodes"] = default["nodes"]
    if not isinstance(normalized["hooks"], dict):
        normalized["hooks"] = default["hooks"]
    if not isinstance(normalized["limits"], dict):
        normalized["limits"] = default["limits"]
    if not isinstance(normalized["tags"], list):
        normalized["tags"] = default["tags"]
    return normalized


def _row_to_profile(row: sqlite3.Row) -> dict[str, Any]:
    return _normalize_profile(
        {
            "agent_id": str(row["agent_id"]),
            "enabled": bool(int(row["enabled"])),
            "profile_version": str(row["profile_version"]),
            "runtime_mode": str(row["runtime_mode"]),
            "role_prompt": str(row["role_prompt"]),
            "skills": _safe_json_load(row["skills_json"], []),
            "nodes": _safe_json_load(row["nodes_json"], []),
            "hooks": _safe_json_load(row["hooks_json"], {}),
            "limits": _safe_json_load(row["limits_json"], {}),
            "tags": _safe_json_load(row["tags_json"], []),
            "updated_by": str(row["updated_by"] or "").strip() or None,
            "updated_at": str(row["updated_at"] or "").strip() or None,
        },
        source="tenant_override",
    )


def get_profile(*, tenant_id: str, agent_id: str) -> dict[str, Any]:
    ensure_schema()
    aid = _norm_agent(agent_id)
    if aid not in AGENT_IDS:
        raise ValueError("unsupported_agent_id")
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT agent_id, enabled, profile_version, runtime_mode, role_prompt,
                   skills_json, nodes_json, hooks_json, limits_json, tags_json,
                   updated_by, updated_at
            FROM agent_extension_profiles
            WHERE tenant_id = ? AND agent_id = ?
            """,
            (str(tenant_id), aid),
        ).fetchone()
    if row is None:
        return default_profile(aid)
    return _row_to_profile(row)


def list_profiles(*, tenant_id: str) -> list[dict[str, Any]]:
    ensure_schema()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT agent_id, enabled, profile_version, runtime_mode, role_prompt,
                   skills_json, nodes_json, hooks_json, limits_json, tags_json,
                   updated_by, updated_at
            FROM agent_extension_profiles
            WHERE tenant_id = ?
            """,
            (str(tenant_id),),
        ).fetchall()
    mapped = {str(row["agent_id"]).strip().lower(): _row_to_profile(row) for row in rows}
    result: list[dict[str, Any]] = []
    for aid in AGENT_IDS:
        result.append(mapped.get(aid, default_profile(aid)))
    return result


def upsert_profile(
    *,
    tenant_id: str,
    agent_id: str,
    enabled: bool = True,
    profile_version: str = "openclaw-native-v1",
    runtime_mode: str = "hybrid",
    role_prompt: str = "",
    skills: list[dict[str, Any]] | None = None,
    nodes: list[dict[str, Any]] | None = None,
    hooks: dict[str, Any] | None = None,
    limits: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    aid = _norm_agent(agent_id)
    if aid not in AGENT_IDS:
        raise ValueError("unsupported_agent_id")
    merged = _normalize_profile(
        {
            "agent_id": aid,
            "enabled": bool(enabled),
            "profile_version": str(profile_version or "openclaw-native-v1").strip() or "openclaw-native-v1",
            "runtime_mode": str(runtime_mode or "hybrid").strip().lower() or "hybrid",
            "role_prompt": str(role_prompt or ""),
            "skills": list(skills or []),
            "nodes": list(nodes or []),
            "hooks": dict(hooks or {}),
            "limits": dict(limits or {}),
            "tags": [str(item).strip() for item in (tags or []) if str(item).strip()],
        },
        source="tenant_override",
    )
    now = _utc_now()
    with _conn() as conn:
        exists = conn.execute(
            "SELECT id FROM agent_extension_profiles WHERE tenant_id = ? AND agent_id = ?",
            (str(tenant_id), aid),
        ).fetchone()
        if exists is None:
            conn.execute(
                """
                INSERT INTO agent_extension_profiles
                    (tenant_id, agent_id, enabled, profile_version, runtime_mode, role_prompt,
                     skills_json, nodes_json, hooks_json, limits_json, tags_json, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(tenant_id),
                    aid,
                    1 if merged["enabled"] else 0,
                    str(merged["profile_version"]),
                    str(merged["runtime_mode"]),
                    str(merged["role_prompt"]),
                    json.dumps(merged["skills"], ensure_ascii=False),
                    json.dumps(merged["nodes"], ensure_ascii=False),
                    json.dumps(merged["hooks"], ensure_ascii=False),
                    json.dumps(merged["limits"], ensure_ascii=False),
                    json.dumps(merged["tags"], ensure_ascii=False),
                    str(updated_by or "").strip(),
                    now,
                ),
            )
            action = "created"
        else:
            conn.execute(
                """
                UPDATE agent_extension_profiles
                SET enabled = ?, profile_version = ?, runtime_mode = ?, role_prompt = ?,
                    skills_json = ?, nodes_json = ?, hooks_json = ?, limits_json = ?, tags_json = ?,
                    updated_by = ?, updated_at = ?
                WHERE tenant_id = ? AND agent_id = ?
                """,
                (
                    1 if merged["enabled"] else 0,
                    str(merged["profile_version"]),
                    str(merged["runtime_mode"]),
                    str(merged["role_prompt"]),
                    json.dumps(merged["skills"], ensure_ascii=False),
                    json.dumps(merged["nodes"], ensure_ascii=False),
                    json.dumps(merged["hooks"], ensure_ascii=False),
                    json.dumps(merged["limits"], ensure_ascii=False),
                    json.dumps(merged["tags"], ensure_ascii=False),
                    str(updated_by or "").strip(),
                    now,
                    str(tenant_id),
                    aid,
                ),
            )
            action = "updated"

        _audit(
            conn=conn,
            tenant_id=str(tenant_id),
            agent_id=aid,
            action=action,
            detail={
                "profile_version": merged["profile_version"],
                "runtime_mode": merged["runtime_mode"],
                "skills_count": len(merged["skills"]),
                "nodes_count": len(merged["nodes"]),
            },
            actor_user_id=updated_by,
        )

        row = conn.execute(
            """
            SELECT agent_id, enabled, profile_version, runtime_mode, role_prompt,
                   skills_json, nodes_json, hooks_json, limits_json, tags_json,
                   updated_by, updated_at
            FROM agent_extension_profiles
            WHERE tenant_id = ? AND agent_id = ?
            """,
            (str(tenant_id), aid),
        ).fetchone()

    if row is None:
        return default_profile(aid)
    return _row_to_profile(row)
