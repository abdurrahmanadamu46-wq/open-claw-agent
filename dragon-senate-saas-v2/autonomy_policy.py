"""
Autonomy policy with L0-L3 decision governance.

The default runtime level is read from AUTONOMY_DEFAULT_LEVEL so the project
can add the new policy layer without breaking existing flows.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import IntEnum
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AutonomyLevel(IntEnum):
    L0_OBSERVE = 0
    L1_SUGGEST = 1
    L2_EXECUTE = 2
    L3_AUTONOMOUS = 3


@dataclass(slots=True)
class AutonomyChangeRecord:
    tenant_id: str
    target: str
    level: int
    updated_at: str
    updated_by: str
    reason: str = ""


class AutonomyPolicy:
    def __init__(self, default_level: AutonomyLevel = AutonomyLevel.L0_OBSERVE):
        self.default_level = default_level
        self.per_lobster_overrides: dict[str, AutonomyLevel] = {}

    def should_require_approval(self, action: dict[str, Any], lobster_id: str) -> bool:
        level = self.per_lobster_overrides.get(lobster_id, self.default_level)
        if level == AutonomyLevel.L0_OBSERVE:
            return True
        if level == AutonomyLevel.L3_AUTONOMOUS:
            return False
        is_irreversible = bool(action.get("irreversible", False))
        affects_shared = bool(action.get("affects_shared_state", False))
        if level == AutonomyLevel.L1_SUGGEST:
            return True
        if level == AutonomyLevel.L2_EXECUTE:
            return is_irreversible or affects_shared
        return True

    def get_audit_level(self, level: AutonomyLevel) -> str:
        return "full_audit" if level == AutonomyLevel.L3_AUTONOMOUS else "standard"

    def set_default_level(self, level: int) -> None:
        self.default_level = AutonomyLevel(int(level))

    def set_lobster_level(self, lobster_id: str, level: int) -> None:
        self.per_lobster_overrides[str(lobster_id)] = AutonomyLevel(int(level))

    def snapshot(self) -> dict[str, Any]:
        return {
            "default_level": int(self.default_level),
            "audit_level": self.get_audit_level(self.default_level),
            "per_lobster_overrides": {key: int(value) for key, value in self.per_lobster_overrides.items()},
        }


class AutonomyPolicyManager:
    def __init__(self, state_path: str = "runtime/autonomy-policy-state.json"):
        self._state_path = Path(state_path)
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state = self._load_state()

    @staticmethod
    def _default_level_from_env() -> int:
        raw = str(os.getenv("AUTONOMY_DEFAULT_LEVEL", "2")).strip()
        try:
            level = int(raw)
        except ValueError:
            level = 2
        return max(0, min(3, level))

    def get_policy(self, tenant_id: str) -> AutonomyPolicy:
        tenants = self._state.setdefault("tenants", {})
        tenant = dict(tenants.get(tenant_id, {}) or {})
        policy = AutonomyPolicy(default_level=AutonomyLevel(int(tenant.get("default_level", self._default_level_from_env()))))
        for lobster_id, level in dict(tenant.get("per_lobster_overrides", {}) or {}).items():
            policy.set_lobster_level(str(lobster_id), int(level))
        return policy

    def get_snapshot(self, tenant_id: str) -> dict[str, Any]:
        policy = self.get_policy(tenant_id)
        history = [
            item
            for item in self._state.get("history", [])
            if isinstance(item, dict) and str(item.get("tenant_id") or "") == tenant_id
        ]
        return {
            "tenant_id": tenant_id,
            **policy.snapshot(),
            "history": history[-100:],
        }

    def update_policy(
        self,
        tenant_id: str,
        *,
        default_level: int | None = None,
        per_lobster_overrides: dict[str, int] | None = None,
        updated_by: str = "system",
        reason: str = "",
    ) -> dict[str, Any]:
        tenants = self._state.setdefault("tenants", {})
        tenant = dict(tenants.get(tenant_id, {}) or {})
        history = self._state.setdefault("history", [])
        if default_level is not None:
            tenant["default_level"] = max(0, min(3, int(default_level)))
            history.append(
                {
                    "tenant_id": tenant_id,
                    "target": "default",
                    "level": tenant["default_level"],
                    "updated_at": _utc_now(),
                    "updated_by": updated_by,
                    "reason": reason,
                }
            )
        overrides = dict(tenant.get("per_lobster_overrides", {}) or {})
        for lobster_id, level in dict(per_lobster_overrides or {}).items():
            safe_level = max(0, min(3, int(level)))
            overrides[str(lobster_id)] = safe_level
            history.append(
                {
                    "tenant_id": tenant_id,
                    "target": str(lobster_id),
                    "level": safe_level,
                    "updated_at": _utc_now(),
                    "updated_by": updated_by,
                    "reason": reason,
                }
            )
        tenant["per_lobster_overrides"] = overrides
        tenant["updated_at"] = _utc_now()
        tenant["updated_by"] = updated_by
        tenants[tenant_id] = tenant
        self._save()
        return self.get_snapshot(tenant_id)

    def _load_state(self) -> dict[str, Any]:
        if not self._state_path.exists():
            return {"tenants": {}, "history": []}
        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except Exception:
            return {"tenants": {}, "history": []}
        if not isinstance(payload, dict):
            payload = {"tenants": {}, "history": []}
        payload.setdefault("tenants", {})
        payload.setdefault("history", [])
        return payload

    def _save(self) -> None:
        self._state_path.write_text(json.dumps(self._state, ensure_ascii=False, indent=2), encoding="utf-8")


_autonomy_manager: AutonomyPolicyManager | None = None


def get_autonomy_policy_manager() -> AutonomyPolicyManager:
    global _autonomy_manager
    if _autonomy_manager is None:
        _autonomy_manager = AutonomyPolicyManager(
            state_path=os.getenv("AUTONOMY_POLICY_STATE_PATH", str(Path(__file__).resolve().parent / "runtime" / "autonomy-policy-state.json")),
        )
    return _autonomy_manager


def reset_autonomy_policy_manager() -> None:
    global _autonomy_manager
    _autonomy_manager = None
