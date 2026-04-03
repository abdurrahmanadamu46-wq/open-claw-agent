"""
Standardized tenant audit events with retention policy and soft-delete cleanup.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger("tenant_audit_log")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuditEventType(str, Enum):
    AUTH_LOGIN = "AUTH_LOGIN"
    AUTH_LOGIN_FAILED = "AUTH_LOGIN_FAILED"
    AUTH_LOGOUT = "AUTH_LOGOUT"
    AUTH_TOKEN_REFRESH = "AUTH_TOKEN_REFRESH"
    AUTH_TOKEN_REFRESH_ERROR = "AUTH_TOKEN_REFRESH_ERROR"
    AUTH_MFA_ENABLED = "AUTH_MFA_ENABLED"
    AUTH_MFA_DISABLED = "AUTH_MFA_DISABLED"
    AUTH_MFA_VERIFY = "AUTH_MFA_VERIFY"
    AUTH_MFA_VERIFY_FAILED = "AUTH_MFA_VERIFY_FAILED"
    AUTH_PASSWORD_RESET = "AUTH_PASSWORD_RESET"
    AUTH_PASSWORD_UPDATE = "AUTH_PASSWORD_UPDATE"

    USER_CREATE = "USER_CREATE"
    USER_UPDATE = "USER_UPDATE"
    USER_DELETE = "USER_DELETE"
    USER_ROLE_ASSIGN = "USER_ROLE_ASSIGN"
    USER_ROLE_REVOKE = "USER_ROLE_REVOKE"
    USER_INVITE = "USER_INVITE"
    USER_ACTIVATE = "USER_ACTIVATE"
    USER_DEACTIVATE = "USER_DEACTIVATE"

    LOBSTER_EXECUTE = "LOBSTER_EXECUTE"
    LOBSTER_EXECUTE_FAILED = "LOBSTER_EXECUTE_FAILED"
    LOBSTER_CONFIG_UPDATE = "LOBSTER_CONFIG_UPDATE"
    LOBSTER_ENABLE = "LOBSTER_ENABLE"
    LOBSTER_DISABLE = "LOBSTER_DISABLE"
    LOBSTER_CLONE = "LOBSTER_CLONE"
    LOBSTER_BOOTSTRAP_COMPLETE = "LOBSTER_BOOTSTRAP_COMPLETE"

    WORKFLOW_CREATE = "WORKFLOW_CREATE"
    WORKFLOW_EXECUTE = "WORKFLOW_EXECUTE"
    WORKFLOW_EXECUTE_FAILED = "WORKFLOW_EXECUTE_FAILED"
    WORKFLOW_UPDATE = "WORKFLOW_UPDATE"
    WORKFLOW_DELETE = "WORKFLOW_DELETE"

    CHANNEL_CONNECT = "CHANNEL_CONNECT"
    CHANNEL_DISCONNECT = "CHANNEL_DISCONNECT"
    CHANNEL_POST = "CHANNEL_POST"
    CHANNEL_POST_FAILED = "CHANNEL_POST_FAILED"

    API_KEY_CREATE = "API_KEY_CREATE"
    API_KEY_REVOKE = "API_KEY_REVOKE"
    API_KEY_USE = "API_KEY_USE"

    TENANT_CREATE = "TENANT_CREATE"
    TENANT_UPDATE = "TENANT_UPDATE"
    TENANT_PLAN_CHANGE = "TENANT_PLAN_CHANGE"
    BILLING_CHARGE = "BILLING_CHARGE"
    BILLING_CHARGE_FAILED = "BILLING_CHARGE_FAILED"
    QUOTA_EXCEED = "QUOTA_EXCEED"
    QUOTA_WARNING = "QUOTA_WARNING"

    PERMISSION_DENIED = "PERMISSION_DENIED"
    SUSPICIOUS_ACTIVITY = "SUSPICIOUS_ACTIVITY"
    SSRF_BLOCKED = "SSRF_BLOCKED"
    DLP_TRIGGERED = "DLP_TRIGGERED"
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"

    EDGE_REGISTER = "EDGE_REGISTER"
    EDGE_DISCONNECT = "EDGE_DISCONNECT"
    EDGE_RECONNECT = "EDGE_RECONNECT"
    EDGE_TASK_EXECUTE = "EDGE_TASK_EXECUTE"
    EDGE_TASK_FAILED = "EDGE_TASK_FAILED"
    EDGE_BACKUP = "EDGE_BACKUP"

    MCP_SERVER_REGISTER = "MCP_SERVER_REGISTER"
    MCP_TOOL_CALL = "MCP_TOOL_CALL"
    MCP_TOOL_CALL_FAILED = "MCP_TOOL_CALL_FAILED"

    SYSTEM_CONFIG_UPDATE = "SYSTEM_CONFIG_UPDATE"
    PROVIDER_ADD = "PROVIDER_ADD"
    PROVIDER_REMOVE = "PROVIDER_REMOVE"
    WHITE_LABEL_UPDATE = "WHITE_LABEL_UPDATE"


EVENT_CATEGORY: dict[AuditEventType, str] = {}
for item in AuditEventType:
    if item.name.startswith("AUTH_"):
        EVENT_CATEGORY[item] = "auth"
    elif item.name.startswith("USER_"):
        EVENT_CATEGORY[item] = "user"
    elif item.name.startswith("LOBSTER_"):
        EVENT_CATEGORY[item] = "lobster"
    elif item.name.startswith("WORKFLOW_"):
        EVENT_CATEGORY[item] = "workflow"
    elif item.name.startswith("CHANNEL_"):
        EVENT_CATEGORY[item] = "channel"
    elif item.name.startswith("API_KEY_"):
        EVENT_CATEGORY[item] = "api_key"
    elif item.name.startswith(("TENANT_", "BILLING_", "QUOTA_")):
        EVENT_CATEGORY[item] = "billing" if "BILLING" in item.name or "QUOTA" in item.name else "tenant"
    elif item.name.startswith(("PERMISSION_", "SUSPICIOUS_", "SSRF_", "DLP_", "RATE_")):
        EVENT_CATEGORY[item] = "security"
    elif item.name.startswith("EDGE_"):
        EVENT_CATEGORY[item] = "edge"
    elif item.name.startswith("MCP_"):
        EVENT_CATEGORY[item] = "mcp"
    else:
        EVENT_CATEGORY[item] = "system"


EVENT_SEVERITY: dict[AuditEventType, str] = {
    AuditEventType.AUTH_LOGIN_FAILED: "WARNING",
    AuditEventType.AUTH_TOKEN_REFRESH_ERROR: "WARNING",
    AuditEventType.AUTH_MFA_VERIFY_FAILED: "WARNING",
    AuditEventType.PERMISSION_DENIED: "WARNING",
    AuditEventType.QUOTA_EXCEED: "WARNING",
    AuditEventType.QUOTA_WARNING: "WARNING",
    AuditEventType.BILLING_CHARGE_FAILED: "ERROR",
    AuditEventType.LOBSTER_EXECUTE_FAILED: "ERROR",
    AuditEventType.WORKFLOW_EXECUTE_FAILED: "ERROR",
    AuditEventType.CHANNEL_POST_FAILED: "ERROR",
    AuditEventType.EDGE_TASK_FAILED: "ERROR",
    AuditEventType.MCP_TOOL_CALL_FAILED: "ERROR",
    AuditEventType.SUSPICIOUS_ACTIVITY: "CRITICAL",
    AuditEventType.SSRF_BLOCKED: "CRITICAL",
    AuditEventType.DLP_TRIGGERED: "CRITICAL",
    AuditEventType.RATE_LIMIT_EXCEEDED: "CRITICAL",
}


@dataclass
class AuditRetentionPolicy:
    tenant_id: str
    auth_events_days: int = 60
    user_events_days: int = 90
    lobster_events_days: int = 30
    security_events_days: int = 180
    billing_events_days: int = 365
    edge_events_days: int = 30
    system_events_days: int = 90
    workflow_events_days: int = 30
    channel_events_days: int = 30
    api_key_events_days: int = 180
    mcp_events_days: int = 30

    def ttl_for_category(self, category: str) -> int:
        mapping = {
            "auth": self.auth_events_days,
            "user": self.user_events_days,
            "lobster": self.lobster_events_days,
            "workflow": self.workflow_events_days,
            "channel": self.channel_events_days,
            "api_key": self.api_key_events_days,
            "tenant": self.system_events_days,
            "billing": self.billing_events_days,
            "security": self.security_events_days,
            "edge": self.edge_events_days,
            "mcp": self.mcp_events_days,
            "system": self.system_events_days,
        }
        return int(mapping.get(str(category or "").strip().lower(), self.system_events_days))


def _db_path() -> Path:
    raw = os.getenv("AUDIT_EVENT_DB_PATH", "data/tenant_audit_events.sqlite")
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parent / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


class AuditStore:
    def __init__(self) -> None:
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(_db_path()))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS audit_events (
                    id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    category TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    user_id TEXT,
                    resource_type TEXT,
                    resource_id TEXT,
                    details_json TEXT NOT NULL DEFAULT '{}',
                    ip_address TEXT,
                    created_at TEXT NOT NULL,
                    deleted_at TEXT,
                    deleted_reason TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created
                    ON audit_events(tenant_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_events_type
                    ON audit_events(tenant_id, event_type, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_events_category
                    ON audit_events(tenant_id, category, severity, created_at DESC);

                CREATE TABLE IF NOT EXISTS audit_retention_policies (
                    tenant_id TEXT PRIMARY KEY,
                    auth_events_days INTEGER NOT NULL DEFAULT 60,
                    user_events_days INTEGER NOT NULL DEFAULT 90,
                    lobster_events_days INTEGER NOT NULL DEFAULT 30,
                    security_events_days INTEGER NOT NULL DEFAULT 180,
                    billing_events_days INTEGER NOT NULL DEFAULT 365,
                    edge_events_days INTEGER NOT NULL DEFAULT 30,
                    system_events_days INTEGER NOT NULL DEFAULT 90,
                    workflow_events_days INTEGER NOT NULL DEFAULT 30,
                    channel_events_days INTEGER NOT NULL DEFAULT 30,
                    api_key_events_days INTEGER NOT NULL DEFAULT 180,
                    mcp_events_days INTEGER NOT NULL DEFAULT 30,
                    updated_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    def insert(self, row: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO audit_events(
                    id, event_type, category, severity, tenant_id, user_id,
                    resource_type, resource_id, details_json, ip_address, created_at,
                    deleted_at, deleted_reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    row["event_type"],
                    row["category"],
                    row["severity"],
                    row["tenant_id"],
                    row.get("user_id"),
                    row.get("resource_type"),
                    row.get("resource_id"),
                    json.dumps(row.get("details") or {}, ensure_ascii=False),
                    row.get("ip_address"),
                    row["created_at"],
                    row.get("deleted_at"),
                    row.get("deleted_reason"),
                ),
            )
            conn.commit()

    def _build_query(
        self,
        *,
        tenant_id: str,
        event_types: list[str] | None = None,
        severity: list[str] | None = None,
        category: list[str] | None = None,
        user_id: str | None = None,
        resource_id: str | None = None,
        from_ts: str | None = None,
        to_ts: str | None = None,
        include_deleted: bool = False,
    ) -> tuple[str, list[Any]]:
        sql = "SELECT * FROM audit_events WHERE tenant_id = ?"
        params: list[Any] = [tenant_id]
        if not include_deleted:
            sql += " AND deleted_at IS NULL"
        if event_types:
            sql += f" AND event_type IN ({','.join(['?'] * len(event_types))})"
            params.extend(event_types)
        if severity:
            sql += f" AND severity IN ({','.join(['?'] * len(severity))})"
            params.extend(severity)
        if category:
            sql += f" AND category IN ({','.join(['?'] * len(category))})"
            params.extend(category)
        if user_id:
            sql += " AND user_id = ?"
            params.append(user_id)
        if resource_id:
            sql += " AND resource_id = ?"
            params.append(resource_id)
        if from_ts:
            sql += " AND created_at >= ?"
            params.append(from_ts)
        if to_ts:
            sql += " AND created_at <= ?"
            params.append(to_ts)
        return sql, params

    def query(
        self,
        *,
        tenant_id: str,
        event_types: list[str] | None = None,
        severity: list[str] | None = None,
        category: list[str] | None = None,
        user_id: str | None = None,
        resource_id: str | None = None,
        from_ts: str | None = None,
        to_ts: str | None = None,
        include_deleted: bool = False,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        sql, params = self._build_query(
            tenant_id=tenant_id,
            event_types=event_types,
            severity=severity,
            category=category,
            user_id=user_id,
            resource_id=resource_id,
            from_ts=from_ts,
            to_ts=to_ts,
            include_deleted=include_deleted,
        )
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(max(1, min(int(limit), 500)))
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row)
            payload["details"] = json.loads(str(payload.pop("details_json", "{}") or "{}"))
            items.append(payload)
        return items

    def query_paginated(
        self,
        *,
        tenant_id: str,
        event_types: list[str] | None = None,
        severity: list[str] | None = None,
        category: list[str] | None = None,
        user_id: str | None = None,
        resource_id: str | None = None,
        from_ts: str | None = None,
        to_ts: str | None = None,
        include_deleted: bool = False,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
    ) -> tuple[list[dict[str, Any]], int]:
        sql, params = self._build_query(
            tenant_id=tenant_id,
            event_types=event_types,
            severity=severity,
            category=category,
            user_id=user_id,
            resource_id=resource_id,
            from_ts=from_ts,
            to_ts=to_ts,
            include_deleted=include_deleted,
        )
        safe_page = max(1, int(page or 1))
        safe_page_size = max(1, min(int(page_size or 50), 500))
        offset = (safe_page - 1) * safe_page_size
        allowed_sort = {
            "created_at": "created_at",
            "event_type": "event_type",
            "severity": "severity",
            "category": "category",
            "resource_id": "resource_id",
        }
        sort_column = allowed_sort.get(str(sort_by or "").strip(), "created_at")
        sort_order = "ASC" if str(sort_dir or "").strip().lower() == "asc" else "DESC"

        with self._connect() as conn:
            count_row = conn.execute(sql.replace("SELECT *", "SELECT COUNT(*) AS total"), params).fetchone()
            rows = conn.execute(
                f"{sql} ORDER BY {sort_column} {sort_order}, created_at DESC LIMIT ? OFFSET ?",
                [*params, safe_page_size, offset],
            ).fetchall()

        total = int(count_row["total"] or 0) if count_row else 0
        items: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row)
            payload["details"] = json.loads(str(payload.pop("details_json", "{}") or "{}"))
            items.append(payload)
        return items, total

    def get_retention_policy(self, tenant_id: str) -> AuditRetentionPolicy:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM audit_retention_policies WHERE tenant_id = ?", (tenant_id,)).fetchone()
        if row is None:
            return AuditRetentionPolicy(tenant_id=tenant_id)
        payload = dict(row)
        payload.pop("updated_at", None)
        return AuditRetentionPolicy(**payload)

    def upsert_retention_policy(self, policy: AuditRetentionPolicy) -> AuditRetentionPolicy:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO audit_retention_policies(
                    tenant_id, auth_events_days, user_events_days, lobster_events_days,
                    security_events_days, billing_events_days, edge_events_days, system_events_days,
                    workflow_events_days, channel_events_days, api_key_events_days, mcp_events_days, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    auth_events_days=excluded.auth_events_days,
                    user_events_days=excluded.user_events_days,
                    lobster_events_days=excluded.lobster_events_days,
                    security_events_days=excluded.security_events_days,
                    billing_events_days=excluded.billing_events_days,
                    edge_events_days=excluded.edge_events_days,
                    system_events_days=excluded.system_events_days,
                    workflow_events_days=excluded.workflow_events_days,
                    channel_events_days=excluded.channel_events_days,
                    api_key_events_days=excluded.api_key_events_days,
                    mcp_events_days=excluded.mcp_events_days,
                    updated_at=excluded.updated_at
                """,
                (
                    policy.tenant_id,
                    policy.auth_events_days,
                    policy.user_events_days,
                    policy.lobster_events_days,
                    policy.security_events_days,
                    policy.billing_events_days,
                    policy.edge_events_days,
                    policy.system_events_days,
                    policy.workflow_events_days,
                    policy.channel_events_days,
                    policy.api_key_events_days,
                    policy.mcp_events_days,
                    _utc_now(),
                ),
            )
            conn.commit()
        return policy

    def list_tenant_ids(self) -> list[str]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT tenant_id FROM audit_events
                UNION
                SELECT tenant_id FROM audit_retention_policies
                """
            ).fetchall()
        return sorted({str(row["tenant_id"]).strip() for row in rows if str(row["tenant_id"]).strip()})

    def soft_delete_before(self, tenant_id: str, *, category: str, cutoff_iso: str, reason: str) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE audit_events
                   SET deleted_at = ?, deleted_reason = ?
                 WHERE tenant_id = ? AND category = ? AND created_at < ? AND deleted_at IS NULL
                """,
                (_utc_now(), reason[:200], tenant_id, category, cutoff_iso),
            )
            conn.commit()
            return int(cur.rowcount or 0)


class SimpleMetrics:
    def __init__(self) -> None:
        self._counters: dict[str, float] = {}

    def increment(self, metric: str, value: float = 1.0) -> None:
        self._counters[metric] = self._counters.get(metric, 0.0) + value

    def get_summary(self) -> dict[str, Any]:
        return {"counters": dict(self._counters)}


class AuditRetentionCleaner:
    def __init__(self, store: AuditStore | None = None) -> None:
        self._store = store or AuditStore()

    def cleanup(self, tenant_id: str) -> dict[str, int]:
        policy = self._store.get_retention_policy(tenant_id)
        summary: dict[str, int] = {}
        for category in {"auth", "user", "lobster", "workflow", "channel", "api_key", "tenant", "billing", "security", "edge", "mcp", "system"}:
            days = policy.ttl_for_category(category)
            if days <= 0:
                summary[category] = 0
                continue
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            summary[category] = self._store.soft_delete_before(
                tenant_id,
                category=category,
                cutoff_iso=cutoff,
                reason=f"retention_policy:{days}d",
            )
        return summary


def _normalize_event_type(value: AuditEventType | str | None) -> AuditEventType:
    if isinstance(value, AuditEventType):
        return value
    raw = str(value or "").strip().upper()
    if not raw:
        return AuditEventType.SYSTEM_CONFIG_UPDATE
    try:
        return AuditEventType(raw)
    except ValueError:
        if raw.startswith("AUTH_"):
            return AuditEventType.AUTH_LOGIN
        return AuditEventType.SYSTEM_CONFIG_UPDATE


class AuditLogService:
    def __init__(self) -> None:
        self._store = AuditStore()
        self.metrics = SimpleMetrics()

    async def log(
        self,
        event_type: AuditEventType | str | None = None,
        tenant_id: str = "",
        *,
        action: str | None = None,
        user_id: str | None = None,
        actor_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        details: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        ip_address: str | None = None,
        severity: str | None = None,
    ) -> str:
        normalized_type = _normalize_event_type(event_type or action)
        row = {
            "id": f"aev_{uuid.uuid4().hex[:16]}",
            "event_type": normalized_type.value,
            "category": EVENT_CATEGORY.get(normalized_type, "system"),
            "severity": str(severity or EVENT_SEVERITY.get(normalized_type, "INFO")).upper(),
            "tenant_id": str(tenant_id or "").strip() or "tenant_main",
            "user_id": str(user_id or actor_id or "").strip() or None,
            "resource_type": str(resource_type or "").strip() or None,
            "resource_id": str(resource_id or "").strip() or None,
            "details": details if isinstance(details, dict) else (metadata if isinstance(metadata, dict) else {}),
            "ip_address": str(ip_address or "").strip() or None,
            "created_at": _utc_now(),
            "deleted_at": None,
            "deleted_reason": None,
        }
        self._store.insert(row)
        self.metrics.increment(f"audit.{row['category']}.events")
        return str(row["id"])

    def query(
        self,
        tenant_id: str,
        *,
        event_types: list[str] | None = None,
        severity: list[str] | None = None,
        category: list[str] | None = None,
        user_id: str | None = None,
        resource_id: str | None = None,
        from_ts: str | None = None,
        to_ts: str | None = None,
        include_deleted: bool = False,
        limit: int = 100,
        action: str | None = None,
        actor_id: str | None = None,
        since: float | None = None,
    ) -> list[dict[str, Any]]:
        normalized_from = from_ts
        if normalized_from is None and since is not None:
            normalized_from = datetime.fromtimestamp(float(since), tz=timezone.utc).isoformat()
        normalized_event_types = event_types
        if action and not normalized_event_types:
            normalized_event_types = [action]
        return self._store.query(
            tenant_id=tenant_id,
            event_types=normalized_event_types,
            severity=severity,
            category=category,
            user_id=user_id or actor_id,
            resource_id=resource_id,
            from_ts=normalized_from,
            to_ts=to_ts,
            include_deleted=include_deleted,
            limit=limit,
        )

    def query_paginated(
        self,
        tenant_id: str,
        *,
        event_types: list[str] | None = None,
        severity: list[str] | None = None,
        category: list[str] | None = None,
        user_id: str | None = None,
        resource_id: str | None = None,
        from_ts: str | None = None,
        to_ts: str | None = None,
        include_deleted: bool = False,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "created_at",
        sort_dir: str = "desc",
    ) -> tuple[list[dict[str, Any]], int]:
        return self._store.query_paginated(
            tenant_id=tenant_id,
            event_types=event_types,
            severity=severity,
            category=category,
            user_id=user_id,
            resource_id=resource_id,
            from_ts=from_ts,
            to_ts=to_ts,
            include_deleted=include_deleted,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )

    def get_metrics_summary(self) -> dict[str, Any]:
        return self.metrics.get_summary()

    def list_event_types(self) -> list[dict[str, str]]:
        return [
            {
                "event_type": item.value,
                "category": EVENT_CATEGORY.get(item, "system"),
                "severity": EVENT_SEVERITY.get(item, "INFO"),
            }
            for item in AuditEventType
        ]

    def get_retention_policy(self, tenant_id: str) -> AuditRetentionPolicy:
        return self._store.get_retention_policy(tenant_id)

    def upsert_retention_policy(self, policy: AuditRetentionPolicy) -> AuditRetentionPolicy:
        return self._store.upsert_retention_policy(policy)

    def cleanup_expired(self, tenant_id: str) -> dict[str, int]:
        return AuditRetentionCleaner(self._store).cleanup(tenant_id)

    def list_tenant_ids(self) -> list[str]:
        return self._store.list_tenant_ids()


_global_audit: AuditLogService | None = None


def get_audit_service() -> AuditLogService:
    global _global_audit
    if _global_audit is None:
        _global_audit = AuditLogService()
    return _global_audit
