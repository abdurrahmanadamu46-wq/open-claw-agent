from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from regional_agent_system import get_regional_agent_manager
from saas_pricing_model import FLOOR_PRICE, PlatformCostModelV7, get_seat_unit_price
from seat_quota_tracker import get_seat_quota_tracker


class SettlementStatus(str, Enum):
    PENDING = "pending"
    CALCULATED = "calculated"
    CONFIRMED = "confirmed"
    PAID = "paid"
    DISPUTED = "disputed"


@dataclass(slots=True)
class MonthlyStatement:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str = ""
    period: str = ""
    seats_purchased: int = 0
    seats_active: int = 0
    purchase_unit_price: int = 0
    total_purchase_cost: int = 0
    resell_unit_price: int = 0
    total_resell_revenue: int = 0
    gross_profit: int = 0
    ops_cost_estimate: int = 0
    net_profit: int = 0
    gross_margin_pct: float = 0.0
    bonus_seats_threshold: int = 0
    bonus_achieved: bool = False
    bonus_discount: float = 0.0
    bonus_description: str = ""
    status: SettlementStatus = SettlementStatus.PENDING
    calculated_at: str | None = None
    confirmed_at: str | None = None
    disputed_at: str | None = None
    dispute_reason: str | None = None
    agent_confirmed_by: str | None = None
    invoice_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["status"] = self.status.value
        return payload


@dataclass(slots=True)
class CommissionTier:
    achievement_rate: float
    next_quarter_discount: float
    bonus_label: str


COMMISSION_TIERS = [
    CommissionTier(achievement_rate=1.5, next_quarter_discount=0.10, bonus_label="超额50%+：下季度采购价再降10%"),
    CommissionTier(achievement_rate=1.3, next_quarter_discount=0.07, bonus_label="超额30%+：下季度采购价再降7%"),
    CommissionTier(achievement_rate=1.1, next_quarter_discount=0.05, bonus_label="超额10%+：下季度采购价再降5%"),
]


class AgentCommissionService:
    def __init__(self, db_path: str = "./data/agent_commission.sqlite") -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = (Path(__file__).resolve().parent / self._db_path).resolve()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        self._agent_manager = get_regional_agent_manager()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS monthly_statements (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    period TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(agent_id, period)
                );
                CREATE INDEX IF NOT EXISTS idx_monthly_statements_agent ON monthly_statements(agent_id, period DESC);
                CREATE TABLE IF NOT EXISTS quarterly_targets (
                    agent_id TEXT NOT NULL,
                    quarter TEXT NOT NULL,
                    target_seats INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(agent_id, quarter)
                );
                """
            )
            conn.commit()

    @staticmethod
    def _utc_now() -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    def _default_period(cls) -> str:
        last_month = cls._utc_now().replace(day=1) - timedelta(days=1)
        return last_month.strftime("%Y-%m")

    @staticmethod
    def _get_quarter(period: str) -> str:
        year, month = map(int, str(period).split("-"))
        quarter = (month - 1) // 3 + 1
        return f"{year}-Q{quarter}"

    async def calculate_monthly_statement(self, agent_id: str, period: str | None = None) -> MonthlyStatement:
        statement_period = period or self._default_period()
        agent = self._agent_manager._agents.get(agent_id)  # noqa: SLF001
        if agent is None:
            raise KeyError(agent_id)
        seats = int(agent.purchased_seat_count or max(20, agent.active_client_count))
        purchase_price = get_seat_unit_price(seats)
        resell_price = self._get_resell_price(seats)
        active_seats = await self._count_active_seats(agent_id, statement_period)
        total_purchase = purchase_price * seats
        total_resell = resell_price * active_seats
        gross_profit = total_resell - total_purchase
        ops_cost = max(20_000, seats * 600)
        net_profit = gross_profit - ops_cost
        gross_margin = round(gross_profit / total_resell * 100, 1) if total_resell else 0.0
        quarterly_target = await self._get_quarterly_target(agent_id, statement_period)
        bonus_info = self._calc_bonus(seats, quarterly_target)
        stmt = MonthlyStatement(
            agent_id=agent_id,
            period=statement_period,
            seats_purchased=seats,
            seats_active=active_seats,
            purchase_unit_price=purchase_price,
            total_purchase_cost=total_purchase,
            resell_unit_price=resell_price,
            total_resell_revenue=total_resell,
            gross_profit=gross_profit,
            ops_cost_estimate=ops_cost,
            net_profit=net_profit,
            gross_margin_pct=gross_margin,
            bonus_seats_threshold=quarterly_target,
            bonus_achieved=bool(bonus_info.get("achieved")),
            bonus_discount=float(bonus_info.get("discount") or 0.0),
            bonus_description=str(bonus_info.get("description") or ""),
            status=SettlementStatus.CALCULATED,
            calculated_at=self._utc_now().isoformat(),
        )
        self._upsert_statement(stmt)
        return stmt

    async def batch_calculate_all_agents(self, period: str | None = None) -> dict[str, Any]:
        result = {"success": [], "failed": []}
        for agent_id, agent in self._agent_manager._agents.items():  # noqa: SLF001
            if str(agent.status or "").lower() not in {"active", "pending_deposit"}:
                continue
            try:
                stmt = await self.calculate_monthly_statement(agent_id, period)
                result["success"].append({"agent_id": agent_id, "period": stmt.period, "net_profit": stmt.net_profit})
            except Exception as exc:
                result["failed"].append({"agent_id": agent_id, "error": str(exc)})
        return result

    async def agent_confirm_statement(self, agent_id: str, period: str, confirmed_by: str) -> dict[str, Any]:
        stmt = self.get_statement(agent_id, period)
        if stmt is None:
            raise KeyError(f"{agent_id}:{period}")
        if stmt.status == SettlementStatus.CONFIRMED:
            raise ValueError("statement_already_confirmed")
        if stmt.bonus_achieved:
            await self._apply_next_quarter_discount(agent_id, stmt)
        stmt.status = SettlementStatus.CONFIRMED
        stmt.confirmed_at = self._utc_now().isoformat()
        stmt.agent_confirmed_by = confirmed_by
        stmt.invoice_url = self._generate_invoice(agent_id, stmt)
        self._upsert_statement(stmt)
        return stmt.to_dict()

    async def dispute_statement(self, agent_id: str, period: str, reason: str) -> dict[str, Any]:
        stmt = self.get_statement(agent_id, period)
        if stmt is None:
            raise KeyError(f"{agent_id}:{period}")
        stmt.status = SettlementStatus.DISPUTED
        stmt.disputed_at = self._utc_now().isoformat()
        stmt.dispute_reason = str(reason or "").strip()[:1000]
        self._upsert_statement(stmt)
        return stmt.to_dict()

    def list_statements(self, agent_id: str, limit: int = 24) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT payload_json FROM monthly_statements WHERE agent_id = ? ORDER BY period DESC LIMIT ?",
                (agent_id, max(1, min(int(limit or 24), 240))),
            ).fetchall()
        return [json.loads(str(row["payload_json"] or "{}")) for row in rows]

    def get_statement(self, agent_id: str, period: str) -> MonthlyStatement | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM monthly_statements WHERE agent_id = ? AND period = ?",
                (agent_id, period),
            ).fetchone()
        if row is None:
            return None
        payload = json.loads(str(row["payload_json"] or "{}"))
        payload["status"] = SettlementStatus(str(payload.get("status") or "pending"))
        return MonthlyStatement(**payload)

    async def profit_forecast(self, agent_id: str) -> dict[str, Any]:
        agent = self._agent_manager._agents.get(agent_id)  # noqa: SLF001
        if agent is None:
            raise KeyError(agent_id)
        return PlatformCostModelV7().reseller_roi_analysis(int(agent.purchased_seat_count or 20))

    def set_quarterly_target(self, agent_id: str, quarter: str, target_seats: int) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO quarterly_targets(agent_id, quarter, target_seats)
                VALUES (?, ?, ?)
                ON CONFLICT(agent_id, quarter) DO UPDATE SET target_seats = excluded.target_seats
                """,
                (agent_id, quarter, max(0, int(target_seats or 0))),
            )
            conn.commit()

    async def _count_active_seats(self, agent_id: str, period: str) -> int:
        seats = await get_seat_quota_tracker().list_seats_for_agent(agent_id)
        month_prefix = str(period or "").strip()
        active = 0
        for seat in seats:
            updated_at = str(seat.get("updated_at") or "")
            if updated_at.startswith(month_prefix):
                active += 1
        return active or len(seats)

    async def _get_quarterly_target(self, agent_id: str, period: str) -> int:
        quarter = self._get_quarter(period)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT target_seats FROM quarterly_targets WHERE agent_id = ? AND quarter = ?",
                (agent_id, quarter),
            ).fetchone()
        return int(row["target_seats"] or 0) if row else 0

    @staticmethod
    def _get_resell_price(seat_count: int) -> int:
        if seat_count >= 300:
            return 2_980
        if seat_count >= 100:
            return 3_800
        if seat_count >= 50:
            return 3_800
        return 4_800

    @staticmethod
    def _calc_bonus(seats: int, quarterly_target: int) -> dict[str, Any]:
        if quarterly_target <= 0:
            return {"achieved": False, "description": ""}
        rate = seats / quarterly_target
        for tier in COMMISSION_TIERS:
            if rate >= tier.achievement_rate:
                return {
                    "achieved": True,
                    "achievement_rate": round(rate, 2),
                    "discount": tier.next_quarter_discount,
                    "description": tier.bonus_label,
                }
        return {"achieved": False, "description": ""}

    async def _apply_next_quarter_discount(self, agent_id: str, stmt: MonthlyStatement) -> None:
        agent = self._agent_manager._agents.get(agent_id)  # noqa: SLF001
        if agent is None:
            return
        current_price = int(agent.unit_purchase_price or get_seat_unit_price(agent.purchased_seat_count or 20))
        discount = float(stmt.bonus_discount or 0.0)
        new_price = max(int(current_price * (1 - discount)), FLOOR_PRICE)
        agent.unit_purchase_price = new_price
        agent.updated_at = datetime.now().isoformat()
        self._agent_manager._save()  # noqa: SLF001

    @staticmethod
    def _generate_invoice(agent_id: str, stmt: MonthlyStatement) -> str:
        return f"https://invoice.dragonsaas.cn/{agent_id}/{stmt.period}.pdf"

    def _upsert_statement(self, stmt: MonthlyStatement) -> None:
        payload = stmt.to_dict()
        now = self._utc_now().isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO monthly_statements(id, agent_id, period, payload_json, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_id, period) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (
                    payload["id"],
                    payload["agent_id"],
                    payload["period"],
                    json.dumps(payload, ensure_ascii=False),
                    payload["status"],
                    payload.get("calculated_at") or now,
                    now,
                ),
            )
            conn.commit()


async def monthly_settlement_cron() -> dict[str, Any]:
    service = AgentCommissionService()
    return await service.batch_calculate_all_agents()


_service: AgentCommissionService | None = None


def get_agent_commission_service() -> AgentCommissionService:
    global _service
    if _service is None:
        _service = AgentCommissionService()
    return _service
