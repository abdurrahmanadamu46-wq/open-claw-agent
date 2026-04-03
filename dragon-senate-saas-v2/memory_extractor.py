"""
Automatic fact extraction and merge flow inspired by mem0.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from memory_conflict_resolver import (
    ExistingMemory,
    MemoryAction,
    MemoryConflictResolver,
    MemoryDecision,
    build_memory_key,
    classify_fact_category,
)

logger = logging.getLogger("memory_extractor")


FACT_EXTRACTION_PROMPT = """
你是一个专业的信息提取助手。从以下对话中提取适合长期记忆的关键事实。

对话内容：
{messages}

提取规则：
1. 只提取对后续客户跟进有价值的客观事实。
2. 不提取系统提示、礼貌寒暄、空泛评价。
3. 每条事实控制在30字内。
4. 输出 JSON：{{"facts":[{{"fact":"...", "category":"budget|company|title|preference|status|goal|info", "confidence":0.0}}]}}
"""


@dataclass(slots=True)
class ExtractedFact:
    fact: str
    category: str
    confidence: float = 1.0
    source: str = "llm"


@dataclass(slots=True)
class MemoryExtractionResult:
    tenant_id: str
    lobster_id: str
    task_id: str
    extracted_facts: list[ExtractedFact] = field(default_factory=list)
    decisions: list[MemoryDecision] = field(default_factory=list)
    added: int = 0
    updated: int = 0
    skipped: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "lobster_id": self.lobster_id,
            "task_id": self.task_id,
            "extracted_facts": [
                {
                    "fact": item.fact,
                    "category": item.category,
                    "confidence": item.confidence,
                    "source": item.source,
                }
                for item in self.extracted_facts
            ],
            "decisions": [
                {
                    "action": item.action.value,
                    "fact": item.fact,
                    "category": item.category,
                    "memory_id": item.memory_id,
                    "key": item.key,
                    "reason": item.reason,
                }
                for item in self.decisions
            ],
            "added": self.added,
            "updated": self.updated,
            "skipped": self.skipped,
        }


class MemoryExtractor:
    def __init__(
        self,
        llm_call_fn: Callable[[str, int], Awaitable[str]] | None = None,
        resolver: MemoryConflictResolver | None = None,
    ) -> None:
        self._llm_call_fn = llm_call_fn
        self._resolver = resolver or MemoryConflictResolver()

    async def extract_and_merge(
        self,
        *,
        bank: Any,
        tenant_id: str,
        lobster_id: str,
        task_id: str,
        conversation_text: str,
        session_id: str = "",
        lead_id: str = "",
    ) -> MemoryExtractionResult:
        facts = await self.extract_facts(conversation_text)
        existing_rows = bank.list_memory_entries(tenant_id)
        existing = [
            ExistingMemory(
                memory_id=str(item.get("memory_id") or item.get("id") or ""),
                key=str(item.get("key") or ""),
                value=str(item.get("value") or ""),
                category=str(item.get("category") or "info"),
                metadata=dict(item.get("metadata") or {}),
            )
            for item in existing_rows
        ]
        result = MemoryExtractionResult(
            tenant_id=tenant_id,
            lobster_id=lobster_id,
            task_id=task_id,
            extracted_facts=facts,
        )

        for fact in facts:
            decision = self._resolver.decide(
                fact=fact.fact,
                category=fact.category,
                existing_memories=existing,
            )
            if not decision.key:
                decision.key = build_memory_key(fact.category, fact.fact)
            result.decisions.append(decision)

            metadata = {
                "source": "memory_extractor",
                "source_lobster": lobster_id,
                "source_task_id": task_id,
                "lead_id": lead_id,
                "session_id": session_id,
                "confidence": fact.confidence,
                "category": fact.category,
            }
            if decision.action == MemoryAction.ADD:
                memory_id = bank.upsert_memory_entry(
                    tenant_id=tenant_id,
                    key=str(decision.key or ""),
                    value=fact.fact,
                    category=fact.category,
                    metadata=metadata,
                )
                existing.append(
                    ExistingMemory(
                        memory_id=str(memory_id),
                        key=str(decision.key or ""),
                        value=fact.fact,
                        category=fact.category,
                        metadata=metadata,
                    )
                )
                result.added += 1
            elif decision.action == MemoryAction.UPDATE:
                memory_id = bank.upsert_memory_entry(
                    tenant_id=tenant_id,
                    key=str(decision.key or ""),
                    value=fact.fact,
                    category=fact.category,
                    metadata=metadata,
                    memory_id=decision.memory_id,
                )
                for item in existing:
                    if item.memory_id == decision.memory_id or item.key == decision.key:
                        item.value = fact.fact
                        item.key = str(decision.key or item.key)
                        item.category = fact.category
                        item.metadata = metadata
                        item.memory_id = str(memory_id)
                result.updated += 1
            else:
                result.skipped += 1

        return result

    async def extract_facts(self, conversation_text: str) -> list[ExtractedFact]:
        text = str(conversation_text or "").strip()
        if not text:
            return []
        if self._llm_call_fn is not None:
            try:
                prompt = FACT_EXTRACTION_PROMPT.format(messages=text[:6000])
                raw = await self._llm_call_fn(prompt, 1200)
                parsed = self._parse_llm_response(raw)
                if parsed:
                    return parsed[:8]
            except Exception as exc:
                logger.warning("MemoryExtractor llm extraction failed, fallback to heuristic: %s", exc)
        return self._heuristic_extract(text)

    def _parse_llm_response(self, raw: str) -> list[ExtractedFact]:
        obj_match = re.search(r"\{.*\}", str(raw or ""), re.DOTALL)
        if not obj_match:
            return []
        payload = json.loads(obj_match.group(0))
        items = payload.get("facts", [])
        results: list[ExtractedFact] = []
        if not isinstance(items, list):
            return results
        for item in items:
            if not isinstance(item, dict):
                continue
            fact = str(item.get("fact") or "").strip()
            if not fact:
                continue
            category = str(item.get("category") or classify_fact_category(fact)).strip() or "info"
            try:
                confidence = float(item.get("confidence", 1.0) or 1.0)
            except Exception:
                confidence = 1.0
            results.append(
                ExtractedFact(
                    fact=fact[:80],
                    category=category,
                    confidence=max(0.0, min(confidence, 1.0)),
                    source="llm",
                )
            )
        return self._dedupe_facts(results)

    def _heuristic_extract(self, text: str) -> list[ExtractedFact]:
        lines = [line.strip(" -•\t") for line in text.splitlines() if line.strip()]
        fragments = [piece.strip(" -•\t") for piece in re.split(r"[。！？；;\n]", text) if piece.strip()]
        facts: list[ExtractedFact] = []
        interesting_tokens = ("预算", "公司", "科技", "集团", "CEO", "经理", "总监", "偏好", "喜欢", "不接受", "进入", "完成", "目标", "计划")
        for line in [*lines, *fragments]:
            if line.startswith("## ") or line.startswith("# "):
                continue
            if any(mark in line for mark in ("。", "！", "？", "；")):
                continue
            if len(line) < 4 or len(line) > 80:
                continue
            if not any(token.lower() in line.lower() for token in interesting_tokens):
                continue
            facts.append(
                ExtractedFact(
                    fact=line[:80],
                    category=classify_fact_category(line),
                    confidence=0.65,
                    source="heuristic",
                )
            )
        if not facts:
            for piece in fragments:
                if len(piece) < 4 or len(piece) > 50:
                    continue
                if any(token in piece for token in ("预算", "目标", "偏好", "公司", "职位", "科技", "推荐")):
                    facts.append(
                        ExtractedFact(
                            fact=piece,
                            category=classify_fact_category(piece),
                            confidence=0.55,
                            source="heuristic",
                        )
                    )
        return self._dedupe_facts(facts)[:8]

    def _dedupe_facts(self, items: list[ExtractedFact]) -> list[ExtractedFact]:
        seen: set[str] = set()
        result: list[ExtractedFact] = []
        for item in items:
            digest = uuid.uuid5(uuid.NAMESPACE_DNS, f"{item.category}:{item.fact.strip().lower()}").hex
            if digest in seen:
                continue
            seen.add(digest)
            result.append(item)
        return result
