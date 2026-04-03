"""
Resource-granular RBAC for lobster/channels/workflows and related assets.

Compatibility goals:
- Keep the original role/resource/action matrix APIs (`can`, `require`, etc.)
- Add resource-level permission rules persisted in SQLite
- Support wildcard rules, explicit deny, per-user and per-role grants
"""

from __future__ import annotations

import os
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Literal


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ResourceType(str, Enum):
    ANY = "*"
    LOBSTER = "lobster"
    WORKFLOW = "workflow"
    CHANNEL = "channel"
    API_KEY = "api_key"
    EDGE_NODE = "edge_node"
    SKILL = "skill"
    MEMORY = "memory"
    REPORT = "report"
    TENANT = "tenant"


class ResourceScope(str, Enum):
    READ = "read"
    WRITE = "write"
    EXECUTE = "execute"
    ADMIN = "admin"


SubjectType = Literal["role", "user"]
Role = Literal["owner", "admin", "operator", "viewer", "member"]


ROLE_ALIASES: dict[str, str] = {
    "owner": "owner",
    "superadmin": "owner",
    "super_admin": "owner",
    "admin": "admin",
    "tenant_admin": "admin",
    "operator": "operator",
    "member": "operator",
    "viewer": "viewer",
    "read_only": "viewer",
}

ROLE_HIERARCHY: dict[str, int] = {
    "viewer": 0,
    "operator": 1,
    "admin": 2,
    "owner": 3,
}


def _normalize_role(role: str | None) -> str:
    return ROLE_ALIASES.get(str(role or "").strip().lower(), str(role or "").strip().lower())


def _scope_allows(rule_scope: str, requested_scope: str) -> bool:
    normalized_rule = str(rule_scope or "").strip().lower()
    normalized_requested = str(requested_scope or "").strip().lower()
    if normalized_rule == ResourceScope.ADMIN.value:
        return True
    if normalized_rule == ResourceScope.WRITE.value and normalized_requested in {ResourceScope.WRITE.value, ResourceScope.READ.value}:
        return True
    return normalized_rule == normalized_requested


def _action_to_scope(action: str) -> ResourceScope:
    normalized = str(action or "").strip().lower()
    if normalized in {"read", "export"}:
        return ResourceScope.READ
    if normalized in {"create", "update", "invite", "leave"}:
        return ResourceScope.WRITE
    if normalized in {"execute", "approve"}:
        return ResourceScope.EXECUTE
    if normalized in {"delete", "admin"}:
        return ResourceScope.ADMIN
    return ResourceScope.READ


@dataclass
class Permission:
    resource: str
    actions: list[str] | Literal["*"]


ROLE_PERMISSIONS: dict[str, list[Permission]] = {
    "owner": [Permission("*", "*")],
    "admin": [Permission("*", "*")],
    "operator": [
        Permission("tenant", ["read"]),
        Permission("lobster", ["read", "execute"]),
        Permission("workflow", ["read", "execute"]),
        Permission("channel", ["read", "write", "execute"]),
        Permission("skill", ["read"]),
        Permission("memory", ["read"]),
        Permission("report", ["read"]),
        Permission("api_key", ["read"]),
    ],
    "viewer": [
        Permission("tenant", ["read"]),
        Permission("lobster", ["read"]),
        Permission("workflow", ["read"]),
        Permission("channel", ["read"]),
        Permission("skill", ["read"]),
        Permission("memory", ["read"]),
        Permission("report", ["read"]),
    ],
}


@dataclass
class ResourcePermission:
    id: str
    tenant_id: str
    resource_type: ResourceType
    resource_id: str
    scope: ResourceScope
    subject_type: SubjectType
    subject_id: str
    granted: bool = True
    created_at: str = field(default_factory=_utc_now)
    note: str = ""
    source: str = "custom"

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["resource_type"] = self.resource_type.value
        payload["scope"] = self.scope.value
        return payload


class RBACService:
    def __init__(self, db_path: str | None = None) -> None:
        raw = db_path or os.getenv("RBAC_DB_PATH", "data/resource_rbac.sqlite")
        self._db_path = Path(raw)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
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
                CREATE TABLE IF NOT EXISTS resource_permissions (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    resource_type TEXT NOT NULL,
                    resource_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    subject_type TEXT NOT NULL,
                    subject_id TEXT NOT NULL,
                    granted INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_rbac_tenant_subject
                    ON resource_permissions(tenant_id, subject_type, subject_id);
                CREATE INDEX IF NOT EXISTS idx_rbac_resource
                    ON resource_permissions(tenant_id, resource_type, resource_id, scope);
                """
            )
            conn.commit()

    def _row_to_perm(self, row: sqlite3.Row, *, source: str = "custom") -> ResourcePermission:
        return ResourcePermission(
            id=str(row["id"]),
            tenant_id=str(row["tenant_id"]),
            resource_type=ResourceType(str(row["resource_type"])),
            resource_id=str(row["resource_id"]),
            scope=ResourceScope(str(row["scope"])),
            subject_type=str(row["subject_type"]),
            subject_id=str(row["subject_id"]),
            granted=bool(int(row["granted"] or 0)),
            created_at=str(row["created_at"]),
            note=str(row["note"] or ""),
            source=source,
        )

    def _default_role_resource_permissions(self, role: str, tenant_id: str) -> list[ResourcePermission]:
        normalized_role = _normalize_role(role)
        perms = ROLE_PERMISSIONS.get(normalized_role, [])
        rows: list[ResourcePermission] = []
        for perm in perms:
            if perm.actions == "*":
                rows.append(
                    ResourcePermission(
                        id=f"default:{normalized_role}:{perm.resource}:admin",
                        tenant_id=tenant_id,
                        resource_type=ResourceType.ANY if perm.resource == "*" else ResourceType(str(perm.resource)),
                        resource_id="*",
                        scope=ResourceScope.ADMIN,
                        subject_type="role",
                        subject_id=normalized_role,
                        granted=True,
                        source="default_role",
                    )
                )
                continue
            for action in perm.actions:
                scope = ResourceScope.ADMIN if action == "delete" and perm.resource == "*" else _action_to_scope(action)
                rows.append(
                    ResourcePermission(
                        id=f"default:{normalized_role}:{perm.resource}:{action}",
                        tenant_id=tenant_id,
                        resource_type=ResourceType.ANY if perm.resource == "*" else ResourceType(str(perm.resource)),
                        resource_id="*",
                        scope=scope,
                        subject_type="role",
                        subject_id=normalized_role,
                        granted=True,
                        source="default_role",
                    )
                )
        return rows

    def _list_custom_permissions(
        self,
        *,
        tenant_id: str,
        subject_type: str | None = None,
        subject_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[ResourcePermission]:
        sql = "SELECT * FROM resource_permissions WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if subject_type:
            sql += " AND subject_type = ?"
            params.append(subject_type)
        if subject_id:
            sql += " AND subject_id = ?"
            params.append(subject_id)
        if resource_type:
            sql += " AND resource_type = ?"
            params.append(resource_type)
        if resource_id:
            sql += " AND resource_id = ?"
            params.append(resource_id)
        sql += " ORDER BY created_at DESC"
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._row_to_perm(row) for row in rows]

    def _rule_matches(
        self,
        perm: ResourcePermission,
        *,
        resource_type: str,
        resource_id: str,
        scope: str,
    ) -> bool:
        type_match = perm.resource_type.value in {"*", resource_type}
        id_match = perm.resource_id in {"*", resource_id}
        scope_match = _scope_allows(perm.scope.value, scope)
        return type_match and id_match and scope_match

    def can(self, role: str, resource: str, action: str) -> bool:
        normalized_role = _normalize_role(role)
        perms = ROLE_PERMISSIONS.get(normalized_role, [])
        for perm in perms:
            if perm.resource not in {"*", resource}:
                continue
            if perm.actions == "*":
                return True
            if action in perm.actions:
                return True
            if action == "read" and "update" in perm.actions:
                return True
        return False

    def require(self, role: str, resource: str, action: str) -> None:
        if not self.can(role, resource, action):
            raise PermissionError(f"角色 [{role}] 没有权限：{action} on {resource}")

    def validate_role_change(self, actor_role: str, target_current_role: str, new_role: str) -> None:
        actor_level = ROLE_HIERARCHY.get(_normalize_role(actor_role), -1)
        target_level = ROLE_HIERARCHY.get(_normalize_role(target_current_role), -1)
        new_level = ROLE_HIERARCHY.get(_normalize_role(new_role), -1)
        if actor_level <= target_level and _normalize_role(actor_role) != _normalize_role(target_current_role):
            raise PermissionError(f"角色 [{actor_role}] 无权修改 [{target_current_role}] 的角色")
        if new_level > actor_level:
            raise PermissionError(f"角色 [{actor_role}] 无权将成员提升到 [{new_role}]")

    def get_allowed_actions(self, role: str, resource: str) -> list[str]:
        perms = ROLE_PERMISSIONS.get(_normalize_role(role), [])
        for perm in perms:
            if perm.resource in {"*", resource}:
                if perm.actions == "*":
                    return ["read", "write", "execute", "admin"]
                return list(perm.actions)
        return []

    def get_permissions_matrix(self) -> dict[str, Any]:
        all_resources = [
            item.value for item in ResourceType if item != ResourceType.ANY
        ]
        matrix: dict[str, Any] = {}
        for role in ["owner", "admin", "operator", "viewer"]:
            matrix[role] = {}
            for resource in all_resources:
                matrix[role][resource] = self.get_allowed_actions(role, resource)
        return matrix

    def get_available_roles(self) -> list[dict[str, str]]:
        return [
            {"id": "owner", "name": "所有者", "description": "完全控制"},
            {"id": "admin", "name": "管理员", "description": "管理成员和配置"},
            {"id": "operator", "name": "运营", "description": "执行资源与更新业务配置"},
            {"id": "viewer", "name": "观察者", "description": "只读访问"},
        ]

    def grant_permission(self, perm: ResourcePermission) -> ResourcePermission:
        resource_type_value = perm.resource_type.value if isinstance(perm.resource_type, ResourceType) else str(perm.resource_type)
        scope_value = perm.scope.value if isinstance(perm.scope, ResourceScope) else str(perm.scope)
        normalized = ResourcePermission(
            id=str(perm.id or f"perm_{uuid.uuid4().hex[:12]}"),
            tenant_id=str(perm.tenant_id).strip(),
            resource_type=ResourceType(resource_type_value),
            resource_id=str(perm.resource_id or "*").strip() or "*",
            scope=ResourceScope(scope_value),
            subject_type=str(perm.subject_type),
            subject_id=str(perm.subject_id).strip().lower(),
            granted=bool(perm.granted),
            created_at=str(perm.created_at or _utc_now()),
            note=str(perm.note or "").strip(),
            source="custom",
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO resource_permissions(
                    id, tenant_id, resource_type, resource_id, scope, subject_type, subject_id, granted, created_at, note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    tenant_id=excluded.tenant_id,
                    resource_type=excluded.resource_type,
                    resource_id=excluded.resource_id,
                    scope=excluded.scope,
                    subject_type=excluded.subject_type,
                    subject_id=excluded.subject_id,
                    granted=excluded.granted,
                    note=excluded.note
                """,
                (
                    normalized.id,
                    normalized.tenant_id,
                    normalized.resource_type.value,
                    normalized.resource_id,
                    normalized.scope.value,
                    normalized.subject_type,
                    normalized.subject_id,
                    1 if normalized.granted else 0,
                    normalized.created_at,
                    normalized.note,
                ),
            )
            conn.commit()
        return normalized

    def revoke_permission(self, perm_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM resource_permissions WHERE id = ?", (perm_id,))
            conn.commit()
            return bool(cur.rowcount)

    def list_permissions(self, tenant_id: str) -> list[ResourcePermission]:
        return self._list_custom_permissions(tenant_id=tenant_id)

    def list_user_permissions(self, user_id: str, tenant_id: str, roles: list[str] | None = None) -> list[ResourcePermission]:
        rows = self._list_custom_permissions(tenant_id=tenant_id, subject_type="user", subject_id=str(user_id).strip().lower())
        role_rows: list[ResourcePermission] = []
        for role in roles or []:
            role_rows.extend(self._list_custom_permissions(tenant_id=tenant_id, subject_type="role", subject_id=_normalize_role(role)))
            role_rows.extend(self._default_role_resource_permissions(role, tenant_id))
        combined = {perm.id: perm for perm in [*rows, *role_rows]}
        return list(combined.values())

    def list_resource_permissions(self, resource_type: ResourceType, resource_id: str, tenant_id: str | None = None) -> list[ResourcePermission]:
        if tenant_id:
            return self._list_custom_permissions(
                tenant_id=tenant_id,
                resource_type=resource_type.value,
                resource_id=resource_id,
            )
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM resource_permissions WHERE resource_type = ? AND resource_id = ? ORDER BY created_at DESC",
                (resource_type.value, resource_id),
            ).fetchall()
        return [self._row_to_perm(row) for row in rows]

    def check_resource_permission(
        self,
        user_id: str,
        tenant_id: str,
        resource_type: ResourceType,
        resource_id: str,
        scope: ResourceScope,
        roles: list[str] | None = None,
    ) -> tuple[bool, ResourcePermission | None, str]:
        normalized_user = str(user_id or "").strip().lower()
        normalized_tenant = str(tenant_id or "").strip()
        normalized_resource_id = str(resource_id or "*").strip() or "*"
        normalized_roles = [_normalize_role(role) for role in (roles or []) if str(role).strip()]

        candidates = self.list_user_permissions(normalized_user, normalized_tenant, normalized_roles)
        deny_matches = [
            perm for perm in candidates
            if not perm.granted and self._rule_matches(perm, resource_type=resource_type.value, resource_id=normalized_resource_id, scope=scope.value)
        ]
        if deny_matches:
            return False, deny_matches[0], "explicit_deny"

        allow_matches = [
            perm for perm in candidates
            if perm.granted and self._rule_matches(perm, resource_type=resource_type.value, resource_id=normalized_resource_id, scope=scope.value)
        ]
        if allow_matches:
            ranked = sorted(
                allow_matches,
                key=lambda item: (
                    0 if item.subject_type == "user" else 1,
                    0 if item.resource_id != "*" else 1,
                    0 if item.resource_type != ResourceType.ANY else 1,
                    0 if item.source == "custom" else 1,
                ),
            )
            return True, ranked[0], "matched_rule"

        return False, None, "no_matching_rule"


_global_rbac: RBACService | None = None


def get_rbac_service() -> RBACService:
    global _global_rbac
    if _global_rbac is None:
        _global_rbac = RBACService()
    return _global_rbac
