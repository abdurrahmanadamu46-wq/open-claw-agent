from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_utc(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _bucket_start_utc(dt: datetime, granularity: str) -> datetime:
    if granularity == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _db_path() -> Path:
    raw = os.getenv("MEMORY_GOVERNOR_DB_PATH", "./data/memory_governor.sqlite").strip()
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
            CREATE TABLE IF NOT EXISTS episode_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                trace_id TEXT,
                episode_key TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_episode_tenant_user_time
                ON episode_memory (tenant_id, user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_episode_tenant_key
                ON episode_memory (tenant_id, episode_key);

            CREATE TABLE IF NOT EXISTS policy_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                policy_key TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                policy_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, user_id, policy_key)
            );

            CREATE TABLE IF NOT EXISTS tenant_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                memory_key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, memory_key)
            );

            CREATE TABLE IF NOT EXISTS role_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role_name TEXT NOT NULL,
                memory_key TEXT NOT NULL,
                card_json TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, user_id, role_name, memory_key)
            );
            CREATE INDEX IF NOT EXISTS idx_role_memory_lookup
                ON role_memory (tenant_id, user_id, role_name, updated_at DESC);

            CREATE TABLE IF NOT EXISTS campaign_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                campaign_key TEXT NOT NULL,
                outcome TEXT NOT NULL DEFAULT 'unknown',
                card_json TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, user_id, campaign_key)
            );
            CREATE INDEX IF NOT EXISTS idx_campaign_memory_lookup
                ON campaign_memory (tenant_id, user_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS winning_playbook_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                role_name TEXT NOT NULL,
                playbook_key TEXT NOT NULL,
                card_json TEXT NOT NULL,
                score REAL NOT NULL DEFAULT 0.5,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, role_name, playbook_key)
            );
            CREATE INDEX IF NOT EXISTS idx_winning_playbook_lookup
                ON winning_playbook_memory (tenant_id, role_name, updated_at DESC);

            CREATE TABLE IF NOT EXISTS failure_playbook_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                role_name TEXT NOT NULL,
                playbook_key TEXT NOT NULL,
                card_json TEXT NOT NULL,
                score REAL NOT NULL DEFAULT 0.5,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, role_name, playbook_key)
            );
            CREATE INDEX IF NOT EXISTS idx_failure_playbook_lookup
                ON failure_playbook_memory (tenant_id, role_name, updated_at DESC);

            CREATE TABLE IF NOT EXISTS kernel_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                trace_id TEXT NOT NULL,
                stage TEXT NOT NULL,
                report_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, user_id, trace_id)
            );
            CREATE INDEX IF NOT EXISTS idx_kernel_reports_tenant_user_time
                ON kernel_reports (tenant_id, user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kernel_reports_trace
                ON kernel_reports (trace_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS kernel_rollout_policies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL UNIQUE,
                enabled INTEGER NOT NULL DEFAULT 1,
                rollout_ratio REAL NOT NULL DEFAULT 100.0,
                block_mode TEXT NOT NULL DEFAULT 'hitl',
                risk_rollout_json TEXT NOT NULL DEFAULT '{}',
                window_start_utc TEXT,
                window_end_utc TEXT,
                note TEXT,
                updated_by TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_kernel_rollout_updated
                ON kernel_rollout_policies (updated_at DESC);

            CREATE TABLE IF NOT EXISTS kernel_rollout_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                template_key TEXT NOT NULL,
                template_name TEXT NOT NULL,
                risk_rollout_json TEXT NOT NULL DEFAULT '{}',
                note TEXT,
                updated_by TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(tenant_id, template_key)
            );
            CREATE INDEX IF NOT EXISTS idx_kernel_rollout_templates_tenant
                ON kernel_rollout_templates (tenant_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS kernel_rollbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                source_trace_id TEXT NOT NULL,
                rollback_trace_id TEXT NOT NULL UNIQUE,
                stage TEXT NOT NULL,
                dry_run INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL,
                approval_id TEXT,
                detail_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_kernel_rollbacks_tenant_time
                ON kernel_rollbacks (tenant_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kernel_rollbacks_source_trace
                ON kernel_rollbacks (source_trace_id, updated_at DESC);
            """
        )
        rollout_cols = {
            str(row["name"])
            for row in conn.execute("PRAGMA table_info(kernel_rollout_policies)").fetchall()
        }
        if "risk_rollout_json" not in rollout_cols:
            conn.execute(
                "ALTER TABLE kernel_rollout_policies ADD COLUMN risk_rollout_json TEXT NOT NULL DEFAULT '{}'"
            )


def append_episode_event(
    *,
    tenant_id: str,
    user_id: str,
    episode_key: str,
    payload: dict[str, Any],
    trace_id: str | None = None,
    importance: float = 0.5,
) -> int:
    ensure_schema()
    with _conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO episode_memory
                (tenant_id, user_id, trace_id, episode_key, payload_json, importance, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_id,
                user_id,
                trace_id,
                episode_key,
                json.dumps(payload, ensure_ascii=False),
                max(0.0, min(float(importance), 1.0)),
                _utc_now(),
            ),
        )
        return int(cur.lastrowid or 0)


def upsert_policy_memory(
    *,
    tenant_id: str,
    user_id: str,
    policy_key: str,
    policy: dict[str, Any],
    bump_version: bool = True,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT id, version FROM policy_memory
            WHERE tenant_id = ? AND user_id = ? AND policy_key = ?
            """,
            (tenant_id, user_id, policy_key),
        ).fetchone()
        if row is None:
            version = 1
            conn.execute(
                """
                INSERT INTO policy_memory (tenant_id, user_id, policy_key, version, policy_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, user_id, policy_key, version, json.dumps(policy, ensure_ascii=False), now),
            )
            return {"inserted": True, "version": version}
        version = int(row["version"] or 1) + (1 if bump_version else 0)
        conn.execute(
            """
            UPDATE policy_memory
            SET version = ?, policy_json = ?, updated_at = ?
            WHERE tenant_id = ? AND user_id = ? AND policy_key = ?
            """,
            (version, json.dumps(policy, ensure_ascii=False), now, tenant_id, user_id, policy_key),
        )
        return {"inserted": False, "version": version}


def upsert_tenant_memory(*, tenant_id: str, memory_key: str, value: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM tenant_memory WHERE tenant_id = ? AND memory_key = ?",
            (tenant_id, memory_key),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO tenant_memory (tenant_id, memory_key, value_json, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (tenant_id, memory_key, json.dumps(value, ensure_ascii=False), now),
            )
            return {"inserted": True}
        conn.execute(
            """
            UPDATE tenant_memory
            SET value_json = ?, updated_at = ?
            WHERE tenant_id = ? AND memory_key = ?
            """,
            (json.dumps(value, ensure_ascii=False), now, tenant_id, memory_key),
        )
        return {"inserted": False}


def fold_reasoning_card(
    *,
    role_name: str,
    trace_id: str,
    task_description: str,
    strategy: dict[str, Any],
    guardian: dict[str, Any],
    verification: dict[str, Any],
    confidence: dict[str, Any],
    outcome: str,
) -> dict[str, Any]:
    strategy_summary = str(strategy.get("strategy_summary") or "").strip()
    if not strategy_summary:
        strategy_summary = str(strategy.get("route_summary") or "").strip()
    if not strategy_summary:
        strategy_summary = str(task_description).strip()[:160]
    reason_codes = sorted(
        set(
            list(guardian.get("reason_codes", []) or [])
            + list(verification.get("reason_codes", []) or [])
        )
    )
    policy_context = guardian.get("policy_context", {}) or {}
    return {
        "role_name": role_name,
        "trace_id": trace_id,
        "task_summary": str(task_description).strip()[:200],
        "strategy_summary": strategy_summary[:240],
        "guardian_decision": guardian.get("decision"),
        "verification_route": verification.get("route"),
        "confidence_band": verification.get("confidence_band"),
        "confidence_center": round(float(confidence.get("center", 0.0) or 0.0), 4),
        "industry": policy_context.get("industry", "general"),
        "strategy_version": policy_context.get("strategy_version", "general_safe_v1"),
        "reason_codes": reason_codes[:12],
        "outcome": outcome,
        "updated_at": _utc_now(),
    }


def upsert_role_memory(
    *,
    tenant_id: str,
    user_id: str,
    role_name: str,
    memory_key: str,
    card: dict[str, Any],
    importance: float = 0.5,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT id FROM role_memory
            WHERE tenant_id = ? AND user_id = ? AND role_name = ? AND memory_key = ?
            """,
            (tenant_id, user_id, role_name, memory_key),
        ).fetchone()
        payload = json.dumps(card, ensure_ascii=False)
        if row is None:
            conn.execute(
                """
                INSERT INTO role_memory
                    (tenant_id, user_id, role_name, memory_key, card_json, importance, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, user_id, role_name, memory_key, payload, max(0.0, min(float(importance), 1.0)), now),
            )
            return {"inserted": True}
        conn.execute(
            """
            UPDATE role_memory
            SET card_json = ?, importance = ?, updated_at = ?
            WHERE tenant_id = ? AND user_id = ? AND role_name = ? AND memory_key = ?
            """,
            (payload, max(0.0, min(float(importance), 1.0)), now, tenant_id, user_id, role_name, memory_key),
        )
        return {"inserted": False}


def upsert_campaign_memory(
    *,
    tenant_id: str,
    user_id: str,
    campaign_key: str,
    outcome: str,
    card: dict[str, Any],
    importance: float = 0.5,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    payload = json.dumps(card, ensure_ascii=False)
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT id FROM campaign_memory
            WHERE tenant_id = ? AND user_id = ? AND campaign_key = ?
            """,
            (tenant_id, user_id, campaign_key),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO campaign_memory
                    (tenant_id, user_id, campaign_key, outcome, card_json, importance, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, user_id, campaign_key, outcome, payload, max(0.0, min(float(importance), 1.0)), now),
            )
            return {"inserted": True}
        conn.execute(
            """
            UPDATE campaign_memory
            SET outcome = ?, card_json = ?, importance = ?, updated_at = ?
            WHERE tenant_id = ? AND user_id = ? AND campaign_key = ?
            """,
            (outcome, payload, max(0.0, min(float(importance), 1.0)), now, tenant_id, user_id, campaign_key),
        )
        return {"inserted": False}


def upsert_playbook_memory(
    *,
    tenant_id: str,
    role_name: str,
    playbook_key: str,
    card: dict[str, Any],
    score: float,
    outcome: str,
) -> dict[str, Any]:
    ensure_schema()
    table = "winning_playbook_memory" if outcome == "success" else "failure_playbook_memory"
    now = _utc_now()
    payload = json.dumps(card, ensure_ascii=False)
    with _conn() as conn:
        row = conn.execute(
            f"""
            SELECT id FROM {table}
            WHERE tenant_id = ? AND role_name = ? AND playbook_key = ?
            """,
            (tenant_id, role_name, playbook_key),
        ).fetchone()
        if row is None:
            conn.execute(
                f"""
                INSERT INTO {table}
                    (tenant_id, role_name, playbook_key, card_json, score, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, role_name, playbook_key, payload, max(0.0, min(float(score), 1.0)), now),
            )
            return {"inserted": True}
        conn.execute(
            f"""
            UPDATE {table}
            SET card_json = ?, score = ?, updated_at = ?
            WHERE tenant_id = ? AND role_name = ? AND playbook_key = ?
            """,
            (payload, max(0.0, min(float(score), 1.0)), now, tenant_id, role_name, playbook_key),
        )
        return {"inserted": False}


def memory_snapshot(
    *,
    tenant_id: str,
    user_id: str,
    topic_keys: list[str] | None = None,
    episode_limit: int = 12,
    role_budgets: dict[str, int] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    keys = [str(x).strip().lower() for x in (topic_keys or []) if str(x).strip()]
    requested_role_budgets = role_budgets or {
        "strategist": 3,
        "dispatcher": 3,
        "visualizer": 2,
        "followup": 3,
    }
    with _conn() as conn:
        episodes = conn.execute(
            """
            SELECT episode_key, payload_json, importance, created_at
            FROM episode_memory
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (tenant_id, user_id, max(1, min(int(episode_limit), 200))),
        ).fetchall()
        policies = conn.execute(
            """
            SELECT policy_key, version, policy_json, updated_at
            FROM policy_memory
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY updated_at DESC
            """,
            (tenant_id, user_id),
        ).fetchall()
        tenant_rows = conn.execute(
            """
            SELECT memory_key, value_json, updated_at
            FROM tenant_memory
            WHERE tenant_id = ?
            ORDER BY updated_at DESC
            """,
            (tenant_id,),
        ).fetchall()
        campaign_rows = conn.execute(
            """
            SELECT campaign_key, outcome, card_json, importance, updated_at
            FROM campaign_memory
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY updated_at DESC
            LIMIT 20
            """,
            (tenant_id, user_id),
        ).fetchall()
        winning_rows = conn.execute(
            """
            SELECT role_name, playbook_key, card_json, score, updated_at
            FROM winning_playbook_memory
            WHERE tenant_id = ?
            ORDER BY updated_at DESC
            LIMIT 20
            """,
            (tenant_id,),
        ).fetchall()
        failure_rows = conn.execute(
            """
            SELECT role_name, playbook_key, card_json, score, updated_at
            FROM failure_playbook_memory
            WHERE tenant_id = ?
            ORDER BY updated_at DESC
            LIMIT 20
            """,
            (tenant_id,),
        ).fetchall()
        role_memory_by_role: dict[str, list[dict[str, Any]]] = {}
        for role_name, limit in requested_role_budgets.items():
            role_rows = conn.execute(
                """
                SELECT memory_key, card_json, importance, updated_at
                FROM role_memory
                WHERE tenant_id = ? AND user_id = ? AND role_name = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (tenant_id, user_id, role_name, max(1, min(int(limit), 20))),
            ).fetchall()
            role_memory_by_role[role_name] = [
                {
                    "memory_key": row["memory_key"],
                    "importance": float(row["importance"] or 0.0),
                    "updated_at": row["updated_at"],
                    "card": json.loads(row["card_json"] or "{}"),
                }
                for row in role_rows
            ]

    parsed_episodes: list[dict[str, Any]] = []
    for row in episodes:
        payload = json.loads(row["payload_json"] or "{}")
        parsed_episodes.append(
            {
                "episode_key": row["episode_key"],
                "importance": float(row["importance"] or 0.0),
                "created_at": row["created_at"],
                "payload": payload,
            }
        )

    if keys:
        filtered: list[dict[str, Any]] = []
        for item in parsed_episodes:
            blob = json.dumps(item.get("payload", {}), ensure_ascii=False).lower()
            if any(k in blob for k in keys):
                filtered.append(item)
        if filtered:
            parsed_episodes = filtered

    parsed_policies: list[dict[str, Any]] = []
    for row in policies:
        parsed_policies.append(
            {
                "policy_key": row["policy_key"],
                "version": int(row["version"] or 1),
                "updated_at": row["updated_at"],
                "policy": json.loads(row["policy_json"] or "{}"),
            }
        )

    tenant_memory: list[dict[str, Any]] = []
    for row in tenant_rows:
        tenant_memory.append(
            {
                "memory_key": row["memory_key"],
                "updated_at": row["updated_at"],
                "value": json.loads(row["value_json"] or "{}"),
            }
        )

    campaign_memory: list[dict[str, Any]] = []
    for row in campaign_rows:
        campaign_memory.append(
            {
                "campaign_key": row["campaign_key"],
                "outcome": row["outcome"],
                "importance": float(row["importance"] or 0.0),
                "updated_at": row["updated_at"],
                "card": json.loads(row["card_json"] or "{}"),
            }
        )

    winning_playbooks: list[dict[str, Any]] = []
    for row in winning_rows:
        winning_playbooks.append(
            {
                "role_name": row["role_name"],
                "playbook_key": row["playbook_key"],
                "score": float(row["score"] or 0.0),
                "updated_at": row["updated_at"],
                "card": json.loads(row["card_json"] or "{}"),
            }
        )

    failure_playbooks: list[dict[str, Any]] = []
    for row in failure_rows:
        failure_playbooks.append(
            {
                "role_name": row["role_name"],
                "playbook_key": row["playbook_key"],
                "score": float(row["score"] or 0.0),
                "updated_at": row["updated_at"],
                "card": json.loads(row["card_json"] or "{}"),
            }
        )

    role_memory_count = sum(len(items) for items in role_memory_by_role.values())
    coverage = min(
        1.0,
        (len(parsed_episodes) * 0.06)
        + (len(parsed_policies) * 0.18)
        + (role_memory_count * 0.05)
        + (len(winning_playbooks) * 0.02),
    )
    return {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "topic_keys": keys,
        "coverage": round(coverage, 4),
        "episode_count": len(parsed_episodes),
        "policy_count": len(parsed_policies),
        "tenant_memory_count": len(tenant_memory),
        "role_memory_count": role_memory_count,
        "campaign_memory_count": len(campaign_memory),
        "winning_playbook_count": len(winning_playbooks),
        "failure_playbook_count": len(failure_playbooks),
        "episodes": parsed_episodes,
        "policies": parsed_policies,
        "tenant_memory": tenant_memory,
        "role_memory": role_memory_by_role,
        "campaign_memory": campaign_memory,
        "winning_playbooks": winning_playbooks,
        "failure_playbooks": failure_playbooks,
        "role_budgets": requested_role_budgets,
    }


def upsert_kernel_report(
    *,
    tenant_id: str,
    user_id: str,
    trace_id: str,
    stage: str,
    report: dict[str, Any],
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    payload = json.dumps(report, ensure_ascii=False)
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT id FROM kernel_reports
            WHERE tenant_id = ? AND user_id = ? AND trace_id = ?
            """,
            (tenant_id, user_id, trace_id),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO kernel_reports
                    (tenant_id, user_id, trace_id, stage, report_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, user_id, trace_id, stage, payload, now, now),
            )
            return {"inserted": True, "updated_at": now}
        conn.execute(
            """
            UPDATE kernel_reports
            SET stage = ?, report_json = ?, updated_at = ?
            WHERE tenant_id = ? AND user_id = ? AND trace_id = ?
            """,
            (stage, payload, now, tenant_id, user_id, trace_id),
        )
        return {"inserted": False, "updated_at": now}


def get_kernel_report(
    *,
    tenant_id: str,
    user_id: str,
    trace_id: str,
) -> dict[str, Any] | None:
    ensure_schema()
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT stage, report_json, created_at, updated_at
            FROM kernel_reports
            WHERE tenant_id = ? AND user_id = ? AND trace_id = ?
            LIMIT 1
            """,
            (tenant_id, user_id, trace_id),
        ).fetchone()
    if row is None:
        return None
    payload = json.loads(row["report_json"] or "{}")
    return {
        "stage": row["stage"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "report": payload if isinstance(payload, dict) else {},
    }


def list_kernel_reports(
    *,
    tenant_id: str,
    user_id: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    ensure_schema()
    n = max(1, min(int(limit), 200))
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT trace_id, stage, report_json, created_at, updated_at
            FROM kernel_reports
            WHERE tenant_id = ? AND user_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (tenant_id, user_id, n),
        ).fetchall()
    output: list[dict[str, Any]] = []
    for row in rows:
        payload = json.loads(row["report_json"] or "{}")
        report = payload if isinstance(payload, dict) else {}
        risk_taxonomy = report.get("risk_taxonomy", {}) if isinstance(report.get("risk_taxonomy"), dict) else {}
        autonomy = report.get("autonomy", {}) if isinstance(report.get("autonomy"), dict) else {}
        output.append(
            {
                "trace_id": str(row["trace_id"]),
                "stage": str(row["stage"]),
                "updated_at": str(row["updated_at"]),
                "created_at": str(row["created_at"]),
                "guardian": (report.get("guardian") or {}).get("decision"),
                "verification": (report.get("verification") or {}).get("accepted"),
                "risk_family": risk_taxonomy.get("primary_family"),
                "autonomy_route": autonomy.get("route"),
            }
        )
    return output


def upsert_kernel_rollout_policy(
    *,
    tenant_id: str,
    enabled: bool,
    rollout_ratio: float,
    block_mode: str,
    window_start_utc: str | None = None,
    window_end_utc: str | None = None,
    risk_rollout: dict[str, Any] | None = None,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    mode = str(block_mode or "hitl").strip().lower()
    if mode not in {"hitl", "deny"}:
        mode = "hitl"
    ratio = max(0.0, min(float(rollout_ratio), 100.0))
    risk_payload = json.dumps(risk_rollout or {}, ensure_ascii=False)
    now = _utc_now()
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM kernel_rollout_policies WHERE tenant_id = ?",
            (tenant_id,),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO kernel_rollout_policies
                    (tenant_id, enabled, rollout_ratio, block_mode, risk_rollout_json, window_start_utc, window_end_utc, note, updated_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    1 if enabled else 0,
                    ratio,
                    mode,
                    risk_payload,
                    window_start_utc,
                    window_end_utc,
                    note,
                    updated_by,
                    now,
                    now,
                ),
            )
            return {"inserted": True, "updated_at": now}
        conn.execute(
            """
            UPDATE kernel_rollout_policies
            SET enabled = ?, rollout_ratio = ?, block_mode = ?, risk_rollout_json = ?, window_start_utc = ?, window_end_utc = ?, note = ?, updated_by = ?, updated_at = ?
            WHERE tenant_id = ?
            """,
            (
                1 if enabled else 0,
                ratio,
                mode,
                risk_payload,
                window_start_utc,
                window_end_utc,
                note,
                updated_by,
                now,
                tenant_id,
            ),
        )
        return {"inserted": False, "updated_at": now}


def get_kernel_rollout_policy(tenant_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT tenant_id, enabled, rollout_ratio, block_mode, risk_rollout_json, window_start_utc, window_end_utc, note, updated_by, created_at, updated_at
            FROM kernel_rollout_policies
            WHERE tenant_id = ?
            LIMIT 1
            """,
            (tenant_id,),
        ).fetchone()
    if row is None:
        return None
    try:
        risk_rollout = json.loads(row["risk_rollout_json"] or "{}")
    except json.JSONDecodeError:
        risk_rollout = {}
    return {
        "tenant_id": str(row["tenant_id"]),
        "enabled": bool(int(row["enabled"] or 0)),
        "rollout_ratio": float(row["rollout_ratio"] or 0.0),
        "block_mode": str(row["block_mode"] or "hitl"),
        "risk_rollout": risk_rollout if isinstance(risk_rollout, dict) else {},
        "window_start_utc": row["window_start_utc"],
        "window_end_utc": row["window_end_utc"],
        "note": row["note"],
        "updated_by": row["updated_by"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def upsert_kernel_rollout_template(
    *,
    tenant_id: str,
    template_key: str,
    template_name: str,
    risk_rollout: dict[str, Any],
    note: str | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    payload = json.dumps(risk_rollout or {}, ensure_ascii=False)
    with _conn() as conn:
        row = conn.execute(
            """
            SELECT id FROM kernel_rollout_templates
            WHERE tenant_id = ? AND template_key = ?
            """,
            (tenant_id, template_key),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO kernel_rollout_templates
                    (tenant_id, template_key, template_name, risk_rollout_json, note, updated_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (tenant_id, template_key, template_name, payload, note, updated_by, now, now),
            )
            return {"inserted": True, "updated_at": now}
        conn.execute(
            """
            UPDATE kernel_rollout_templates
            SET template_name = ?, risk_rollout_json = ?, note = ?, updated_by = ?, updated_at = ?
            WHERE tenant_id = ? AND template_key = ?
            """,
            (template_name, payload, note, updated_by, now, tenant_id, template_key),
        )
        return {"inserted": False, "updated_at": now}


def list_kernel_rollout_templates(tenant_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
    ensure_schema()
    n = max(1, min(int(limit), 500))
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT tenant_id, template_key, template_name, risk_rollout_json, note, updated_by, created_at, updated_at
            FROM kernel_rollout_templates
            WHERE tenant_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (tenant_id, n),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            risk_rollout = json.loads(row["risk_rollout_json"] or "{}")
        except json.JSONDecodeError:
            risk_rollout = {}
        out.append(
            {
                "tenant_id": str(row["tenant_id"]),
                "template_key": str(row["template_key"]),
                "template_name": str(row["template_name"]),
                "risk_rollout": risk_rollout if isinstance(risk_rollout, dict) else {},
                "note": row["note"],
                "updated_by": row["updated_by"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )
    return out


def rename_kernel_rollout_template(
    *,
    tenant_id: str,
    template_key: str,
    new_template_key: str | None = None,
    template_name: str | None = None,
    note: str | None = None,
    updated_by: str | None = None,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    old_key = str(template_key or "").strip()
    next_key = str(new_template_key or old_key).strip()
    if not old_key or not next_key:
        return {"updated": False, "reason": "invalid_template_key"}

    with _conn() as conn:
        current = conn.execute(
            """
            SELECT template_name, note
            FROM kernel_rollout_templates
            WHERE tenant_id = ? AND template_key = ?
            """,
            (tenant_id, old_key),
        ).fetchone()
        if current is None:
            return {"updated": False, "reason": "not_found"}

        if next_key != old_key:
            conflict = conn.execute(
                """
                SELECT id
                FROM kernel_rollout_templates
                WHERE tenant_id = ? AND template_key = ?
                LIMIT 1
                """,
                (tenant_id, next_key),
            ).fetchone()
            if conflict is not None:
                return {"updated": False, "reason": "template_key_conflict"}

        final_name = str(template_name).strip() if template_name is not None else str(current["template_name"])
        if not final_name:
            return {"updated": False, "reason": "invalid_template_name"}

        final_note = note if note is not None else current["note"]
        conn.execute(
            """
            UPDATE kernel_rollout_templates
            SET template_key = ?, template_name = ?, note = ?, updated_by = ?, updated_at = ?
            WHERE tenant_id = ? AND template_key = ?
            """,
            (next_key, final_name, final_note, updated_by, now, tenant_id, old_key),
        )
        return {
            "updated": True,
            "template_key": next_key,
            "template_name": final_name,
            "note": final_note,
            "updated_at": now,
        }


def delete_kernel_rollout_template(*, tenant_id: str, template_key: str) -> dict[str, Any]:
    ensure_schema()
    target_key = str(template_key or "").strip()
    if not target_key:
        return {"deleted": False, "reason": "invalid_template_key"}

    with _conn() as conn:
        cur = conn.execute(
            """
            DELETE FROM kernel_rollout_templates
            WHERE tenant_id = ? AND template_key = ?
            """,
            (tenant_id, target_key),
        )
        deleted = int(cur.rowcount or 0) > 0
        return {"deleted": deleted, "template_key": target_key}


def record_kernel_rollback(
    *,
    tenant_id: str,
    user_id: str,
    source_trace_id: str,
    rollback_trace_id: str,
    stage: str,
    dry_run: bool,
    status: str,
    approval_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    now = _utc_now()
    detail_json = json.dumps(detail or {}, ensure_ascii=False)
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM kernel_rollbacks WHERE rollback_trace_id = ?",
            (rollback_trace_id,),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO kernel_rollbacks
                    (tenant_id, user_id, source_trace_id, rollback_trace_id, stage, dry_run, status, approval_id, detail_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tenant_id,
                    user_id,
                    source_trace_id,
                    rollback_trace_id,
                    stage,
                    1 if dry_run else 0,
                    status,
                    approval_id,
                    detail_json,
                    now,
                    now,
                ),
            )
            return {"inserted": True, "updated_at": now}
        conn.execute(
            """
            UPDATE kernel_rollbacks
            SET status = ?, approval_id = ?, detail_json = ?, updated_at = ?
            WHERE rollback_trace_id = ?
            """,
            (status, approval_id, detail_json, now, rollback_trace_id),
        )
        return {"inserted": False, "updated_at": now}


def kernel_metrics_dashboard(
    *,
    tenant_id: str,
    from_utc: str | None = None,
    to_utc: str | None = None,
    granularity: str = "day",
) -> dict[str, Any]:
    ensure_schema()
    granularity_norm = "hour" if str(granularity).strip().lower() == "hour" else "day"
    where = ["tenant_id = ?"]
    params: list[Any] = [tenant_id]
    if from_utc:
        where.append("updated_at >= ?")
        params.append(from_utc)
    if to_utc:
        where.append("updated_at <= ?")
        params.append(to_utc)
    where_sql = " AND ".join(where)

    with _conn() as conn:
        reports_rows = conn.execute(
            f"""
            SELECT report_json, updated_at
            FROM kernel_reports
            WHERE {where_sql}
            ORDER BY updated_at DESC
            """,
            tuple(params),
        ).fetchall()
        rollback_rows = conn.execute(
            f"""
            SELECT dry_run, status
            FROM kernel_rollbacks
            WHERE {where_sql}
            ORDER BY updated_at DESC
            """,
            tuple(params),
        ).fetchall()

    total = len(reports_rows)
    applied = 0
    risk_counts = {"P0": 0, "P1": 0, "P2": 0, "P3": 0}
    risk_family_counts = {"single_agent": 0, "inter_agent": 0, "system_emergent": 0}
    strategy_version_stats: dict[str, dict[str, float | int]] = {}
    trend_buckets: dict[str, dict[str, Any]] = {}
    autonomy_trend_buckets: dict[str, dict[str, Any]] = {}
    auto_pass_count = 0
    auto_block_count = 0
    review_required_count = 0
    approval_required_count = 0
    approval_resolved_count = 0
    approval_latency_samples: list[float] = []
    for row in reports_rows:
        try:
            report = json.loads(row["report_json"] or "{}")
        except json.JSONDecodeError:
            report = {}
        applied_flag = bool(report.get("applied"))
        if applied_flag:
            applied += 1
        risk_level = str(
            report.get("risk_level")
            or ((report.get("kernel_policy") or {}).get("risk_level"))
            or "P2"
        ).upper()
        if risk_level in risk_counts:
            risk_counts[risk_level] += 1
        risk_taxonomy = report.get("risk_taxonomy", {}) if isinstance(report.get("risk_taxonomy"), dict) else {}
        risk_family = str(risk_taxonomy.get("primary_family") or "").strip()
        if risk_family in risk_family_counts:
            risk_family_counts[risk_family] += 1
        strategy_version = str(
            report.get("strategy_version")
            or ((report.get("kernel_policy") or {}).get("strategy_version"))
            or "default"
        ).strip()
        if not strategy_version:
            strategy_version = "default"
        row_stat = strategy_version_stats.setdefault(
            strategy_version,
            {"total": 0, "applied": 0},
        )
        row_stat["total"] = int(row_stat.get("total", 0)) + 1
        if applied_flag:
            row_stat["applied"] = int(row_stat.get("applied", 0)) + 1
        ts = _parse_iso_utc(row["updated_at"])
        if ts is None:
            continue
        bucket_dt = _bucket_start_utc(ts, granularity_norm)
        bucket_key = bucket_dt.isoformat()
        bucket = trend_buckets.setdefault(
            bucket_key,
            {
                "bucket_start_utc": bucket_key,
                "bucket_label": (
                    bucket_dt.strftime("%Y-%m-%d %H:00") if granularity_norm == "hour" else bucket_dt.strftime("%Y-%m-%d")
                ),
                "total": 0,
                "applied": 0,
                "strategy": {},
            },
        )
        bucket["total"] = int(bucket.get("total", 0)) + 1
        if applied_flag:
            bucket["applied"] = int(bucket.get("applied", 0)) + 1
        strategy_map = bucket.setdefault("strategy", {})
        strategy_entry = strategy_map.setdefault(strategy_version, {"total": 0, "applied": 0})
        strategy_entry["total"] = int(strategy_entry.get("total", 0)) + 1
        if applied_flag:
            strategy_entry["applied"] = int(strategy_entry.get("applied", 0)) + 1

        autonomy = report.get("autonomy", {}) if isinstance(report.get("autonomy"), dict) else {}
        autonomy_route = str(autonomy.get("route") or "unknown").strip()
        if autonomy_route == "auto_pass":
            auto_pass_count += 1
        elif autonomy_route == "auto_block":
            auto_block_count += 1
        elif autonomy_route == "review_required":
            review_required_count += 1

        approval_required = bool(autonomy.get("approval_required", False))
        approval_resolved = bool(autonomy.get("approval_resolved", False))
        if approval_required:
            approval_required_count += 1
        if approval_resolved:
            approval_resolved_count += 1
        latency_sec = autonomy.get("approval_latency_sec")
        if isinstance(latency_sec, (int, float)) and latency_sec >= 0:
            approval_latency_samples.append(float(latency_sec))

        autonomy_bucket = autonomy_trend_buckets.setdefault(
            bucket_key,
            {
                "bucket_start_utc": bucket_key,
                "bucket_label": bucket.get("bucket_label"),
                "auto_pass": 0,
                "auto_block": 0,
                "review_required": 0,
                "approval_required": 0,
                "approval_resolved": 0,
                "approval_latency_samples": [],
            },
        )
        if autonomy_route in {"auto_pass", "auto_block", "review_required"}:
            autonomy_bucket[autonomy_route] = int(autonomy_bucket.get(autonomy_route, 0)) + 1
        if approval_required:
            autonomy_bucket["approval_required"] = int(autonomy_bucket.get("approval_required", 0)) + 1
        if approval_resolved:
            autonomy_bucket["approval_resolved"] = int(autonomy_bucket.get("approval_resolved", 0)) + 1
        if isinstance(latency_sec, (int, float)) and latency_sec >= 0:
            autonomy_bucket.setdefault("approval_latency_samples", []).append(float(latency_sec))

    hit_rate = round((applied / total) if total > 0 else 0.0, 4)
    average_approval_latency_sec = round(
        (sum(approval_latency_samples) / len(approval_latency_samples)) if approval_latency_samples else 0.0,
        2,
    )

    rollback_trigger = 0
    rollback_success = 0
    for row in rollback_rows:
        dry_run = bool(int(row["dry_run"] or 0))
        status = str(row["status"] or "").strip().lower()
        if dry_run:
            continue
        rollback_trigger += 1
        if status in {"executed", "executed_approved"}:
            rollback_success += 1
    rollback_success_rate = round((rollback_success / rollback_trigger) if rollback_trigger > 0 else 0.0, 4)
    by_strategy_version = []
    for version, stat in strategy_version_stats.items():
        version_total = int(stat.get("total", 0))
        version_applied = int(stat.get("applied", 0))
        by_strategy_version.append(
            {
                "strategy_version": version,
                "total": version_total,
                "applied": version_applied,
                "hit_rate": round((version_applied / version_total) if version_total > 0 else 0.0, 4),
            }
        )
    by_strategy_version.sort(key=lambda x: (int(x["total"]), str(x["strategy_version"])), reverse=True)
    strategy_trend_series: list[dict[str, Any]] = []
    for bucket_key in sorted(trend_buckets.keys()):
        bucket = trend_buckets[bucket_key]
        bucket_total = int(bucket.get("total", 0))
        bucket_applied = int(bucket.get("applied", 0))
        by_strategy = []
        strategy_map = bucket.get("strategy", {})
        if isinstance(strategy_map, dict):
            for version, stat in strategy_map.items():
                version_total = int((stat or {}).get("total", 0))
                version_applied = int((stat or {}).get("applied", 0))
                by_strategy.append(
                    {
                        "strategy_version": str(version),
                        "total": version_total,
                        "applied": version_applied,
                        "hit_rate": round((version_applied / version_total) if version_total > 0 else 0.0, 4),
                    }
                )
        by_strategy.sort(key=lambda x: (int(x["total"]), str(x["strategy_version"])), reverse=True)
        strategy_trend_series.append(
            {
                "bucket_start_utc": bucket.get("bucket_start_utc"),
                "bucket_label": bucket.get("bucket_label"),
                "total": bucket_total,
                "applied": bucket_applied,
                "hit_rate": round((bucket_applied / bucket_total) if bucket_total > 0 else 0.0, 4),
                "by_strategy": by_strategy,
            }
        )

    autonomy_trend_series: list[dict[str, Any]] = []
    for bucket_key in sorted(autonomy_trend_buckets.keys()):
        bucket = autonomy_trend_buckets[bucket_key]
        samples = bucket.get("approval_latency_samples", [])
        autonomy_trend_series.append(
            {
                "bucket_start_utc": bucket.get("bucket_start_utc"),
                "bucket_label": bucket.get("bucket_label"),
                "auto_pass": int(bucket.get("auto_pass", 0)),
                "auto_block": int(bucket.get("auto_block", 0)),
                "review_required": int(bucket.get("review_required", 0)),
                "approval_required": int(bucket.get("approval_required", 0)),
                "approval_resolved": int(bucket.get("approval_resolved", 0)),
                "average_approval_latency_sec": round(
                    (sum(samples) / len(samples)) if samples else 0.0,
                    2,
                ),
            }
        )

    return {
        "tenant_id": tenant_id,
        "query": {"from": from_utc, "to": to_utc, "granularity": granularity_norm},
        "totals": {
            "kernel_reports_total": total,
            "kernel_applied": applied,
            "strategy_hit_rate": hit_rate,
            "rollback_trigger_count": rollback_trigger,
            "rollback_success_count": rollback_success,
            "rollback_success_rate": rollback_success_rate,
            "auto_pass_count": auto_pass_count,
            "auto_block_count": auto_block_count,
            "review_required_count": review_required_count,
            "approval_required_count": approval_required_count,
            "approval_resolved_count": approval_resolved_count,
            "average_approval_latency_sec": average_approval_latency_sec,
        },
        "byRisk": risk_counts,
        "byRiskFamily": risk_family_counts,
        "byStrategyVersion": by_strategy_version,
        "strategyTrendSeries": strategy_trend_series,
        "autonomyTrendSeries": autonomy_trend_series,
    }
