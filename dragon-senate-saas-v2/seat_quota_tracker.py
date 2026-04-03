from __future__ import annotations

import asyncio
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SEAT_DEFAULT_QUOTAS: dict[str, int] = {
    "video": 20,
    "image": 30,
    "digital_human": 3,
    "customer_interactions": 500,
    "sales_calls": 30,
    "llm_tasks": 50,
}


class SeatQuotaExceededError(RuntimeError):
    pass


@dataclass(slots=True)
class SeatQuotaMutation:
    seat_id: str
    tenant_id: str
    resource: str
    amount: int
    trace_id: str = ""
    source: str = "runtime"


class SeatQuotaTracker:
    def __init__(self, db_path: str = "./data/seat_quotas.sqlite") -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS seat_quotas (
                    seat_id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    agent_id TEXT DEFAULT '',
                    seat_name TEXT DEFAULT '',
                    platform TEXT DEFAULT '',
                    account_username TEXT DEFAULT '',
                    client_name TEXT DEFAULT '',
                    seat_status TEXT NOT NULL DEFAULT 'active',
                    video_limit INTEGER NOT NULL DEFAULT 20,
                    video_used INTEGER NOT NULL DEFAULT 0,
                    image_limit INTEGER NOT NULL DEFAULT 30,
                    image_used INTEGER NOT NULL DEFAULT 0,
                    digital_human_limit INTEGER NOT NULL DEFAULT 3,
                    digital_human_used INTEGER NOT NULL DEFAULT 0,
                    customer_interactions_limit INTEGER NOT NULL DEFAULT 500,
                    customer_interactions_used INTEGER NOT NULL DEFAULT 0,
                    sales_calls_limit INTEGER NOT NULL DEFAULT 30,
                    sales_calls_used INTEGER NOT NULL DEFAULT 0,
                    llm_tasks_limit INTEGER NOT NULL DEFAULT 50,
                    llm_tasks_used INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_seat_quotas_tenant ON seat_quotas(tenant_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_seat_quotas_agent ON seat_quotas(agent_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS seat_quota_events (
                    event_id TEXT PRIMARY KEY,
                    seat_id TEXT NOT NULL,
                    tenant_id TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    amount INTEGER NOT NULL DEFAULT 0,
                    trace_id TEXT DEFAULT '',
                    source TEXT DEFAULT 'runtime',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_seat_quota_events_seat ON seat_quota_events(seat_id, created_at DESC);
                """
            )
            conn.commit()

    @staticmethod
    def _now_iso() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    async def init_tenant_seats(
        self,
        tenant_id: str,
        seat_count: int,
        *,
        agent_id: str | None = None,
    ) -> list[str]:
        created: list[str] = []
        normalized_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        normalized_agent = str(agent_id or "").strip()
        async with self._lock:
            with self._connect() as conn:
                current = conn.execute(
                    "SELECT seat_id FROM seat_quotas WHERE tenant_id = ? ORDER BY seat_id ASC",
                    (normalized_tenant,),
                ).fetchall()
                existing_count = len(current)
                target_count = max(0, int(seat_count or 0))
                now = self._now_iso()
                for index in range(existing_count + 1, target_count + 1):
                    seat_id = f"{normalized_tenant}_seat_{index:03d}"
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO seat_quotas(
                            seat_id, tenant_id, agent_id, seat_name, platform, account_username, client_name,
                            seat_status, video_limit, video_used, image_limit, image_used,
                            digital_human_limit, digital_human_used, customer_interactions_limit, customer_interactions_used,
                            sales_calls_limit, sales_calls_used, llm_tasks_limit, llm_tasks_used, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, '', '', '', 'active', ?, 0, ?, 0, ?, 0, ?, 0, ?, 0, ?, 0, ?, ?)
                        """,
                        (
                            seat_id,
                            normalized_tenant,
                            normalized_agent,
                            f"{normalized_tenant} 席位 {index}",
                            SEAT_DEFAULT_QUOTAS["video"],
                            SEAT_DEFAULT_QUOTAS["image"],
                            SEAT_DEFAULT_QUOTAS["digital_human"],
                            SEAT_DEFAULT_QUOTAS["customer_interactions"],
                            SEAT_DEFAULT_QUOTAS["sales_calls"],
                            SEAT_DEFAULT_QUOTAS["llm_tasks"],
                            now,
                            now,
                        ),
                    )
                    created.append(seat_id)
                conn.commit()
        return created

    async def assign_seat(
        self,
        *,
        seat_id: str,
        tenant_id: str,
        agent_id: str | None = None,
        seat_name: str | None = None,
        platform: str | None = None,
        account_username: str | None = None,
        client_name: str | None = None,
        seat_status: str | None = None,
    ) -> dict[str, Any]:
        normalized_seat = str(seat_id or "").strip()
        normalized_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
        if not normalized_seat:
            raise ValueError("seat_id is required")
        async with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT * FROM seat_quotas WHERE seat_id = ? AND tenant_id = ?",
                    (normalized_seat, normalized_tenant),
                ).fetchone()
                if row is None:
                    raise KeyError(normalized_seat)
                next_row = dict(row)
                if agent_id is not None:
                    next_row["agent_id"] = str(agent_id or "").strip()
                if seat_name is not None:
                    next_row["seat_name"] = str(seat_name or "").strip()
                if platform is not None:
                    next_row["platform"] = str(platform or "").strip()
                if account_username is not None:
                    next_row["account_username"] = str(account_username or "").strip()
                if client_name is not None:
                    next_row["client_name"] = str(client_name or "").strip()
                if seat_status is not None:
                    next_row["seat_status"] = str(seat_status or "active").strip() or "active"
                next_row["updated_at"] = self._now_iso()
                conn.execute(
                    """
                    UPDATE seat_quotas
                    SET agent_id = ?, seat_name = ?, platform = ?, account_username = ?, client_name = ?, seat_status = ?, updated_at = ?
                    WHERE seat_id = ? AND tenant_id = ?
                    """,
                    (
                        next_row["agent_id"],
                        next_row["seat_name"],
                        next_row["platform"],
                        next_row["account_username"],
                        next_row["client_name"],
                        next_row["seat_status"],
                        next_row["updated_at"],
                        normalized_seat,
                        normalized_tenant,
                    ),
                )
                conn.commit()
                return self._row_to_summary(next_row)

    async def consume(self, mutation: SeatQuotaMutation) -> dict[str, Any]:
        normalized_resource = str(mutation.resource or "").strip().lower()
        if normalized_resource not in SEAT_DEFAULT_QUOTAS:
            raise ValueError(f"unsupported_resource:{normalized_resource}")
        amount = max(1, int(mutation.amount or 1))
        limit_col = f"{normalized_resource}_limit"
        used_col = f"{normalized_resource}_used"
        async with self._lock:
            with self._connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                row = conn.execute(
                    "SELECT * FROM seat_quotas WHERE seat_id = ? AND tenant_id = ?",
                    (mutation.seat_id, mutation.tenant_id),
                ).fetchone()
                if row is None:
                    conn.execute("ROLLBACK")
                    raise KeyError(mutation.seat_id)
                current_used = int(row[used_col] or 0)
                current_limit = int(row[limit_col] or 0)
                if current_used + amount > current_limit:
                    conn.execute("ROLLBACK")
                    raise SeatQuotaExceededError(
                        f"quota_exceeded:{mutation.seat_id}:{normalized_resource}:{current_used + amount}>{current_limit}"
                    )
                now = self._now_iso()
                conn.execute(
                    f"UPDATE seat_quotas SET {used_col} = ?, updated_at = ? WHERE seat_id = ? AND tenant_id = ?",
                    (current_used + amount, now, mutation.seat_id, mutation.tenant_id),
                )
                conn.execute(
                    """
                    INSERT INTO seat_quota_events(event_id, seat_id, tenant_id, resource, amount, trace_id, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"sqe_{uuid.uuid4().hex[:12]}",
                        mutation.seat_id,
                        mutation.tenant_id,
                        normalized_resource,
                        amount,
                        str(mutation.trace_id or "")[:128],
                        str(mutation.source or "runtime")[:64],
                        now,
                    ),
                )
                conn.commit()
                updated = conn.execute(
                    "SELECT * FROM seat_quotas WHERE seat_id = ? AND tenant_id = ?",
                    (mutation.seat_id, mutation.tenant_id),
                ).fetchone()
        return self._row_to_summary(updated)

    async def get_seat_usage_summary(self, seat_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM seat_quotas WHERE seat_id = ?", (seat_id,)).fetchone()
        if row is None:
            raise KeyError(seat_id)
        return self._row_to_summary(row)

    async def list_seats_for_agent(self, agent_id: str) -> list[dict[str, Any]]:
        normalized = str(agent_id or "").strip()
        if not normalized:
            return []
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM seat_quotas WHERE agent_id = ? ORDER BY seat_id ASC",
                (normalized,),
            ).fetchall()
        return [self._row_to_summary(row) for row in rows]

    async def list_seats_for_tenant(self, tenant_id: str) -> list[dict[str, Any]]:
        normalized = str(tenant_id or "tenant_main").strip() or "tenant_main"
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM seat_quotas WHERE tenant_id = ? ORDER BY seat_id ASC",
                (normalized,),
            ).fetchall()
        return [self._row_to_summary(row) for row in rows]

    async def get_tenant_usage_summary(self, tenant_id: str, seat_ids: list[str] | None = None) -> dict[str, Any]:
        seats = await self.list_seats_for_tenant(tenant_id)
        if seat_ids:
            seat_set = {str(item).strip() for item in seat_ids if str(item).strip()}
            seats = [seat for seat in seats if seat["seat_id"] in seat_set]
        totals: dict[str, dict[str, Any]] = {}
        for resource in SEAT_DEFAULT_QUOTAS:
            totals[resource] = {"limit": 0, "used": 0, "usage_pct": 0.0}
        for seat in seats:
            for resource, quota in seat["quotas"].items():
                totals[resource]["limit"] += int(quota["limit"])
                totals[resource]["used"] += int(quota["used"])
        for resource, total in totals.items():
            limit = max(1, int(total["limit"] or 0))
            total["usage_pct"] = round((int(total["used"] or 0) / limit) * 100, 1) if total["limit"] else 0.0
        return {
            "tenant_id": str(tenant_id or "tenant_main").strip() or "tenant_main",
            "seat_count": len(seats),
            "quotas": totals,
            "overall_health": self._calc_overall_health(totals),
            "seats": seats,
        }

    def _calc_overall_health(self, totals: dict[str, dict[str, Any]]) -> str:
        highest = max((float(item.get("usage_pct") or 0.0) for item in totals.values()), default=0.0)
        if highest >= 95:
            return "red"
        if highest >= 75:
            return "yellow"
        return "green"

    def _row_to_summary(self, row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
        payload = dict(row)
        quotas: dict[str, dict[str, Any]] = {}
        for resource in SEAT_DEFAULT_QUOTAS:
            limit = int(payload.get(f"{resource}_limit", 0) or 0)
            used = int(payload.get(f"{resource}_used", 0) or 0)
            quotas[resource] = {
                "limit": limit,
                "used": used,
                "remaining": max(0, limit - used),
                "usage_pct": round((used / max(1, limit)) * 100, 1) if limit else 0.0,
            }
        return {
            "seat_id": str(payload.get("seat_id") or ""),
            "tenant_id": str(payload.get("tenant_id") or ""),
            "agent_id": str(payload.get("agent_id") or ""),
            "seat_name": str(payload.get("seat_name") or ""),
            "platform": str(payload.get("platform") or ""),
            "account_username": str(payload.get("account_username") or ""),
            "client_name": str(payload.get("client_name") or ""),
            "seat_status": str(payload.get("seat_status") or "active"),
            "updated_at": str(payload.get("updated_at") or ""),
            "quotas": quotas,
            "overall_health": self._calc_overall_health(quotas),
        }


_tracker: SeatQuotaTracker | None = None


def get_seat_quota_tracker() -> SeatQuotaTracker:
    global _tracker
    if _tracker is None:
        _tracker = SeatQuotaTracker()
    return _tracker
