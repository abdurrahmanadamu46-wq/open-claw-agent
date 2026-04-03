"""
audit_logger.py — 审计日志模块
================================
所有关键动作（审批、发布、支付、回滚、高风险操作）统一记录。
支持 SQLite（开发）和 PostgreSQL（生产），可切真。

商业化要求：
- 所有关键动作可审计、可回滚、可复盘
- 多租户隔离
- 支持按时间/租户/动作类型查询
"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Index, Integer, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from lobster_failure_reason import FAILURE_ACTION_MAP
from lobster_failure_reason import FailureRecord
from lobster_failure_reason import LobsterFailureReason


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _normalize_db_url(db_url: str) -> str:
    if db_url.startswith("sqlite:///"):
        return db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return db_url


def _audit_db_url() -> str:
    raw = os.getenv("AUDIT_DATABASE_URL", "").strip()
    if raw:
        return _normalize_db_url(raw)
    fallback = os.getenv("DATABASE_URL", "sqlite:///data/audit_log.sqlite").strip()
    return _normalize_db_url(fallback)


_engine = create_async_engine(_audit_db_url(), echo=False)
_async_session = sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


async def audit_session() -> AsyncGenerator[AsyncSession, None]:
    async with _async_session() as session:
        yield session


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


class AuditLogEntry(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entry_id = Column(String(64), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    timestamp = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    # Who
    tenant_id = Column(String(128), nullable=False, index=True)
    user_id = Column(String(128), nullable=False, index=True)
    operator = Column(String(256), nullable=True)  # human name or bot id

    # What
    action = Column(String(128), nullable=False, index=True)
    category = Column(String(64), nullable=False, index=True)  # approval, publish, payment, rollback, config, auth
    resource_type = Column(String(128), nullable=True)  # e.g. "campaign", "subscription", "edge_node"
    resource_id = Column(String(256), nullable=True)

    # Details
    summary = Column(Text, nullable=False)
    detail_json = Column(Text, nullable=True)  # JSON blob

    # Result
    result = Column(String(32), nullable=False, default="success")  # success, failure, pending, rolled_back
    error_message = Column(Text, nullable=True)

    # Rollback
    rollback_ref = Column(String(256), nullable=True)  # reference to rollback entry
    is_rollback = Column(Integer, nullable=False, default=0)

    # Source
    source = Column(String(64), nullable=False, default="api")  # api, tg_bot, web, cron, system
    ip_address = Column(String(64), nullable=True)
    trace_id = Column(String(128), nullable=True)

    __table_args__ = (
        Index("idx_audit_tenant_time", "tenant_id", "timestamp"),
        Index("idx_audit_action_time", "action", "timestamp"),
        Index("idx_audit_category_time", "category", "timestamp"),
    )


# ---------------------------------------------------------------------------
# Schema Init
# ---------------------------------------------------------------------------

async def init_audit_schema() -> None:
    """Create tables if not exist."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------------------------------------------------------------------------
# API Models
# ---------------------------------------------------------------------------

class AuditLogRequest(BaseModel):
    tenant_id: str
    user_id: str
    operator: str | None = None
    action: str
    category: str = "general"
    resource_type: str | None = None
    resource_id: str | None = None
    summary: str
    detail: dict[str, Any] | None = None
    result: str = "success"
    error_message: str | None = None
    source: str = "api"
    ip_address: str | None = None
    trace_id: str | None = None


class AuditLogResponse(BaseModel):
    entry_id: str
    timestamp: str
    tenant_id: str
    user_id: str
    operator: str | None
    action: str
    category: str
    resource_type: str | None
    resource_id: str | None
    summary: str
    detail: dict[str, Any] | None
    result: str
    error_message: str | None
    rollback_ref: str | None
    is_rollback: bool
    source: str
    trace_id: str | None


class AuditQueryParams(BaseModel):
    tenant_id: str | None = None
    user_id: str | None = None
    action: str | None = None
    category: str | None = None
    resource_type: str | None = None
    result: str | None = None
    since: str | None = None  # ISO datetime
    until: str | None = None  # ISO datetime
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


# ---------------------------------------------------------------------------
# Core Functions
# ---------------------------------------------------------------------------

def _entry_to_dict(entry: AuditLogEntry) -> dict[str, Any]:
    detail = None
    if entry.detail_json:
        try:
            detail = json.loads(entry.detail_json)
        except (json.JSONDecodeError, TypeError):
            detail = {"_raw": entry.detail_json}

    return {
        "entry_id": entry.entry_id,
        "timestamp": entry.timestamp.isoformat() if entry.timestamp else None,
        "tenant_id": entry.tenant_id,
        "user_id": entry.user_id,
        "operator": entry.operator,
        "action": entry.action,
        "category": entry.category,
        "resource_type": entry.resource_type,
        "resource_id": entry.resource_id,
        "summary": entry.summary,
        "detail": detail,
        "result": entry.result,
        "error_message": entry.error_message,
        "rollback_ref": entry.rollback_ref,
        "is_rollback": bool(entry.is_rollback),
        "source": entry.source,
        "ip_address": entry.ip_address,
        "trace_id": entry.trace_id,
    }


async def record_audit_log(
    *,
    tenant_id: str,
    user_id: str,
    action: str,
    summary: str,
    category: str = "general",
    operator: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: dict[str, Any] | None = None,
    result: str = "success",
    error_message: str | None = None,
    source: str = "api",
    ip_address: str | None = None,
    trace_id: str | None = None,
    rollback_ref: str | None = None,
    is_rollback: bool = False,
) -> dict[str, Any]:
    """Record an audit log entry. Returns the created entry dict."""
    entry = AuditLogEntry(
        entry_id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc),
        tenant_id=tenant_id,
        user_id=user_id,
        operator=operator,
        action=action,
        category=category,
        resource_type=resource_type,
        resource_id=resource_id,
        summary=summary,
        detail_json=json.dumps(detail, ensure_ascii=False) if detail else None,
        result=result,
        error_message=error_message,
        source=source,
        ip_address=ip_address,
        trace_id=trace_id,
        rollback_ref=rollback_ref,
        is_rollback=1 if is_rollback else 0,
    )

    async with _async_session() as session:
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        return _entry_to_dict(entry)


async def query_audit_logs(params: AuditQueryParams) -> dict[str, Any]:
    """Query audit logs with filters. Returns {items: [...], total: N}."""
    async with _async_session() as session:
        stmt = select(AuditLogEntry)
        count_stmt = select(func.count(AuditLogEntry.id))

        if params.tenant_id:
            stmt = stmt.where(AuditLogEntry.tenant_id == params.tenant_id)
            count_stmt = count_stmt.where(AuditLogEntry.tenant_id == params.tenant_id)
        if params.user_id:
            stmt = stmt.where(AuditLogEntry.user_id == params.user_id)
            count_stmt = count_stmt.where(AuditLogEntry.user_id == params.user_id)
        if params.action:
            stmt = stmt.where(AuditLogEntry.action == params.action)
            count_stmt = count_stmt.where(AuditLogEntry.action == params.action)
        if params.category:
            stmt = stmt.where(AuditLogEntry.category == params.category)
            count_stmt = count_stmt.where(AuditLogEntry.category == params.category)
        if params.resource_type:
            stmt = stmt.where(AuditLogEntry.resource_type == params.resource_type)
            count_stmt = count_stmt.where(AuditLogEntry.resource_type == params.resource_type)
        if params.result:
            stmt = stmt.where(AuditLogEntry.result == params.result)
            count_stmt = count_stmt.where(AuditLogEntry.result == params.result)
        if params.since:
            try:
                since_dt = datetime.fromisoformat(params.since)
                stmt = stmt.where(AuditLogEntry.timestamp >= since_dt)
                count_stmt = count_stmt.where(AuditLogEntry.timestamp >= since_dt)
            except ValueError:
                pass
        if params.until:
            try:
                until_dt = datetime.fromisoformat(params.until)
                stmt = stmt.where(AuditLogEntry.timestamp <= until_dt)
                count_stmt = count_stmt.where(AuditLogEntry.timestamp <= until_dt)
            except ValueError:
                pass

        stmt = stmt.order_by(AuditLogEntry.timestamp.desc())
        stmt = stmt.offset(params.offset).limit(params.limit)

        result = await session.execute(stmt)
        entries = result.scalars().all()

        count_result = await session.execute(count_stmt)
        total = count_result.scalar() or 0

        return {
            "items": [_entry_to_dict(e) for e in entries],
            "total": total,
            "limit": params.limit,
            "offset": params.offset,
        }


async def get_audit_entry(entry_id: str) -> dict[str, Any] | None:
    """Get a single audit entry by entry_id."""
    async with _async_session() as session:
        stmt = select(AuditLogEntry).where(AuditLogEntry.entry_id == entry_id)
        result = await session.execute(stmt)
        entry = result.scalar_one_or_none()
        if entry is None:
            return None
        return _entry_to_dict(entry)


async def record_rollback(
    *,
    original_entry_id: str,
    tenant_id: str,
    user_id: str,
    summary: str,
    operator: str | None = None,
    detail: dict[str, Any] | None = None,
    source: str = "api",
) -> dict[str, Any]:
    """Record a rollback action referencing the original entry."""
    original = await get_audit_entry(original_entry_id)
    if original is None:
        raise ValueError(f"Original audit entry not found: {original_entry_id}")

    return await record_audit_log(
        tenant_id=tenant_id,
        user_id=user_id,
        operator=operator,
        action=f"rollback:{original['action']}",
        category="rollback",
        resource_type=original.get("resource_type"),
        resource_id=original.get("resource_id"),
        summary=summary,
        detail=detail or {"rolled_back_entry": original_entry_id},
        result="success",
        source=source,
        rollback_ref=original_entry_id,
        is_rollback=True,
    )


# ---------------------------------------------------------------------------
# Convenience helpers for common categories
# ---------------------------------------------------------------------------

async def audit_approval(
    tenant_id: str, user_id: str, action: str, summary: str, **kwargs: Any
) -> dict[str, Any]:
    return await record_audit_log(
        tenant_id=tenant_id, user_id=user_id, action=action,
        summary=summary, category="approval", **kwargs,
    )


async def audit_publish(
    tenant_id: str, user_id: str, action: str, summary: str, **kwargs: Any
) -> dict[str, Any]:
    return await record_audit_log(
        tenant_id=tenant_id, user_id=user_id, action=action,
        summary=summary, category="publish", **kwargs,
    )


async def audit_payment(
    tenant_id: str, user_id: str, action: str, summary: str, **kwargs: Any
) -> dict[str, Any]:
    return await record_audit_log(
        tenant_id=tenant_id, user_id=user_id, action=action,
        summary=summary, category="payment", **kwargs,
    )


async def audit_auth(
    tenant_id: str, user_id: str, action: str, summary: str, **kwargs: Any
) -> dict[str, Any]:
    return await record_audit_log(
        tenant_id=tenant_id, user_id=user_id, action=action,
        summary=summary, category="auth", **kwargs,
    )


async def audit_config(
    tenant_id: str, user_id: str, action: str, summary: str, **kwargs: Any
) -> dict[str, Any]:
    return await record_audit_log(
        tenant_id=tenant_id, user_id=user_id, action=action,
        summary=summary, category="config", **kwargs,
    )


async def log_lobster_action(
    tenant_id: str,
    lobster_id: str,
    action: str,
    task_id: str | None = None,
    status: str = "success",
    duration_ms: int = 0,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Convenience helper for runtime lobster action audit records."""
    return await record_audit_log(
        tenant_id=tenant_id,
        user_id=lobster_id,
        operator=lobster_id,
        action=action,
        summary=f"{lobster_id}:{action}:{status}",
        category="lobster_action",
        resource_type="lobster",
        resource_id=task_id,
        detail={
            "lobster_id": lobster_id,
            "task_id": task_id,
            "duration_ms": duration_ms,
            "status": status,
            **(metadata or {}),
        },
        result=status,
        error_message=error,
        source="runtime",
        trace_id=task_id,
    )


def build_failure_record(
    *,
    task_id: str,
    lobster_id: str,
    reason: LobsterFailureReason,
    detail: str,
    auto_retried: bool,
    occurred_at: str,
) -> FailureRecord:
    return FailureRecord(
        task_id=task_id,
        lobster_id=lobster_id,
        reason=reason,
        detail=detail,
        suggested_action=FAILURE_ACTION_MAP[reason],
        auto_retried=auto_retried,
        occurred_at=occurred_at,
    )
