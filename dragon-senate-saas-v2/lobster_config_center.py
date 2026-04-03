"""
LobsterConfigCenter — 龙虾一站式配置聚合中心

借鉴 Onyx admin/agents：把角色卡、技能、工具、策略、自主级别、提示词和记忆概览
聚合到一个 API 里，供控制台统一展示和更新。
"""

from __future__ import annotations

import fnmatch
import logging
from dataclasses import dataclass
from typing import Any

from autonomy_policy import get_autonomy_policy_manager
from commander_router import get_strategy_intensity_manager
from dynamic_config import get_dynamic_config
from lifecycle_manager import get_lifecycle_manager
from lobster_doc_store import get_lobster_doc_store
from lobster_registry_manager import get_lobster_summary
from lobster_skill_registry import get_skill_registry
from lobsters.base_lobster import (
    load_heartbeat,
    load_prompt_assets,
    load_role_card,
    load_working,
)
from lobsters.lobster_memory import LobsterMemory
from mcp_gateway import get_mcp_gateway
from mcp_tool_policy import tool_policy_enforcer
from tool_marketplace import get_tool_marketplace

logger = logging.getLogger("lobster_config_center")

VALID_LOBSTER_IDS = [
    "commander",
    "radar",
    "strategist",
    "inkwriter",
    "visualizer",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
]

CONFIG_KEY = "lobster_config_center"


@dataclass(slots=True)
class LobsterRuntimeOverrides:
    strategy_level: int | None = None
    autonomy_level: int | None = None
    active_skill_ids: list[str] | None = None
    active_tools: list[str] | None = None
    custom_prompt: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "strategy_level": self.strategy_level,
            "autonomy_level": self.autonomy_level,
            "active_skill_ids": list(self.active_skill_ids or []),
            "active_tools": list(self.active_tools or []),
            "custom_prompt": self.custom_prompt,
        }


class LobsterConfigCenter:
    def __init__(self) -> None:
        self._cfg = get_dynamic_config()

    def list_all_lobsters(self, tenant_id: str) -> list[dict[str, Any]]:
        lifecycle_rows = {
            str(item.get("id") or ""): item
            for item in get_lifecycle_manager().list_lobsters()
        }
        registry_rows = {
            str(item.get("role_id") or ""): item
            for item in get_lobster_summary()
        }
        out: list[dict[str, Any]] = []
        for lobster_id in VALID_LOBSTER_IDS:
            role_card = load_role_card(lobster_id)
            lifecycle = lifecycle_rows.get(lobster_id, {})
            summary = registry_rows.get(lobster_id, {})
            overrides = self.get_runtime_overrides(lobster_id, tenant_id)
            autonomy = self._get_autonomy_block(lobster_id, tenant_id)
            strategy = self._get_strategy_block(lobster_id, tenant_id, overrides)
            out.append(
                {
                    "lobster_id": lobster_id,
                    "display_name": str(role_card.get("displayName") or lobster_id),
                    "zh_name": str(role_card.get("zhName") or lobster_id),
                    "emoji": self._emoji_for_lobster(lobster_id),
                    "mission": str(role_card.get("mission") or lifecycle.get("description") or ""),
                    "status": str(summary.get("status") or "idle"),
                    "lifecycle": str(lifecycle.get("lifecycle") or "production"),
                    "skill_count": len(get_skill_registry().get_skills_for_lobster(lobster_id)),
                    "tool_count": len(overrides.active_tools or tool_policy_enforcer.get_policy(lobster_id).get("allowed_tools", [])),
                    "autonomy_level": autonomy.get("effective_level", 0),
                    "strategy_level": strategy.get("lobster_level_hint"),
                }
            )
        return out

    def get_runtime_overrides(self, lobster_id: str, tenant_id: str) -> LobsterRuntimeOverrides:
        safe_id = self._validate_lobster_id(lobster_id)
        state = self._get_state(tenant_id)
        raw = state.get(safe_id, {}) if isinstance(state.get(safe_id), dict) else {}
        try:
            strategy_level = int(raw["strategy_level"]) if raw.get("strategy_level") is not None else None
        except (TypeError, ValueError):
            strategy_level = None
        try:
            autonomy_level = int(raw["autonomy_level"]) if raw.get("autonomy_level") is not None else None
        except (TypeError, ValueError):
            autonomy_level = None
        active_skill_ids = [str(item) for item in raw.get("active_skill_ids", []) if str(item).strip()]
        active_tools = [str(item) for item in raw.get("active_tools", []) if str(item).strip()]
        return LobsterRuntimeOverrides(
            strategy_level=strategy_level,
            autonomy_level=autonomy_level,
            active_skill_ids=active_skill_ids,
            active_tools=active_tools,
            custom_prompt=str(raw.get("custom_prompt") or "").strip(),
        )

    def get_lobster_config(self, lobster_id: str, tenant_id: str) -> dict[str, Any]:
        safe_id = self._validate_lobster_id(lobster_id)
        role_card = load_role_card(safe_id)
        lifecycle = get_lifecycle_manager().get_lobster(safe_id) or {}
        summary_map = {
            str(item.get("role_id") or ""): item
            for item in get_lobster_summary()
        }
        summary = summary_map.get(safe_id, {})
        overrides = self.get_runtime_overrides(safe_id, tenant_id)
        return {
            "lobster_id": safe_id,
            "tenant_id": tenant_id,
            "role_card": {
                "display_name": str(role_card.get("displayName") or safe_id),
                "zh_name": str(role_card.get("zhName") or safe_id),
                "mission": str(role_card.get("mission") or lifecycle.get("description") or ""),
                "personality": str(role_card.get("personality") or ""),
                "communication_style": str(role_card.get("communicationStyle") or ""),
                "primary_artifact": str(role_card.get("primaryArtifact") or ""),
                "input_contract": list(role_card.get("inputContract", []) or []),
                "output_contract": list(role_card.get("outputContract", []) or []),
                "forbidden_actions": list(role_card.get("forbiddenActions", []) or []),
            },
            "collaboration": {
                "upstream_roles": list(role_card.get("upstreamRoles", []) or []),
                "downstream_roles": list(role_card.get("downstreamRoles", []) or []),
            },
            "status": {
                "runtime_status": str(summary.get("status") or "idle"),
                "lifecycle": str(lifecycle.get("lifecycle") or "production"),
                "system": str(lifecycle.get("system") or ""),
                "run_count": int(summary.get("run_count") or 0),
                "error_count": int(summary.get("error_count") or 0),
                "last_heartbeat": summary.get("last_heartbeat"),
            },
            "strategy": self._get_strategy_block(safe_id, tenant_id, overrides),
            "autonomy": self._get_autonomy_block(safe_id, tenant_id),
            "runtime_overrides": overrides.to_dict(),
            "skills": self._get_skill_items(safe_id, tenant_id, overrides),
            "tools": self._get_tool_items(safe_id, tenant_id, overrides),
            "prompt_assets": load_prompt_assets(safe_id),
            "memory": self._get_memory_summary(safe_id, tenant_id),
            "docs": self._get_doc_summary(safe_id, tenant_id),
            "heartbeat": load_heartbeat(safe_id),
            "working": load_working(safe_id),
        }

    def update_lobster_config(
        self,
        lobster_id: str,
        tenant_id: str,
        patch: dict[str, Any],
        *,
        updated_by: str = "system",
    ) -> dict[str, Any]:
        safe_id = self._validate_lobster_id(lobster_id)
        state = self._get_state(tenant_id)
        current = dict(state.get(safe_id) or {})
        applied: dict[str, Any] = {}

        if patch.get("strategy_level") is not None:
            strategy_level = max(1, min(int(patch.get("strategy_level")), 4))
            current["strategy_level"] = strategy_level
            applied["strategy_level"] = strategy_level
            if safe_id == "commander":
                try:
                    get_strategy_intensity_manager(tenant_id).set_level(
                        strategy_level,
                        manual=True,
                        updated_by=updated_by,
                        reason="lobster_config_center",
                        lobster_id="commander",
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Failed to sync commander strategy level: %s", exc)

        if patch.get("autonomy_level") is not None:
            autonomy_level = max(0, min(int(patch.get("autonomy_level")), 3))
            current["autonomy_level"] = autonomy_level
            applied["autonomy_level"] = autonomy_level
            get_autonomy_policy_manager().update_policy(
                tenant_id,
                per_lobster_overrides={safe_id: autonomy_level},
                updated_by=updated_by,
                reason="lobster_config_center",
            )

        if patch.get("active_skills") is not None:
            valid_skill_ids = {
                skill.id
                for skill in get_skill_registry().get_skills_for_lobster(safe_id)
            }
            selected = [
                str(item)
                for item in patch.get("active_skills", [])
                if str(item).strip() and str(item) in valid_skill_ids
            ]
            current["active_skill_ids"] = list(dict.fromkeys(selected))
            applied["active_skill_ids"] = list(current["active_skill_ids"])

        if patch.get("active_tools") is not None:
            selected_tools = [
                str(item)
                for item in patch.get("active_tools", [])
                if str(item).strip()
            ]
            current["active_tools"] = list(dict.fromkeys(selected_tools))
            applied["active_tools"] = list(current["active_tools"])

        if patch.get("custom_prompt") is not None:
            current["custom_prompt"] = str(patch.get("custom_prompt") or "").strip()[:4000]
            applied["custom_prompt"] = current["custom_prompt"]

        state[safe_id] = current
        self._save_state(tenant_id, state, updated_by=updated_by)
        return {
            "ok": True,
            "lobster_id": safe_id,
            "tenant_id": tenant_id,
            "applied": applied,
            "config": self.get_lobster_config(safe_id, tenant_id),
        }

    def _get_state(self, tenant_id: str) -> dict[str, Any]:
        raw = self._cfg.get_json(CONFIG_KEY, default={}, namespace=tenant_id)
        return dict(raw) if isinstance(raw, dict) else {}

    def _save_state(self, tenant_id: str, state: dict[str, Any], *, updated_by: str) -> None:
        self._cfg.set(
            CONFIG_KEY,
            state,
            namespace=tenant_id,
            description="Per-lobster runtime config center overrides",
            updated_by=updated_by,
        )

    def _get_skill_items(
        self,
        lobster_id: str,
        tenant_id: str,
        overrides: LobsterRuntimeOverrides,
    ) -> dict[str, Any]:
        registry = get_skill_registry()
        valid_selected = set(overrides.active_skill_ids or [])
        items = []
        for skill in registry.get_skills_for_lobster(lobster_id):
            row = skill.to_api_dict()
            row["selected"] = skill.id in valid_selected if valid_selected else bool(row.get("enabled", True))
            items.append(row)
        items.sort(key=lambda row: (not bool(row.get("selected")), str(row.get("id") or "")))
        return {
            "selected_ids": list(overrides.active_skill_ids or []),
            "items": items,
            "count": len(items),
            "tenant_id": tenant_id,
        }

    def _get_tool_items(
        self,
        lobster_id: str,
        tenant_id: str,
        overrides: LobsterRuntimeOverrides,
    ) -> dict[str, Any]:
        policy = tool_policy_enforcer.get_policy(lobster_id)
        catalog = get_tool_marketplace().list_all(tenant_id=tenant_id)
        selected_patterns = list(overrides.active_tools or policy.get("allowed_tools", []))
        items = []
        for item in catalog:
            tool_id = str(item.get("tool_id") or "")
            selected = any(
                pattern == "*" or fnmatch.fnmatch(tool_id, str(pattern))
                for pattern in selected_patterns
            )
            items.append({**item, "selected": selected})
        items.sort(key=lambda row: (not bool(row.get("selected")), str(row.get("tool_id") or "")))
        return {
            "policy": policy,
            "selected_tools": list(overrides.active_tools or []),
            "items": items,
            "servers": get_mcp_gateway().list_servers(),
        }

    def _get_doc_summary(self, lobster_id: str, tenant_id: str) -> dict[str, Any]:
        try:
            latest = get_lobster_doc_store().get_latest_for_lobster(lobster_id, tenant_id)
        except Exception:
            latest = None
        if not latest:
            return {"latest": None}
        return {
            "latest": {
                "doc_id": latest.get("doc_id"),
                "title": latest.get("title"),
                "version": latest.get("version"),
                "updated_at": latest.get("updated_at"),
            }
        }

    def _get_memory_summary(self, lobster_id: str, tenant_id: str) -> dict[str, Any]:
        stats = LobsterMemory(lobster_id, tenant_id).get_stats()
        return {
            "counts": stats,
            "total": sum(int(value or 0) for value in stats.values()),
        }

    def _get_strategy_block(
        self,
        lobster_id: str,
        tenant_id: str,
        overrides: LobsterRuntimeOverrides,
    ) -> dict[str, Any]:
        snapshot = get_strategy_intensity_manager(tenant_id).get_snapshot()
        return {
            "tenant_current_level": int(snapshot.get("current_level", 0) or 0),
            "tenant_label": str(snapshot.get("label") or ""),
            "tenant_description": str(snapshot.get("description") or ""),
            "lobster_level_hint": overrides.strategy_level,
            "applies_globally": lobster_id == "commander",
        }

    def _get_autonomy_block(self, lobster_id: str, tenant_id: str) -> dict[str, Any]:
        snapshot = get_autonomy_policy_manager().get_snapshot(tenant_id)
        policy = get_autonomy_policy_manager().get_policy(tenant_id)
        effective_level = int(policy.per_lobster_overrides.get(lobster_id, policy.default_level))
        return {
            "tenant_default_level": int(snapshot.get("default_level", 0) or 0),
            "effective_level": effective_level,
            "effective_label": self._autonomy_label(effective_level),
            "history_count": len(snapshot.get("history", []) or []),
        }

    @staticmethod
    def _autonomy_label(level: int) -> str:
        return {
            0: "observe",
            1: "suggest",
            2: "execute",
            3: "autonomous",
        }.get(int(level), "observe")

    @staticmethod
    def _emoji_for_lobster(lobster_id: str) -> str:
        return {
            "commander": "🧠",
            "radar": "📡",
            "strategist": "🧭",
            "inkwriter": "✍️",
            "visualizer": "🎬",
            "dispatcher": "📦",
            "echoer": "💬",
            "catcher": "🎯",
            "abacus": "🧮",
            "followup": "📞",
        }.get(lobster_id, "🦞")

    @staticmethod
    def _validate_lobster_id(lobster_id: str) -> str:
        safe_id = str(lobster_id or "").strip()
        if safe_id not in VALID_LOBSTER_IDS:
            raise KeyError(f"unknown_lobster:{lobster_id}")
        return safe_id


_lobster_config_center: LobsterConfigCenter | None = None


def get_lobster_config_center() -> LobsterConfigCenter:
    global _lobster_config_center
    if _lobster_config_center is None:
        _lobster_config_center = LobsterConfigCenter()
    return _lobster_config_center
