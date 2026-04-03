from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from industry_taxonomy import all_subindustry_records
from industry_taxonomy import profile_seed_from_tag
from industry_taxonomy import resolve_subindustry_tag
from workflow_template_registry import list_templates_by_industry


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_path() -> Path:
    raw = os.getenv("INDUSTRY_KB_DB_PATH", "./data/industry_kb_pool.sqlite").strip()
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


def ensure_schema() -> None:
    with _conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS industry_starter_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                industry_tag TEXT NOT NULL,
                task_key TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'accepted',
                task_json TEXT NOT NULL,
                verifier_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, industry_tag, task_key)
            );
            CREATE INDEX IF NOT EXISTS idx_industry_starter_tasks_tenant
                ON industry_starter_tasks (tenant_id, industry_tag, updated_at DESC);
            """
        )


def _normalize_channel_family(category_tag: str, industry_tag: str) -> list[dict[str, Any]]:
    base = [
        {
            "channel": "douyin",
            "touchpoint": "short_video_lead_capture",
            "goal": "acquire",
            "required_assets": ["hook_script", "storyboard", "approval_policy"],
            "governance_mode": "hitl_default",
        },
        {
            "channel": "xiaohongshu",
            "touchpoint": "comment_intercept",
            "goal": "capture",
            "required_assets": ["offer_card", "comment_policy", "risk_terms"],
            "governance_mode": "guarded_auto",
        },
        {
            "channel": "wechat",
            "touchpoint": "dm_followup",
            "goal": "convert",
            "required_assets": ["followup_script", "intent_tags", "approval_policy"],
            "governance_mode": "hitl_default",
        },
    ]

    if category_tag in {"enterprise_service", "medical_health"} or industry_tag.startswith("enterprise_"):
        base.append(
            {
                "channel": "phone",
                "touchpoint": "appointment_followup",
                "goal": "close",
                "required_assets": ["call_script", "lead_score", "approval_policy"],
                "governance_mode": "strict_hitl",
            }
        )
    else:
        base.append(
            {
                "channel": "local_reviews",
                "touchpoint": "reputation_response",
                "goal": "retain",
                "required_assets": ["reply_guide", "proof_points", "risk_terms"],
                "governance_mode": "guarded_auto",
            }
        )
    return base


def _find_record(industry_tag: str) -> dict[str, Any]:
    normalized = resolve_subindustry_tag(industry_tag)
    for row in all_subindustry_records():
        if str(row.get("tag") or "") == normalized:
            return row
    seed = profile_seed_from_tag(industry_tag)
    config = dict(seed.get("config", {}) or {})
    return {
        "tag": str(seed.get("industry_tag") or normalized),
        "name": str(config.get("industry_name") or normalized),
        "category_tag": str(config.get("category_tag") or "general"),
        "category_name": str(config.get("category_name") or "General"),
        "schema": config.get("schema", {}),
        "aliases": config.get("aliases", []),
    }


def _verifier_scores(
    *,
    task: dict[str, Any],
    workflow_count: int,
    pain_points: list[str],
    objections: list[str],
    risk_behaviors: list[str],
) -> dict[str, Any]:
    touchpoint = str(task.get("touchpoint") or "")
    governance_mode = str(task.get("governance_mode") or "guarded_auto")
    feasibility = 0.60 + min(workflow_count, 4) * 0.06
    if touchpoint in {"short_video_lead_capture", "comment_intercept"}:
        feasibility += 0.08
    if touchpoint == "appointment_followup":
        feasibility -= 0.06

    observability = 0.66 + min(len(pain_points), 5) * 0.03 + min(len(objections), 4) * 0.01
    if touchpoint in {"dm_followup", "appointment_followup", "reputation_response"}:
        observability += 0.05

    governance_fit = 0.58 + min(len(risk_behaviors), 5) * 0.04
    if governance_mode == "strict_hitl":
        governance_fit += 0.12
    elif governance_mode == "hitl_default":
        governance_fit += 0.08

    feasibility = min(round(feasibility, 4), 0.99)
    observability = min(round(observability, 4), 0.99)
    governance_fit = min(round(governance_fit, 4), 0.99)
    accepted = feasibility >= 0.60 and observability >= 0.66 and governance_fit >= 0.62

    reasons: list[str] = []
    if workflow_count > 0:
        reasons.append("workflow templates available")
    if pain_points:
        reasons.append("industry pain points available")
    if risk_behaviors:
        reasons.append("governance rules available")
    if touchpoint == "appointment_followup":
        reasons.append("phone followup requires stronger operational readiness")

    return {
        "accepted": accepted,
        "feasibility_score": feasibility,
        "observability_score": observability,
        "governance_fit_score": governance_fit,
        "reasons": reasons[:4],
    }


def _candidate_tasks(industry_tag: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    row = _find_record(industry_tag)
    schema = dict(row.get("schema", {}) or {})
    category_tag = str(row.get("category_tag") or "general")
    pain_points = [str(item).strip() for item in schema.get("pain_points", []) if str(item).strip()]
    solutions = [str(item).strip() for item in schema.get("solutions", []) if str(item).strip()]
    objections = [str(item).strip() for item in schema.get("objections", []) if str(item).strip()]
    risk_behaviors = [str(item).strip() for item in schema.get("risk_behaviors", []) if str(item).strip()]
    workflow_templates = list_templates_by_industry(industry_tag)

    explorer_summary = {
        "industry_tag": str(row.get("tag") or industry_tag),
        "industry_name": str(row.get("name") or industry_tag),
        "category_tag": category_tag,
        "channel_count": 0,
        "workflow_template_count": len(workflow_templates),
        "pain_point_count": len(pain_points),
        "objection_count": len(objections),
        "risk_behavior_count": len(risk_behaviors),
        "aliases": list(row.get("aliases", []) or []),
    }

    tasks: list[dict[str, Any]] = []
    channel_family = _normalize_channel_family(category_tag, str(row.get("tag") or industry_tag))
    explorer_summary["channel_count"] = len(channel_family)
    industry_name = str(row.get("name") or industry_tag)
    primary_problem = pain_points[0] if pain_points else "lead generation"
    primary_solution = solutions[0] if solutions else "operator-guided conversion"

    for idx, lane in enumerate(channel_family, start=1):
        touchpoint = str(lane["touchpoint"])
        verifier = _verifier_scores(
            task=lane,
            workflow_count=len(workflow_templates),
            pain_points=pain_points,
            objections=objections,
            risk_behaviors=risk_behaviors,
        )
        tasks.append(
            {
                "task_key": f"{row.get('tag', industry_tag)}:{lane['channel']}:{touchpoint}",
                "industry_tag": str(row.get("tag") or industry_tag),
                "industry_name": industry_name,
                "title": f"{industry_name} / {lane['channel']} / {touchpoint}",
                "objective": f"Address {primary_problem} through {lane['channel']} and move prospects toward {primary_solution}.",
                "channel": lane["channel"],
                "touchpoint": touchpoint,
                "goal": lane["goal"],
                "required_assets": lane["required_assets"],
                "governance_mode": lane["governance_mode"],
                "pain_points": pain_points[:3],
                "objections": objections[:3],
                "risk_behaviors": risk_behaviors[:3],
                "recommended_workflows": [str(item.get("name") or "") for item in workflow_templates[:3] if str(item.get("name") or "")],
                "priority": idx,
                "verifier": verifier,
            }
        )

    return tasks, explorer_summary


def generate_starter_tasks(
    *,
    tenant_id: str,
    industry_tag: str,
    actor_user_id: str,
    force: bool = False,
    max_tasks: int = 12,
) -> dict[str, Any]:
    ensure_schema()
    normalized_tag = resolve_subindustry_tag(industry_tag)
    tasks, explorer_summary = _candidate_tasks(normalized_tag)
    accepted = [task for task in tasks if bool((task.get("verifier") or {}).get("accepted"))][: max(1, min(int(max_tasks), 50))]
    rejected = [task for task in tasks if not bool((task.get("verifier") or {}).get("accepted"))][: max(0, min(int(max_tasks), 50))]
    now = _utc_now()

    with _conn() as conn:
        for task in accepted + rejected:
            task_key = str(task.get("task_key") or "").strip()
            if not task_key:
                continue
            existing = conn.execute(
                """
                SELECT id FROM industry_starter_tasks
                WHERE tenant_id = ? AND industry_tag = ? AND task_key = ?
                """,
                (tenant_id, normalized_tag, task_key),
            ).fetchone()
            if existing is not None and not force:
                continue
            status = "accepted" if task in accepted else "rejected"
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO industry_starter_tasks
                        (tenant_id, industry_tag, task_key, status, task_json, verifier_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        tenant_id,
                        normalized_tag,
                        task_key,
                        status,
                        json.dumps(task, ensure_ascii=False),
                        json.dumps(task.get("verifier", {}), ensure_ascii=False),
                        now,
                        now,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE industry_starter_tasks
                    SET status = ?, task_json = ?, verifier_json = ?, updated_at = ?
                    WHERE tenant_id = ? AND industry_tag = ? AND task_key = ?
                    """,
                    (
                        status,
                        json.dumps(task, ensure_ascii=False),
                        json.dumps(task.get("verifier", {}), ensure_ascii=False),
                        now,
                        tenant_id,
                        normalized_tag,
                        task_key,
                    ),
                )

    return {
        "tenant_id": tenant_id,
        "industry_tag": normalized_tag,
        "actor_user_id": actor_user_id,
        "generated_at": now,
        "explorer_summary": explorer_summary,
        "accepted_count": len(accepted),
        "rejected_count": len(rejected),
        "accepted_tasks": accepted,
        "rejected_tasks": rejected,
    }


def list_starter_tasks(
    *,
    tenant_id: str,
    industry_tag: str,
    status: str | None = "accepted",
    limit: int = 20,
) -> list[dict[str, Any]]:
    ensure_schema()
    normalized_tag = resolve_subindustry_tag(industry_tag)
    where = ["tenant_id = ?", "industry_tag = ?"]
    params: list[Any] = [tenant_id, normalized_tag]
    normalized_status = str(status or "").strip().lower()
    if normalized_status in {"accepted", "rejected"}:
        where.append("status = ?")
        params.append(normalized_status)

    with _conn() as conn:
        rows = conn.execute(
            f"""
            SELECT task_key, status, task_json, verifier_json, created_at, updated_at
            FROM industry_starter_tasks
            WHERE {' AND '.join(where)}
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            tuple(params + [max(1, min(int(limit), 100))]),
        ).fetchall()

    output: list[dict[str, Any]] = []
    for row in rows:
        payload = json.loads(row["task_json"] or "{}")
        verifier = json.loads(row["verifier_json"] or "{}")
        output.append(
            {
                "task_key": str(row["task_key"]),
                "status": str(row["status"]),
                "task": payload if isinstance(payload, dict) else {},
                "verifier": verifier if isinstance(verifier, dict) else {},
                "created_at": str(row["created_at"]),
                "updated_at": str(row["updated_at"]),
            }
        )
    return output
