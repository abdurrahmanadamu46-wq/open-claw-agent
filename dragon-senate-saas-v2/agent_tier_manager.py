from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from saas_pricing_model import FLOOR_PRICE, get_seat_total_price, get_seat_unit_price


@dataclass(frozen=True)
class AgentTierRule:
    code: str
    name: str
    min_seats: int
    max_seats: int | None
    suggested_resell_unit_price: int

    def matches(self, seat_count: int) -> bool:
        if seat_count < self.min_seats:
            return False
        if self.max_seats is None:
            return True
        return seat_count <= self.max_seats


AGENT_TIER_RULES: list[AgentTierRule] = [
    AgentTierRule("starter_agent", "起步代理", 20, 49, 4_800),
    AgentTierRule("regional_agent", "区域代理", 50, 99, 3_800),
    AgentTierRule("provincial_agent", "省级代理", 100, 299, 3_800),
    AgentTierRule("master_agent", "总代理", 300, None, 2_980),
]


class AgentTierManager:
    """Seat-based reseller tier resolver derived from V7 pricing rules."""

    def get_agent_tier(self, seat_count: int) -> dict[str, Any]:
        normalized = max(0, int(seat_count or 0))
        for rule in AGENT_TIER_RULES:
            if rule.matches(normalized):
                unit_price = get_seat_unit_price(normalized)
                return {
                    "code": rule.code,
                    "name": rule.name,
                    "seat_count": normalized,
                    "min_seats": rule.min_seats,
                    "max_seats": rule.max_seats,
                    "unit_purchase_price": unit_price,
                    "floor_price": FLOOR_PRICE,
                    "suggested_resell_unit_price": max(rule.suggested_resell_unit_price, FLOOR_PRICE),
                    "pricing": get_seat_total_price(normalized, billing_cycle="monthly"),
                }
        return {
            "code": "direct",
            "name": "直签客户",
            "seat_count": normalized,
            "min_seats": 0,
            "max_seats": 19,
            "unit_purchase_price": get_seat_unit_price(max(1, normalized or 1)),
            "floor_price": FLOOR_PRICE,
            "suggested_resell_unit_price": None,
            "pricing": get_seat_total_price(max(1, normalized or 1), billing_cycle="monthly"),
        }

    def check_tier_upgrade(self, agent_id: str, *, old_seats: int, new_seats: int) -> dict[str, Any]:
        before = self.get_agent_tier(old_seats)
        after = self.get_agent_tier(new_seats)
        upgraded = before["code"] != after["code"]
        return {
            "agent_id": agent_id,
            "upgraded": upgraded,
            "downgraded": False if upgraded else int(new_seats or 0) < int(old_seats or 0),
            "from_tier": before["name"],
            "to_tier": after["name"],
            "old_seats": int(old_seats or 0),
            "new_seats": int(new_seats or 0),
            "old_unit_price": before["unit_purchase_price"],
            "new_unit_price": after["unit_purchase_price"],
            "floor_price": FLOOR_PRICE,
            "suggested_resell_unit_price": after["suggested_resell_unit_price"],
        }

    def validate_floor_price(self, unit_price: int) -> bool:
        return int(unit_price or 0) >= FLOOR_PRICE


_manager: AgentTierManager | None = None


def get_agent_tier_manager() -> AgentTierManager:
    global _manager
    if _manager is None:
        _manager = AgentTierManager()
    return _manager
