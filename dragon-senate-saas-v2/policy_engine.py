"""
OPA-style declarative policy engine for lobster runtime.
"""

from __future__ import annotations

import json
import logging
import operator
import re
import sqlite3
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("policy_engine")

REPO_ROOT = Path(__file__).resolve().parent
DB_PATH = REPO_ROOT / "data" / "policy_engine.sqlite"
GLOBAL_TENANT = "*"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)


def _normalize_tenant_id(value: str | None) -> str:
    text = str(value or "").strip()
    return text or GLOBAL_TENANT


@dataclass(slots=True)
class PolicyCondition:
    field: str
    op: str
    value: Any = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class PolicyRule:
    rule_id: str
    policy_path: str
    name: str
    conditions: list[PolicyCondition] = field(default_factory=list)
    effect: str = "deny"
    target: str | None = None
    priority: int = 100
    tenant_id: str = GLOBAL_TENANT
    condition_logic: str = "AND"
    enabled: bool = True
    description: str = ""
    tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["conditions"] = [condition.to_dict() for condition in self.conditions]
        return payload


class PolicyEngine:
    """
    In-memory evaluator backed by SQLite for declarative rule management.
    """

    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or DB_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._rules: list[PolicyRule] = []
        self._ensure_schema()
        self._seed_defaults()
        self.reload()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS policy_rules (
                    rule_id TEXT PRIMARY KEY,
                    policy_path TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    tenant_id TEXT NOT NULL DEFAULT '*',
                    condition_logic TEXT NOT NULL DEFAULT 'AND',
                    conditions_json TEXT NOT NULL DEFAULT '[]',
                    effect TEXT NOT NULL DEFAULT 'deny',
                    target TEXT,
                    priority INTEGER NOT NULL DEFAULT 100,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_policy_rules_path
                    ON policy_rules(policy_path, tenant_id, enabled, priority, rule_id);
                """
            )
            conn.commit()

    def _seed_defaults(self) -> None:
        with self._connect() as conn:
            count = int(conn.execute("SELECT COUNT(*) FROM policy_rules").fetchone()[0])
            if count > 0:
                return
            now = _utc_now()
            defaults = [
                PolicyRule(
                    rule_id="POLICY_DISPATCH_HIGH_SCORE",
                    policy_path="dispatch",
                    name="High score leads go to followup",
                    description="Dispatch high intent leads to the followup lobster.",
                    conditions=[
                        PolicyCondition(field="lead.score", op="gte", value=80),
                        PolicyCondition(field="lead.followup_count", op="lt", value=3),
                    ],
                    effect="dispatch",
                    target="followup",
                    priority=10,
                    tenant_id=GLOBAL_TENANT,
                    enabled=True,
                    created_at=now,
                    updated_at=now,
                    tags=["builtin", "dispatch"],
                ),
                PolicyRule(
                    rule_id="POLICY_DISPATCH_MID_SCORE",
                    policy_path="dispatch",
                    name="Mid score leads go to echoer",
                    description="Fallback dispatch for medium intent leads.",
                    conditions=[
                        PolicyCondition(field="lead.score", op="gte", value=60),
                        PolicyCondition(field="lead.score", op="lt", value=80),
                    ],
                    effect="dispatch",
                    target="echoer",
                    priority=20,
                    tenant_id=GLOBAL_TENANT,
                    enabled=True,
                    created_at=now,
                    updated_at=now,
                    tags=["builtin", "dispatch"],
                ),
                PolicyRule(
                    rule_id="POLICY_DENY_BLACKLISTED_SEND",
                    policy_path="send_message",
                    name="Block sending to blacklisted targets",
                    description="Compliance guardrail for outbound messaging.",
                    conditions=[
                        PolicyCondition(field="lead.blacklisted", op="eq", value=True),
                    ],
                    effect="deny",
                    priority=1,
                    tenant_id=GLOBAL_TENANT,
                    enabled=True,
                    created_at=now,
                    updated_at=now,
                    tags=["builtin", "compliance"],
                ),
            ]
            for rule in defaults:
                conn.execute(
                    """
                    INSERT INTO policy_rules(
                        rule_id, policy_path, name, description, tenant_id, condition_logic,
                        conditions_json, effect, target, priority, enabled, tags_json,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        rule.rule_id,
                        rule.policy_path,
                        rule.name,
                        rule.description,
                        rule.tenant_id,
                        rule.condition_logic,
                        _json_dumps([condition.to_dict() for condition in rule.conditions]),
                        rule.effect,
                        rule.target,
                        rule.priority,
                        1 if rule.enabled else 0,
                        _json_dumps(rule.tags),
                        rule.created_at,
                        rule.updated_at,
                    ),
                )
            conn.commit()

    def reload(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                  FROM policy_rules
              ORDER BY priority ASC, rule_id ASC
                """
            ).fetchall()
        with self._lock:
            self._rules = [self._row_to_rule(row) for row in rows]
        return self.list_rules(include_disabled=True)

    def load_rules(self, rules: list[PolicyRule]) -> list[dict[str, Any]]:
        ordered = sorted(rules, key=lambda item: (item.priority, item.rule_id))
        with self._connect() as conn:
            conn.execute("DELETE FROM policy_rules")
            for rule in ordered:
                conn.execute(
                    """
                    INSERT INTO policy_rules(
                        rule_id, policy_path, name, description, tenant_id, condition_logic,
                        conditions_json, effect, target, priority, enabled, tags_json,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        rule.rule_id,
                        rule.policy_path,
                        rule.name,
                        rule.description,
                        rule.tenant_id,
                        rule.condition_logic,
                        _json_dumps([condition.to_dict() for condition in rule.conditions]),
                        rule.effect,
                        rule.target,
                        rule.priority,
                        1 if rule.enabled else 0,
                        _json_dumps(rule.tags),
                        rule.created_at,
                        rule.updated_at,
                    ),
                )
            conn.commit()
        with self._lock:
            self._rules = list(ordered)
        return self.list_rules(include_disabled=True)

    def list_rules(
        self,
        *,
        policy_path: str | None = None,
        tenant_id: str | None = None,
        include_disabled: bool = True,
        effective: bool = False,
    ) -> list[dict[str, Any]]:
        normalized_tenant = str(tenant_id).strip() if tenant_id is not None else None
        with self._lock:
            rules = list(self._rules)
        items: list[dict[str, Any]] = []
        for rule in rules:
            if policy_path and rule.policy_path != policy_path:
                continue
            if not include_disabled and not rule.enabled:
                continue
            if normalized_tenant is not None:
                if effective:
                    if rule.tenant_id not in {GLOBAL_TENANT, normalized_tenant}:
                        continue
                elif rule.tenant_id != normalized_tenant:
                    continue
            items.append(rule.to_dict())
        return items

    def get_rule(self, rule_id: str) -> dict[str, Any] | None:
        with self._lock:
            for rule in self._rules:
                if rule.rule_id == rule_id:
                    return rule.to_dict()
        return None

    def upsert_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        existing = self.get_rule(str(payload.get("rule_id") or "").strip())
        now = _utc_now()
        rule = self._coerce_rule(
            payload,
            created_at=str(existing.get("created_at")) if existing else now,
            updated_at=now,
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO policy_rules(
                    rule_id, policy_path, name, description, tenant_id, condition_logic,
                    conditions_json, effect, target, priority, enabled, tags_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(rule_id) DO UPDATE SET
                    policy_path=excluded.policy_path,
                    name=excluded.name,
                    description=excluded.description,
                    tenant_id=excluded.tenant_id,
                    condition_logic=excluded.condition_logic,
                    conditions_json=excluded.conditions_json,
                    effect=excluded.effect,
                    target=excluded.target,
                    priority=excluded.priority,
                    enabled=excluded.enabled,
                    tags_json=excluded.tags_json,
                    updated_at=excluded.updated_at
                """,
                (
                    rule.rule_id,
                    rule.policy_path,
                    rule.name,
                    rule.description,
                    rule.tenant_id,
                    rule.condition_logic,
                    _json_dumps([condition.to_dict() for condition in rule.conditions]),
                    rule.effect,
                    rule.target,
                    rule.priority,
                    1 if rule.enabled else 0,
                    _json_dumps(rule.tags),
                    rule.created_at,
                    rule.updated_at,
                ),
            )
            conn.commit()
        self.reload()
        return rule.to_dict()

    def delete_rule(self, rule_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM policy_rules WHERE rule_id = ?", (rule_id,))
            conn.commit()
            deleted = bool(cur.rowcount)
        if deleted:
            self.reload()
        return deleted

    def evaluate(
        self,
        input_data: dict[str, Any],
        *,
        policy_path: str = "dispatch",
        tenant_id: str | None = None,
        default_decision: str = "deny",
        trace: bool = False,
    ) -> dict[str, Any]:
        started_at = datetime.now(timezone.utc)
        trace_events: list[dict[str, Any]] = []
        target_tenant = _normalize_tenant_id(tenant_id if tenant_id != GLOBAL_TENANT else GLOBAL_TENANT)
        with self._lock:
            applicable = [
                rule
                for rule in self._rules
                if rule.policy_path == policy_path
                and rule.enabled
                and rule.tenant_id in {GLOBAL_TENANT, target_tenant}
            ]

        matched_rules: list[dict[str, Any]] = []
        primary_rule: PolicyRule | None = None
        primary_reasons: list[str] = []
        for rule in applicable:
            matched, reasons = self._match_rule(rule, input_data, trace_events if trace else None)
            if not matched:
                continue
            matched_rules.append(
                {
                    "rule_id": rule.rule_id,
                    "name": rule.name,
                    "effect": rule.effect,
                    "target": rule.target,
                    "priority": rule.priority,
                }
            )
            if primary_rule is None:
                primary_rule = rule
                primary_reasons = reasons

        elapsed_ms = round((datetime.now(timezone.utc) - started_at).total_seconds() * 1000, 3)
        if primary_rule is None:
            decision = str(default_decision or "deny")
            reason = "no matching rule"
            rule_id = None
        else:
            decision = primary_rule.target if primary_rule.effect == "dispatch" and primary_rule.target else primary_rule.effect
            reason = " AND ".join(primary_reasons) if primary_reasons else f"matched {primary_rule.rule_id}"
            rule_id = primary_rule.rule_id

        result = {
            "decision": decision,
            "rule_id": rule_id,
            "reason": reason,
            "matched_rules": matched_rules,
            "evaluation_ms": elapsed_ms,
            "policy_path": policy_path,
            "tenant_id": target_tenant,
            "evaluated_rule_count": len(applicable),
            "default_decision": default_decision,
        }
        if trace:
            result["trace"] = trace_events
        return result

    def _match_rule(
        self,
        rule: PolicyRule,
        input_data: dict[str, Any],
        trace_events: list[dict[str, Any]] | None = None,
    ) -> tuple[bool, list[str]]:
        reasons: list[str] = []
        checks: list[bool] = []
        if trace_events is not None:
            trace_events.append(
                {
                    "event": "enter_rule",
                    "rule_id": rule.rule_id,
                    "policy_path": rule.policy_path,
                    "priority": rule.priority,
                }
            )
        for condition in rule.conditions:
            field_value = self._get_field(input_data, condition.field)
            matched = self._evaluate_operator(condition.op, field_value, condition.value)
            checks.append(matched)
            reasons.append(f"{condition.field}({field_value!r}) {condition.op} {condition.value!r}")
            if trace_events is not None:
                trace_events.append(
                    {
                        "event": "eval_condition",
                        "rule_id": rule.rule_id,
                        "field": condition.field,
                        "op": condition.op,
                        "expected": condition.value,
                        "actual": field_value,
                        "matched": matched,
                    }
                )
        matched_rule = all(checks) if str(rule.condition_logic).upper() != "OR" else any(checks)
        if trace_events is not None:
            trace_events.append(
                {
                    "event": "rule_match" if matched_rule else "rule_skip",
                    "rule_id": rule.rule_id,
                    "matched": matched_rule,
                }
            )
        return matched_rule, reasons

    def _evaluate_operator(self, op_name: str, current: Any, expected: Any) -> bool:
        op = str(op_name or "").strip().lower()
        scalar_ops: dict[str, Any] = {
            "eq": operator.eq,
            "ne": operator.ne,
            "neq": operator.ne,
            "gt": operator.gt,
            "gte": operator.ge,
            "lt": operator.lt,
            "lte": operator.le,
        }
        try:
            if op in scalar_ops:
                return bool(scalar_ops[op](current, expected))
            if op == "in":
                return current in (expected or [])
            if op == "not_in":
                return current not in (expected or [])
            if op == "contains":
                return str(expected) in str(current)
            if op == "startswith":
                return str(current).startswith(str(expected))
            if op == "endswith":
                return str(current).endswith(str(expected))
            if op == "regex":
                return re.search(str(expected), str(current)) is not None
            if op == "exists":
                return current is not None
        except Exception:
            logger.debug("Policy operator %s failed for %r and %r", op, current, expected)
            return False
        return False

    def _get_field(self, payload: dict[str, Any], path: str) -> Any:
        current: Any = payload
        for part in str(path or "").split("."):
            if isinstance(current, dict):
                current = current.get(part)
                continue
            if isinstance(current, list) and part.isdigit():
                index = int(part)
                if 0 <= index < len(current):
                    current = current[index]
                    continue
            return None
        return current

    def _coerce_rule(
        self,
        payload: dict[str, Any],
        *,
        created_at: str,
        updated_at: str,
    ) -> PolicyRule:
        conditions = [
            PolicyCondition(
                field=str(item.get("field") or "").strip(),
                op=str(item.get("op") or "eq").strip(),
                value=item.get("value"),
            )
            for item in payload.get("conditions", [])
            if isinstance(item, dict) and str(item.get("field") or "").strip()
        ]
        effect = str(payload.get("effect") or "deny").strip().lower()
        if effect not in {"allow", "deny", "dispatch"}:
            effect = "deny"
        logic = str(payload.get("condition_logic") or "AND").strip().upper()
        if logic not in {"AND", "OR"}:
            logic = "AND"
        return PolicyRule(
            rule_id=str(payload.get("rule_id") or f"policy_{uuid.uuid4().hex[:12]}").strip(),
            policy_path=str(payload.get("policy_path") or "dispatch").strip() or "dispatch",
            name=str(payload.get("name") or "Unnamed policy").strip() or "Unnamed policy",
            description=str(payload.get("description") or "").strip(),
            tenant_id=_normalize_tenant_id(payload.get("tenant_id")),
            condition_logic=logic,
            conditions=conditions,
            effect=effect,
            target=str(payload.get("target") or "").strip() or None,
            priority=int(payload.get("priority", 100) or 100),
            enabled=bool(payload.get("enabled", True)),
            tags=[str(item).strip() for item in payload.get("tags", []) if str(item).strip()],
            created_at=created_at,
            updated_at=updated_at,
        )

    def _row_to_rule(self, row: sqlite3.Row) -> PolicyRule:
        conditions = [
            PolicyCondition(
                field=str(item.get("field") or "").strip(),
                op=str(item.get("op") or "eq").strip(),
                value=item.get("value"),
            )
            for item in json.loads(str(row["conditions_json"] or "[]"))
            if isinstance(item, dict)
        ]
        tags = [str(item).strip() for item in json.loads(str(row["tags_json"] or "[]")) if str(item).strip()]
        return PolicyRule(
            rule_id=str(row["rule_id"]),
            policy_path=str(row["policy_path"]),
            name=str(row["name"]),
            description=str(row["description"] or ""),
            tenant_id=_normalize_tenant_id(row["tenant_id"]),
            condition_logic=str(row["condition_logic"] or "AND").upper(),
            conditions=conditions,
            effect=str(row["effect"] or "deny").lower(),
            target=str(row["target"]).strip() if row["target"] else None,
            priority=int(row["priority"] or 100),
            enabled=bool(row["enabled"]),
            tags=tags,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )


_policy_engine: PolicyEngine | None = None


def get_policy_engine() -> PolicyEngine:
    global _policy_engine
    if _policy_engine is None:
        _policy_engine = PolicyEngine()
    return _policy_engine
