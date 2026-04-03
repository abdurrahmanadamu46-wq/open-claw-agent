"""
LobeHub-inspired context engine for lobster runtime.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class ContextItem:
    content: str
    source: str
    relevance_score: float
    priority: int
    token_count: int
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ContextBudget:
    max_total_tokens: int = 8000
    task_prompt_reserve: int = 1000
    output_reserve: int = 2000

    @property
    def context_budget(self) -> int:
        return max(500, self.max_total_tokens - self.task_prompt_reserve - self.output_reserve)


@dataclass(slots=True)
class ContextBuildResult:
    context_text: str
    selected_items: list[ContextItem]
    selected_history_indexes: list[int]
    used_tokens: int
    omitted_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "context_text": self.context_text,
            "selected_items": [item.to_dict() for item in self.selected_items],
            "selected_history_indexes": list(self.selected_history_indexes),
            "used_tokens": self.used_tokens,
            "omitted_count": self.omitted_count,
        }


class LobsterContextEngine:
    def __init__(self, budget: ContextBudget | None = None) -> None:
        self.budget = budget or ContextBudget()

    def build_context(
        self,
        *,
        task: str,
        lead_profile: dict[str, Any] | None = None,
        conversation_history: list[dict[str, Any]] | None = None,
        skill_docs: list[dict[str, Any]] | None = None,
        knowledge_snippets: list[dict[str, Any]] | None = None,
    ) -> ContextBuildResult:
        candidates: list[ContextItem] = []
        history = list(conversation_history or [])
        selected_history_indexes: list[int] = []

        profile_summary = self._summarize_profile(lead_profile or {})
        if profile_summary:
            candidates.append(
                ContextItem(
                    content=profile_summary,
                    source="lead_profile",
                    relevance_score=0.95,
                    priority=1,
                    token_count=self._estimate_tokens(profile_summary),
                )
            )

        for idx, msg in enumerate(history):
            content = str(msg.get("content") or "").strip()
            if not content:
                continue
            role = str(msg.get("role") or "user")
            rendered = f"[{role}] {content[:300]}"
            score = self._compute_relevance(task, content)
            recency_bonus = max(0.0, 0.25 - (len(history) - idx - 1) * 0.03)
            final_score = min(1.0, score + recency_bonus)
            candidates.append(
                ContextItem(
                    content=rendered,
                    source="history",
                    relevance_score=final_score,
                    priority=2,
                    token_count=self._estimate_tokens(rendered),
                    metadata={"history_index": idx},
                )
            )

        for skill in skill_docs or []:
            content = str(skill.get("content") or skill.get("description") or "").strip()
            if not content:
                continue
            rendered = f"[skill:{skill.get('id') or skill.get('name')}] {content[:400]}"
            candidates.append(
                ContextItem(
                    content=rendered,
                    source="skill",
                    relevance_score=self._compute_relevance(task, content),
                    priority=3,
                    token_count=self._estimate_tokens(rendered),
                    metadata={"skill_id": str(skill.get("id") or "")},
                )
            )

        for snippet in knowledge_snippets or []:
            content = str(snippet.get("content") or "").strip()
            if not content:
                continue
            score = self._compute_relevance(task, content)
            if score < 0.15:
                continue
            rendered = f"[knowledge:{snippet.get('kb_name') or snippet.get('kb_id') or 'kb'}] {content[:280]}"
            candidates.append(
                ContextItem(
                    content=rendered,
                    source="knowledge",
                    relevance_score=score,
                    priority=4,
                    token_count=self._estimate_tokens(rendered),
                    metadata={"kb_id": str(snippet.get("kb_id") or "")},
                )
            )

        selected = self._greedy_fill(candidates, self.budget.context_budget)
        for item in selected:
            if item.source == "history" and "history_index" in item.metadata:
                selected_history_indexes.append(int(item.metadata["history_index"]))
        selected_history_indexes = sorted(set(selected_history_indexes))
        return ContextBuildResult(
            context_text=self._format_context(selected),
            selected_items=selected,
            selected_history_indexes=selected_history_indexes,
            used_tokens=sum(item.token_count for item in selected),
            omitted_count=max(0, len(candidates) - len(selected)),
        )

    def _greedy_fill(self, candidates: list[ContextItem], budget: int) -> list[ContextItem]:
        sorted_candidates = sorted(
            candidates,
            key=lambda item: (item.priority, -item.relevance_score, item.token_count),
        )
        selected: list[ContextItem] = []
        used = 0
        for item in sorted_candidates:
            if item.token_count <= 0:
                continue
            if used + item.token_count > budget:
                continue
            selected.append(item)
            used += item.token_count
        return selected

    def _format_context(self, items: list[ContextItem]) -> str:
        if not items:
            return ""
        sections: list[str] = []
        grouped: dict[str, list[str]] = {}
        title_map = {
            "lead_profile": "Lead Profile",
            "history": "Relevant History",
            "skill": "Relevant Skills",
            "knowledge": "Knowledge Snippets",
        }
        for item in items:
            grouped.setdefault(item.source, []).append(item.content)
        for source in ("lead_profile", "history", "skill", "knowledge"):
            rows = grouped.get(source) or []
            if not rows:
                continue
            sections.append(f"## {title_map[source]}\n" + "\n".join(f"- {row}" for row in rows))
        return "\n\n".join(sections)

    @staticmethod
    def _summarize_profile(profile: dict[str, Any]) -> str:
        if not isinstance(profile, dict) or not profile:
            return ""
        important_keys = (
            "lead_id",
            "name",
            "company",
            "title",
            "score",
            "grade",
            "intent",
            "channel",
            "city",
            "industry",
            "budget",
            "status",
        )
        rows = []
        for key in important_keys:
            value = profile.get(key)
            if value in (None, "", [], {}):
                continue
            rows.append(f"{key}: {value}")
        return "\n".join(rows)[:500]

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, int(len(str(text or "")) / 4))

    @staticmethod
    def _compute_relevance(task: str, content: str) -> float:
        task_terms = set(_tokenize(task))
        content_terms = set(_tokenize(content))
        if not task_terms or not content_terms:
            return 0.0
        overlap = len(task_terms & content_terms)
        return min(1.0, overlap / max(1, min(len(task_terms), 8)))


def _tokenize(text: str) -> list[str]:
    normalized = re.sub(r"[^\w\u4e00-\u9fff]+", " ", str(text or "").lower())
    tokens = [item for item in normalized.split() if item.strip()]
    if not tokens:
        chars = [ch for ch in str(text or "") if "\u4e00" <= ch <= "\u9fff"]
        return chars[:32]
    return tokens[:64]
