from __future__ import annotations

import json
import os
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import select

from user_auth import AsyncSessionMaker
from user_auth import User
from user_auth import UserCreate
from user_auth import UserManager
from user_auth import _normalize_roles
from user_auth import _utcnow_naive

SCIM_LIST_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
SCIM_PATCH_OP_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
SCIM_RESOURCE_TYPE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ResourceType"
SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"
SCIM_CORE_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
SCIM_CORE_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group"
SCIM_ENTERPRISE_USER_SCHEMA = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
SCIM_DRAGON_USER_SCHEMA = "urn:dragon-senate:params:scim:schemas:extension:tenant:2.0:User"
SCIM_DRAGON_GROUP_SCHEMA = "urn:dragon-senate:params:scim:schemas:extension:tenant-group:2.0:Group"


class ScimNotFoundError(Exception):
    pass


class ScimConflictError(Exception):
    pass


def _group_state_path() -> Path:
    raw = os.getenv("AUTH_SCIM_GROUPS_DB_PATH", "data/auth_scim_groups.sqlite").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _group_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_group_state_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_group_schema() -> None:
    with _group_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS scim_groups (
                group_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                external_id TEXT,
                mapped_roles_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_scim_groups_tenant
            ON scim_groups(tenant_id, display_name);

            CREATE TABLE IF NOT EXISTS scim_group_members (
                group_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (group_id, user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_scim_group_members_tenant
            ON scim_group_members(tenant_id, group_id);
            """
        )
        columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(scim_groups)").fetchall()}
        if "mapped_roles_json" not in columns:
            conn.execute("ALTER TABLE scim_groups ADD COLUMN mapped_roles_json TEXT NOT NULL DEFAULT '[]'")
        conn.commit()


def _isoformat(value: datetime | None) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _user_location(base_url: str, user_id: str) -> str:
    return f"{base_url.rstrip('/')}/scim/v2/Users/{user_id}"


def _group_location(base_url: str, group_id: str) -> str:
    return f"{base_url.rstrip('/')}/scim/v2/Groups/{group_id}"


def _display_name_for_user(user: User) -> str:
    return str(user.username or user.email or user.id)


def _display_name_for_member_row(row: sqlite3.Row | dict[str, Any]) -> str:
    return str(row.get("username") or row.get("email") or row.get("user_id") or row.get("id") or "")


def _coerce_roles(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values: list[str] = []
        for item in raw:
            if isinstance(item, dict):
                value = str(item.get("value") or item.get("display") or "").strip()
            else:
                value = str(item or "").strip()
            if value:
                values.append(value)
        return _normalize_roles(values)
    if isinstance(raw, dict):
        value = str(raw.get("value") or raw.get("display") or "").strip()
        return _normalize_roles([value] if value else [])
    if isinstance(raw, str):
        return _normalize_roles([raw])
    return ["member"]


def _coerce_emails(raw: Any) -> str:
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                value = str(item.get("value") or "").strip().lower()
            else:
                value = str(item or "").strip().lower()
            if value:
                return value
    if isinstance(raw, dict):
        value = str(raw.get("value") or "").strip().lower()
        if value:
            return value
    if isinstance(raw, str):
        value = raw.strip().lower()
        if value:
            return value
    return ""


def _coerce_active(raw: Any, *, default: bool = True) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in {"true", "1", "yes", "on"}:
        return True
    if text in {"false", "0", "no", "off"}:
        return False
    return default


def _coerce_username(payload: dict[str, Any], *, fallback_email: str) -> str:
    candidates = [
        str(payload.get("userName") or "").strip(),
        str(payload.get("displayName") or "").strip(),
        str((payload.get("name") or {}).get("formatted") if isinstance(payload.get("name"), dict) else "").strip(),
        fallback_email.split("@", 1)[0].strip(),
    ]
    for candidate in candidates:
        if candidate:
            return candidate[:64]
    return f"user_{uuid.uuid4().hex[:8]}"


def _coerce_tenant_id(payload: dict[str, Any], default_tenant_id: str) -> str:
    dragon_ext = payload.get(SCIM_DRAGON_USER_SCHEMA)
    if isinstance(dragon_ext, dict):
        tenant_id = str(dragon_ext.get("tenantId") or "").strip()
        if tenant_id:
            return tenant_id[:128]
    return default_tenant_id[:128]


def _coerce_password(payload: dict[str, Any]) -> str:
    password = str(payload.get("password") or "").strip()
    if password:
        return password
    return f"{secrets.token_urlsafe(16)}Aa1!"


def _coerce_group_members(raw: Any) -> list[str]:
    values: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                value = str(item.get("value") or "").strip()
            else:
                value = str(item or "").strip()
            if value:
                values.append(value)
    elif isinstance(raw, dict):
        value = str(raw.get("value") or "").strip()
        if value:
            values.append(value)
    elif isinstance(raw, str):
        value = raw.strip()
        if value:
            values.append(value)

    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return unique


def _coerce_mapped_roles(raw: Any) -> list[str]:
    values: list[str] = []
    if isinstance(raw, dict):
        raw = raw.get("mappedRoles") or raw.get("roles") or []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                value = str(item.get("value") or item.get("display") or "").strip()
            else:
                value = str(item or "").strip()
            if value:
                values.append(value)
    elif isinstance(raw, str):
        text = raw.strip()
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = text
            if isinstance(parsed, list):
                for item in parsed:
                    value = str(item or "").strip()
                    if value:
                        values.append(value)
            else:
                values.append(str(parsed).strip())
    if not values:
        return []
    return _normalize_roles(values)


@dataclass(slots=True)
class ScimUserFields:
    username: str
    email: str
    password: str
    roles: list[str]
    active: bool
    tenant_id: str
    display_name: str


@dataclass(slots=True)
class ScimGroupFields:
    display_name: str
    external_id: str
    member_ids: list[str]
    mapped_roles: list[str]


def parse_scim_user_payload(payload: dict[str, Any], *, default_tenant_id: str) -> ScimUserFields:
    email = _coerce_emails(payload.get("emails"))
    if not email:
        base_name = str(payload.get("userName") or payload.get("displayName") or "").strip() or f"user_{uuid.uuid4().hex[:8]}"
        email = f"{base_name[:32].replace(' ', '_').lower()}@example.com"
    username = _coerce_username(payload, fallback_email=email)
    roles = _coerce_roles(payload.get("roles"))
    active = _coerce_active(payload.get("active"), default=True)
    tenant_id = _coerce_tenant_id(payload, default_tenant_id)
    display_name = str(payload.get("displayName") or username).strip() or username
    return ScimUserFields(
        username=username,
        email=email,
        password=_coerce_password(payload),
        roles=roles or ["member"],
        active=active,
        tenant_id=tenant_id,
        display_name=display_name[:128],
    )


def parse_scim_group_payload(payload: dict[str, Any]) -> ScimGroupFields:
    display_name = str(payload.get("displayName") or payload.get("name") or "").strip()
    if not display_name:
        display_name = f"group_{uuid.uuid4().hex[:8]}"
    external_id = str(payload.get("externalId") or "").strip()
    members = _coerce_group_members(payload.get("members"))
    group_ext = payload.get(SCIM_DRAGON_GROUP_SCHEMA)
    mapped_roles = _coerce_mapped_roles(group_ext)
    return ScimGroupFields(
        display_name=display_name[:128],
        external_id=external_id[:128],
        member_ids=members,
        mapped_roles=mapped_roles,
    )


def serialize_scim_user(user: User, *, base_url: str) -> dict[str, Any]:
    display_name = _display_name_for_user(user)
    emails: list[dict[str, Any]] = []
    if user.email:
        emails.append({"value": str(user.email), "type": "work", "primary": True})
    direct_roles = _normalize_roles(user.roles_json)
    inherited_roles = inherited_group_roles_for_user(str(user.tenant_id or ""), str(user.id))
    effective_roles = _normalize_roles(direct_roles + inherited_roles)
    roles = [{"value": role, "display": role} for role in effective_roles]
    return {
        "schemas": [SCIM_CORE_USER_SCHEMA, SCIM_DRAGON_USER_SCHEMA],
        "id": str(user.id),
        "externalId": str(user.username or user.email or user.id),
        "userName": str(user.username or user.email or user.id),
        "displayName": display_name,
        "active": bool(user.is_active),
        "emails": emails,
        "roles": roles,
        SCIM_DRAGON_USER_SCHEMA: {
            "tenantId": str(user.tenant_id or ""),
            "roles": list(effective_roles),
            "directRoles": list(direct_roles),
            "inheritedRoles": list(inherited_roles),
            "isSuperuser": bool(user.is_superuser),
            "isVerified": bool(user.is_verified),
        },
        "meta": {
            "resourceType": "User",
            "created": _isoformat(user.created_at),
            "lastModified": _isoformat(user.updated_at),
            "location": _user_location(base_url, str(user.id)),
        },
    }


async def _tenant_user_rows(tenant_id: str, user_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not user_ids:
        return {}
    valid_ids: list[uuid.UUID] = []
    raw_to_uuid: dict[str, uuid.UUID] = {}
    for user_id in user_ids:
        try:
            parsed = uuid.UUID(str(user_id))
        except ValueError:
            continue
        raw_to_uuid[str(parsed)] = parsed
        valid_ids.append(parsed)
    if not valid_ids:
        return {}
    async with AsyncSessionMaker() as session:
        rows = (
            await session.execute(
                select(User).where(User.id.in_(valid_ids)).where(User.tenant_id == tenant_id)
            )
        ).scalars().all()
    return {
        str(user.id): {
            "user_id": str(user.id),
            "username": str(user.username or ""),
            "email": str(user.email or ""),
            "tenant_id": str(user.tenant_id or ""),
        }
        for user in rows
    }


def inherited_group_roles_for_user(tenant_id: str, user_id: str) -> list[str]:
    _ensure_group_schema()
    with _group_conn() as conn:
        rows = conn.execute(
            """
            SELECT g.mapped_roles_json
            FROM scim_groups g
            JOIN scim_group_members m
              ON g.group_id = m.group_id AND g.tenant_id = m.tenant_id
            WHERE g.tenant_id = ? AND m.user_id = ?
            """,
            (tenant_id, str(user_id)),
        ).fetchall()
    merged: list[str] = []
    for row in rows:
        merged.extend(_coerce_mapped_roles(row["mapped_roles_json"]))
    if not merged:
        return []
    return _normalize_roles(merged)


async def _validate_group_member_ids(tenant_id: str, member_ids: list[str]) -> list[str]:
    normalized = _coerce_group_members(member_ids)
    if not normalized:
        return []
    user_map = await _tenant_user_rows(tenant_id, normalized)
    missing = [user_id for user_id in normalized if user_id not in user_map]
    if missing:
        raise ScimConflictError("invalid_group_members")
    return normalized


def _group_row_to_dict(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    if isinstance(row, sqlite3.Row):
        return dict(row)
    return dict(row)


async def _serialize_scim_group_row(row: sqlite3.Row | dict[str, Any], *, base_url: str) -> dict[str, Any]:
    payload = _group_row_to_dict(row)
    tenant_id = str(payload.get("tenant_id") or "")
    group_id = str(payload.get("group_id") or "")
    mapped_roles = _coerce_mapped_roles(payload.get("mapped_roles_json"))
    with _group_conn() as conn:
        member_rows = conn.execute(
            """
            SELECT user_id
            FROM scim_group_members
            WHERE tenant_id = ? AND group_id = ?
            ORDER BY added_at ASC
            """,
            (tenant_id, group_id),
        ).fetchall()
    member_ids = [str(item["user_id"]) for item in member_rows]
    user_map = await _tenant_user_rows(tenant_id, member_ids)
    members = []
    for member_id in member_ids:
        user_row = user_map.get(member_id)
        if user_row is None:
            continue
        members.append(
            {
                "value": member_id,
                "display": _display_name_for_member_row(user_row),
                "$ref": _user_location(base_url, member_id),
            }
        )
    return {
        "schemas": [SCIM_CORE_GROUP_SCHEMA, SCIM_DRAGON_GROUP_SCHEMA],
        "id": group_id,
        "externalId": str(payload.get("external_id") or ""),
        "displayName": str(payload.get("display_name") or ""),
        "members": members,
        SCIM_DRAGON_GROUP_SCHEMA: {
            "mappedRoles": list(mapped_roles),
        },
        "meta": {
            "resourceType": "Group",
            "created": str(payload.get("created_at") or _isoformat(None)),
            "lastModified": str(payload.get("updated_at") or _isoformat(None)),
            "location": _group_location(base_url, group_id),
        },
    }


def build_service_provider_config(base_url: str) -> dict[str, Any]:
    return {
        "schemas": [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA],
        "patch": {"supported": True},
        "bulk": {"supported": False, "maxOperations": 0, "maxPayloadSize": 0},
        "filter": {"supported": True, "maxResults": 200},
        "changePassword": {"supported": True},
        "sort": {"supported": False},
        "etag": {"supported": False},
        "authenticationSchemes": [
            {
                "type": "oauthbearertoken",
                "name": "Bearer Token",
                "description": "Static SCIM bearer token or admin JWT",
                "specUri": "https://datatracker.ietf.org/doc/html/rfc7644",
                "primary": True,
            }
        ],
        "meta": {
            "resourceType": "ServiceProviderConfig",
            "location": f"{base_url.rstrip('/')}/scim/v2/ServiceProviderConfig",
        },
    }


def build_schemas(base_url: str) -> dict[str, Any]:
    resources = [
        {
            "id": SCIM_CORE_USER_SCHEMA,
            "name": "User",
            "description": "Core SCIM User",
            "attributes": [
                {"name": "userName", "type": "string", "required": True, "mutability": "readWrite"},
                {"name": "displayName", "type": "string", "required": False, "mutability": "readWrite"},
                {"name": "active", "type": "boolean", "required": False, "mutability": "readWrite"},
                {"name": "emails", "type": "complex", "multiValued": True, "required": False, "mutability": "readWrite"},
                {"name": "roles", "type": "complex", "multiValued": True, "required": False, "mutability": "readWrite"},
            ],
            "meta": {"resourceType": "Schema", "location": f"{base_url.rstrip('/')}/scim/v2/Schemas/{SCIM_CORE_USER_SCHEMA}"},
        },
        {
            "id": SCIM_DRAGON_USER_SCHEMA,
            "name": "DragonSenateUser",
            "description": "Dragon Senate tenant extension",
            "attributes": [
                {"name": "tenantId", "type": "string", "required": False, "mutability": "readWrite"},
                {"name": "roles", "type": "string", "multiValued": True, "required": False, "mutability": "readWrite"},
                {"name": "directRoles", "type": "string", "multiValued": True, "required": False, "mutability": "readOnly"},
                {"name": "inheritedRoles", "type": "string", "multiValued": True, "required": False, "mutability": "readOnly"},
                {"name": "isSuperuser", "type": "boolean", "required": False, "mutability": "readOnly"},
                {"name": "isVerified", "type": "boolean", "required": False, "mutability": "readOnly"},
            ],
            "meta": {"resourceType": "Schema", "location": f"{base_url.rstrip('/')}/scim/v2/Schemas/{SCIM_DRAGON_USER_SCHEMA}"},
        },
        {
            "id": SCIM_CORE_GROUP_SCHEMA,
            "name": "Group",
            "description": "Core SCIM Group",
            "attributes": [
                {"name": "displayName", "type": "string", "required": True, "mutability": "readWrite"},
                {"name": "members", "type": "complex", "multiValued": True, "required": False, "mutability": "readWrite"},
            ],
            "meta": {"resourceType": "Schema", "location": f"{base_url.rstrip('/')}/scim/v2/Schemas/{SCIM_CORE_GROUP_SCHEMA}"},
        },
        {
            "id": SCIM_DRAGON_GROUP_SCHEMA,
            "name": "DragonSenateGroup",
            "description": "Dragon Senate group extension",
            "attributes": [
                {"name": "mappedRoles", "type": "string", "multiValued": True, "required": False, "mutability": "readWrite"},
            ],
            "meta": {"resourceType": "Schema", "location": f"{base_url.rstrip('/')}/scim/v2/Schemas/{SCIM_DRAGON_GROUP_SCHEMA}"},
        },
    ]
    return {
        "schemas": [SCIM_LIST_RESPONSE_SCHEMA],
        "totalResults": len(resources),
        "startIndex": 1,
        "itemsPerPage": len(resources),
        "Resources": resources,
    }


def build_resource_types(base_url: str) -> dict[str, Any]:
    resources = [
        {
            "schemas": [SCIM_RESOURCE_TYPE_SCHEMA],
            "id": "User",
            "name": "User",
            "endpoint": "/Users",
            "schema": SCIM_CORE_USER_SCHEMA,
            "schemaExtensions": [
                {"schema": SCIM_DRAGON_USER_SCHEMA, "required": False},
            ],
            "meta": {
                "resourceType": "ResourceType",
                "location": f"{base_url.rstrip('/')}/scim/v2/ResourceTypes/User",
            },
        },
        {
            "schemas": [SCIM_RESOURCE_TYPE_SCHEMA],
            "id": "Group",
            "name": "Group",
            "endpoint": "/Groups",
            "schema": SCIM_CORE_GROUP_SCHEMA,
            "schemaExtensions": [
                {"schema": SCIM_DRAGON_GROUP_SCHEMA, "required": False},
            ],
            "meta": {
                "resourceType": "ResourceType",
                "location": f"{base_url.rstrip('/')}/scim/v2/ResourceTypes/Group",
            },
        },
    ]
    return {
        "schemas": [SCIM_LIST_RESPONSE_SCHEMA],
        "totalResults": len(resources),
        "startIndex": 1,
        "itemsPerPage": len(resources),
        "Resources": resources,
    }


def _apply_scim_filter(statement: Any, filter_expr: str | None) -> Any:
    raw = str(filter_expr or "").strip()
    if not raw:
        return statement
    lowered = raw.lower()
    marker = ' eq '
    if marker not in lowered:
        return statement
    attr, value = raw.split(marker, 1)
    attr = attr.strip()
    value = value.strip().strip('"').strip("'")
    if not value:
        return statement
    if attr == "userName":
        return statement.where(User.username == value)
    if attr in {"email", "emails.value"}:
        return statement.where(User.email == value.lower())
    if attr == "active":
        return statement.where(User.is_active == _coerce_active(value))
    return statement


def _apply_group_filter(rows: list[sqlite3.Row], filter_expr: str | None) -> list[sqlite3.Row]:
    raw = str(filter_expr or "").strip()
    if not raw:
        return rows
    lowered = raw.lower()
    marker = " eq "
    if marker not in lowered:
        return rows
    attr, value = raw.split(marker, 1)
    attr = attr.strip()
    value = value.strip().strip('"').strip("'")
    if attr not in {"displayName", "externalId"} or not value:
        return rows
    key = "display_name" if attr == "displayName" else "external_id"
    return [row for row in rows if str(row[key] or "") == value]


async def list_scim_users(
    *,
    tenant_id: str,
    base_url: str,
    start_index: int = 1,
    count: int = 100,
    filter_expr: str | None = None,
) -> dict[str, Any]:
    async with AsyncSessionMaker() as session:
        base_stmt = select(User).where(User.tenant_id == tenant_id)
        filtered_stmt = _apply_scim_filter(base_stmt, filter_expr)
        rows = (await session.execute(filtered_stmt)).scalars().all()
    rows = list(rows)
    total = len(rows)
    safe_start = max(1, int(start_index or 1))
    safe_count = max(1, min(int(count or 100), 200))
    page = rows[safe_start - 1 : safe_start - 1 + safe_count]
    resources = [serialize_scim_user(user, base_url=base_url) for user in page]
    return {
        "schemas": [SCIM_LIST_RESPONSE_SCHEMA],
        "totalResults": total,
        "startIndex": safe_start,
        "itemsPerPage": len(resources),
        "Resources": resources,
    }


async def get_scim_user(*, tenant_id: str, user_id: str, base_url: str) -> dict[str, Any]:
    try:
        parsed_user_id = uuid.UUID(str(user_id))
    except ValueError as exc:
        raise ScimNotFoundError(user_id) from exc
    async with AsyncSessionMaker() as session:
        user = await session.get(User, parsed_user_id)
        if user is None or str(user.tenant_id or "") != tenant_id:
            raise ScimNotFoundError(user_id)
        return serialize_scim_user(user, base_url=base_url)


async def create_scim_user(*, tenant_id: str, payload: dict[str, Any], base_url: str) -> dict[str, Any]:
    fields = parse_scim_user_payload(payload, default_tenant_id=tenant_id)
    async with AsyncSessionMaker() as session:
        existing = (
            await session.execute(
                select(User).where((User.username == fields.username) | (User.email == fields.email.lower()))
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ScimConflictError("username_or_email_exists")

        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        create_payload = UserCreate(
            email=fields.email.lower(),
            password=fields.password,
            is_superuser="admin" in fields.roles,
            is_active=fields.active,
            is_verified=fields.active,
            username=fields.username,
            tenant_id=tenant_id,
            roles=fields.roles,
        )
        created = await manager.create(create_payload, safe=False, request=None)
        created.roles = fields.roles
        created.username = fields.username
        created.tenant_id = tenant_id
        created.is_active = fields.active
        created.is_verified = fields.active
        created.is_superuser = "admin" in fields.roles
        created.updated_at = _utcnow_naive()
        await session.commit()
        await session.refresh(created)
        return serialize_scim_user(created, base_url=base_url)


async def replace_scim_user(*, tenant_id: str, user_id: str, payload: dict[str, Any], base_url: str) -> dict[str, Any]:
    fields = parse_scim_user_payload(payload, default_tenant_id=tenant_id)
    try:
        parsed_user_id = uuid.UUID(str(user_id))
    except ValueError as exc:
        raise ScimNotFoundError(user_id) from exc

    async with AsyncSessionMaker() as session:
        user = await session.get(User, parsed_user_id)
        if user is None or str(user.tenant_id or "") != tenant_id:
            raise ScimNotFoundError(user_id)
        duplicate = (
            await session.execute(
                select(User).where(
                    ((User.username == fields.username) | (User.email == fields.email.lower())) & (User.id != parsed_user_id)
                )
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            raise ScimConflictError("username_or_email_exists")

        user.username = fields.username
        user.email = fields.email.lower()
        user.roles = fields.roles
        user.tenant_id = tenant_id
        user.is_active = fields.active
        user.is_verified = fields.active
        user.is_superuser = "admin" in fields.roles
        user.updated_at = _utcnow_naive()

        if fields.password:
            user_db = SQLAlchemyUserDatabase(session, User)
            manager = UserManager(user_db)
            user.hashed_password = manager.password_helper.hash(fields.password)

        await session.commit()
        await session.refresh(user)
        return serialize_scim_user(user, base_url=base_url)


def _apply_patch_value(target: dict[str, Any], *, path: str | None, value: Any) -> None:
    if not path:
        if isinstance(value, dict):
            for key, item in value.items():
                target[key] = item
        return
    normalized = path.strip()
    if normalized in {"userName", "displayName", "nickName"}:
        target["userName"] = value
        if normalized != "userName":
            target["displayName"] = value
        return
    if normalized == "active":
        target["active"] = value
        return
    if normalized.startswith("emails"):
        target["emails"] = [{"value": value, "type": "work", "primary": True}]
        return
    if normalized == "password":
        target["password"] = value
        return
    if normalized == "roles":
        target["roles"] = value
        return
    if normalized.startswith(f"{SCIM_DRAGON_USER_SCHEMA}:"):
        attr = normalized[len(f"{SCIM_DRAGON_USER_SCHEMA}:") :]
        ext = target.setdefault(SCIM_DRAGON_USER_SCHEMA, {})
        if isinstance(ext, dict):
            ext[attr] = value
        return
    target[normalized] = value


async def patch_scim_user(*, tenant_id: str, user_id: str, payload: dict[str, Any], base_url: str) -> dict[str, Any]:
    current = await get_scim_user(tenant_id=tenant_id, user_id=user_id, base_url=base_url)
    patch_target: dict[str, Any] = {
        "userName": current.get("userName"),
        "displayName": current.get("displayName"),
        "active": current.get("active", True),
        "emails": current.get("emails", []),
        "roles": current.get("roles", []),
        SCIM_DRAGON_USER_SCHEMA: dict((current.get(SCIM_DRAGON_USER_SCHEMA) or {})),
    }
    operations = payload.get("Operations")
    if not isinstance(operations, list):
        operations = []

    for operation in operations:
        if not isinstance(operation, dict):
            continue
        op = str(operation.get("op") or "replace").strip().lower()
        path = str(operation.get("path") or "").strip() or None
        value = operation.get("value")
        if op in {"add", "replace"}:
            _apply_patch_value(patch_target, path=path, value=value)
        elif op == "remove":
            _apply_patch_value(patch_target, path=path, value=[] if path == "roles" else None)

    return await replace_scim_user(tenant_id=tenant_id, user_id=user_id, payload=patch_target, base_url=base_url)


async def delete_scim_user(*, tenant_id: str, user_id: str) -> None:
    try:
        parsed_user_id = uuid.UUID(str(user_id))
    except ValueError as exc:
        raise ScimNotFoundError(user_id) from exc
    async with AsyncSessionMaker() as session:
        user = await session.get(User, parsed_user_id)
        if user is None or str(user.tenant_id or "") != tenant_id:
            raise ScimNotFoundError(user_id)
        await session.delete(user)
        await session.commit()


async def list_scim_groups(
    *,
    tenant_id: str,
    base_url: str,
    start_index: int = 1,
    count: int = 100,
    filter_expr: str | None = None,
) -> dict[str, Any]:
    _ensure_group_schema()
    with _group_conn() as conn:
        rows = conn.execute(
            """
            SELECT group_id, tenant_id, display_name, external_id, created_at, updated_at
                 , mapped_roles_json
            FROM scim_groups
            WHERE tenant_id = ?
            ORDER BY display_name ASC, created_at ASC
            """,
            (tenant_id,),
        ).fetchall()
    filtered = _apply_group_filter(list(rows), filter_expr)
    total = len(filtered)
    safe_start = max(1, int(start_index or 1))
    safe_count = max(1, min(int(count or 100), 200))
    page = filtered[safe_start - 1 : safe_start - 1 + safe_count]
    resources = [await _serialize_scim_group_row(row, base_url=base_url) for row in page]
    return {
        "schemas": [SCIM_LIST_RESPONSE_SCHEMA],
        "totalResults": total,
        "startIndex": safe_start,
        "itemsPerPage": len(resources),
        "Resources": resources,
    }


async def get_scim_group(*, tenant_id: str, group_id: str, base_url: str) -> dict[str, Any]:
    _ensure_group_schema()
    with _group_conn() as conn:
        row = conn.execute(
            """
            SELECT group_id, tenant_id, display_name, external_id, created_at, updated_at
                 , mapped_roles_json
            FROM scim_groups
            WHERE tenant_id = ? AND group_id = ?
            """,
            (tenant_id, str(group_id)),
        ).fetchone()
    if row is None:
        raise ScimNotFoundError(group_id)
    return await _serialize_scim_group_row(row, base_url=base_url)


async def create_scim_group(*, tenant_id: str, payload: dict[str, Any], base_url: str) -> dict[str, Any]:
    _ensure_group_schema()
    fields = parse_scim_group_payload(payload)
    member_ids = await _validate_group_member_ids(tenant_id, fields.member_ids)
    group_id = str(uuid.uuid4())
    now = _isoformat(None)
    with _group_conn() as conn:
        existing = conn.execute(
            "SELECT group_id FROM scim_groups WHERE tenant_id = ? AND display_name = ?",
            (tenant_id, fields.display_name),
        ).fetchone()
        if existing is not None:
            raise ScimConflictError("group_display_name_exists")
        conn.execute(
            """
            INSERT INTO scim_groups(group_id, tenant_id, display_name, external_id, mapped_roles_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                group_id,
                tenant_id,
                fields.display_name,
                fields.external_id or None,
                json.dumps(fields.mapped_roles, ensure_ascii=False),
                now,
                now,
            ),
        )
        for user_id in member_ids:
            conn.execute(
                """
                INSERT INTO scim_group_members(group_id, tenant_id, user_id, added_at)
                VALUES (?, ?, ?, ?)
                """,
                (group_id, tenant_id, user_id, now),
            )
        conn.commit()
        row = conn.execute(
            "SELECT group_id, tenant_id, display_name, external_id, mapped_roles_json, created_at, updated_at FROM scim_groups WHERE group_id = ?",
            (group_id,),
        ).fetchone()
    return await _serialize_scim_group_row(row, base_url=base_url)


async def replace_scim_group(*, tenant_id: str, group_id: str, payload: dict[str, Any], base_url: str) -> dict[str, Any]:
    _ensure_group_schema()
    fields = parse_scim_group_payload(payload)
    member_ids = await _validate_group_member_ids(tenant_id, fields.member_ids)
    now = _isoformat(None)
    with _group_conn() as conn:
        existing = conn.execute(
            "SELECT group_id FROM scim_groups WHERE tenant_id = ? AND group_id = ?",
            (tenant_id, str(group_id)),
        ).fetchone()
        if existing is None:
            raise ScimNotFoundError(group_id)
        duplicate = conn.execute(
            "SELECT group_id FROM scim_groups WHERE tenant_id = ? AND display_name = ? AND group_id != ?",
            (tenant_id, fields.display_name, str(group_id)),
        ).fetchone()
        if duplicate is not None:
            raise ScimConflictError("group_display_name_exists")
        conn.execute(
            """
            UPDATE scim_groups
            SET display_name = ?, external_id = ?, mapped_roles_json = ?, updated_at = ?
            WHERE tenant_id = ? AND group_id = ?
            """,
            (fields.display_name, fields.external_id or None, json.dumps(fields.mapped_roles, ensure_ascii=False), now, tenant_id, str(group_id)),
        )
        conn.execute(
            "DELETE FROM scim_group_members WHERE tenant_id = ? AND group_id = ?",
            (tenant_id, str(group_id)),
        )
        for user_id in member_ids:
            conn.execute(
                """
                INSERT INTO scim_group_members(group_id, tenant_id, user_id, added_at)
                VALUES (?, ?, ?, ?)
                """,
                (str(group_id), tenant_id, user_id, now),
            )
        conn.commit()
        row = conn.execute(
            "SELECT group_id, tenant_id, display_name, external_id, mapped_roles_json, created_at, updated_at FROM scim_groups WHERE group_id = ?",
            (str(group_id),),
        ).fetchone()
    return await _serialize_scim_group_row(row, base_url=base_url)


def _patch_group_members(current_member_ids: list[str], operation: dict[str, Any]) -> list[str]:
    current = list(current_member_ids)
    op = str(operation.get("op") or "replace").strip().lower()
    path = str(operation.get("path") or "").strip()
    value = operation.get("value")
    if path in {"displayName", "externalId"}:
        return current
    if not path or path.startswith("members"):
        if op == "replace":
            return _coerce_group_members(value)
        if op == "add":
            merged = current + _coerce_group_members(value)
            return _coerce_group_members(merged)
        if op == "remove":
            if not path or path == "members":
                return []
            marker = 'value eq "'
            if marker in path:
                target = path.split(marker, 1)[1].split('"', 1)[0].strip()
                return [member_id for member_id in current if member_id != target]
    return current


def _patch_group_roles(current_roles: list[str], operation: dict[str, Any]) -> list[str]:
    current = list(current_roles)
    op = str(operation.get("op") or "replace").strip().lower()
    path = str(operation.get("path") or "").strip()
    value = operation.get("value")
    role_paths = {"mappedRoles", f"{SCIM_DRAGON_GROUP_SCHEMA}:mappedRoles"}
    if not path:
        return current
    if path in role_paths:
        if op == "replace":
            return _coerce_mapped_roles(value)
        if op == "add":
            return _normalize_roles(current + _coerce_mapped_roles(value))
        if op == "remove":
            return []
    return current


async def patch_scim_group(*, tenant_id: str, group_id: str, payload: dict[str, Any], base_url: str) -> dict[str, Any]:
    current = await get_scim_group(tenant_id=tenant_id, group_id=group_id, base_url=base_url)
    group_payload: dict[str, Any] = {
        "displayName": current.get("displayName"),
        "externalId": current.get("externalId"),
        "members": [member.get("value") for member in current.get("members", []) if isinstance(member, dict)],
        SCIM_DRAGON_GROUP_SCHEMA: {
            "mappedRoles": list(((current.get(SCIM_DRAGON_GROUP_SCHEMA) or {}).get("mappedRoles") or [])),
        },
    }
    operations = payload.get("Operations")
    if not isinstance(operations, list):
        operations = []
    for operation in operations:
        if not isinstance(operation, dict):
            continue
        path = str(operation.get("path") or "").strip()
        op = str(operation.get("op") or "replace").strip().lower()
        value = operation.get("value")
        if not path and isinstance(value, dict):
            if "displayName" in value and op in {"add", "replace"}:
                group_payload["displayName"] = str(value.get("displayName") or "").strip() or group_payload.get("displayName")
            if "externalId" in value and op in {"add", "replace"}:
                group_payload["externalId"] = str(value.get("externalId") or "").strip()
            if "members" in value:
                group_payload["members"] = _patch_group_members(
                    group_payload.get("members", []),
                    {"op": op, "path": "members", "value": value.get("members")},
                )
            if SCIM_DRAGON_GROUP_SCHEMA in value and isinstance(value.get(SCIM_DRAGON_GROUP_SCHEMA), dict):
                group_payload[SCIM_DRAGON_GROUP_SCHEMA]["mappedRoles"] = _coerce_mapped_roles(
                    value.get(SCIM_DRAGON_GROUP_SCHEMA)
                )
            if "mappedRoles" in value:
                group_payload[SCIM_DRAGON_GROUP_SCHEMA]["mappedRoles"] = _coerce_mapped_roles(value.get("mappedRoles"))
            continue
        if path == "displayName" and op in {"add", "replace"}:
            group_payload["displayName"] = str(value or "").strip() or group_payload.get("displayName")
            continue
        if path == "externalId" and op in {"add", "replace"}:
            group_payload["externalId"] = str(value or "").strip()
            continue
        next_roles = _patch_group_roles(
            group_payload.get(SCIM_DRAGON_GROUP_SCHEMA, {}).get("mappedRoles", []),
            operation,
        )
        if next_roles != group_payload.get(SCIM_DRAGON_GROUP_SCHEMA, {}).get("mappedRoles", []):
            group_payload[SCIM_DRAGON_GROUP_SCHEMA]["mappedRoles"] = next_roles
            continue
        group_payload["members"] = _patch_group_members(group_payload.get("members", []), operation)
    return await replace_scim_group(tenant_id=tenant_id, group_id=group_id, payload=group_payload, base_url=base_url)


async def delete_scim_group(*, tenant_id: str, group_id: str) -> None:
    _ensure_group_schema()
    with _group_conn() as conn:
        existing = conn.execute(
            "SELECT group_id FROM scim_groups WHERE tenant_id = ? AND group_id = ?",
            (tenant_id, str(group_id)),
        ).fetchone()
        if existing is None:
            raise ScimNotFoundError(group_id)
        conn.execute("DELETE FROM scim_group_members WHERE tenant_id = ? AND group_id = ?", (tenant_id, str(group_id)))
        conn.execute("DELETE FROM scim_groups WHERE tenant_id = ? AND group_id = ?", (tenant_id, str(group_id)))
        conn.commit()
