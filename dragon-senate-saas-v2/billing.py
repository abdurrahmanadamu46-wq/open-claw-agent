from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator

from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, Integer, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from time_utils import ensure_aware_utc
from time_utils import utc_now

def _normalize_db_url(db_url: str) -> str:
    if db_url.startswith("postgresql+asyncpg://"):
        return db_url
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if db_url.startswith("sqlite+aiosqlite://"):
        return db_url
    if db_url.startswith("sqlite:///"):
        return db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if db_url.startswith("sqlite://"):
        suffix = db_url.replace("sqlite://", "", 1)
        return f"sqlite+aiosqlite://{suffix}"
    return db_url


def _billing_db_url() -> str:
    raw = (
        os.getenv("BILLING_DATABASE_URL", "").strip()
        or os.getenv("AUTH_DATABASE_URL", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
        or "sqlite+aiosqlite:///./dragon_billing.db"
    )
    return _normalize_db_url(raw)


def _safe_slug(raw: str, *, fallback: str = "default") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", (raw or "").strip().lower()).strip("_")
    return cleaned[:120] or fallback


def _plan_catalog() -> dict[str, dict[str, Any]]:
    return {
        "free": {
            "token_limit": int(os.getenv("PLAN_FREE_TOKEN_LIMIT", "300000")),
            "run_limit": int(os.getenv("PLAN_FREE_RUN_LIMIT", "120")),
            "price_month_cny": 0,
            "price_year_cny": 0,
        },
        "pro": {
            "token_limit": int(os.getenv("PLAN_PRO_TOKEN_LIMIT", "10000000")),
            "run_limit": int(os.getenv("PLAN_PRO_RUN_LIMIT", "3000")),
            "price_month_cny": int(os.getenv("PLAN_PRO_PRICE_MONTH_CNY", "499")),
            "price_year_cny": int(os.getenv("PLAN_PRO_PRICE_YEAR_CNY", "4990")),
        },
        "enterprise": {
            "token_limit": int(os.getenv("PLAN_ENTERPRISE_TOKEN_LIMIT", "100000000")),
            "run_limit": int(os.getenv("PLAN_ENTERPRISE_RUN_LIMIT", "50000")),
            "price_month_cny": int(os.getenv("PLAN_ENTERPRISE_PRICE_MONTH_CNY", "4999")),
            "price_year_cny": int(os.getenv("PLAN_ENTERPRISE_PRICE_YEAR_CNY", "49990")),
        },
    }


class Base(DeclarativeBase):
    pass


class BillingSubscription(Base):
    __tablename__ = "billing_subscriptions"

    id: Mapped[str] = mapped_column(String(length=64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    plan_code: Mapped[str] = mapped_column(String(length=32), nullable=False, default="free")
    cycle: Mapped[str] = mapped_column(String(length=16), nullable=False, default="month")
    status: Mapped[str] = mapped_column(String(length=32), nullable=False, default="trialing")
    payment_provider: Mapped[str] = mapped_column(String(length=32), nullable=False, default="stripe")
    provider_customer_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True)

    token_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=300000)
    run_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    used_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_runs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    auto_renew: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    trial_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    trial_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class BillingUsageEvent(Base):
    __tablename__ = "billing_usage_events"

    id: Mapped[str] = mapped_column(String(length=64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(length=64), nullable=False, default="runtime")
    path: Mapped[str] = mapped_column(String(length=160), nullable=False, default="/")
    runs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_cny_milli: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trace_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True, index=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)


class BillingOrder(Base):
    __tablename__ = "billing_orders"

    id: Mapped[str] = mapped_column(String(length=64), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(length=64), nullable=False, unique=True, index=True)
    checkout_id: Mapped[str] = mapped_column(String(length=64), nullable=False, unique=True, index=True)
    user_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    plan_code: Mapped[str] = mapped_column(String(length=32), nullable=False)
    cycle: Mapped[str] = mapped_column(String(length=16), nullable=False)
    payment_provider: Mapped[str] = mapped_column(String(length=32), nullable=False, default="stripe")
    amount_cny: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(length=16), nullable=False, default="CNY")
    status: Mapped[str] = mapped_column(String(length=32), nullable=False, default="created", index=True)
    return_url: Mapped[str | None] = mapped_column(String(length=1000), nullable=True)
    provider_customer_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True, index=True)
    last_webhook_event_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)


class BillingWebhookEvent(Base):
    __tablename__ = "billing_webhook_events"

    id: Mapped[str] = mapped_column(String(length=64), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider_event_key: Mapped[str] = mapped_column(String(length=160), nullable=False, unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(length=32), nullable=False)
    event_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(length=64), nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True, index=True)
    tenant_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True, index=True)
    order_id: Mapped[str | None] = mapped_column(String(length=64), nullable=True, index=True)
    processed_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    duplicate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(String(length=200), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)


class BillingReconciliationRun(Base):
    __tablename__ = "billing_reconciliation_runs"

    run_id: Mapped[str] = mapped_column(String(length=64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(length=32), nullable=False, index=True)
    tenant_id: Mapped[str | None] = mapped_column(String(length=128), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(length=32), nullable=False, default="running")
    scanned_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    flagged_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BillingCompensationTask(Base):
    __tablename__ = "billing_compensation_tasks"

    task_id: Mapped[str] = mapped_column(String(length=64), primary_key=True)
    order_id: Mapped[str] = mapped_column(String(length=64), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(length=128), nullable=False, index=True)
    reason_code: Mapped[str] = mapped_column(String(length=64), nullable=False)
    status: Mapped[str] = mapped_column(String(length=32), nullable=False, default="open", index=True)
    detail_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)


@dataclass(slots=True)
class BillingGuardDecision:
    allowed: bool
    code: str
    reason: str
    subscription: dict[str, Any]


class UsageReportRequest(BaseModel):
    event_type: str = Field(default="runtime", min_length=1, max_length=64)
    path: str = Field(default="/", min_length=1, max_length=160)
    runs: int = Field(default=0, ge=0, le=1000)
    tokens: int = Field(default=0, ge=0, le=10_000_000)
    trace_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


BILLING_DB_URL = _billing_db_url()
_connect_args = {"check_same_thread": False} if BILLING_DB_URL.startswith("sqlite+") else {}
billing_engine = create_async_engine(
    BILLING_DB_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args=_connect_args,
)
BillingSessionMaker = async_sessionmaker(billing_engine, expire_on_commit=False)


async def billing_session() -> AsyncGenerator[AsyncSession, None]:
    async with BillingSessionMaker() as session:
        yield session


async def init_billing_schema() -> None:
    async with billing_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if str(BILLING_DB_URL).startswith("sqlite+"):
            rows = await conn.exec_driver_sql("PRAGMA table_info(billing_subscriptions)")
            cols = {str(row[1]).strip().lower() for row in rows.fetchall()}
            if "trial_used" not in cols:
                await conn.exec_driver_sql(
                    "ALTER TABLE billing_subscriptions ADD COLUMN trial_used BOOLEAN NOT NULL DEFAULT 0"
                )
            if "trial_started_at" not in cols:
                await conn.exec_driver_sql(
                    "ALTER TABLE billing_subscriptions ADD COLUMN trial_started_at DATETIME"
                )
            if "trial_ends_at" not in cols:
                await conn.exec_driver_sql(
                    "ALTER TABLE billing_subscriptions ADD COLUMN trial_ends_at DATETIME"
                )


def _default_plan_code() -> str:
    catalog = _plan_catalog()
    desired = _safe_slug(os.getenv("BILLING_DEFAULT_PLAN", "free"), fallback="free")
    return desired if desired in catalog else "free"


def _default_cycle() -> str:
    cycle = _safe_slug(os.getenv("BILLING_DEFAULT_CYCLE", "month"), fallback="month")
    return cycle if cycle in {"month", "year"} else "month"


def _period_window(cycle: str) -> tuple[datetime, datetime]:
    now = utc_now()
    if cycle == "year":
        return now, now + timedelta(days=365)
    return now, now + timedelta(days=30)


def _subscription_to_dict(row: BillingSubscription) -> dict[str, Any]:
    current_period_start = ensure_aware_utc(row.current_period_start) or utc_now()
    current_period_end = ensure_aware_utc(row.current_period_end) or utc_now()
    created_at = ensure_aware_utc(row.created_at) or utc_now()
    updated_at = ensure_aware_utc(row.updated_at) or utc_now()
    trial_started_at = ensure_aware_utc(row.trial_started_at) if row.trial_started_at else None
    trial_ends_at = ensure_aware_utc(row.trial_ends_at) if row.trial_ends_at else None
    return {
        "id": row.id,
        "user_id": row.user_id,
        "tenant_id": row.tenant_id,
        "plan_code": row.plan_code,
        "cycle": row.cycle,
        "status": row.status,
        "payment_provider": row.payment_provider,
        "provider_customer_id": row.provider_customer_id,
        "provider_subscription_id": row.provider_subscription_id,
        "token_limit": row.token_limit,
        "run_limit": row.run_limit,
        "used_tokens": row.used_tokens,
        "used_runs": row.used_runs,
        "auto_renew": row.auto_renew,
        "trial_used": row.trial_used,
        "current_period_start": current_period_start.isoformat(),
        "current_period_end": current_period_end.isoformat(),
        "trial_started_at": trial_started_at.isoformat() if trial_started_at else None,
        "trial_ends_at": trial_ends_at.isoformat() if trial_ends_at else None,
        "created_at": created_at.isoformat(),
        "updated_at": updated_at.isoformat(),
    }


def _order_to_dict(row: BillingOrder) -> dict[str, Any]:
    created_at = ensure_aware_utc(row.created_at) or utc_now()
    updated_at = ensure_aware_utc(row.updated_at) or utc_now()
    return {
        "id": row.id,
        "order_id": row.order_id,
        "checkout_id": row.checkout_id,
        "user_id": row.user_id,
        "tenant_id": row.tenant_id,
        "plan_code": row.plan_code,
        "cycle": row.cycle,
        "payment_provider": row.payment_provider,
        "amount_cny": row.amount_cny,
        "currency": row.currency,
        "status": row.status,
        "return_url": row.return_url,
        "provider_customer_id": row.provider_customer_id,
        "provider_subscription_id": row.provider_subscription_id,
        "last_webhook_event_id": row.last_webhook_event_id,
        "metadata": json.loads(row.metadata_json or "{}"),
        "last_error": row.last_error,
        "created_at": created_at.isoformat(),
        "updated_at": updated_at.isoformat(),
    }


def _webhook_event_to_dict(row: BillingWebhookEvent) -> dict[str, Any]:
    created_at = ensure_aware_utc(row.created_at) or utc_now()
    return {
        "id": row.id,
        "provider_event_key": row.provider_event_key,
        "provider": row.provider,
        "event_id": row.event_id,
        "action": row.action,
        "user_id": row.user_id,
        "tenant_id": row.tenant_id,
        "order_id": row.order_id,
        "processed_ok": row.processed_ok,
        "duplicate": row.duplicate,
        "reason": row.reason,
        "payload": json.loads(row.payload_json or "{}"),
        "result": json.loads(row.result_json or "{}"),
        "created_at": created_at.isoformat(),
    }


def _compensation_task_to_dict(row: BillingCompensationTask) -> dict[str, Any]:
    created_at = ensure_aware_utc(row.created_at) or utc_now()
    updated_at = ensure_aware_utc(row.updated_at) or utc_now()
    return {
        "task_id": row.task_id,
        "order_id": row.order_id,
        "user_id": row.user_id,
        "tenant_id": row.tenant_id,
        "reason_code": row.reason_code,
        "status": row.status,
        "detail": json.loads(row.detail_json or "{}"),
        "created_at": created_at.isoformat(),
        "updated_at": updated_at.isoformat(),
    }


async def _fetch_subscription_row(session: AsyncSession, user_id: str, tenant_id: str) -> BillingSubscription | None:
    result = await session.execute(
        select(BillingSubscription)
        .where(BillingSubscription.user_id == user_id)
        .where(BillingSubscription.tenant_id == tenant_id)
        .order_by(BillingSubscription.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _fetch_order_by_order_id(session: AsyncSession, order_id: str) -> BillingOrder | None:
    result = await session.execute(
        select(BillingOrder)
        .where(BillingOrder.order_id == order_id)
        .order_by(BillingOrder.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _fetch_order_by_checkout_id(session: AsyncSession, checkout_id: str) -> BillingOrder | None:
    result = await session.execute(
        select(BillingOrder)
        .where(BillingOrder.checkout_id == checkout_id)
        .order_by(BillingOrder.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _reset_if_period_expired(session: AsyncSession, sub: BillingSubscription) -> None:
    now = utc_now()
    period_end = ensure_aware_utc(sub.current_period_end) or now
    if period_end > now:
        return
    if str(sub.status or "").lower() == "trialing" and bool(sub.trial_used):
        free_plan = _plan_catalog()["free"]
        start, end = _period_window("month")
        sub.plan_code = "free"
        sub.cycle = "month"
        sub.status = "active"
        sub.token_limit = int(free_plan["token_limit"])
        sub.run_limit = int(free_plan["run_limit"])
        sub.current_period_start = start
        sub.current_period_end = end
        sub.trial_started_at = None
        sub.trial_ends_at = None
        sub.used_runs = 0
        sub.used_tokens = 0
        sub.updated_at = now
        await session.commit()
        return
    start, end = _period_window(sub.cycle)
    sub.current_period_start = start
    sub.current_period_end = end
    sub.used_runs = 0
    sub.used_tokens = 0
    sub.updated_at = now
    await session.commit()


async def ensure_subscription(user_id: str, tenant_id: str) -> dict[str, Any]:
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    catalog = _plan_catalog()
    plan_code = _default_plan_code()
    cycle = _default_cycle()
    start, end = _period_window(cycle)

    async with BillingSessionMaker() as session:
        existing = await _fetch_subscription_row(session, safe_user, safe_tenant)
        if existing is None:
            plan_row = catalog[plan_code]
            existing = BillingSubscription(
                user_id=safe_user,
                tenant_id=safe_tenant,
                plan_code=plan_code,
                cycle=cycle,
                status="trialing" if plan_code == "free" else "active",
                token_limit=int(plan_row["token_limit"]),
                run_limit=int(plan_row["run_limit"]),
                used_tokens=0,
                used_runs=0,
                payment_provider="stripe",
                provider_customer_id=f"cus_{safe_user}",
                provider_subscription_id=f"sub_{safe_user}",
                trial_used=False,
                trial_started_at=None,
                trial_ends_at=None,
                current_period_start=start,
                current_period_end=end,
            )
            session.add(existing)
            await session.commit()
            await session.refresh(existing)
        else:
            await _reset_if_period_expired(session, existing)
        return _subscription_to_dict(existing)


async def get_subscription(user_id: str, tenant_id: str) -> dict[str, Any]:
    return await ensure_subscription(user_id, tenant_id)


async def create_checkout_order(
    *,
    order_id: str,
    checkout_id: str,
    user_id: str,
    tenant_id: str,
    plan_code: str,
    cycle: str,
    payment_provider: str,
    amount_cny: int,
    currency: str = "CNY",
    status: str = "checkout_url_ready_pending_provider_redirect",
    return_url: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    now = utc_now()
    async with BillingSessionMaker() as session:
        row = await _fetch_order_by_order_id(session, order_id)
        if row is None:
            row = BillingOrder(
                order_id=order_id[:64],
                checkout_id=checkout_id[:64],
                user_id=safe_user,
                tenant_id=safe_tenant,
                plan_code=_safe_slug(plan_code, fallback=_default_plan_code()),
                cycle=_safe_slug(cycle, fallback=_default_cycle()),
                payment_provider=_safe_slug(payment_provider, fallback="stripe"),
                amount_cny=max(0, int(amount_cny)),
                currency=(currency or "CNY").strip().upper()[:16] or "CNY",
                status=_safe_slug(status, fallback="created"),
                return_url=(return_url or "")[:1000] or None,
                metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
        else:
            row.checkout_id = checkout_id[:64]
            row.plan_code = _safe_slug(plan_code, fallback=_default_plan_code())
            row.cycle = _safe_slug(cycle, fallback=_default_cycle())
            row.payment_provider = _safe_slug(payment_provider, fallback="stripe")
            row.amount_cny = max(0, int(amount_cny))
            row.currency = (currency or "CNY").strip().upper()[:16] or "CNY"
            row.status = _safe_slug(status, fallback=row.status or "created")
            row.return_url = (return_url or "")[:1000] or None
            row.metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
            row.updated_at = now
        await session.commit()
        await session.refresh(row)
        return _order_to_dict(row)


async def upsert_subscription_plan(
    user_id: str,
    tenant_id: str,
    *,
    plan_code: str,
    cycle: str,
    status: str = "active",
    payment_provider: str = "stripe",
) -> dict[str, Any]:
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    catalog = _plan_catalog()
    desired_plan = _safe_slug(plan_code, fallback=_default_plan_code())
    if desired_plan not in catalog:
        desired_plan = _default_plan_code()
    desired_cycle = _safe_slug(cycle, fallback=_default_cycle())
    if desired_cycle not in {"month", "year"}:
        desired_cycle = _default_cycle()
    desired_status = _safe_slug(status, fallback="active")

    start, end = _period_window(desired_cycle)
    plan_row = catalog[desired_plan]

    async with BillingSessionMaker() as session:
        sub = await _fetch_subscription_row(session, safe_user, safe_tenant)
        if sub is None:
            sub = BillingSubscription(
                user_id=safe_user,
                tenant_id=safe_tenant,
                plan_code=desired_plan,
                cycle=desired_cycle,
                status=desired_status,
                payment_provider=payment_provider,
                provider_customer_id=f"cus_{safe_user}",
                provider_subscription_id=f"sub_{safe_user}",
                token_limit=int(plan_row["token_limit"]),
                run_limit=int(plan_row["run_limit"]),
                used_tokens=0,
                used_runs=0,
                current_period_start=start,
                current_period_end=end,
                trial_used=False,
                trial_started_at=None,
                trial_ends_at=None,
            )
            session.add(sub)
        else:
            sub.plan_code = desired_plan
            sub.cycle = desired_cycle
            sub.status = desired_status
            sub.payment_provider = payment_provider
            sub.provider_customer_id = sub.provider_customer_id or f"cus_{safe_user}"
            sub.provider_subscription_id = sub.provider_subscription_id or f"sub_{safe_user}"
            sub.token_limit = int(plan_row["token_limit"])
            sub.run_limit = int(plan_row["run_limit"])
            sub.current_period_start = start
            sub.current_period_end = end
            if desired_status != "trialing":
                sub.trial_started_at = None
                sub.trial_ends_at = None
            sub.updated_at = utc_now()
        await session.commit()
        await session.refresh(sub)
        return _subscription_to_dict(sub)


async def activate_trial(
    *,
    user_id: str,
    tenant_id: str,
    plan_code: str = "pro",
    duration_days: int = 14,
) -> dict[str, Any]:
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    desired_plan = _safe_slug(plan_code, fallback="pro")
    catalog = _plan_catalog()
    if desired_plan not in catalog or desired_plan == "free":
        desired_plan = "pro"
    now = utc_now()
    trial_end = now + timedelta(days=max(1, min(int(duration_days), 60)))

    async with BillingSessionMaker() as session:
        sub = await _fetch_subscription_row(session, safe_user, safe_tenant)
        if sub is None:
            await ensure_subscription(safe_user, safe_tenant)
            sub = await _fetch_subscription_row(session, safe_user, safe_tenant)
        if sub is None:
            raise RuntimeError("subscription_not_found_after_ensure")
        await _reset_if_period_expired(session, sub)
        if bool(sub.trial_used):
            raise RuntimeError("trial_already_used")

        plan_row = catalog[desired_plan]
        sub.plan_code = desired_plan
        sub.cycle = "month"
        sub.status = "trialing"
        sub.token_limit = int(plan_row["token_limit"])
        sub.run_limit = int(plan_row["run_limit"])
        sub.used_runs = 0
        sub.used_tokens = 0
        sub.auto_renew = False
        sub.trial_used = True
        sub.trial_started_at = now
        sub.trial_ends_at = trial_end
        sub.current_period_start = now
        sub.current_period_end = trial_end
        sub.updated_at = now
        await session.commit()
        await session.refresh(sub)
        return _subscription_to_dict(sub)


async def apply_provider_webhook_event(
    *,
    user_id: str,
    tenant_id: str,
    action: str,
    plan_code: str | None = None,
    cycle: str | None = None,
    provider_subscription_id: str | None = None,
    payment_provider: str = "stripe",
) -> dict[str, Any]:
    safe_action = _safe_slug(action, fallback="noop")
    sub = await ensure_subscription(user_id, tenant_id)
    status = sub["status"]
    desired_plan_code = _safe_slug(plan_code or str(sub["plan_code"]), fallback=_default_plan_code())
    desired_cycle = _safe_slug(cycle or str(sub["cycle"]), fallback=_default_cycle())

    if safe_action in {"payment_succeeded", "activate"}:
        status = "active"
    elif safe_action in {"payment_failed", "past_due"}:
        status = "past_due"
    elif safe_action in {"cancel", "canceled"}:
        status = "canceled"
    elif safe_action in {"resume"}:
        status = "active"
    elif safe_action in {"downgrade_free"}:
        desired_plan_code = "free"
        status = "active"
    elif safe_action in {"upgrade_pro"}:
        desired_plan_code = "pro"
        status = "active"
    elif safe_action in {"upgrade_enterprise"}:
        desired_plan_code = "enterprise"
        status = "active"
    elif safe_action in {"upgrade_free"}:
        desired_plan_code = "free"
        status = "active"

    updated = await upsert_subscription_plan(
        user_id=user_id,
        tenant_id=tenant_id,
        plan_code=desired_plan_code,
        cycle=desired_cycle,
        status=status,
        payment_provider=_safe_slug(payment_provider, fallback="stripe"),
    )
    if provider_subscription_id:
        async with BillingSessionMaker() as session:
            row = await _fetch_subscription_row(session, _safe_slug(user_id), _safe_slug(tenant_id))
            if row is not None:
                row.provider_subscription_id = provider_subscription_id[:128]
                row.updated_at = utc_now()
                await session.commit()
                await session.refresh(row)
                updated = _subscription_to_dict(row)
    return updated


def _order_status_from_action(action: str) -> str:
    safe_action = _safe_slug(action, fallback="noop")
    if safe_action in {"payment_succeeded", "activate", "resume", "upgrade_pro", "upgrade_enterprise", "upgrade_free", "downgrade_free"}:
        return "paid"
    if safe_action in {"payment_failed", "past_due"}:
        return "payment_failed"
    if safe_action in {"cancel", "canceled"}:
        return "canceled"
    return "webhook_processed"


async def update_order_after_webhook(
    *,
    order_id: str,
    action: str,
    payment_provider: str,
    event_id: str,
    provider_subscription_id: str | None = None,
    error_message: str | None = None,
) -> dict[str, Any] | None:
    async with BillingSessionMaker() as session:
        row = await _fetch_order_by_order_id(session, order_id[:64])
        if row is None:
            return None
        row.status = _order_status_from_action(action)
        row.payment_provider = _safe_slug(payment_provider, fallback=row.payment_provider or "stripe")
        row.last_webhook_event_id = event_id[:128]
        if provider_subscription_id:
            row.provider_subscription_id = provider_subscription_id[:128]
        if error_message:
            row.last_error = error_message[:2000]
        row.updated_at = utc_now()
        await session.commit()
        await session.refresh(row)
        return _order_to_dict(row)


async def record_webhook_event(
    *,
    provider: str,
    event_id: str,
    action: str,
    payload: dict[str, Any],
    processed_ok: bool,
    reason: str = "",
    result: dict[str, Any] | None = None,
    user_id: str | None = None,
    tenant_id: str | None = None,
    order_id: str | None = None,
) -> dict[str, Any]:
    safe_provider = _safe_slug(provider, fallback="stripe")
    safe_event_id = (event_id or f"evt_{uuid.uuid4().hex[:14]}")[:128]
    key = f"{safe_provider}:{safe_event_id}"

    async with BillingSessionMaker() as session:
        existing = await session.execute(
            select(BillingWebhookEvent)
            .where(BillingWebhookEvent.provider_event_key == key)
            .limit(1)
        )
        row = existing.scalar_one_or_none()
        if row is not None:
            row.duplicate = True
            await session.commit()
            await session.refresh(row)
            return {**_webhook_event_to_dict(row), "already_recorded": True}

        row = BillingWebhookEvent(
            provider_event_key=key,
            provider=safe_provider,
            event_id=safe_event_id,
            action=_safe_slug(action, fallback="noop"),
            user_id=_safe_slug(user_id, fallback="user") if user_id else None,
            tenant_id=_safe_slug(tenant_id, fallback="tenant_main") if tenant_id else None,
            order_id=(order_id or "")[:64] or None,
            processed_ok=bool(processed_ok),
            duplicate=False,
            reason=(reason or "")[:200],
            payload_json=json.dumps(payload or {}, ensure_ascii=False),
            result_json=json.dumps(result or {}, ensure_ascii=False),
            created_at=utc_now(),
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return {**_webhook_event_to_dict(row), "already_recorded": False}


async def list_orders(*, user_id: str, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    bounded_limit = max(1, min(int(limit), 200))
    async with BillingSessionMaker() as session:
        rows = (
            await session.execute(
                select(BillingOrder)
                .where(BillingOrder.user_id == safe_user)
                .where(BillingOrder.tenant_id == safe_tenant)
                .order_by(BillingOrder.updated_at.desc())
                .limit(bounded_limit)
            )
        ).scalars().all()
    return [_order_to_dict(row) for row in rows]


async def list_webhook_events(*, tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    bounded_limit = max(1, min(int(limit), 200))
    async with BillingSessionMaker() as session:
        rows = (
            await session.execute(
                select(BillingWebhookEvent)
                .where(BillingWebhookEvent.tenant_id == safe_tenant)
                .order_by(BillingWebhookEvent.created_at.desc())
                .limit(bounded_limit)
            )
        ).scalars().all()
    return [_webhook_event_to_dict(row) for row in rows]


async def enqueue_compensation_task(
    *,
    order_id: str,
    user_id: str,
    tenant_id: str,
    reason_code: str,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task_id = f"cmp_{uuid.uuid4().hex[:16]}"
    now = utc_now()
    async with BillingSessionMaker() as session:
        row = BillingCompensationTask(
            task_id=task_id,
            order_id=order_id[:64],
            user_id=_safe_slug(user_id, fallback="user"),
            tenant_id=_safe_slug(tenant_id, fallback="tenant_main"),
            reason_code=_safe_slug(reason_code, fallback="unknown"),
            status="open",
            detail_json=json.dumps(detail or {}, ensure_ascii=False),
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return _compensation_task_to_dict(row)


async def list_compensation_tasks(*, tenant_id: str, status: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_status = _safe_slug(status or "", fallback="").strip("_")
    bounded_limit = max(1, min(int(limit), 200))
    async with BillingSessionMaker() as session:
        stmt = (
            select(BillingCompensationTask)
            .where(BillingCompensationTask.tenant_id == safe_tenant)
            .order_by(BillingCompensationTask.updated_at.desc())
            .limit(bounded_limit)
        )
        if safe_status:
            stmt = stmt.where(BillingCompensationTask.status == safe_status)
        rows = (await session.execute(stmt)).scalars().all()
    return [_compensation_task_to_dict(row) for row in rows]


async def resolve_compensation_task(*, task_id: str, status: str, notes: str | None = None) -> dict[str, Any] | None:
    safe_status = _safe_slug(status, fallback="resolved")
    async with BillingSessionMaker() as session:
        row = (
            await session.execute(
                select(BillingCompensationTask)
                .where(BillingCompensationTask.task_id == task_id[:64])
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        detail = json.loads(row.detail_json or "{}")
        if notes:
            detail["resolution_notes"] = notes[:2000]
        row.status = safe_status
        row.detail_json = json.dumps(detail, ensure_ascii=False)
        row.updated_at = utc_now()
        await session.commit()
        await session.refresh(row)
        return _compensation_task_to_dict(row)


async def run_reconciliation(
    *,
    provider: str,
    tenant_id: str | None = None,
    stale_minutes: int = 30,
    lookback_days: int = 30,
) -> dict[str, Any]:
    safe_provider = _safe_slug(provider, fallback="stripe")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main") if tenant_id else None
    run_id = f"recon_{uuid.uuid4().hex[:16]}"
    created_at = utc_now()
    stale_before = utc_now() - timedelta(minutes=max(5, stale_minutes))
    lookback_from = utc_now() - timedelta(days=max(1, lookback_days))

    async with BillingSessionMaker() as session:
        run = BillingReconciliationRun(
            run_id=run_id,
            provider=safe_provider,
            tenant_id=safe_tenant,
            status="running",
            scanned_count=0,
            flagged_count=0,
            summary_json="{}",
            created_at=created_at,
        )
        session.add(run)
        await session.commit()

        stmt = select(BillingOrder).where(BillingOrder.payment_provider == safe_provider)
        stmt = stmt.where(BillingOrder.created_at >= lookback_from)
        if safe_tenant:
            stmt = stmt.where(BillingOrder.tenant_id == safe_tenant)
        orders = (await session.execute(stmt.order_by(BillingOrder.updated_at.desc()))).scalars().all()

        flagged: list[dict[str, Any]] = []
        for order in orders:
            order_created = ensure_aware_utc(order.created_at) or created_at
            if order.status in {"checkout_url_ready_pending_provider_redirect", "created"} and order_created <= stale_before:
                flagged.append({"order_id": order.order_id, "reason": "stale_checkout"})
                comp = await enqueue_compensation_task(
                    order_id=order.order_id,
                    user_id=order.user_id,
                    tenant_id=order.tenant_id,
                    reason_code="stale_checkout",
                    detail={"provider": safe_provider},
                )
                flagged[-1]["compensation_task_id"] = comp["task_id"]
            elif order.status in {"payment_failed", "past_due"}:
                flagged.append({"order_id": order.order_id, "reason": order.status})
                comp = await enqueue_compensation_task(
                    order_id=order.order_id,
                    user_id=order.user_id,
                    tenant_id=order.tenant_id,
                    reason_code=order.status,
                    detail={"provider": safe_provider},
                )
                flagged[-1]["compensation_task_id"] = comp["task_id"]

        run.scanned_count = len(orders)
        run.flagged_count = len(flagged)
        run.status = "success"
        run.summary_json = json.dumps({"flagged": flagged}, ensure_ascii=False)
        run.finished_at = utc_now()
        await session.commit()
        await session.refresh(run)
        return {
            "run_id": run.run_id,
            "provider": run.provider,
            "tenant_id": run.tenant_id,
            "status": run.status,
            "scanned_count": run.scanned_count,
            "flagged_count": run.flagged_count,
            "summary": json.loads(run.summary_json or "{}"),
        }


async def evaluate_guard(
    *,
    user_id: str,
    tenant_id: str,
    path: str,
    estimated_runs: int = 1,
    estimated_tokens: int = 0,
) -> BillingGuardDecision:
    sub = await ensure_subscription(user_id, tenant_id)
    status = str(sub.get("status", "trialing")).lower()
    if status not in {"active", "trialing"}:
        return BillingGuardDecision(
            allowed=False,
            code="subscription_inactive",
            reason=f"subscription status={status}",
            subscription=sub,
        )

    token_limit = int(sub.get("token_limit", 0) or 0)
    run_limit = int(sub.get("run_limit", 0) or 0)
    used_tokens = int(sub.get("used_tokens", 0) or 0)
    used_runs = int(sub.get("used_runs", 0) or 0)

    if run_limit > 0 and used_runs + max(0, estimated_runs) > run_limit:
        return BillingGuardDecision(
            allowed=False,
            code="run_quota_exceeded",
            reason=f"run limit exceeded on {path}",
            subscription=sub,
        )
    if token_limit > 0 and used_tokens + max(0, estimated_tokens) > token_limit:
        return BillingGuardDecision(
            allowed=False,
            code="token_quota_exceeded",
            reason=f"token limit exceeded on {path}",
            subscription=sub,
        )
    return BillingGuardDecision(
        allowed=True,
        code="ok",
        reason="allowed",
        subscription=sub,
    )


def _estimate_cost_milli(tokens: int) -> int:
    # Blended unit pricing for early commercialization telemetry.
    # Default: 楼0.30 / 1M input + 楼0.60 / 1M output => use 楼0.45 / 1M as rough blended.
    price_per_mtok_cny = float(os.getenv("BILLING_EST_PRICE_PER_MTOK_CNY", "0.45"))
    cost = max(0.0, (tokens / 1_000_000.0) * price_per_mtok_cny)
    return int(round(cost * 1000))


async def report_usage(
    *,
    user_id: str,
    tenant_id: str,
    event_type: str,
    path: str,
    runs: int,
    tokens: int,
    trace_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    safe_event = _safe_slug(event_type, fallback="runtime")
    safe_path = path.strip()[:160] or "/"
    safe_runs = max(0, int(runs))
    safe_tokens = max(0, int(tokens))
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False)

    async with BillingSessionMaker() as session:
        sub = await _fetch_subscription_row(session, safe_user, safe_tenant)
        if sub is None:
            await session.commit()
        sub = await _fetch_subscription_row(session, safe_user, safe_tenant)
        if sub is None:
            # Ensure with a separate session path for stability.
            await session.rollback()
    # Ensure once outside transactional context.
    await ensure_subscription(safe_user, safe_tenant)

    async with BillingSessionMaker() as session:
        sub = await _fetch_subscription_row(session, safe_user, safe_tenant)
        if sub is None:
            raise RuntimeError("subscription_not_found_after_ensure")
        await _reset_if_period_expired(session, sub)
        sub.used_runs = int(sub.used_runs or 0) + safe_runs
        sub.used_tokens = int(sub.used_tokens or 0) + safe_tokens
        sub.updated_at = utc_now()

        event = BillingUsageEvent(
            user_id=safe_user,
            tenant_id=safe_tenant,
            event_type=safe_event,
            path=safe_path,
            runs=safe_runs,
            tokens=safe_tokens,
            cost_cny_milli=_estimate_cost_milli(safe_tokens),
            trace_id=(trace_id or "")[:128] or None,
            metadata_json=metadata_json,
        )
        session.add(event)
        await session.commit()
        await session.refresh(sub)
        return {
            "subscription": _subscription_to_dict(sub),
            "event_id": event.id,
        }


async def usage_summary(
    *,
    user_id: str,
    tenant_id: str,
    from_ts: datetime | None = None,
    to_ts: datetime | None = None,
) -> dict[str, Any]:
    safe_user = _safe_slug(user_id, fallback="user")
    safe_tenant = _safe_slug(tenant_id, fallback="tenant_main")
    now = utc_now()
    period_from = ensure_aware_utc(from_ts) or (now - timedelta(days=30))
    period_to = ensure_aware_utc(to_ts) or now

    async with BillingSessionMaker() as session:
        stmt = (
            select(
                func.count(BillingUsageEvent.id),
                func.coalesce(func.sum(BillingUsageEvent.runs), 0),
                func.coalesce(func.sum(BillingUsageEvent.tokens), 0),
                func.coalesce(func.sum(BillingUsageEvent.cost_cny_milli), 0),
            )
            .where(BillingUsageEvent.user_id == safe_user)
            .where(BillingUsageEvent.tenant_id == safe_tenant)
            .where(BillingUsageEvent.created_at >= period_from)
            .where(BillingUsageEvent.created_at <= period_to)
        )
        row = (await session.execute(stmt)).one()
        subscription = await ensure_subscription(safe_user, safe_tenant)
        return {
            "user_id": safe_user,
            "tenant_id": safe_tenant,
            "from": period_from.isoformat(),
            "to": period_to.isoformat(),
            "event_count": int(row[0] or 0),
            "runs": int(row[1] or 0),
            "tokens": int(row[2] or 0),
            "cost_cny_milli": int(row[3] or 0),
            "cost_cny": round(int(row[3] or 0) / 1000.0, 6),
            "subscription": subscription,
        }

