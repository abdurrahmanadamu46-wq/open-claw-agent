from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from agent_tier_manager import get_agent_tier_manager
from payment_gateway import payment_gateway
from saas_pricing_model import FLOOR_PRICE, get_seat_unit_price
from seat_quota_tracker import get_seat_quota_tracker


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _coerce_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


@dataclass(slots=True)
class SeatSubscriptionRecord:
    id: str
    tenant_id: str
    agent_id: str | None
    seat_count: int
    unit_price: int
    floor_price: int
    billing_cycle: str
    status: str
    trial_ends_at: str | None
    current_period_start: str | None
    current_period_end: str | None
    past_due_since: str | None
    suspended_at: str | None
    checkout_id: str | None
    last_payment_provider: str | None
    created_at: str
    updated_at: str

    @property
    def monthly_amount(self) -> int:
        return max(int(self.unit_price or 0), int(self.floor_price or FLOOR_PRICE)) * max(1, int(self.seat_count or 1))

    @property
    def annual_amount(self) -> int:
        annual_unit = max(int(max(self.unit_price, self.floor_price) * 0.9), self.floor_price)
        return annual_unit * max(1, self.seat_count) * 12

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "agent_id": self.agent_id,
            "seat_count": self.seat_count,
            "unit_price": self.unit_price,
            "floor_price": self.floor_price,
            "billing_cycle": self.billing_cycle,
            "status": self.status,
            "trial_ends_at": self.trial_ends_at,
            "current_period_start": self.current_period_start,
            "current_period_end": self.current_period_end,
            "past_due_since": self.past_due_since,
            "suspended_at": self.suspended_at,
            "checkout_id": self.checkout_id,
            "last_payment_provider": self.last_payment_provider,
            "monthly_amount": self.monthly_amount,
            "annual_amount": self.annual_amount,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class SeatBillingService:
    def __init__(self, db_path: str = "./data/seat_billing.sqlite") -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        self.quota_tracker = get_seat_quota_tracker()
        self.tier_manager = get_agent_tier_manager()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS seat_subscriptions (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL UNIQUE,
                    agent_id TEXT DEFAULT '',
                    seat_count INTEGER NOT NULL DEFAULT 1,
                    unit_price INTEGER NOT NULL DEFAULT 4800,
                    floor_price INTEGER NOT NULL DEFAULT 1980,
                    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
                    status TEXT NOT NULL DEFAULT 'trial',
                    trial_ends_at TEXT,
                    current_period_start TEXT,
                    current_period_end TEXT,
                    past_due_since TEXT,
                    suspended_at TEXT,
                    checkout_id TEXT,
                    last_payment_provider TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS seat_invoices (
                    invoice_id TEXT PRIMARY KEY,
                    subscription_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    invoice_type TEXT NOT NULL DEFAULT 'receipt',
                    amount_cny INTEGER NOT NULL DEFAULT 0,
                    currency TEXT NOT NULL DEFAULT 'CNY',
                    status TEXT NOT NULL DEFAULT 'issued',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(subscription_id) REFERENCES seat_subscriptions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_seat_invoices_tenant ON seat_invoices(tenant_id, created_at DESC);
                """
            )
            conn.commit()

    def _row_to_subscription(self, row: sqlite3.Row | dict[str, Any]) -> SeatSubscriptionRecord:
        payload = dict(row)
        return SeatSubscriptionRecord(
            id=str(payload.get("id") or ""),
            tenant_id=str(payload.get("tenant_id") or ""),
            agent_id=str(payload.get("agent_id") or "").strip() or None,
            seat_count=int(payload.get("seat_count") or 1),
            unit_price=int(payload.get("unit_price") or FLOOR_PRICE),
            floor_price=int(payload.get("floor_price") or FLOOR_PRICE),
            billing_cycle=str(payload.get("billing_cycle") or "monthly"),
            status=str(payload.get("status") or "trial"),
            trial_ends_at=str(payload.get("trial_ends_at") or "") or None,
            current_period_start=str(payload.get("current_period_start") or "") or None,
            current_period_end=str(payload.get("current_period_end") or "") or None,
            past_due_since=str(payload.get("past_due_since") or "") or None,
            suspended_at=str(payload.get("suspended_at") or "") or None,
            checkout_id=str(payload.get("checkout_id") or "") or None,
            last_payment_provider=str(payload.get("last_payment_provider") or "") or None,
            created_at=str(payload.get("created_at") or ""),
            updated_at=str(payload.get("updated_at") or ""),
        )

    async def create_subscription(
        self,
        *,
        tenant_id: str,
        seat_count: int,
        billing_cycle: str = "monthly",
        agent_id: str | None = None,
        trial_days: int = 14,
    ) -> dict[str, Any]:
        normalized_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        normalized_seats = max(1, int(seat_count or 1))
        normalized_cycle = str(billing_cycle or "monthly").strip().lower()
        if normalized_cycle not in {"monthly", "annual"}:
            normalized_cycle = "monthly"
        unit_price = get_seat_unit_price(normalized_seats)
        if unit_price < FLOOR_PRICE:
            raise ValueError(f"seat_unit_price_below_floor:{unit_price}<{FLOOR_PRICE}")
        now = _utc_now()
        record = SeatSubscriptionRecord(
            id=f"seat_sub_{uuid.uuid4().hex[:16]}",
            tenant_id=normalized_tenant,
            agent_id=str(agent_id or "").strip() or None,
            seat_count=normalized_seats,
            unit_price=unit_price,
            floor_price=FLOOR_PRICE,
            billing_cycle=normalized_cycle,
            status="trial",
            trial_ends_at=(now + timedelta(days=max(1, min(int(trial_days or 14), 30)))).isoformat(),
            current_period_start=now.date().isoformat(),
            current_period_end=(now.date() + timedelta(days=30 if normalized_cycle == "monthly" else 365)).isoformat(),
            past_due_since=None,
            suspended_at=None,
            checkout_id=None,
            last_payment_provider=None,
            created_at=now.isoformat(),
            updated_at=now.isoformat(),
        )
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO seat_subscriptions(
                    id, tenant_id, agent_id, seat_count, unit_price, floor_price, billing_cycle, status,
                    trial_ends_at, current_period_start, current_period_end, past_due_since, suspended_at,
                    checkout_id, last_payment_provider, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    agent_id = excluded.agent_id,
                    seat_count = excluded.seat_count,
                    unit_price = excluded.unit_price,
                    floor_price = excluded.floor_price,
                    billing_cycle = excluded.billing_cycle,
                    status = excluded.status,
                    trial_ends_at = excluded.trial_ends_at,
                    current_period_start = excluded.current_period_start,
                    current_period_end = excluded.current_period_end,
                    updated_at = excluded.updated_at
                """,
                (
                    record.id,
                    record.tenant_id,
                    record.agent_id or "",
                    record.seat_count,
                    record.unit_price,
                    record.floor_price,
                    record.billing_cycle,
                    record.status,
                    record.trial_ends_at,
                    record.current_period_start,
                    record.current_period_end,
                    record.past_due_since,
                    record.suspended_at,
                    record.checkout_id,
                    record.last_payment_provider or "",
                    record.created_at,
                    record.updated_at,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM seat_subscriptions WHERE tenant_id = ?",
                (record.tenant_id,),
            ).fetchone()
        await self.quota_tracker.init_tenant_seats(record.tenant_id, record.seat_count, agent_id=record.agent_id)
        created = self._row_to_subscription(row).to_dict()
        created["agent_tier"] = self.tier_manager.get_agent_tier(record.seat_count) if record.agent_id else None
        created["receipt"] = await self.generate_invoice(created["id"], invoice_type="trial_receipt")
        return created

    async def get_subscription(self, *, tenant_id: str | None = None, subscription_id: str | None = None) -> dict[str, Any] | None:
        with self._connect() as conn:
            if subscription_id:
                row = conn.execute("SELECT * FROM seat_subscriptions WHERE id = ?", (str(subscription_id or "").strip(),)).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM seat_subscriptions WHERE tenant_id = ?",
                    (str(tenant_id or "tenant_main").strip() or "tenant_main",),
                ).fetchone()
        if row is None:
            return None
        data = self._row_to_subscription(row).to_dict()
        data["agent_tier"] = self.tier_manager.get_agent_tier(data["seat_count"]) if data.get("agent_id") else None
        return data

    async def list_subscriptions(self, *, agent_id: str | None = None) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if agent_id:
                rows = conn.execute(
                    "SELECT * FROM seat_subscriptions WHERE agent_id = ? ORDER BY updated_at DESC",
                    (str(agent_id or "").strip(),),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM seat_subscriptions ORDER BY updated_at DESC").fetchall()
        items = [self._row_to_subscription(row).to_dict() for row in rows]
        for item in items:
            item["agent_tier"] = self.tier_manager.get_agent_tier(item["seat_count"]) if item.get("agent_id") else None
        return items

    async def upgrade_seats(self, *, tenant_id: str, new_seat_count: int) -> dict[str, Any]:
        current = await self.get_subscription(tenant_id=tenant_id)
        if current is None:
            raise KeyError(str(tenant_id or "tenant_main"))
        old_count = int(current["seat_count"])
        old_price = int(current["unit_price"])
        normalized_new = max(1, int(new_seat_count or old_count))
        new_price = get_seat_unit_price(normalized_new)
        if new_price < FLOOR_PRICE:
            raise ValueError("seat_unit_price_below_floor")
        start = _coerce_date(str(current.get("current_period_start") or "")) or _utc_now()
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = _coerce_date(str(current.get("current_period_end") or "")) or (start + timedelta(days=30))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        now = _utc_now()
        days_remaining = max(0, (end - now).days)
        days_total = max(1, (end - start).days or 30)
        added = normalized_new - old_count
        proration = 0.0
        if added != 0:
            proration = (added * new_price * days_remaining / days_total) + (
                old_count * (new_price - old_price) * days_remaining / days_total
            )
        with self._connect() as conn:
            conn.execute(
                "UPDATE seat_subscriptions SET seat_count = ?, unit_price = ?, updated_at = ? WHERE tenant_id = ?",
                (normalized_new, new_price, _utc_now_iso(), str(tenant_id or "tenant_main").strip() or "tenant_main"),
            )
            conn.commit()
        await self.quota_tracker.init_tenant_seats(str(tenant_id or "tenant_main").strip() or "tenant_main", normalized_new, agent_id=current.get("agent_id"))
        tier_change = self.tier_manager.check_tier_upgrade(str(current.get("agent_id") or tenant_id), old_seats=old_count, new_seats=normalized_new)
        return {
            "tenant_id": tenant_id,
            "old_seats": old_count,
            "new_seats": normalized_new,
            "old_unit_price": old_price,
            "new_unit_price": new_price,
            "proration_amount": int(round(proration)),
            "tier_change": tier_change,
            "subscription": await self.get_subscription(tenant_id=tenant_id),
        }

    async def create_checkout(
        self,
        *,
        subscription_id: str,
        provider: str = "wechatpay",
        return_url: str | None = None,
    ) -> dict[str, Any]:
        sub = await self.get_subscription(subscription_id=subscription_id)
        if sub is None:
            raise KeyError(subscription_id)
        amount_cny = int(sub["annual_amount"] if sub["billing_cycle"] == "annual" else sub["monthly_amount"])
        intent = payment_gateway.create_checkout_intent(
            user_id=str(sub.get("agent_id") or sub["tenant_id"]),
            tenant_id=str(sub["tenant_id"]),
            plan_code=f"seat_{sub['seat_count']}",
            cycle="year" if sub["billing_cycle"] == "annual" else "month",
            amount_cny=amount_cny,
            provider=provider,
            return_url=return_url,
        )
        intent.metadata["subscription_id"] = subscription_id
        with self._connect() as conn:
            conn.execute(
                "UPDATE seat_subscriptions SET checkout_id = ?, last_payment_provider = ?, updated_at = ? WHERE id = ?",
                (intent.checkout_id, intent.provider, _utc_now_iso(), subscription_id),
            )
            conn.commit()
        return {"subscription": await self.get_subscription(subscription_id=subscription_id), "checkout": intent.as_dict()}

    async def mark_subscription_paid(
        self,
        *,
        subscription_id: str | None = None,
        checkout_id: str | None = None,
        provider: str = "wechatpay",
    ) -> dict[str, Any]:
        with self._connect() as conn:
            if subscription_id:
                row = conn.execute("SELECT * FROM seat_subscriptions WHERE id = ?", (subscription_id,)).fetchone()
            else:
                row = conn.execute("SELECT * FROM seat_subscriptions WHERE checkout_id = ?", (checkout_id,)).fetchone()
            if row is None:
                raise KeyError(subscription_id or checkout_id or "subscription")
            record = self._row_to_subscription(row)
            next_start = _utc_now().date().isoformat()
            next_end = (_utc_now().date() + timedelta(days=30 if record.billing_cycle == "monthly" else 365)).isoformat()
            conn.execute(
                """
                UPDATE seat_subscriptions
                SET status = 'active', past_due_since = NULL, suspended_at = NULL,
                    current_period_start = ?, current_period_end = ?, last_payment_provider = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_start, next_end, provider, _utc_now_iso(), record.id),
            )
            conn.commit()
        updated = await self.get_subscription(subscription_id=record.id)
        if updated:
            updated["receipt"] = await self.generate_invoice(record.id, invoice_type="receipt")
        return updated or {}

    async def handle_payment_failed(self, *, tenant_id: str) -> dict[str, Any]:
        sub = await self.get_subscription(tenant_id=tenant_id)
        if sub is None:
            raise KeyError(tenant_id)
        now = _utc_now()
        status = str(sub["status"])
        updates = {"status": status, "past_due_since": sub.get("past_due_since"), "suspended_at": sub.get("suspended_at")}
        if status == "active":
            updates["status"] = "past_due"
            updates["past_due_since"] = now.isoformat()
        elif status == "past_due":
            past_due_since = _coerce_date(str(sub.get("past_due_since") or "")) or now
            if (now - past_due_since).days >= 7:
                updates["status"] = "suspended"
                updates["suspended_at"] = now.isoformat()
        with self._connect() as conn:
            conn.execute(
                "UPDATE seat_subscriptions SET status = ?, past_due_since = ?, suspended_at = ?, updated_at = ? WHERE tenant_id = ?",
                (
                    updates["status"],
                    updates["past_due_since"],
                    updates["suspended_at"],
                    _utc_now_iso(),
                    str(tenant_id or "tenant_main").strip() or "tenant_main",
                ),
            )
            conn.commit()
        return await self.get_subscription(tenant_id=tenant_id) or {}

    async def generate_invoice(self, subscription_id: str, *, invoice_type: str = "receipt") -> dict[str, Any]:
        sub = await self.get_subscription(subscription_id=subscription_id)
        if sub is None:
            raise KeyError(subscription_id)
        amount_cny = int(sub["annual_amount"] if sub["billing_cycle"] == "annual" else sub["monthly_amount"])
        payload = {
            "subscription_id": subscription_id,
            "tenant_id": sub["tenant_id"],
            "seat_count": sub["seat_count"],
            "unit_price": sub["unit_price"],
            "billing_cycle": sub["billing_cycle"],
            "status": sub["status"],
        }
        invoice_id = f"inv_{uuid.uuid4().hex[:12]}"
        created_at = _utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO seat_invoices(invoice_id, subscription_id, tenant_id, invoice_type, amount_cny, currency, status, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, 'CNY', 'issued', ?, ?)
                """,
                (invoice_id, subscription_id, sub["tenant_id"], str(invoice_type or "receipt"), amount_cny, json.dumps(payload, ensure_ascii=False), created_at),
            )
            conn.commit()
        return {
            "invoice_id": invoice_id,
            "subscription_id": subscription_id,
            "tenant_id": sub["tenant_id"],
            "invoice_type": invoice_type,
            "amount_cny": amount_cny,
            "currency": "CNY",
            "status": "issued",
            "payload": payload,
            "created_at": created_at,
        }


_service: SeatBillingService | None = None


def get_seat_billing_service() -> SeatBillingService:
    global _service
    if _service is None:
        _service = SeatBillingService()
    return _service
