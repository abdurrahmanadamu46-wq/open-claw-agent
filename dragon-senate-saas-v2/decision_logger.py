"""
Structured policy decision logger inspired by OPA decision logs.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = (Path(__file__).resolve().parent / "data" / "policy_decisions.sqlite").resolve()

_SENSITIVE_KEY_FRAGMENTS = {
    "phone",
    "mobile",
    "email",
    "id_card",
    "password",
    "secret",
    "token",
    "cookie",
    "authorization",
    "auth",
    "api_key",
    "access_key",
    "refresh_token",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)


@dataclass(slots=True)
class DecisionLog:
    log_id: str
    tenant_id: str
    policy_path: str
    input_data: dict[str, Any]
    decision: str
    rule_id: str | None
    reason: str
    evaluation_ms: float
    lobster_id: str | None = None
    task_id: str | None = None
    matched_rules: list[dict[str, Any]] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class DecisionLogger:
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
                CREATE TABLE IF NOT EXISTS policy_decisions (
                    log_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    policy_path TEXT NOT NULL,
                    input_json TEXT NOT NULL DEFAULT '{}',
                    input_digest TEXT NOT NULL DEFAULT '',
                    decision TEXT NOT NULL,
                    rule_id TEXT,
                    reason TEXT NOT NULL DEFAULT '',
                    evaluation_ms REAL NOT NULL DEFAULT 0,
                    lobster_id TEXT,
                    task_id TEXT,
                    matched_rules_json TEXT NOT NULL DEFAULT '[]',
                    trace_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_policy_decisions_tenant_created
                    ON policy_decisions(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_policy_decisions_path
                    ON policy_decisions(tenant_id, policy_path, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_policy_decisions_decision
                    ON policy_decisions(tenant_id, decision, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_policy_decisions_rule
                    ON policy_decisions(tenant_id, rule_id, created_at DESC);
                """
            )
            conn.commit()

    async def log(self, decision_result: dict[str, Any], context: dict[str, Any] | None = None) -> DecisionLog:
        ctx = context or {}
        input_data = self._sanitize(ctx.get("input_data", {}))
        matched_rules = [
            item for item in decision_result.get("matched_rules", [])
            if isinstance(item, dict)
        ]
        trace = [
            item for item in decision_result.get("trace", [])
            if isinstance(item, dict)
        ]
        record = DecisionLog(
            log_id=f"pdl_{uuid.uuid4().hex[:16]}",
            tenant_id=str(ctx.get("tenant_id") or "tenant_main"),
            policy_path=str(decision_result.get("policy_path") or ""),
            input_data=input_data,
            decision=str(decision_result.get("decision") or ""),
            rule_id=str(decision_result["rule_id"]) if decision_result.get("rule_id") else None,
            reason=str(decision_result.get("reason") or ""),
            evaluation_ms=float(decision_result.get("evaluation_ms") or 0.0),
            lobster_id=str(ctx.get("lobster_id")).strip() if ctx.get("lobster_id") else None,
            task_id=str(ctx.get("task_id")).strip() if ctx.get("task_id") else None,
            matched_rules=matched_rules,
            trace=trace,
        )
        digest = hashlib.sha256(_json_dumps(record.input_data).encode("utf-8")).hexdigest()[:16]
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO policy_decisions(
                    log_id, tenant_id, policy_path, input_json, input_digest,
                    decision, rule_id, reason, evaluation_ms, lobster_id, task_id,
                    matched_rules_json, trace_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.log_id,
                    record.tenant_id,
                    record.policy_path,
                    _json_dumps(record.input_data),
                    digest,
                    record.decision,
                    record.rule_id,
                    record.reason,
                    record.evaluation_ms,
                    record.lobster_id,
                    record.task_id,
                    _json_dumps(record.matched_rules),
                    _json_dumps(record.trace),
                    record.created_at,
                ),
            )
            conn.commit()
        if record.decision == "deny":
            try:
                from tenant_audit_log import AuditEventType, get_audit_service

                await get_audit_service().log(
                    event_type=AuditEventType.PERMISSION_DENIED,
                    tenant_id=record.tenant_id,
                    resource_type="policy_rule",
                    resource_id=record.rule_id,
                    details={
                        "policy_path": record.policy_path,
                        "decision": record.decision,
                        "reason": record.reason,
                        "lobster_id": record.lobster_id,
                        "task_id": record.task_id,
                        "evaluation_ms": record.evaluation_ms,
                    },
                )
            except Exception:
                pass
        return record

    def list_logs(
        self,
        tenant_id: str,
        *,
        policy_path: str | None = None,
        decision: str | None = None,
        rule_id: str | None = None,
        lobster_id: str | None = None,
        start: str | None = None,
        end: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = ["tenant_id = ?"]
        params: list[Any] = [tenant_id]
        if policy_path:
            clauses.append("policy_path = ?")
            params.append(policy_path)
        if decision:
            clauses.append("decision = ?")
            params.append(decision)
        if rule_id:
            clauses.append("rule_id = ?")
            params.append(rule_id)
        if lobster_id:
            clauses.append("lobster_id = ?")
            params.append(lobster_id)
        if start:
            clauses.append("created_at >= ?")
            params.append(start)
        if end:
            clauses.append("created_at <= ?")
            params.append(end)
        where_clause = " AND ".join(clauses)
        offset = max(page - 1, 0) * page_size
        with self._connect() as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM policy_decisions WHERE {where_clause}",
                    params,
                ).fetchone()[0]
            )
            rows = conn.execute(
                f"""
                SELECT *
                  FROM policy_decisions
                 WHERE {where_clause}
              ORDER BY created_at DESC
                 LIMIT ? OFFSET ?
                """,
                [*params, page_size, offset],
            ).fetchall()
        return [self._row_to_dict(row) for row in rows], total

    def get_log(self, log_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM policy_decisions WHERE log_id = ?", (log_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def stats(
        self,
        tenant_id: str,
        *,
        policy_path: str | None = None,
        start: str | None = None,
        end: str | None = None,
    ) -> dict[str, Any]:
        clauses = ["tenant_id = ?"]
        params: list[Any] = [tenant_id]
        if policy_path:
            clauses.append("policy_path = ?")
            params.append(policy_path)
        if start:
            clauses.append("created_at >= ?")
            params.append(start)
        if end:
            clauses.append("created_at <= ?")
            params.append(end)
        where_clause = " AND ".join(clauses)
        with self._connect() as conn:
            total = int(conn.execute(f"SELECT COUNT(*) FROM policy_decisions WHERE {where_clause}", params).fetchone()[0])
            avg_row = conn.execute(
                f"SELECT COALESCE(AVG(evaluation_ms), 0) AS avg_ms FROM policy_decisions WHERE {where_clause}",
                params,
            ).fetchone()
            by_decision = conn.execute(
                f"""
                SELECT decision, COUNT(*) AS count
                  FROM policy_decisions
                 WHERE {where_clause}
              GROUP BY decision
              ORDER BY count DESC, decision ASC
                """,
                params,
            ).fetchall()
            by_policy_path = conn.execute(
                f"""
                SELECT policy_path, COUNT(*) AS count
                  FROM policy_decisions
                 WHERE {where_clause}
              GROUP BY policy_path
              ORDER BY count DESC, policy_path ASC
                """,
                params,
            ).fetchall()
            top_denied_rules = conn.execute(
                f"""
                SELECT rule_id, COUNT(*) AS count
                  FROM policy_decisions
                 WHERE {where_clause} AND decision = 'deny'
              GROUP BY rule_id
              ORDER BY count DESC, rule_id ASC
                 LIMIT 10
                """,
                params,
            ).fetchall()
        return {
            "tenant_id": tenant_id,
            "policy_path": policy_path,
            "total": total,
            "avg_evaluation_ms": round(float(avg_row["avg_ms"] if avg_row else 0.0), 3),
            "by_decision": [
                {"decision": str(row["decision"]), "count": int(row["count"])}
                for row in by_decision
            ],
            "by_policy_path": [
                {"policy_path": str(row["policy_path"]), "count": int(row["count"])}
                for row in by_policy_path
            ],
            "top_denied_rules": [
                {"rule_id": str(row["rule_id"] or ""), "count": int(row["count"])}
                for row in top_denied_rules
                if str(row["rule_id"] or "").strip()
            ],
        }

    def _sanitize(self, payload: Any, *, key_name: str | None = None) -> Any:
        if isinstance(payload, dict):
            return {
                str(key): self._sanitize(value, key_name=str(key))
                for key, value in payload.items()
            }
        if isinstance(payload, list):
            return [self._sanitize(item, key_name=key_name) for item in payload]
        if key_name and any(fragment in key_name.lower() for fragment in _SENSITIVE_KEY_FRAGMENTS):
            return "***"
        return payload

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "log_id": str(row["log_id"]),
            "tenant_id": str(row["tenant_id"]),
            "policy_path": str(row["policy_path"]),
            "input_data": json.loads(str(row["input_json"] or "{}")),
            "decision": str(row["decision"]),
            "rule_id": str(row["rule_id"]) if row["rule_id"] else None,
            "reason": str(row["reason"] or ""),
            "evaluation_ms": float(row["evaluation_ms"] or 0.0),
            "lobster_id": str(row["lobster_id"]) if row["lobster_id"] else None,
            "task_id": str(row["task_id"]) if row["task_id"] else None,
            "matched_rules": json.loads(str(row["matched_rules_json"] or "[]")),
            "trace": json.loads(str(row["trace_json"] or "[]")),
            "created_at": str(row["created_at"]),
        }


_decision_logger: DecisionLogger | None = None


def get_decision_logger() -> DecisionLogger:
    global _decision_logger
    if _decision_logger is None:
        _decision_logger = DecisionLogger()
    return _decision_logger
