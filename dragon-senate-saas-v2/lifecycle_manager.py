"""
统一管理龙虾、工作流、渠道账号的生命周期状态。
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from feature_flags import FeatureFlagEnvironment, get_feature_flag_client
from notification_center import send_notification
from tenant_audit_log import AuditEventType, get_audit_service


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LobsterLifecycle(str, Enum):
    EXPERIMENTAL = "experimental"
    PRODUCTION = "production"
    DEPRECATED = "deprecated"


class WorkflowLifecycle(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class ChannelLifecycle(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


@dataclass
class LifecycleChangeEvent:
    entity_type: str
    entity_id: str
    entity_name: str
    old_lifecycle: str
    new_lifecycle: str
    changed_by: str
    tenant_id: str
    reason: str | None = None
    changed_at: str = field(default_factory=_utc_now)


class LifecycleManager:
    LOBSTER_TRANSITIONS = {
        LobsterLifecycle.EXPERIMENTAL: [LobsterLifecycle.PRODUCTION, LobsterLifecycle.DEPRECATED],
        LobsterLifecycle.PRODUCTION: [LobsterLifecycle.DEPRECATED],
        LobsterLifecycle.DEPRECATED: [],
    }
    WORKFLOW_TRANSITIONS = {
        WorkflowLifecycle.DRAFT: [WorkflowLifecycle.ACTIVE, WorkflowLifecycle.ARCHIVED],
        WorkflowLifecycle.ACTIVE: [WorkflowLifecycle.PAUSED, WorkflowLifecycle.ARCHIVED],
        WorkflowLifecycle.PAUSED: [WorkflowLifecycle.ACTIVE, WorkflowLifecycle.ARCHIVED],
        WorkflowLifecycle.ARCHIVED: [],
    }
    CHANNEL_TRANSITIONS = {
        ChannelLifecycle.ACTIVE: [ChannelLifecycle.PAUSED, ChannelLifecycle.ARCHIVED],
        ChannelLifecycle.PAUSED: [ChannelLifecycle.ACTIVE, ChannelLifecycle.ARCHIVED],
        ChannelLifecycle.ARCHIVED: [],
    }

    SYSTEMS = {
        "content-intelligence": {
            "description": "内容情报与策略分析",
            "lobsters": ["radar", "strategist"],
        },
        "content-production": {
            "description": "内容创作与视觉生产",
            "lobsters": ["inkwriter", "visualizer"],
        },
        "channel-delivery": {
            "description": "渠道分发与互动承接",
            "lobsters": ["dispatcher", "echoer", "catcher"],
        },
        "follow-growth": {
            "description": "跟进、复盘与增长闭环",
            "lobsters": ["abacus", "followup", "commander"],
        },
    }

    def __init__(self, registry_path: str | Path | None = None, state_db_path: str | Path | None = None) -> None:
        self.registry_path = Path(registry_path) if registry_path else (Path(__file__).resolve().parent / "lobsters-registry.json")
        self.state_db_path = Path(state_db_path) if state_db_path else (Path(__file__).resolve().parent / "data" / "lifecycle.sqlite")
        self.state_db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_state_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.state_db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_state_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS entity_lifecycle_state (
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    lifecycle TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (entity_type, entity_id)
                );
                """
            )
            conn.commit()

    def _load_registry(self) -> dict[str, Any]:
        if self.registry_path.exists():
            return json.loads(self.registry_path.read_text(encoding="utf-8-sig"))
        return {"$schema": "lobsters-registry-v2", "updated_at": None, "lobsters": {}, "systems": []}

    def _save_registry(self, registry: dict[str, Any]) -> None:
        registry["updated_at"] = _utc_now()
        self.registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")

    def ensure_registry_shape(self) -> dict[str, Any]:
        registry = self._load_registry()
        if registry.get("$schema") != "lobsters-registry-v2":
            registry["$schema"] = "lobsters-registry-v2"
            changed = True
        else:
            changed = False
        lobsters = registry.get("lobsters", {})
        for lobster_id, data in lobsters.items():
            system_name = next((name for name, cfg in self.SYSTEMS.items() if lobster_id in cfg["lobsters"]), "follow-growth")
            if "id" not in data:
                data["id"] = lobster_id
                changed = True
            if "description" not in data:
                data["description"] = str(data.get("role") or data.get("phase") or lobster_id)
                changed = True
            if "lifecycle" not in data:
                data["lifecycle"] = LobsterLifecycle.PRODUCTION.value
                changed = True
            if "system" not in data:
                data["system"] = system_name
                changed = True
            if "annotations" not in data:
                data["annotations"] = {}
                changed = True
            if data.get("system") != system_name:
                data["system"] = system_name
                changed = True
            if not isinstance(data.get("annotations"), dict):
                data["annotations"] = {}
                changed = True
            if "scheduling_priority" not in data:
                data["scheduling_priority"] = 100 if data.get("lifecycle") != LobsterLifecycle.DEPRECATED.value else 0
                changed = True
            if "openclaw/edge-compatible" not in data["annotations"]:
                data["annotations"]["openclaw/edge-compatible"] = "true"
                changed = True
            if "openclaw/prompt-version" not in data["annotations"]:
                data["annotations"]["openclaw/prompt-version"] = "stable"
                changed = True

        desired_systems = [
            {
                "name": name,
                "description": cfg["description"],
                "lobsters": list(cfg["lobsters"]),
            }
            for name, cfg in self.SYSTEMS.items()
        ]
        if registry.get("systems") != desired_systems:
            registry["systems"] = desired_systems
            changed = True
        if changed:
            self._save_registry(registry)
        return registry

    def list_lobsters(self, lifecycle: str | None = None) -> list[dict[str, Any]]:
        registry = self.ensure_registry_shape()
        rows = []
        for lobster_id, item in registry.get("lobsters", {}).items():
            if lifecycle and str(item.get("lifecycle") or "").strip().lower() != str(lifecycle).strip().lower():
                continue
            rows.append({"id": lobster_id, **item})
        return rows

    def get_lobster(self, lobster_id: str) -> dict[str, Any] | None:
        registry = self.ensure_registry_shape()
        row = registry.get("lobsters", {}).get(lobster_id)
        if row is None:
            return None
        return {"id": lobster_id, **row}

    def should_schedule_lobster(self, lobster: dict[str, Any]) -> bool:
        lifecycle = str(lobster.get("lifecycle") or LobsterLifecycle.PRODUCTION.value).strip().lower()
        return lifecycle != LobsterLifecycle.DEPRECATED.value

    def get_workflow_lifecycle(self, workflow_id: str) -> str:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT lifecycle FROM entity_lifecycle_state WHERE entity_type='workflow' AND entity_id=?",
                (workflow_id,),
            ).fetchone()
        return str(row["lifecycle"]) if row else WorkflowLifecycle.ACTIVE.value

    def set_workflow_lifecycle(self, workflow_id: str, lifecycle: WorkflowLifecycle) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO entity_lifecycle_state(entity_type, entity_id, lifecycle, updated_at)
                VALUES ('workflow', ?, ?, ?)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET lifecycle=excluded.lifecycle, updated_at=excluded.updated_at
                """,
                (workflow_id, lifecycle.value, _utc_now()),
            )
            conn.commit()

    def get_channel_lifecycle(self, channel_id: str) -> str:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT lifecycle FROM entity_lifecycle_state WHERE entity_type='channel' AND entity_id=?",
                (channel_id,),
            ).fetchone()
        return str(row["lifecycle"]) if row else ChannelLifecycle.ACTIVE.value

    def set_channel_lifecycle(self, channel_id: str, lifecycle: ChannelLifecycle) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO entity_lifecycle_state(entity_type, entity_id, lifecycle, updated_at)
                VALUES ('channel', ?, ?, ?)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET lifecycle=excluded.lifecycle, updated_at=excluded.updated_at
                """,
                (channel_id, lifecycle.value, _utc_now()),
            )
            conn.commit()

    def _validate_transition(self, current: Enum, target: Enum, transitions: dict[Enum, list[Enum]]) -> None:
        if target not in transitions.get(current, []):
            raise ValueError(f"invalid_lifecycle_transition:{current.value}->{target.value}")

    def _lobster_pool_db_path(self) -> Path:
        raw = os.getenv("LOBSTER_POOL_DB_PATH", "./data/lobster_pool.sqlite")
        path = Path(raw)
        if not path.is_absolute():
            path = (Path(__file__).resolve().parent / path).resolve()
        return path

    def _affected_tenants(self, lobster_id: str) -> list[str]:
        path = self._lobster_pool_db_path()
        if not path.exists():
            return []
        conn = sqlite3.connect(str(path))
        try:
            rows = conn.execute(
                "SELECT DISTINCT tenant_id FROM lobster_run_log WHERE lobster_id = ?",
                (lobster_id,),
            ).fetchall()
            return [str(row[0]).strip() for row in rows if str(row[0]).strip()]
        finally:
            conn.close()

    async def _record_audit(self, event: LifecycleChangeEvent) -> None:
        await get_audit_service().log(
            event_type=AuditEventType.LOBSTER_CONFIG_UPDATE,
            tenant_id=event.tenant_id,
            user_id=event.changed_by,
            resource_type=event.entity_type,
            resource_id=event.entity_id,
            details={
                "entity_name": event.entity_name,
                "old_lifecycle": event.old_lifecycle,
                "new_lifecycle": event.new_lifecycle,
                "reason": event.reason,
            },
        )

    async def _notify_affected_tenants(self, lobster: dict[str, Any], reason: str | None) -> None:
        tenants = self._affected_tenants(str(lobster.get("id") or ""))
        for tenant_id in tenants:
            await send_notification(
                tenant_id=tenant_id,
                category="lifecycle",
                level="warning",
                message=(
                    f"龙虾 {lobster.get('zh_name') or lobster.get('display_name') or lobster.get('id')} "
                    f"已进入 deprecated 状态。{reason or ''}"
                ).strip(),
            )

    async def _apply_lobster_effects(self, lobster: dict[str, Any], new_lifecycle: LobsterLifecycle) -> None:
        if new_lifecycle == LobsterLifecycle.DEPRECATED:
            try:
                flag = get_feature_flag_client().get_flag(
                    f"lobster.{lobster['id']}.enabled",
                    environment=FeatureFlagEnvironment.PROD,
                )
                if flag is not None:
                    flag.enabled = False
                    get_feature_flag_client().upsert_flag(flag, changed_by="lifecycle_manager")
            except Exception:
                pass
            await self._notify_affected_tenants(lobster, "请尽快迁移到替代龙虾或稳定工作流。")
        elif new_lifecycle == LobsterLifecycle.PRODUCTION:
            try:
                flag = get_feature_flag_client().get_flag(
                    f"lobster.{lobster['id']}.enabled",
                    environment=FeatureFlagEnvironment.PROD,
                )
                if flag is not None:
                    flag.enabled = True
                    get_feature_flag_client().upsert_flag(flag, changed_by="lifecycle_manager")
            except Exception:
                pass

    async def change_lobster_lifecycle(
        self,
        lobster_id: str,
        new_lifecycle: LobsterLifecycle,
        changed_by: str,
        tenant_id: str,
        reason: str | None = None,
    ) -> LifecycleChangeEvent:
        registry = self.ensure_registry_shape()
        lobster = registry.get("lobsters", {}).get(lobster_id)
        if lobster is None:
            raise KeyError(lobster_id)
        current_lifecycle = LobsterLifecycle(str(lobster.get("lifecycle") or LobsterLifecycle.PRODUCTION.value))
        self._validate_transition(current_lifecycle, new_lifecycle, self.LOBSTER_TRANSITIONS)
        lobster["lifecycle"] = new_lifecycle.value
        lobster["scheduling_priority"] = 0 if new_lifecycle == LobsterLifecycle.DEPRECATED else 100
        self._save_registry(registry)
        event = LifecycleChangeEvent(
            entity_type="lobster",
            entity_id=lobster_id,
            entity_name=str(lobster.get("display_name") or lobster_id),
            old_lifecycle=current_lifecycle.value,
            new_lifecycle=new_lifecycle.value,
            changed_by=changed_by,
            tenant_id=tenant_id,
            reason=reason,
        )
        await self._apply_lobster_effects({"id": lobster_id, **lobster}, new_lifecycle)
        await self._record_audit(event)
        return event

    async def change_workflow_lifecycle(
        self,
        workflow_id: str,
        new_lifecycle: WorkflowLifecycle,
        changed_by: str,
        tenant_id: str,
        reason: str | None = None,
    ) -> LifecycleChangeEvent:
        from workflow_engine import load_workflow

        workflow = load_workflow(workflow_id)
        current_lifecycle = WorkflowLifecycle(self.get_workflow_lifecycle(workflow_id))
        self._validate_transition(current_lifecycle, new_lifecycle, self.WORKFLOW_TRANSITIONS)
        self.set_workflow_lifecycle(workflow_id, new_lifecycle)
        event = LifecycleChangeEvent(
            entity_type="workflow",
            entity_id=workflow_id,
            entity_name=workflow.name,
            old_lifecycle=current_lifecycle.value,
            new_lifecycle=new_lifecycle.value,
            changed_by=changed_by,
            tenant_id=tenant_id,
            reason=reason,
        )
        await self._record_audit(event)
        return event

    async def change_channel_lifecycle(
        self,
        channel_id: str,
        new_lifecycle: ChannelLifecycle,
        changed_by: str,
        tenant_id: str,
        reason: str | None = None,
    ) -> LifecycleChangeEvent:
        current_lifecycle = ChannelLifecycle(self.get_channel_lifecycle(channel_id))
        self._validate_transition(current_lifecycle, new_lifecycle, self.CHANNEL_TRANSITIONS)
        self.set_channel_lifecycle(channel_id, new_lifecycle)
        event = LifecycleChangeEvent(
            entity_type="channel",
            entity_id=channel_id,
            entity_name=channel_id,
            old_lifecycle=current_lifecycle.value,
            new_lifecycle=new_lifecycle.value,
            changed_by=changed_by,
            tenant_id=tenant_id,
            reason=reason,
        )
        await self._record_audit(event)
        return event


_manager: LifecycleManager | None = None


def get_lifecycle_manager() -> LifecycleManager:
    global _manager
    if _manager is None:
        _manager = LifecycleManager()
    return _manager
