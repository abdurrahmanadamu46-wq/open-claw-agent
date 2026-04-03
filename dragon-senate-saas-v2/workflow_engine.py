"""
Deterministic workflow engine for multi-lobster orchestration.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
import yaml

from langfuse_tracer import LangfuseTracer
from lobster_runner import LobsterRunSpec
from tenant_concurrency import (
    ConcurrencyAcquireTimeoutError,
    QueueDepthExceededError,
    WorkflowRateLimitedError,
    get_tenant_concurrency_manager,
)
from workflow_idempotency import get_workflow_idempotency_store
from workflow_realtime import get_workflow_realtime_hub

logger = logging.getLogger("workflow_engine")

WORKFLOWS_DIR = Path(__file__).resolve().parent / "workflows"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class StepStatus(str, Enum):
    WAITING = "waiting"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    ABANDONED = "abandoned"
    SKIPPED = "skipped"


@dataclass(slots=True)
class WorkflowAgentRef:
    id: str
    lobster: str


@dataclass(slots=True)
class WorkflowStep:
    step_id: str
    agent: str
    step_type: str
    input_template: str
    expects: str
    max_retries: int = 2
    retry_delay_seconds: int = 0
    loop_over: str = ""
    action_lobster: str = ""
    critique_lobsters: list[dict[str, Any]] = field(default_factory=list)
    max_rounds: int = 3
    approval_signal: str = "APPROVED"
    proposer: str = ""
    judge: str = ""
    debate_rounds: int = 0
    judge_prompt: str = ""


@dataclass(slots=True)
class WorkflowDefinition:
    workflow_id: str
    name: str
    description: str
    steps: list[WorkflowStep]
    agents: list[WorkflowAgentRef] = field(default_factory=list)
    error_workflow_id: str | None = None
    error_notify_channels: list[str] = field(default_factory=list)
    source_template_id: str | None = None

    def resolve_lobster_id(self, agent_id: str) -> str:
        for item in self.agents:
            if item.id == agent_id:
                return item.lobster
        return agent_id


def _json_loads(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _resolve_path(data: Any, path: str) -> Any:
    current = data
    for chunk in str(path or "").split("."):
        if not chunk:
            continue
        if isinstance(current, dict):
            current = current.get(chunk)
            continue
        if isinstance(current, list):
            try:
                current = current[int(chunk)]
            except (ValueError, IndexError):
                return None
            continue
        return None
    return current


def _stringify_template_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        if all(isinstance(item, str) for item in value):
            return "\n".join(str(item) for item in value)
        return json.dumps(value, ensure_ascii=False, indent=2)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return str(value)


def _extract_workflow_industry_fields(context: dict[str, Any]) -> dict[str, str]:
    if not isinstance(context, dict):
        return {}

    result: dict[str, str] = {}

    def _pick(source: dict[str, Any]) -> None:
        if not isinstance(source, dict):
            return
        for key in ("industry", "industry_tag"):
            value = str(source.get(key) or "").strip()
            if value and key not in result:
                result[key] = value

    _pick(context)
    nested = context.get("industry_workflow_context")
    if isinstance(nested, dict):
        _pick(nested)
        request_block = nested.get("request")
        if isinstance(request_block, dict):
            _pick(request_block)
    return result


def _build_workflow_runtime_context(context: dict[str, Any] | None) -> dict[str, Any]:
    runtime_context = dict(context or {})
    nested = runtime_context.get("industry_workflow_context")
    if not isinstance(nested, dict):
        nested = {}
    if nested:
        runtime_context["industry_workflow_context"] = nested

    request_block = nested.get("request") if isinstance(nested.get("request"), dict) else {}
    blueprint = nested.get("blueprint") if isinstance(nested.get("blueprint"), dict) else {}
    merchant_profile = request_block.get("merchantProfile") if isinstance(request_block.get("merchantProfile"), dict) else {}
    approval_summary = blueprint.get("approvalSummary") if isinstance(blueprint.get("approvalSummary"), list) else []
    channels = request_block.get("channels") if isinstance(request_block.get("channels"), list) else []
    bind_accounts = merchant_profile.get("bindAccounts") if isinstance(merchant_profile.get("bindAccounts"), list) else []

    account_info = {
        "brand_name": str(merchant_profile.get("brandName") or "").strip() or None,
        "merchant_type": str(merchant_profile.get("merchantType") or "").strip() or None,
        "bind_accounts": [str(item).strip() for item in bind_accounts if str(item).strip()],
        "category_id": str(request_block.get("categoryId") or "").strip() or None,
        "sub_industry_id": str(request_block.get("subIndustryId") or "").strip() or None,
        "workflow_id": str(request_block.get("workflowId") or blueprint.get("workflowId") or "").strip() or None,
    }
    account_info = {key: value for key, value in account_info.items() if value not in (None, [], {})}

    account_config = {
        "channels": channels,
        "approval_summary": approval_summary,
        "requires_approval": bool(approval_summary),
        "channel_count": len(channels),
    }

    if account_info:
        runtime_context.setdefault("account_info", account_info)
    if any(value not in (None, [], {}) for value in account_config.values()):
        runtime_context.setdefault("account_config", account_config)
    if merchant_profile:
        runtime_context.setdefault("merchant_profile", merchant_profile)
    if request_block:
        runtime_context.setdefault("workflow_request", request_block)
    if blueprint:
        runtime_context.setdefault("workflow_blueprint", blueprint)

    industry_fields = _extract_workflow_industry_fields(runtime_context)
    for key, value in industry_fields.items():
        runtime_context.setdefault(key, value)

    return runtime_context


def render_template(template: str, context: dict[str, Any]) -> str:
    """Render a Handlebars-like template with {{field}} lookups."""

    rendered = str(template or "")
    cursor = 0
    parts: list[str] = []

    while True:
        start = rendered.find("{{", cursor)
        if start < 0:
            parts.append(rendered[cursor:])
            break
        end = rendered.find("}}", start + 2)
        if end < 0:
            parts.append(rendered[cursor:])
            break
        parts.append(rendered[cursor:start])
        expr = rendered[start + 2:end].strip()
        value = _resolve_path(context, expr)
        parts.append(_stringify_template_value(value) if value is not None else f"{{{{{expr}}}}}")
        cursor = end + 2

    return "".join(parts)


def _coerce_step_type(raw: str | None) -> str:
    value = str(raw or "single").strip().lower()
    if value in {"loop", "ccv_loop", "debate_judge"}:
        return value
    return "single"


def load_workflow(workflow_id: str, workflows_dir: str | Path | None = None) -> WorkflowDefinition:
    """Load a workflow definition from YAML."""

    root = Path(workflows_dir) if workflows_dir else WORKFLOWS_DIR
    yaml_path = root / f"{workflow_id}.yaml"
    if not yaml_path.exists():
        raise FileNotFoundError(f"workflow_not_found:{yaml_path}")

    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    agents = [
        WorkflowAgentRef(
            id=str(item.get("id") or "").strip(),
            lobster=str(item.get("lobster") or item.get("id") or "").strip(),
        )
        for item in data.get("agents", [])
        if str(item.get("id") or "").strip()
    ]
    steps = [
        WorkflowStep(
            step_id=str(item.get("id") or "").strip(),
            agent=str(item.get("agent") or item.get("action_lobster") or item.get("proposer") or "").strip(),
            step_type=_coerce_step_type(item.get("type")),
            input_template=str(item.get("input") or ""),
            expects=str(item.get("expects") or "").strip(),
            max_retries=max(0, int(item.get("max_retries", 2) or 0)),
            retry_delay_seconds=max(0, int(item.get("retry_delay_seconds", 0) or 0)),
            loop_over=str(item.get("loop_over") or "").strip(),
            action_lobster=str(item.get("action_lobster") or "").strip(),
            critique_lobsters=[dict(row) for row in (item.get("critique_lobsters") or []) if isinstance(row, dict)],
            max_rounds=max(1, int(item.get("max_rounds", 3) or 3)),
            approval_signal=str(item.get("approval_signal") or "APPROVED").strip() or "APPROVED",
            proposer=str(item.get("proposer") or "").strip(),
            judge=str(item.get("judge") or "").strip(),
            debate_rounds=max(0, int(item.get("debate_rounds", 0) or 0)),
            judge_prompt=str(item.get("judge_prompt") or "").strip(),
        )
        for item in data.get("steps", [])
        if str(item.get("id") or "").strip()
    ]

    return WorkflowDefinition(
        workflow_id=str(data.get("id") or workflow_id).strip(),
        name=str(data.get("name") or workflow_id).strip(),
        description=str(data.get("description") or "").strip(),
        steps=steps,
        agents=agents,
        error_workflow_id=str(data.get("error_workflow_id") or "").strip() or None,
        error_notify_channels=[str(item).strip() for item in (data.get("error_notify_channels") or []) if str(item).strip()],
        source_template_id=str(data.get("source_template_id") or "").strip() or None,
    )


def list_workflows(workflows_dir: str | Path | None = None) -> list[dict[str, Any]]:
    root = Path(workflows_dir) if workflows_dir else WORKFLOWS_DIR
    if not root.exists():
        return []
    items: list[dict[str, Any]] = []
    for yaml_path in sorted(root.glob("*.yaml")):
        try:
            workflow = load_workflow(yaml_path.stem, workflows_dir=root)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load workflow %s: %s", yaml_path.name, exc)
            continue
        items.append(
            {
                "id": workflow.workflow_id,
                "name": workflow.name,
                "description": workflow.description,
                "step_count": len(workflow.steps),
                "agents": [{"id": agent.id, "lobster": agent.lobster} for agent in workflow.agents],
                "error_workflow_id": workflow.error_workflow_id,
                "source_template_id": workflow.source_template_id,
            }
        )
    return items


class WorkflowStore:
    """SQLite persistence for workflow runs, steps, and loop stories."""

    def __init__(self, db_path: str = "data/workflow_engine.sqlite") -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS workflow_runs (
                    run_number INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL UNIQUE,
                    tenant_id TEXT NOT NULL,
                    workflow_id TEXT NOT NULL,
                    task TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    trigger_type TEXT NOT NULL DEFAULT 'manual',
                    source_execution_id TEXT,
                    replay_from_step_id TEXT,
                    idempotency_key TEXT,
                    context_json TEXT NOT NULL DEFAULT '{}',
                    notify_url TEXT,
                    current_step_id TEXT,
                    failure_reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant
                    ON workflow_runs(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
                    ON workflow_runs(workflow_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS workflow_steps (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    step_index INTEGER NOT NULL,
                    agent_id TEXT NOT NULL,
                    lobster_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'waiting',
                    type TEXT NOT NULL DEFAULT 'single',
                    input_template TEXT NOT NULL,
                    rendered_input TEXT,
                    expects TEXT NOT NULL,
                    output_text TEXT,
                    output_json TEXT,
                    error_message TEXT,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    max_retries INTEGER NOT NULL DEFAULT 2,
                    loop_over TEXT,
                    current_story_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_workflow_steps_run
                    ON workflow_steps(run_id, step_index);

                CREATE TABLE IF NOT EXISTS workflow_stories (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    story_index INTEGER NOT NULL,
                    story_key TEXT NOT NULL,
                    title TEXT NOT NULL,
                    input_text TEXT NOT NULL,
                    expects TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'waiting',
                    output_text TEXT,
                    error_message TEXT,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    max_retries INTEGER NOT NULL DEFAULT 2,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_workflow_stories_run
                    ON workflow_stories(run_id, step_id, story_index);
                """
            )
            run_cols = {str(row["name"]) for row in conn.execute("PRAGMA table_info(workflow_runs)").fetchall()}
            if "trigger_type" not in run_cols:
                conn.execute("ALTER TABLE workflow_runs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual'")
            if "source_execution_id" not in run_cols:
                conn.execute("ALTER TABLE workflow_runs ADD COLUMN source_execution_id TEXT")
            if "replay_from_step_id" not in run_cols:
                conn.execute("ALTER TABLE workflow_runs ADD COLUMN replay_from_step_id TEXT")
            if "idempotency_key" not in run_cols:
                conn.execute("ALTER TABLE workflow_runs ADD COLUMN idempotency_key TEXT")
            conn.commit()

    def create_run(
        self,
        *,
        run_id: str,
        tenant_id: str,
        workflow: WorkflowDefinition,
        task: str,
        context: dict[str, Any],
        notify_url: str | None,
        status: str = RunStatus.QUEUED.value,
        trigger_type: str = "manual",
        source_execution_id: str | None = None,
        replay_from_step_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> int:
        now = _utc_now_iso()
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO workflow_runs (
                    run_id, tenant_id, workflow_id, task, status, trigger_type,
                    source_execution_id, replay_from_step_id, idempotency_key, context_json,
                    notify_url, current_step_id, failure_reason, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
                """,
                (
                    run_id,
                    tenant_id,
                    workflow.workflow_id,
                    task,
                    status,
                    trigger_type,
                    source_execution_id,
                    replay_from_step_id,
                    idempotency_key,
                    json.dumps(context or {}, ensure_ascii=False),
                    notify_url,
                    now,
                    now,
                ),
            )
            run_number = int(cur.lastrowid)
            for index, step in enumerate(workflow.steps):
                conn.execute(
                    """
                    INSERT INTO workflow_steps (
                        id, run_id, step_id, step_index, agent_id, lobster_id, status,
                        type, input_template, rendered_input, expects, output_text, output_json,
                        error_message, retry_count, max_retries, loop_over, current_story_id,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, 0, ?, ?, NULL, ?, ?)
                    """,
                    (
                        f"{run_id}:{step.step_id}",
                        run_id,
                        step.step_id,
                        index,
                        step.agent,
                        workflow.resolve_lobster_id(step.agent),
                        StepStatus.WAITING.value,
                        step.step_type,
                        step.input_template,
                        step.expects,
                        step.max_retries,
                        step.loop_over,
                        now,
                        now,
                    ),
                )
            conn.commit()
        return run_number

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM workflow_runs WHERE run_id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        payload = dict(row)
        payload["context"] = _json_loads(payload.pop("context_json", "{}"), {})
        return payload

    def list_runs(self, tenant_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT run_id, run_number, tenant_id, workflow_id, task, status,
                       trigger_type, source_execution_id, replay_from_step_id, idempotency_key,
                       current_step_id, failure_reason, created_at, updated_at
                  FROM workflow_runs
                 WHERE tenant_id = ?
                 ORDER BY run_number DESC
                 LIMIT ?
                """,
                (tenant_id, max(1, min(limit, 200))),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_runs_for_workflow(
        self,
        *,
        tenant_id: str,
        workflow_id: str,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
    ) -> dict[str, Any]:
        safe_page = max(1, int(page or 1))
        safe_page_size = max(1, min(int(page_size or 20), 200))
        offset = (safe_page - 1) * safe_page_size
        query = "FROM workflow_runs WHERE tenant_id = ? AND workflow_id = ?"
        params: list[Any] = [tenant_id, workflow_id]
        if status:
            query += " AND status = ?"
            params.append(status)
        with self._connect() as conn:
            total_row = conn.execute(f"SELECT COUNT(*) AS total {query}", params).fetchone()
            rows = conn.execute(
                f"""SELECT run_id, run_number, tenant_id, workflow_id, task, status,
                           trigger_type, source_execution_id, replay_from_step_id, idempotency_key,
                           current_step_id, failure_reason, created_at, updated_at
                      {query}
                     ORDER BY run_number DESC
                     LIMIT ? OFFSET ?""",
                [*params, safe_page_size, offset],
            ).fetchall()
        total = int(total_row["total"] or 0) if total_row else 0
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            step_rows = self.list_steps(str(row["run_id"]))
            item["latest_round_summary"] = self._latest_round_summary(step_rows)
            items.append(item)
        return {
            "items": items,
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
            "total_pages": max(1, (total + safe_page_size - 1) // safe_page_size),
        }

    def list_steps(self, run_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY step_index ASC",
                (run_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def count_runs_by_statuses(self, tenant_id: str, statuses: list[str]) -> int:
        normalized_statuses = [str(item).strip() for item in statuses if str(item).strip()]
        if not normalized_statuses:
            return 0
        placeholders = ",".join("?" for _ in normalized_statuses)
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) AS total FROM workflow_runs WHERE tenant_id = ? AND status IN ({placeholders})",
                [tenant_id, *normalized_statuses],
            ).fetchone()
        return int(row["total"] or 0) if row else 0

    def list_tenant_ids(self) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT DISTINCT tenant_id FROM workflow_runs ORDER BY tenant_id ASC").fetchall()
        return [str(row["tenant_id"]) for row in rows if str(row["tenant_id"]).strip()]

    def get_step(self, run_id: str, step_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM workflow_steps WHERE run_id = ? AND step_id = ?",
                (run_id, step_id),
            ).fetchone()
        return dict(row) if row is not None else None

    def list_stories(self, run_id: str, step_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM workflow_stories WHERE run_id = ?"
        params: list[Any] = [run_id]
        if step_id:
            query += " AND step_id = ?"
            params.append(step_id)
        query += " ORDER BY step_id ASC, story_index ASC"
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def update_run(
        self,
        run_id: str,
        *,
        status: str | None = None,
        current_step_id: str | None = None,
        failure_reason: str | None = None,
    ) -> None:
        patches: list[str] = []
        values: list[Any] = []
        if status is not None:
            patches.append("status = ?")
            values.append(status)
        if current_step_id is not None:
            patches.append("current_step_id = ?")
            values.append(current_step_id)
        if failure_reason is not None:
            patches.append("failure_reason = ?")
            values.append(failure_reason)
        patches.append("updated_at = ?")
        values.append(_utc_now_iso())
        values.append(run_id)
        with self._connect() as conn:
            conn.execute(f"UPDATE workflow_runs SET {', '.join(patches)} WHERE run_id = ?", values)
            conn.commit()

    def update_step(
        self,
        run_id: str,
        step_id: str,
        *,
        status: str | None = None,
        rendered_input: str | None = None,
        output_text: str | None = None,
        output_json: str | None = None,
        error_message: str | None = None,
        retry_count: int | None = None,
        current_story_id: str | None = None,
    ) -> None:
        patches: list[str] = []
        values: list[Any] = []
        if status is not None:
            patches.append("status = ?")
            values.append(status)
        if rendered_input is not None:
            patches.append("rendered_input = ?")
            values.append(rendered_input)
        if output_text is not None:
            patches.append("output_text = ?")
            values.append(output_text)
        if output_json is not None:
            patches.append("output_json = ?")
            values.append(output_json)
        if error_message is not None:
            patches.append("error_message = ?")
            values.append(error_message)
        if retry_count is not None:
            patches.append("retry_count = ?")
            values.append(retry_count)
        if current_story_id is not None:
            patches.append("current_story_id = ?")
            values.append(current_story_id)
        patches.append("updated_at = ?")
        values.append(_utc_now_iso())
        values.extend([run_id, step_id])
        with self._connect() as conn:
            conn.execute(
                f"UPDATE workflow_steps SET {', '.join(patches)} WHERE run_id = ? AND step_id = ?",
                values,
            )
            conn.commit()

    def replace_stories(
        self,
        *,
        run_id: str,
        step_id: str,
        stories: list[dict[str, Any]],
        max_retries: int,
        expects: str,
    ) -> None:
        now = _utc_now_iso()
        with self._connect() as conn:
            conn.execute("DELETE FROM workflow_stories WHERE run_id = ? AND step_id = ?", (run_id, step_id))
            for index, story in enumerate(stories):
                conn.execute(
                    """
                    INSERT INTO workflow_stories (
                        id, run_id, step_id, story_index, story_key, title, input_text,
                        expects, status, output_text, error_message, retry_count, max_retries,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?)
                    """,
                    (
                        story["id"],
                        run_id,
                        step_id,
                        index,
                        story["story_key"],
                        story["title"],
                        story["input_text"],
                        expects,
                        StepStatus.WAITING.value,
                        max_retries,
                        now,
                        now,
                    ),
                )
            conn.commit()

    def update_story(
        self,
        story_id: str,
        *,
        status: str | None = None,
        output_text: str | None = None,
        error_message: str | None = None,
        retry_count: int | None = None,
    ) -> None:
        patches: list[str] = []
        values: list[Any] = []
        if status is not None:
            patches.append("status = ?")
            values.append(status)
        if output_text is not None:
            patches.append("output_text = ?")
            values.append(output_text)
        if error_message is not None:
            patches.append("error_message = ?")
            values.append(error_message)
        if retry_count is not None:
            patches.append("retry_count = ?")
            values.append(retry_count)
        patches.append("updated_at = ?")
        values.append(_utc_now_iso())
        values.append(story_id)
        with self._connect() as conn:
            conn.execute(f"UPDATE workflow_stories SET {', '.join(patches)} WHERE id = ?", values)
            conn.commit()

    def reset_failed_steps(self, run_id: str) -> int:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT step_id
                  FROM workflow_steps
                 WHERE run_id = ? AND status IN (?, ?)
                """,
                (run_id, StepStatus.FAILED.value, StepStatus.ABANDONED.value),
            ).fetchall()
            count = 0
            for row in rows:
                step_id = str(row["step_id"])
                conn.execute(
                    """
                    UPDATE workflow_steps
                       SET status = ?, rendered_input = NULL, output_text = NULL, output_json = NULL,
                           error_message = NULL, retry_count = 0, current_story_id = NULL, updated_at = ?
                     WHERE run_id = ? AND step_id = ?
                    """,
                    (StepStatus.WAITING.value, _utc_now_iso(), run_id, step_id),
                )
                conn.execute("DELETE FROM workflow_stories WHERE run_id = ? AND step_id = ?", (run_id, step_id))
                count += 1
            if count:
                conn.execute(
                    "UPDATE workflow_runs SET status = ?, failure_reason = NULL, updated_at = ? WHERE run_id = ?",
                    (RunStatus.QUEUED.value, _utc_now_iso(), run_id),
                )
            conn.commit()
        return count


class WorkflowEngine:
    """Execute YAML workflows through LobsterRunner with persistent state."""

    def __init__(
        self,
        *,
        db_path: str = "data/workflow_engine.sqlite",
        workflows_dir: str | Path | None = None,
        runner: Any,
        runtime_lobster_factory: Callable[[str, str], Any],
    ) -> None:
        self.store = WorkflowStore(db_path=db_path)
        self.workflows_dir = Path(workflows_dir) if workflows_dir else WORKFLOWS_DIR
        self.runner = runner
        self.runtime_lobster_factory = runtime_lobster_factory
        self._background_tasks: set[asyncio.Task[Any]] = set()

    async def aclose(self) -> None:
        tasks = list(self._background_tasks)
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception("Background workflow task shutdown failed")

    async def start_run(
        self,
        *,
        run_id: str | None = None,
        tenant_id: str,
        workflow_id: str,
        task: str,
        context: dict[str, Any] | None = None,
        notify_url: str | None = None,
        trigger_type: str = "manual",
        source_execution_id: str | None = None,
        replay_from_step_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        workflow = load_workflow(workflow_id, workflows_dir=self.workflows_dir)
        runtime_context = _build_workflow_runtime_context(context)
        concurrency = get_tenant_concurrency_manager()
        config = concurrency.get_tenant_config(tenant_id)
        await concurrency.enforce_workflow_rate_limit(tenant_id, config.workflow_per_minute)
        queue_depth = self.store.count_runs_by_statuses(
            tenant_id,
            [RunStatus.QUEUED.value, RunStatus.RUNNING.value],
        )
        if config.max_queue_depth > 0 and queue_depth >= config.max_queue_depth:
            raise QueueDepthExceededError(f"queue_full:{tenant_id}:{queue_depth}:{config.max_queue_depth}")
        resolved_run_id = str(run_id or uuid.uuid4())
        self.store.create_run(
            run_id=resolved_run_id,
            tenant_id=tenant_id,
            workflow=workflow,
            task=task,
            context=runtime_context,
            notify_url=notify_url,
            status=RunStatus.QUEUED.value,
            trigger_type=trigger_type,
            source_execution_id=source_execution_id,
            replay_from_step_id=replay_from_step_id,
            idempotency_key=idempotency_key,
        )
        await get_workflow_realtime_hub().publish(
            resolved_run_id,
            {
                "type": "execution_queued",
                "workflow_id": workflow.workflow_id,
                "workflow_name": workflow.name,
                "trigger_type": trigger_type,
                "queue_depth": queue_depth + 1,
            },
        )
        await self._emit_subject_event(
            tenant_id=tenant_id,
            event_type="workflow.execution.queued",
            subject_template="task.{tenant_id}.{workflow_id}.execution.queued",
            payload={
                "workflow_id": workflow.workflow_id,
                "workflow_name": workflow.name,
                "run_id": resolved_run_id,
                "queue_depth": queue_depth + 1,
            },
            workflow_id=workflow.workflow_id,
        )
        self._spawn(self._execute_run(resolved_run_id), name=f"workflow-run:{resolved_run_id}")
        return resolved_run_id

    async def replay_run(
        self,
        run_id: str,
        *,
        from_step_id: str | None = None,
    ) -> str:
        run = self.store.get_run(run_id)
        if run is None:
            raise KeyError(run_id)
        return await self.start_run(
            tenant_id=str(run["tenant_id"]),
            workflow_id=str(run["workflow_id"]),
            task=str(run["task"]),
            context=dict(run.get("context") or {}),
            notify_url=str(run.get("notify_url") or "").strip() or None,
            trigger_type="replay",
            source_execution_id=run_id,
            replay_from_step_id=from_step_id,
        )

    async def resume_run(self, run_id: str) -> bool:
        run = self.store.get_run(run_id)
        if run is None or str(run.get("status")) != RunStatus.PAUSED.value:
            return False
        reset_count = self.store.reset_failed_steps(run_id)
        if reset_count <= 0:
            self.store.update_run(run_id, status=RunStatus.QUEUED.value, failure_reason="")
        self._spawn(self._execute_run(run_id), name=f"workflow-resume:{run_id}")
        return True

    async def pause_run(self, run_id: str, reason: str = "manual_pause") -> bool:
        run = self.store.get_run(run_id)
        if run is None:
            return False
        self.store.update_run(run_id, status=RunStatus.PAUSED.value, failure_reason=reason)
        return True

    async def list_runs(self, tenant_id: str, limit: int = 20) -> list[dict[str, Any]]:
        return self.store.list_runs(tenant_id, limit=limit)

    async def get_run_status(self, run_id: str) -> dict[str, Any]:
        run = self.store.get_run(run_id)
        if run is None:
            return {}
        steps = self.store.list_steps(run_id)
        stories = self.store.list_stories(run_id)
        stories_by_step: dict[str, list[dict[str, Any]]] = {}
        for item in stories:
            stories_by_step.setdefault(str(item["step_id"]), []).append(item)
        return {
            "run_id": str(run["run_id"]),
            "run_number": int(run["run_number"]),
            "tenant_id": str(run["tenant_id"]),
            "workflow_id": str(run["workflow_id"]),
            "task": str(run["task"]),
            "status": str(run["status"]),
            "trigger_type": str(run.get("trigger_type") or "manual"),
            "source_execution_id": run.get("source_execution_id"),
            "replay_from_step_id": run.get("replay_from_step_id"),
            "idempotency_key": run.get("idempotency_key"),
            "current_step_id": run.get("current_step_id"),
            "failure_reason": run.get("failure_reason"),
            "created_at": str(run["created_at"]),
            "updated_at": str(run["updated_at"]),
            "steps": [self._serialize_step_row(item, stories_by_step.get(str(item["step_id"]), [])) for item in steps],
        }

    def _serialize_step_row(self, row: dict[str, Any], stories: list[dict[str, Any]]) -> dict[str, Any]:
        preview = str(row.get("output_text") or "").strip()
        if not preview and row.get("output_json"):
            parsed = _json_loads(str(row.get("output_json")), [])
            preview = _stringify_template_value(parsed)
        return {
            "step_id": str(row["step_id"]),
            "agent_id": str(row["agent_id"]),
            "lobster_id": str(row["lobster_id"]),
            "status": str(row["status"]),
            "step_type": str(row["type"]),
            "retry_count": int(row.get("retry_count") or 0),
            "max_retries": int(row.get("max_retries") or 0),
            "expects": str(row.get("expects") or ""),
            "current_story_id": row.get("current_story_id"),
            "rendered_input": str(row.get("rendered_input") or ""),
            "output_text": str(row.get("output_text") or ""),
            "output_json": _json_loads(str(row.get("output_json") or ""), [] if str(row.get("type")) == "loop" else {}),
            "output_preview": preview[:200],
            "error_message": row.get("error_message"),
            "updated_at": str(row["updated_at"]),
            "stories": [
                {
                    "story_id": str(item["story_key"]),
                    "title": str(item["title"]),
                    "status": str(item["status"]),
                    "retry_count": int(item.get("retry_count") or 0),
                    "output_preview": str(item.get("output_text") or "")[:160],
                    "error_message": item.get("error_message"),
                    "updated_at": str(item["updated_at"]),
                }
                for item in stories
            ],
        }

    def _latest_round_summary(self, step_rows: list[dict[str, Any]]) -> str | None:
        for row in reversed(step_rows):
            payload = _json_loads(str(row.get("output_json") or ""), {})
            if not isinstance(payload, dict):
                continue
            mode = str(payload.get("mode") or "")
            if mode == "ccv_loop":
                rounds = payload.get("rounds") or []
                if isinstance(rounds, list) and rounds:
                    return f"ccv_loop rounds={len(rounds)} approved={bool(rounds[-1].get('approved', False))}"
            if mode == "debate_judge":
                return "debate_judge proposals=2 judge_completed"
        return None

    def _spawn(self, coro: Awaitable[Any], *, name: str) -> None:
        task = asyncio.create_task(coro, name=name)
        self._background_tasks.add(task)

        def _cleanup(done: asyncio.Task[Any]) -> None:
            self._background_tasks.discard(done)

        task.add_done_callback(_cleanup)

    async def _execute_run(self, run_id: str) -> None:
        run = self.store.get_run(run_id)
        if run is None:
            return
        workflow = load_workflow(str(run["workflow_id"]), workflows_dir=self.workflows_dir)
        tenant_id = str(run["tenant_id"])
        context = dict(run.get("context") or {})
        step_outputs = self._rebuild_completed_outputs(run_id)
        replay_from_step_id = str(run.get("replay_from_step_id") or "").strip() or None
        source_execution_id = str(run.get("source_execution_id") or "").strip() or None
        source_steps = {
            str(item["step_id"]): item
            for item in self.store.list_steps(source_execution_id)
        } if source_execution_id else {}
        replay_started = replay_from_step_id is None
        realtime_hub = get_workflow_realtime_hub()
        concurrency = get_tenant_concurrency_manager()
        config = concurrency.get_tenant_config(tenant_id)
        workflow_slot_acquired = False
        trace_id = ""

        try:
            await concurrency.wait_for_slot(
                tenant_id=tenant_id,
                resource="workflows",
                max_limit=config.max_concurrent_workflows,
                wait_timeout_seconds=300,
                poll_interval_seconds=2,
            )
            workflow_slot_acquired = True
            self.store.update_run(run_id, status=RunStatus.RUNNING.value, current_step_id="", failure_reason="")
            await realtime_hub.publish(
                run_id,
                {
                    "type": "execution_started",
                    "workflow_id": workflow.workflow_id,
                    "workflow_name": workflow.name,
                    "task": str(run["task"]),
                    "total_steps": len(workflow.steps),
                },
            )
            await self._emit_subject_event(
                tenant_id=tenant_id,
                event_type="workflow.execution.started",
                subject_template="task.{tenant_id}.{workflow_id}.execution.started",
                payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "task": str(run["task"])},
                workflow_id=workflow.workflow_id,
            )
            trace_id = LangfuseTracer.start_workflow_trace(
                workflow_id=run_id,
                workflow_name=workflow.workflow_id,
                tenant_id=tenant_id,
                input_summary={
                    "workflow_name": workflow.name,
                    "step_count": len(workflow.steps),
                    "task": str(run["task"]),
                },
                metadata={"workflow_id": workflow.workflow_id},
            )
            for step_index, step in enumerate(workflow.steps):
                latest = self.store.get_run(run_id)
                if latest is None or str(latest.get("status")) != RunStatus.RUNNING.value:
                    if trace_id:
                        LangfuseTracer.end_workflow_trace(trace_id, status="cancelled", output={"steps_completed": len(step_outputs)})
                    await realtime_hub.publish(
                        run_id,
                        {
                            "type": "execution_cancelled",
                            "status": str((latest or {}).get("status") or RunStatus.CANCELLED.value),
                            "steps_completed": len(step_outputs),
                        },
                    )
                    return
                step_row = self.store.get_step(run_id, step.step_id)
                if step_row is None:
                    continue
                if str(step_row.get("status")) in {StepStatus.DONE.value, StepStatus.SKIPPED.value}:
                    step_outputs[step.step_id] = self._materialize_step_output(step_row)
                    continue

                if source_steps and not replay_started:
                    if step.step_id == replay_from_step_id:
                        replay_started = True
                    else:
                        source_step = source_steps.get(step.step_id)
                        if source_step and str(source_step.get("status")) == StepStatus.DONE.value:
                            self.store.update_step(
                                run_id,
                                step.step_id,
                                status=StepStatus.SKIPPED.value,
                                rendered_input=str(source_step.get("rendered_input") or ""),
                                output_text=str(source_step.get("output_text") or ""),
                                output_json=str(source_step.get("output_json") or ""),
                                error_message="replay_skipped_using_source",
                                current_story_id="",
                            )
                            await realtime_hub.publish(
                                run_id,
                                {
                                    "type": "step_skipped",
                                    "step_index": step_index,
                                    "step_id": step.step_id,
                                    "lobster_id": workflow.resolve_lobster_id(step.agent),
                                    "reason": "replay_skipped_using_source",
                                },
                            )
                            await self._emit_subject_event(
                                tenant_id=tenant_id,
                                event_type="workflow.step.skipped",
                                subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.skipped",
                                payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id},
                                workflow_id=workflow.workflow_id,
                                step_id=step.step_id,
                            )
                            step_outputs[step.step_id] = self._materialize_step_output(source_step)
                            continue
                        replay_started = True

                self.store.update_run(run_id, current_step_id=step.step_id)
                render_ctx = {
                    "task": str(run["task"]),
                    "context": context,
                    "steps": step_outputs,
                }
                if step.step_type == "loop":
                    ok, output = await self._execute_loop_step(run_id, workflow, step, render_ctx, trace_id=trace_id, step_index=step_index)
                    if not ok:
                        if trace_id:
                            LangfuseTracer.end_workflow_trace(trace_id, status="failed", output={"steps_completed": len(step_outputs)})
                        get_workflow_idempotency_store().update_by_run(
                            run_id,
                            status=RunStatus.FAILED.value,
                            result_summary={"failed_step_id": step.step_id},
                        )
                        await realtime_hub.publish(
                            run_id,
                            {"type": "execution_failed", "failed_step_id": step.step_id, "steps_completed": len(step_outputs)},
                        )
                        await self._emit_subject_event(
                            tenant_id=tenant_id,
                            event_type="workflow.execution.failed",
                            subject_template="task.{tenant_id}.{workflow_id}.execution.failed",
                            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "failed_step_id": step.step_id},
                            workflow_id=workflow.workflow_id,
                        )
                        return
                    step_outputs[step.step_id] = {"outputs": output}
                elif step.step_type == "ccv_loop":
                    ok, output, details = await self._execute_ccv_loop_step(
                        run_id,
                        workflow,
                        step,
                        render_ctx,
                        trace_id=trace_id,
                        step_index=step_index,
                    )
                    if not ok:
                        if trace_id:
                            LangfuseTracer.end_workflow_trace(trace_id, status="failed", output={"steps_completed": len(step_outputs)})
                        get_workflow_idempotency_store().update_by_run(
                            run_id,
                            status=RunStatus.FAILED.value,
                            result_summary={"failed_step_id": step.step_id},
                        )
                        await realtime_hub.publish(
                            run_id,
                            {"type": "execution_failed", "failed_step_id": step.step_id, "steps_completed": len(step_outputs)},
                        )
                        await self._emit_subject_event(
                            tenant_id=tenant_id,
                            event_type="workflow.execution.failed",
                            subject_template="task.{tenant_id}.{workflow_id}.execution.failed",
                            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "failed_step_id": step.step_id},
                            workflow_id=workflow.workflow_id,
                        )
                        return
                    step_outputs[step.step_id] = {"output": output, "details": details}
                elif step.step_type == "debate_judge":
                    ok, output, details = await self._execute_debate_judge_step(
                        run_id,
                        workflow,
                        step,
                        render_ctx,
                        trace_id=trace_id,
                        step_index=step_index,
                    )
                    if not ok:
                        if trace_id:
                            LangfuseTracer.end_workflow_trace(trace_id, status="failed", output={"steps_completed": len(step_outputs)})
                        get_workflow_idempotency_store().update_by_run(
                            run_id,
                            status=RunStatus.FAILED.value,
                            result_summary={"failed_step_id": step.step_id},
                        )
                        await realtime_hub.publish(
                            run_id,
                            {"type": "execution_failed", "failed_step_id": step.step_id, "steps_completed": len(step_outputs)},
                        )
                        await self._emit_subject_event(
                            tenant_id=tenant_id,
                            event_type="workflow.execution.failed",
                            subject_template="task.{tenant_id}.{workflow_id}.execution.failed",
                            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "failed_step_id": step.step_id},
                            workflow_id=workflow.workflow_id,
                        )
                        return
                    step_outputs[step.step_id] = {"output": output, "details": details}
                else:
                    ok, output = await self._execute_single_step(run_id, workflow, step, render_ctx, trace_id=trace_id, step_index=step_index)
                    if not ok:
                        if trace_id:
                            LangfuseTracer.end_workflow_trace(trace_id, status="failed", output={"steps_completed": len(step_outputs)})
                        get_workflow_idempotency_store().update_by_run(
                            run_id,
                            status=RunStatus.FAILED.value,
                            result_summary={"failed_step_id": step.step_id},
                        )
                        await realtime_hub.publish(
                            run_id,
                            {"type": "execution_failed", "failed_step_id": step.step_id, "steps_completed": len(step_outputs)},
                        )
                        await self._emit_subject_event(
                            tenant_id=tenant_id,
                            event_type="workflow.execution.failed",
                            subject_template="task.{tenant_id}.{workflow_id}.execution.failed",
                            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "failed_step_id": step.step_id},
                            workflow_id=workflow.workflow_id,
                        )
                        return
                    step_outputs[step.step_id] = {"output": output}

            self.store.update_run(
                run_id,
                status=RunStatus.DONE.value,
                current_step_id=workflow.steps[-1].step_id if workflow.steps else None,
                failure_reason="",
            )
            await self._record_audit(
                "workflow_run_complete",
                {
                    "run_id": run_id,
                    "tenant_id": str(run["tenant_id"]),
                    "workflow_id": workflow.workflow_id,
                    "trace_id": trace_id,
                },
            )
            if trace_id:
                LangfuseTracer.end_workflow_trace(trace_id, status="completed", output={"steps_completed": len(step_outputs)})
            get_workflow_idempotency_store().update_by_run(
                run_id,
                status=RunStatus.DONE.value,
                result_summary={"steps_completed": len(step_outputs), "workflow_id": workflow.workflow_id},
            )
            await realtime_hub.publish(
                run_id,
                {"type": "execution_completed", "steps_completed": len(step_outputs), "total_steps": len(workflow.steps)},
            )
            await self._emit_subject_event(
                tenant_id=tenant_id,
                event_type="workflow.execution.completed",
                subject_template="task.{tenant_id}.{workflow_id}.execution.completed",
                payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "steps_completed": len(step_outputs)},
                workflow_id=workflow.workflow_id,
            )
        except (ConcurrencyAcquireTimeoutError, WorkflowRateLimitedError, QueueDepthExceededError) as exc:
            self.store.update_run(
                run_id,
                status=RunStatus.FAILED.value,
                current_step_id="",
                failure_reason=str(exc),
            )
            get_workflow_idempotency_store().update_by_run(
                run_id,
                status=RunStatus.FAILED.value,
                result_summary={"error": str(exc)},
            )
            await realtime_hub.publish(run_id, {"type": "execution_failed", "error": str(exc), "failed_step_id": None})
            await self._emit_subject_event(
                tenant_id=tenant_id,
                event_type="workflow.execution.failed",
                subject_template="task.{tenant_id}.{workflow_id}.execution.failed",
                payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "error": str(exc)},
                workflow_id=workflow.workflow_id,
            )
        except Exception as exc:
            self.store.update_run(
                run_id,
                status=RunStatus.FAILED.value,
                current_step_id="",
                failure_reason=str(exc)[:1000],
            )
            if trace_id:
                LangfuseTracer.end_workflow_trace(trace_id, status="error", output={"steps_completed": len(step_outputs)})
            get_workflow_idempotency_store().update_by_run(
                run_id,
                status=RunStatus.FAILED.value,
                result_summary={"error": "unhandled_execution_error"},
            )
            await realtime_hub.publish(run_id, {"type": "execution_failed", "error": str(exc), "failed_step_id": None})
            await self._emit_subject_event(
                tenant_id=tenant_id,
                event_type="workflow.execution.failed",
                subject_template="task.{tenant_id}.{workflow_id}.execution.failed",
                payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "error": str(exc)},
                workflow_id=workflow.workflow_id,
            )
            raise
        finally:
            if workflow_slot_acquired:
                await concurrency.release(tenant_id, "workflows")

    async def _execute_single_step(
        self,
        run_id: str,
        workflow: WorkflowDefinition,
        step: WorkflowStep,
        render_ctx: dict[str, Any],
        *,
        trace_id: str,
        step_index: int,
    ) -> tuple[bool, str]:
        rendered_input = render_template(step.input_template, render_ctx)
        tenant_id = str((self.store.get_run(run_id) or {}).get("tenant_id") or "tenant_main")
        step_started_at = datetime.now(timezone.utc)
        await get_workflow_realtime_hub().publish(
            run_id,
            {
                "type": "step_started",
                "step_index": step_index,
                "step_id": step.step_id,
                "lobster_id": workflow.resolve_lobster_id(step.agent),
                "skill_name": step.step_id,
            },
        )
        await self._emit_subject_event(
            tenant_id=tenant_id,
            event_type="workflow.step.started",
            subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.started",
            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id},
            workflow_id=workflow.workflow_id,
            step_id=step.step_id,
        )
        for attempt in range(step.max_retries + 1):
            self.store.update_step(
                run_id,
                step.step_id,
                status=StepStatus.RUNNING.value,
                rendered_input=rendered_input,
                retry_count=attempt,
                error_message="",
                current_story_id="",
            )
            try:
                output = await self._run_lobster_step(
                    workflow=workflow,
                    step=step,
                    run_id=run_id,
                    user_input=rendered_input,
                    story_key=None,
                    trace_id=trace_id,
                    span_suffix=step.step_id,
                    step_index=step_index,
                )
                self._assert_expectation(step.expects, output)
                self.store.update_step(
                    run_id,
                    step.step_id,
                    status=StepStatus.DONE.value,
                    output_text=output,
                    output_json="",
                    error_message="",
                    retry_count=attempt,
                    current_story_id="",
                )
                duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                await get_workflow_realtime_hub().publish(
                    run_id,
                    {
                        "type": "step_completed",
                        "step_index": step_index,
                        "step_id": step.step_id,
                        "lobster_id": workflow.resolve_lobster_id(step.agent),
                        "duration_ms": duration_ms,
                    },
                )
                await self._emit_subject_event(
                    tenant_id=tenant_id,
                    event_type="workflow.step.completed",
                    subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.completed",
                    payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id, "duration_ms": duration_ms},
                    workflow_id=workflow.workflow_id,
                    step_id=step.step_id,
                )
                return True, output
            except Exception as exc:  # noqa: BLE001
                if attempt >= step.max_retries:
                    self.store.update_step(
                        run_id,
                        step.step_id,
                        status=StepStatus.FAILED.value,
                        error_message=str(exc),
                        retry_count=attempt,
                        current_story_id="",
                    )
                    duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                    await get_workflow_realtime_hub().publish(
                        run_id,
                        {
                            "type": "step_failed",
                            "step_index": step_index,
                            "step_id": step.step_id,
                            "lobster_id": workflow.resolve_lobster_id(step.agent),
                            "error": str(exc),
                            "duration_ms": duration_ms,
                        },
                    )
                    await self._emit_subject_event(
                        tenant_id=tenant_id,
                        event_type="workflow.step.failed",
                        subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.failed",
                        payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id, "error": str(exc)},
                        workflow_id=workflow.workflow_id,
                        step_id=step.step_id,
                    )
                    await self._handle_workflow_failure(
                        run_id=run_id,
                        workflow=workflow,
                        step=step,
                        reason=str(exc),
                        tenant_id=tenant_id,
                    )
                    return False, ""
                await asyncio.sleep(self._retry_delay_seconds(step, attempt))
        return False, ""

    async def _execute_loop_step(
        self,
        run_id: str,
        workflow: WorkflowDefinition,
        step: WorkflowStep,
        render_ctx: dict[str, Any],
        *,
        trace_id: str,
        step_index: int,
    ) -> tuple[bool, list[str]]:
        items = self._resolve_loop_items(step.loop_over, render_ctx)
        tenant_id = str((self.store.get_run(run_id) or {}).get("tenant_id") or "tenant_main")
        step_started_at = datetime.now(timezone.utc)
        await get_workflow_realtime_hub().publish(
            run_id,
            {
                "type": "step_started",
                "step_index": step_index,
                "step_id": step.step_id,
                "lobster_id": workflow.resolve_lobster_id(step.agent),
                "skill_name": step.step_id,
                "loop_count": len(items),
            },
        )
        await self._emit_subject_event(
            tenant_id=tenant_id,
            event_type="workflow.step.started",
            subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.started",
            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id, "loop_count": len(items)},
            workflow_id=workflow.workflow_id,
            step_id=step.step_id,
        )
        stories = self._build_story_rows(run_id, step, items)
        self.store.replace_stories(
            run_id=run_id,
            step_id=step.step_id,
            stories=stories,
            max_retries=step.max_retries,
            expects=step.expects,
        )
        if not items:
            self.store.update_step(
                run_id,
                step.step_id,
                status=StepStatus.DONE.value,
                rendered_input="",
                output_json=json.dumps([], ensure_ascii=False),
                output_text="",
                current_story_id="",
                error_message="",
            )
            await get_workflow_realtime_hub().publish(
                run_id,
                {
                    "type": "step_completed",
                    "step_index": step_index,
                    "step_id": step.step_id,
                    "lobster_id": workflow.resolve_lobster_id(step.agent),
                    "duration_ms": 0,
                },
            )
            await self._emit_subject_event(
                tenant_id=tenant_id,
                event_type="workflow.step.completed",
                subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.completed",
                payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id, "duration_ms": 0},
                workflow_id=workflow.workflow_id,
                step_id=step.step_id,
            )
            return True, []

        outputs: list[str] = []
        singular_key = self._singularize(step.loop_over)
        for index, item in enumerate(items):
            story = stories[index]
            story_context = dict(render_ctx)
            story_context["loop_item"] = item
            if singular_key:
                story_context[singular_key] = item
            input_text = render_template(step.input_template, story_context)
            self.store.update_step(
                run_id,
                step.step_id,
                status=StepStatus.RUNNING.value,
                rendered_input=input_text,
                current_story_id=story["story_key"],
            )

            success = False
            for attempt in range(step.max_retries + 1):
                self.store.update_story(
                    story["id"],
                    status=StepStatus.RUNNING.value,
                    retry_count=attempt,
                    error_message="",
                )
                try:
                    output = await self._run_lobster_step(
                        workflow=workflow,
                        step=step,
                        run_id=run_id,
                        user_input=input_text,
                        story_key=story["story_key"],
                        trace_id=trace_id,
                        span_suffix=story["story_key"],
                        step_index=step_index,
                    )
                    self._assert_expectation(step.expects, output)
                    self.store.update_story(
                        story["id"],
                        status=StepStatus.DONE.value,
                        output_text=output,
                        retry_count=attempt,
                        error_message="",
                    )
                    outputs.append(output)
                    success = True
                    break
                except Exception as exc:  # noqa: BLE001
                    self.store.update_story(
                        story["id"],
                        status=StepStatus.FAILED.value if attempt >= step.max_retries else StepStatus.RUNNING.value,
                        retry_count=attempt,
                        error_message=str(exc),
                    )
                    if attempt >= step.max_retries:
                        self.store.update_step(
                            run_id,
                            step.step_id,
                            status=StepStatus.FAILED.value,
                            error_message=f"{story['story_key']}: {exc}",
                            retry_count=attempt,
                            current_story_id=story["story_key"],
                        )
                        duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                        await get_workflow_realtime_hub().publish(
                            run_id,
                            {
                                "type": "step_failed",
                                "step_index": step_index,
                                "step_id": step.step_id,
                                "lobster_id": workflow.resolve_lobster_id(step.agent),
                                "error": f"{story['story_key']}: {exc}",
                                "duration_ms": duration_ms,
                            },
                        )
                        await self._emit_subject_event(
                            tenant_id=tenant_id,
                            event_type="workflow.step.failed",
                            subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.failed",
                            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id, "error": f"{story['story_key']}: {exc}"},
                            workflow_id=workflow.workflow_id,
                            step_id=step.step_id,
                        )
                        await self._handle_workflow_failure(
                            run_id=run_id,
                            workflow=workflow,
                            step=step,
                            reason=f"{story['story_key']}: {exc}",
                            tenant_id=tenant_id,
                        )
                        return False, outputs
                    await asyncio.sleep(self._retry_delay_seconds(step, attempt))

            if not success:
                return False, outputs

        self.store.update_step(
            run_id,
            step.step_id,
            status=StepStatus.DONE.value,
            rendered_input="",
            output_text="",
            output_json=json.dumps(outputs, ensure_ascii=False),
            error_message="",
            current_story_id="",
        )
        duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
        await get_workflow_realtime_hub().publish(
            run_id,
            {
                "type": "step_completed",
                "step_index": step_index,
                "step_id": step.step_id,
                "lobster_id": workflow.resolve_lobster_id(step.agent),
                "duration_ms": duration_ms,
            },
        )
        await self._emit_subject_event(
            tenant_id=tenant_id,
            event_type="workflow.step.completed",
            subject_template="task.{tenant_id}.{workflow_id}.step.{step_id}.completed",
            payload={"workflow_id": workflow.workflow_id, "run_id": run_id, "step_id": step.step_id, "duration_ms": duration_ms},
            workflow_id=workflow.workflow_id,
            step_id=step.step_id,
        )
        return True, outputs

    async def _execute_ccv_loop_step(
        self,
        run_id: str,
        workflow: WorkflowDefinition,
        step: WorkflowStep,
        render_ctx: dict[str, Any],
        *,
        trace_id: str,
        step_index: int,
    ) -> tuple[bool, str, dict[str, Any]]:
        rendered_input = render_template(step.input_template, render_ctx)
        tenant_id = str((self.store.get_run(run_id) or {}).get("tenant_id") or "tenant_main")
        step_started_at = datetime.now(timezone.utc)
        action_lobster = str(step.action_lobster or workflow.resolve_lobster_id(step.agent)).strip() or workflow.resolve_lobster_id(step.agent)
        approval_signal = str(step.approval_signal or "APPROVED").strip() or "APPROVED"
        rounds_payload: list[dict[str, Any]] = []
        final_output = ""

        await get_workflow_realtime_hub().publish(
            run_id,
            {
                "type": "step_started",
                "step_index": step_index,
                "step_id": step.step_id,
                "lobster_id": action_lobster,
                "skill_name": step.step_id,
                "step_mode": "ccv_loop",
                "max_rounds": step.max_rounds,
            },
        )

        for attempt in range(step.max_retries + 1):
            critique_notes: list[str] = []
            rounds_payload = []
            try:
                for round_num in range(1, step.max_rounds + 1):
                    draft_prompt = rendered_input
                    if critique_notes:
                        draft_prompt += "\n\n[上一轮批评意见]\n" + "\n".join(f"- {item}" for item in critique_notes)
                        draft_prompt += "\n请据此修正并重新输出完整结果。"
                    draft_output = await self._run_lobster_step(
                        workflow=workflow,
                        step=step,
                        run_id=run_id,
                        user_input=draft_prompt,
                        story_key=f"ccv:{round_num}:action",
                        trace_id=trace_id,
                        span_suffix=f"{step.step_id}:ccv:round{round_num}:action",
                        step_index=step_index,
                        lobster_id_override=action_lobster,
                    )
                    final_output = draft_output
                    round_record: dict[str, Any] = {
                        "round": round_num,
                        "action_lobster": action_lobster,
                        "draft": draft_output,
                        "critiques": [],
                    }
                    all_approved = True
                    critique_notes = []
                    for critic_cfg in step.critique_lobsters:
                        critic_lobster = str(critic_cfg.get("lobster") or "").strip()
                        focus = str(critic_cfg.get("focus") or "").strip()
                        if not critic_lobster:
                            continue
                        critic_prompt = (
                            f"请专注评审：{focus or '输出质量与一致性'}。\n"
                            f"如果通过，请在回复开头写 {approval_signal}。\n\n"
                            f"[原始任务]\n{rendered_input}\n\n"
                            f"[当前草案]\n{draft_output}"
                        )
                        feedback = await self._run_lobster_step(
                            workflow=workflow,
                            step=step,
                            run_id=run_id,
                            user_input=critic_prompt,
                            story_key=f"ccv:{round_num}:critic:{critic_lobster}",
                            trace_id=trace_id,
                            span_suffix=f"{step.step_id}:ccv:round{round_num}:{critic_lobster}",
                            step_index=step_index,
                            lobster_id_override=critic_lobster,
                        )
                        approved = approval_signal.lower() in feedback.lower()
                        round_record["critiques"].append(
                            {
                                "lobster": critic_lobster,
                                "focus": focus,
                                "feedback": feedback,
                                "approved": approved,
                            }
                        )
                        if not approved:
                            all_approved = False
                            critique_notes.append(f"{critic_lobster}({focus or 'general'}): {feedback}")
                            break
                    round_record["approved"] = all_approved
                    rounds_payload.append(round_record)
                    await get_workflow_realtime_hub().publish(
                        run_id,
                        {
                            "type": "ccv_round",
                            "step_index": step_index,
                            "step_id": step.step_id,
                            "round": round_num,
                            "approved": all_approved,
                            "action_lobster": action_lobster,
                            "critique_count": len(round_record["critiques"]),
                        },
                    )
                    if all_approved:
                        details = {
                            "mode": "ccv_loop",
                            "max_rounds": step.max_rounds,
                            "approval_signal": approval_signal,
                            "rounds": rounds_payload,
                            "final_output": final_output,
                        }
                        self.store.update_step(
                            run_id,
                            step.step_id,
                            status=StepStatus.DONE.value,
                            rendered_input=rendered_input,
                            output_text=final_output,
                            output_json=json.dumps(details, ensure_ascii=False),
                            error_message="",
                            retry_count=attempt,
                            current_story_id="",
                        )
                        duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                        await get_workflow_realtime_hub().publish(
                            run_id,
                            {
                                "type": "step_completed",
                                "step_index": step_index,
                                "step_id": step.step_id,
                                "lobster_id": action_lobster,
                                "duration_ms": duration_ms,
                                "step_mode": "ccv_loop",
                                "round_count": len(rounds_payload),
                            },
                        )
                        return True, final_output, details
                details = {
                    "mode": "ccv_loop",
                    "max_rounds": step.max_rounds,
                    "approval_signal": approval_signal,
                    "rounds": rounds_payload,
                    "final_output": final_output,
                    "exhausted": True,
                }
                self.store.update_step(
                    run_id,
                    step.step_id,
                    status=StepStatus.DONE.value,
                    rendered_input=rendered_input,
                    output_text=final_output,
                    output_json=json.dumps(details, ensure_ascii=False),
                    error_message="",
                    retry_count=attempt,
                    current_story_id="",
                )
                duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                await get_workflow_realtime_hub().publish(
                    run_id,
                    {
                        "type": "step_completed",
                        "step_index": step_index,
                        "step_id": step.step_id,
                        "lobster_id": action_lobster,
                        "duration_ms": duration_ms,
                        "step_mode": "ccv_loop",
                        "round_count": len(rounds_payload),
                        "approval_exhausted": True,
                    },
                )
                return True, final_output, details
            except Exception as exc:  # noqa: BLE001
                if attempt >= step.max_retries:
                    self.store.update_step(
                        run_id,
                        step.step_id,
                        status=StepStatus.FAILED.value,
                        rendered_input=rendered_input,
                        output_json=json.dumps({"mode": "ccv_loop", "rounds": rounds_payload}, ensure_ascii=False),
                        error_message=str(exc),
                        retry_count=attempt,
                        current_story_id="",
                    )
                    duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                    await get_workflow_realtime_hub().publish(
                        run_id,
                        {
                            "type": "step_failed",
                            "step_index": step_index,
                            "step_id": step.step_id,
                            "lobster_id": action_lobster,
                            "error": str(exc),
                            "duration_ms": duration_ms,
                            "step_mode": "ccv_loop",
                        },
                    )
                    await self._handle_workflow_failure(
                        run_id=run_id,
                        workflow=workflow,
                        step=step,
                        reason=str(exc),
                        tenant_id=tenant_id,
                    )
                    return False, "", {}
                await asyncio.sleep(self._retry_delay_seconds(step, attempt))
        return False, "", {}

    async def _execute_debate_judge_step(
        self,
        run_id: str,
        workflow: WorkflowDefinition,
        step: WorkflowStep,
        render_ctx: dict[str, Any],
        *,
        trace_id: str,
        step_index: int,
    ) -> tuple[bool, str, dict[str, Any]]:
        rendered_input = render_template(step.input_template, render_ctx)
        tenant_id = str((self.store.get_run(run_id) or {}).get("tenant_id") or "tenant_main")
        step_started_at = datetime.now(timezone.utc)
        proposer = str(step.proposer or workflow.resolve_lobster_id(step.agent)).strip() or workflow.resolve_lobster_id(step.agent)
        judge_lobster = str(step.judge or "commander").strip() or "commander"

        await get_workflow_realtime_hub().publish(
            run_id,
            {
                "type": "step_started",
                "step_index": step_index,
                "step_id": step.step_id,
                "lobster_id": proposer,
                "skill_name": step.step_id,
                "step_mode": "debate_judge",
            },
        )

        proposals_payload: dict[str, Any] = {}
        final_output = ""
        for attempt in range(step.max_retries + 1):
            try:
                proposal_a, proposal_b = await asyncio.gather(
                    self._run_lobster_step(
                        workflow=workflow,
                        step=step,
                        run_id=run_id,
                        user_input=rendered_input,
                        story_key="debate:proposal_a",
                        trace_id=trace_id,
                        span_suffix=f"{step.step_id}:proposal_a",
                        step_index=step_index,
                        lobster_id_override=proposer,
                        task_id_suffix="proposal_a",
                    ),
                    self._run_lobster_step(
                        workflow=workflow,
                        step=step,
                        run_id=run_id,
                        user_input=rendered_input,
                        story_key="debate:proposal_b",
                        trace_id=trace_id,
                        span_suffix=f"{step.step_id}:proposal_b",
                        step_index=step_index,
                        lobster_id_override=proposer,
                        task_id_suffix="proposal_b",
                    ),
                )
                proposals_payload = {"proposal_a": proposal_a, "proposal_b": proposal_b}
                critiques: list[dict[str, Any]] = []
                current_a = proposal_a
                current_b = proposal_b
                for round_idx in range(1, step.debate_rounds + 1):
                    critique_a = await self._run_lobster_step(
                        workflow=workflow,
                        step=step,
                        run_id=run_id,
                        user_input=(
                            f"请批评下面这个方案的不足，并说明你的方案为什么更好。\n\n"
                            f"[你的方案]\n{current_a}\n\n[对方方案]\n{current_b}"
                        ),
                        story_key=f"debate:critique_a:{round_idx}",
                        trace_id=trace_id,
                        span_suffix=f"{step.step_id}:critique_a:{round_idx}",
                        step_index=step_index,
                        lobster_id_override=proposer,
                        task_id_suffix=f"critique_a_{round_idx}",
                    )
                    critique_b = await self._run_lobster_step(
                        workflow=workflow,
                        step=step,
                        run_id=run_id,
                        user_input=(
                            f"请批评下面这个方案的不足，并说明你的方案为什么更好。\n\n"
                            f"[你的方案]\n{current_b}\n\n[对方方案]\n{current_a}"
                        ),
                        story_key=f"debate:critique_b:{round_idx}",
                        trace_id=trace_id,
                        span_suffix=f"{step.step_id}:critique_b:{round_idx}",
                        step_index=step_index,
                        lobster_id_override=proposer,
                        task_id_suffix=f"critique_b_{round_idx}",
                    )
                    critiques.append({"round": round_idx, "critique_a": critique_a, "critique_b": critique_b})
                    await get_workflow_realtime_hub().publish(
                        run_id,
                        {
                            "type": "debate_round",
                            "step_index": step_index,
                            "step_id": step.step_id,
                            "round": round_idx,
                            "proposer": proposer,
                        },
                    )
                judge_input = (
                    f"{rendered_input}\n\n"
                    f"[proposal_a]\n{proposal_a}\n\n"
                    f"[proposal_b]\n{proposal_b}\n\n"
                    f"[judge_instruction]\n{step.judge_prompt or '从质量与可执行性角度选出更优方案，输出最终内容。'}"
                )
                if critiques:
                    judge_input += "\n\n[debate_history]\n" + json.dumps(critiques, ensure_ascii=False, indent=2)
                final_output = await self._run_lobster_step(
                    workflow=workflow,
                    step=step,
                    run_id=run_id,
                    user_input=judge_input,
                    story_key="debate:judge",
                    trace_id=trace_id,
                    span_suffix=f"{step.step_id}:judge",
                    step_index=step_index,
                    lobster_id_override=judge_lobster,
                    task_id_suffix="judge",
                )
                details = {
                    "mode": "debate_judge",
                    "proposer": proposer,
                    "judge": judge_lobster,
                    "proposal_a": proposal_a,
                    "proposal_b": proposal_b,
                    "debate_rounds": critiques,
                    "judge_output": final_output,
                }
                self.store.update_step(
                    run_id,
                    step.step_id,
                    status=StepStatus.DONE.value,
                    rendered_input=rendered_input,
                    output_text=final_output,
                    output_json=json.dumps(details, ensure_ascii=False),
                    error_message="",
                    retry_count=attempt,
                    current_story_id="",
                )
                duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                await get_workflow_realtime_hub().publish(
                    run_id,
                    {
                        "type": "step_completed",
                        "step_index": step_index,
                        "step_id": step.step_id,
                        "lobster_id": judge_lobster,
                        "duration_ms": duration_ms,
                        "step_mode": "debate_judge",
                    },
                )
                return True, final_output, details
            except Exception as exc:  # noqa: BLE001
                if attempt >= step.max_retries:
                    self.store.update_step(
                        run_id,
                        step.step_id,
                        status=StepStatus.FAILED.value,
                        rendered_input=rendered_input,
                        output_json=json.dumps({"mode": "debate_judge", **proposals_payload}, ensure_ascii=False),
                        error_message=str(exc),
                        retry_count=attempt,
                        current_story_id="",
                    )
                    duration_ms = int((datetime.now(timezone.utc) - step_started_at).total_seconds() * 1000)
                    await get_workflow_realtime_hub().publish(
                        run_id,
                        {
                            "type": "step_failed",
                            "step_index": step_index,
                            "step_id": step.step_id,
                            "lobster_id": judge_lobster,
                            "error": str(exc),
                            "duration_ms": duration_ms,
                            "step_mode": "debate_judge",
                        },
                    )
                    await self._handle_workflow_failure(
                        run_id=run_id,
                        workflow=workflow,
                        step=step,
                        reason=str(exc),
                        tenant_id=tenant_id,
                    )
                    return False, "", {}
                await asyncio.sleep(self._retry_delay_seconds(step, attempt))
        return False, "", {}

    async def _run_lobster_step(
        self,
        *,
        workflow: WorkflowDefinition,
        step: WorkflowStep,
        run_id: str,
        user_input: str,
        story_key: str | None,
        trace_id: str,
        span_suffix: str,
        step_index: int,
        lobster_id_override: str | None = None,
        task_id_suffix: str | None = None,
    ) -> str:
        run = self.store.get_run(run_id)
        if run is None:
            raise RuntimeError("workflow_run_missing")
        tenant_id = str(run["tenant_id"])
        workflow_context = dict(run.get("context") or {})
        industry_fields = _extract_workflow_industry_fields(workflow_context)
        concurrency = get_tenant_concurrency_manager()
        config = concurrency.get_tenant_config(tenant_id)
        await concurrency.wait_for_slot(
            tenant_id=tenant_id,
            resource="steps",
            max_limit=config.max_concurrent_steps,
            wait_timeout_seconds=300,
            poll_interval_seconds=2,
        )
        lobster_id = str(lobster_id_override or workflow.resolve_lobster_id(step.agent)).strip() or workflow.resolve_lobster_id(step.agent)
        lobster = self.runtime_lobster_factory(lobster_id, tenant_id)
        span_id = LangfuseTracer.start_lobster_span(
            trace_id,
            lobster_name=getattr(lobster, "display_name", lobster_id),
            skill_name=step.step_id,
            lobster_id=lobster_id,
            input_data={"user_input": user_input, "story_key": story_key},
            tenant_id=tenant_id,
            step_index=step_index,
        )
        task_id = f"{run_id}:{step.step_id}"
        if story_key:
            task_id = f"{task_id}:{story_key}"
        if task_id_suffix:
            task_id = f"{task_id}:{task_id_suffix}"
        spec = LobsterRunSpec(
            role_id=lobster_id,
            system_prompt=getattr(lobster, "system_prompt_full", "") or f"You are {lobster_id}.",
            user_prompt=user_input,
            lobster=lobster,
            fresh_context=True,
            session_mode="isolated",
            peer_id=f"workflow-{run_id}",
            meta={
                "tenant_id": tenant_id,
                "task_id": task_id,
                "workflow_run_id": run_id,
                "workflow_id": str(run["workflow_id"]),
                "workflow_step_id": step.step_id,
                "workflow_story_id": story_key,
                "task_type": f"workflow_{workflow.workflow_id}",
                "trace_id": trace_id,
                "span_id": span_id,
                "channel": "workflow",
                "session_mode": "isolated",
                "peer_id": f"workflow-{run_id}",
                "approved": True,
                "workflow_context": workflow_context,
                "industry_workflow_context": workflow_context.get("industry_workflow_context")
                if isinstance(workflow_context.get("industry_workflow_context"), dict)
                else {},
                **industry_fields,
            },
        )
        try:
            result = await self.runner.run(spec)
            if result.error:
                LangfuseTracer.end_lobster_span(span_id, output={"run_id": run_id}, error=result.error)
                raise RuntimeError(result.error)
            if result.stop_reason not in {"completed", "max_iterations"}:
                LangfuseTracer.end_lobster_span(span_id, output={"run_id": run_id}, error=result.stop_reason)
                raise RuntimeError(result.stop_reason)
            LangfuseTracer.end_lobster_span(
                span_id,
                output={"run_id": run_id, "gen_id": None, "story_key": story_key},
                quality_score=None,
            )
            return str(result.final_content or "").strip()
        finally:
            await concurrency.release(tenant_id, "steps")

    def _assert_expectation(self, expects: str, output: str) -> None:
        normalized = str(expects or "").strip()
        if not normalized:
            return
        if normalized not in str(output or ""):
            raise ValueError(f"expects_not_met:{normalized}")

    def _rebuild_completed_outputs(self, run_id: str) -> dict[str, Any]:
        outputs: dict[str, Any] = {}
        for row in self.store.list_steps(run_id):
            if str(row.get("status")) not in {StepStatus.DONE.value, StepStatus.SKIPPED.value}:
                continue
            outputs[str(row["step_id"])] = self._materialize_step_output(row)
        return outputs

    def _retry_delay_seconds(self, step: WorkflowStep, attempt: int) -> float:
        """Combine per-step retry delay with the existing exponential backoff."""

        exponential = float(2**attempt)
        configured = float(max(0, step.retry_delay_seconds) * max(1, attempt + 1))
        return min(30.0, max(exponential, configured))

    def _materialize_step_output(self, row: dict[str, Any]) -> dict[str, Any]:
        step_type = str(row.get("type") or "")
        if step_type == "loop":
            return {"outputs": _json_loads(str(row.get("output_json") or ""), [])}
        if step_type in {"ccv_loop", "debate_judge"}:
            return {
                "output": str(row.get("output_text") or ""),
                "details": _json_loads(str(row.get("output_json") or ""), {}),
            }
        return {"output": str(row.get("output_text") or "")}

    def _resolve_loop_items(self, loop_over: str, render_ctx: dict[str, Any]) -> list[Any]:
        if not loop_over:
            return []
        for candidate in (
            _resolve_path(render_ctx, loop_over),
            _resolve_path(render_ctx.get("context", {}), loop_over),
        ):
            if isinstance(candidate, list):
                return candidate
        return []

    def _build_story_rows(self, run_id: str, step: WorkflowStep, items: list[Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for index, item in enumerate(items):
            story_key = f"{step.step_id}:{index + 1}"
            rows.append(
                {
                    "id": f"{run_id}:{story_key}",
                    "story_key": story_key,
                    "title": self._story_title(item, index),
                    "input_text": _stringify_template_value(item),
                }
            )
        return rows

    def _story_title(self, item: Any, index: int) -> str:
        if isinstance(item, dict):
            for key in ("title", "name", "id", "platform"):
                value = str(item.get(key) or "").strip()
                if value:
                    return value
        return f"Story {index + 1}"

    def _singularize(self, raw: str) -> str:
        value = str(raw or "").strip()
        if value.endswith("ies") and len(value) > 3:
            return value[:-3] + "y"
        if value.endswith("es") and len(value) > 2:
            return value[:-2]
        if value.endswith("s") and len(value) > 1:
            return value[:-1]
        return value

    async def _escalate(self, run_id: str, step_id: str, reason: str) -> None:
        run = self.store.get_run(run_id)
        self.store.update_run(
            run_id,
            status=RunStatus.PAUSED.value,
            current_step_id=step_id,
            failure_reason=reason[:1000],
        )
        payload = {
            "event": "workflow_escalate",
            "run_id": run_id,
            "tenant_id": str((run or {}).get("tenant_id") or "tenant_main"),
            "step_id": step_id,
            "reason": reason[:1000],
        }
        await self._record_audit("workflow_escalate", payload)
        notify_url = str((run or {}).get("notify_url") or "").strip()
        if not notify_url:
            return
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(notify_url, json=payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Workflow escalate notify failed for %s: %s", run_id, exc)

    async def _record_audit(self, action: str, detail: dict[str, Any]) -> None:
        try:
            from audit_logger import record_audit_log

            await record_audit_log(
                tenant_id=str(detail.get("tenant_id") or "tenant_main"),
                user_id="workflow-engine",
                operator="workflow-engine",
                action=action,
                category="workflow",
                summary=action,
                detail=detail,
                resource_type="workflow_run",
                resource_id=str(detail.get("run_id") or ""),
                result="success",
                source="workflow_engine",
                trace_id=str(detail.get("run_id") or ""),
            )
        except Exception:
            pass

    async def _emit_subject_event(
        self,
        *,
        tenant_id: str,
        event_type: str,
        subject_template: str,
        payload: dict[str, Any],
        **subject_kwargs: Any,
    ) -> None:
        try:
            from event_subjects import EventSubjects
            from webhook_event_bus import PlatformEvent, get_event_bus

            await get_event_bus().emit(
                PlatformEvent(
                    event_type=event_type,
                    subject=EventSubjects.format(subject_template, tenant_id=tenant_id, **subject_kwargs),
                    tenant_id=tenant_id,
                    payload=payload,
                )
            )
        except Exception:
            pass

    async def _handle_workflow_failure(
        self,
        *,
        run_id: str,
        workflow: WorkflowDefinition,
        step: WorkflowStep,
        reason: str,
        tenant_id: str,
    ) -> None:
        run = self.store.get_run(run_id) or {}
        await self._escalate(run_id, step.step_id, reason)
        error_context = {
            "error_message": reason[:1000],
            "error_type": "WorkflowStepError",
            "failed_step_id": step.step_id,
            "failed_lobster_id": workflow.resolve_lobster_id(step.agent),
            "failed_skill_name": step.step_id,
            "workflow_id": workflow.workflow_id,
            "workflow_name": workflow.name,
            "execution_id": run_id,
            "tenant_id": tenant_id,
            "trigger_type": str(run.get("trigger_type") or "manual"),
        }
        if workflow.error_workflow_id == "system_error_notifier":
            try:
                from notification_center import send_notification

                await send_notification(
                    tenant_id=tenant_id,
                    message=f"工作流 {workflow.name} 在步骤 {step.step_id} 失败：{reason[:200]}",
                    level="warning",
                    category="workflow_error",
                )
            except Exception:
                pass
            return
        if workflow.error_notify_channels:
            try:
                from notification_center import send_notification

                await send_notification(
                    tenant_id=tenant_id,
                    message=f"工作流 {workflow.name} 在步骤 {step.step_id} 失败：{reason[:200]}",
                    level="warning",
                    category="workflow_error",
                )
            except Exception:
                pass
        if (
            workflow.error_workflow_id
            and workflow.error_workflow_id != workflow.workflow_id
            and str(run.get("trigger_type") or "") != "error_compensation"
        ):
            try:
                await self.start_run(
                    tenant_id=tenant_id,
                    workflow_id=workflow.error_workflow_id,
                    task=f"Error compensation for {workflow.name}",
                    context={"error": error_context},
                    trigger_type="error_compensation",
                    source_execution_id=run_id,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to trigger error workflow for %s: %s", workflow.workflow_id, exc)
