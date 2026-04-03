"""
Memory conflict resolver inspired by mem0's ADD/UPDATE/DELETE/NONE flow.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Any


class MemoryAction(str, Enum):
    ADD = "ADD"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    NONE = "NONE"


@dataclass(slots=True)
class MemoryDecision:
    action: MemoryAction
    fact: str
    category: str
    memory_id: str | None = None
    key: str | None = None
    reason: str = ""


@dataclass(slots=True)
class ExistingMemory:
    memory_id: str
    key: str
    value: str
    category: str
    metadata: dict[str, Any]


_BUDGET_RE = re.compile(r"预算[\s:：]*([0-9]+(?:\.[0-9]+)?(?:万|w|W|k|K|元)?)")
_TITLE_RE = re.compile(r"(CEO|cto|cfo|coo|顾问|经理|总监|老板|创始人|负责人|老师|医生)", re.IGNORECASE)
_STATUS_HINTS = ("已", "进入", "完成", "暂停", "停止", "改为", "更新为", "变更为")


def build_memory_key(category: str, fact: str) -> str:
    normalized = re.sub(r"\s+", " ", str(fact or "").strip())
    lowered = normalized.lower()
    if category == "budget":
        return "customer_budget"
    if category == "title":
        return "customer_title"
    if category == "company":
        return "customer_company"
    if category == "preference":
        return f"preference_{uuid.uuid5(uuid.NAMESPACE_DNS, lowered).hex[:10]}"
    if category == "status":
        return f"status_{uuid.uuid5(uuid.NAMESPACE_DNS, lowered).hex[:10]}"
    return f"{category}_{uuid.uuid5(uuid.NAMESPACE_DNS, lowered).hex[:10]}"


class MemoryConflictResolver:
    """
    Lightweight conflict resolver with deterministic heuristics.
    """

    def decide(
        self,
        *,
        fact: str,
        category: str,
        existing_memories: list[ExistingMemory],
    ) -> MemoryDecision:
        normalized_fact = str(fact or "").strip()
        if not normalized_fact:
            return MemoryDecision(
                action=MemoryAction.NONE,
                fact="",
                category=category,
                reason="empty_fact",
            )

        candidate_key = build_memory_key(category, normalized_fact)
        same_category = [item for item in existing_memories if item.category == category]
        same_key = [item for item in same_category if item.key == candidate_key]

        for item in same_key:
            if self._normalize_text(item.value) == self._normalize_text(normalized_fact):
                return MemoryDecision(
                    action=MemoryAction.NONE,
                    fact=normalized_fact,
                    category=category,
                    memory_id=item.memory_id,
                    key=item.key,
                    reason="duplicate_fact",
                )

        conflict = self._find_conflict(normalized_fact, category, same_category)
        if conflict is not None:
            return MemoryDecision(
                action=MemoryAction.UPDATE,
                fact=normalized_fact,
                category=category,
                memory_id=conflict.memory_id,
                key=conflict.key,
                reason="existing_memory_conflict",
            )

        return MemoryDecision(
            action=MemoryAction.ADD,
            fact=normalized_fact,
            category=category,
            key=candidate_key,
            reason="new_fact",
        )

    def _find_conflict(
        self,
        fact: str,
        category: str,
        same_category: list[ExistingMemory],
    ) -> ExistingMemory | None:
        if category == "budget":
            incoming = _extract_budget(fact)
            if incoming is None:
                return None
            for item in same_category:
                current = _extract_budget(item.value)
                if current is not None and current != incoming:
                    return item
            return same_category[0] if same_category else None

        if category in {"title", "company"}:
            for item in same_category:
                if self._normalize_text(item.value) != self._normalize_text(fact):
                    return item
            return same_category[0] if same_category else None

        if category == "status":
            for item in same_category:
                if any(hint in fact for hint in _STATUS_HINTS) and self._normalize_text(item.value) != self._normalize_text(fact):
                    return item
        return None

    @staticmethod
    def _normalize_text(text: str) -> str:
        return re.sub(r"\s+", "", str(text or "").strip().lower())


def classify_fact_category(fact: str) -> str:
    text = str(fact or "").strip()
    lowered = text.lower()
    if _BUDGET_RE.search(text):
        return "budget"
    if "公司" in text or "科技" in text or "集团" in text or "工作室" in text:
        return "company"
    if _TITLE_RE.search(text):
        return "title"
    if any(token in lowered for token in ("偏好", "喜欢", "不接受", "更愿意", "邮件沟通", "电话")):
        return "preference"
    if any(token in text for token in _STATUS_HINTS):
        return "status"
    if any(token in lowered for token in ("目标", "计划", "想要", "希望")):
        return "goal"
    return "info"


def _extract_budget(text: str) -> float | None:
    match = _BUDGET_RE.search(str(text or ""))
    if not match:
        return None
    raw = match.group(1)
    try:
        if raw.lower().endswith(("万", "w")):
            return float(raw[:-1]) * 10000
        if raw.lower().endswith("k"):
            return float(raw[:-1]) * 1000
        if raw.endswith("元"):
            return float(raw[:-1])
        return float(raw)
    except Exception:
        return None
