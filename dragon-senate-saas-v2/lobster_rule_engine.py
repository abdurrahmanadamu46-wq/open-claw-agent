"""
Lobster rule engine inspired by Wazuh engine.
"""

from __future__ import annotations

import json
import operator
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Awaitable

STATE_PATH = Path(os.getenv("LOBSTER_RULE_ENGINE_PATH", "./runtime/lobster_rule_engine.json"))


class RuleOperator(str):
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    EQ = "eq"
    NEQ = "neq"
    CONTAINS = "contains"
    STARTSWITH = "startswith"
    REGEX = "regex"


@dataclass(slots=True)
class RuleCondition:
    field: str
    op: str
    value: Any

    def match(self, event: dict[str, Any]) -> bool:
        target = self._get_field(event, self.field)
        if target is None:
            return False
        if self.op == RuleOperator.REGEX:
            return re.search(str(self.value), str(target)) is not None
        ops = {
            RuleOperator.GT: operator.gt,
            RuleOperator.GTE: operator.ge,
            RuleOperator.LT: operator.lt,
            RuleOperator.LTE: operator.le,
            RuleOperator.EQ: operator.eq,
            RuleOperator.NEQ: operator.ne,
            RuleOperator.CONTAINS: lambda a, b: str(b) in str(a),
            RuleOperator.STARTSWITH: lambda a, b: str(a).startswith(str(b)),
        }
        return ops.get(self.op, lambda a, b: False)(target, self.value)

    @staticmethod
    def _get_field(obj: dict[str, Any], path: str) -> Any:
        current: Any = obj
        for part in str(path).split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current


@dataclass(slots=True)
class RuleAction:
    action_type: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class LobsterRule:
    rule_id: str
    name: str
    description: str = ""
    tenant_id: str = "*"
    conditions: list[RuleCondition] = field(default_factory=list)
    condition_logic: str = "AND"
    actions: list[RuleAction] = field(default_factory=list)
    priority: int = 100
    enabled: bool = True
    tags: list[str] = field(default_factory=list)

    def match(self, event: dict[str, Any]) -> bool:
        if not self.enabled or not self.conditions:
            return False
        matched = [condition.match(event) for condition in self.conditions]
        return all(matched) if str(self.condition_logic).upper() != "OR" else any(matched)

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "name": self.name,
            "description": self.description,
            "tenant_id": self.tenant_id,
            "conditions": [asdict(condition) for condition in self.conditions],
            "condition_logic": self.condition_logic,
            "actions": [asdict(action) for action in self.actions],
            "priority": self.priority,
            "enabled": self.enabled,
            "tags": list(self.tags),
        }


class LobsterRuleEngine:
    def __init__(self, state_path: Path = STATE_PATH) -> None:
        self._state_path = state_path
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._rules: list[LobsterRule] = []
        self._action_handlers: dict[str, Callable[[dict[str, Any], dict[str, Any], str], Awaitable[Any]]] = {}
        self.load_from_disk()

    def register_action(self, action_type: str, handler: Callable[[dict[str, Any], dict[str, Any], str], Awaitable[Any]]) -> None:
        self._action_handlers[action_type] = handler

    def load_rules(self, rules: list[LobsterRule]) -> None:
        self._rules = sorted(rules, key=lambda item: (item.priority, item.rule_id))
        self.save_to_disk()

    def list_rules(self) -> list[dict[str, Any]]:
        return [rule.to_dict() for rule in self._rules]

    def upsert_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        rule = self._rule_from_dict(payload)
        self._rules = [item for item in self._rules if item.rule_id != rule.rule_id]
        self._rules.append(rule)
        self._rules.sort(key=lambda item: (item.priority, item.rule_id))
        self.save_to_disk()
        return rule.to_dict()

    def delete_rule(self, rule_id: str) -> bool:
        before = len(self._rules)
        self._rules = [rule for rule in self._rules if rule.rule_id != rule_id]
        changed = len(self._rules) != before
        if changed:
            self.save_to_disk()
        return changed

    async def process(self, event: dict[str, Any], tenant_id: str) -> list[dict[str, Any]]:
        triggered: list[dict[str, Any]] = []
        for rule in self._rules:
            if rule.tenant_id not in {"*", tenant_id}:
                continue
            if not rule.match(event):
                continue
            for action in rule.actions:
                handler = self._action_handlers.get(action.action_type)
                result: Any = {"status": "no_handler"}
                if handler is not None:
                    result = await handler(event, action.params, tenant_id)
                triggered.append(
                    {
                        "rule_id": rule.rule_id,
                        "rule_name": rule.name,
                        "action": action.action_type,
                        "result": result,
                    }
                )
        return triggered

    def load_from_disk(self) -> None:
        if not self._state_path.exists():
            self._rules = self._default_rules()
            self.save_to_disk()
            return
        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except Exception:
            self._rules = self._default_rules()
            self.save_to_disk()
            return
        rules = payload.get("rules", []) if isinstance(payload, dict) else []
        self._rules = [self._rule_from_dict(item) for item in rules if isinstance(item, dict)]
        if not self._rules:
            self._rules = self._default_rules()
            self.save_to_disk()

    def save_to_disk(self) -> None:
        payload = {"rules": [rule.to_dict() for rule in self._rules]}
        self._state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _rule_from_dict(self, payload: dict[str, Any]) -> LobsterRule:
        conditions = [
            RuleCondition(
                field=str(item.get("field") or ""),
                op=str(item.get("op") or RuleOperator.EQ),
                value=item.get("value"),
            )
            for item in payload.get("conditions", [])
            if isinstance(item, dict)
        ]
        actions = [
            RuleAction(
                action_type=str(item.get("action_type") or item.get("type") or ""),
                params=dict(item.get("params") or {}),
            )
            for item in payload.get("actions", [])
            if isinstance(item, dict)
        ]
        return LobsterRule(
            rule_id=str(payload.get("rule_id") or payload.get("id") or ""),
            name=str(payload.get("name") or ""),
            description=str(payload.get("description") or ""),
            tenant_id=str(payload.get("tenant_id") or "*"),
            conditions=conditions,
            condition_logic=str(payload.get("condition_logic") or payload.get("logic") or "AND"),
            actions=actions,
            priority=int(payload.get("priority", 100) or 100),
            enabled=bool(payload.get("enabled", True)),
            tags=[str(item) for item in payload.get("tags", []) if str(item).strip()],
        )

    def _default_rules(self) -> list[LobsterRule]:
        defaults = [
            {
                "rule_id": "RULE_EDGE_OFFLINE_ALERT",
                "name": "边缘离线告警",
                "tenant_id": "*",
                "priority": 10,
                "conditions": [
                    {"field": "event.type", "op": "eq", "value": "edge_heartbeat"},
                    {"field": "edge.status", "op": "eq", "value": "offline"},
                ],
                "condition_logic": "AND",
                "actions": [
                    {
                        "action_type": "send_alert",
                        "params": {"message_template": "边缘节点 {{edge.edge_id}} 已离线，当前状态={{edge.status}}"},
                    }
                ],
                "enabled": True,
                "tags": ["edge", "availability"],
            },
            {
                "rule_id": "RULE_HIGH_SCORE_LEAD",
                "name": "高分线索自动跟进",
                "tenant_id": "*",
                "priority": 20,
                "conditions": [
                    {"field": "event.type", "op": "eq", "value": "lead_scored"},
                    {"field": "lead.score", "op": "gte", "value": 80},
                ],
                "condition_logic": "AND",
                "actions": [
                    {
                        "action_type": "dispatch_lobster",
                        "params": {"lobster_id": "followup", "task": "高意向线索自动跟进"},
                    }
                ],
                "enabled": True,
                "tags": ["lead", "followup"],
            },
        ]
        return [self._rule_from_dict(item) for item in defaults]


_rule_engine: LobsterRuleEngine | None = None


def get_lobster_rule_engine() -> LobsterRuleEngine:
    global _rule_engine
    if _rule_engine is None:
        _rule_engine = LobsterRuleEngine()
    return _rule_engine
