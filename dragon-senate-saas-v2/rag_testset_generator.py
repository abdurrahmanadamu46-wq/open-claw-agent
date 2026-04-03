"""
RAG testset generator inspired by RAGAS.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Callable
from typing import Literal

from dataset_store import get_dataset_store
from enterprise_memory import EnterpriseMemoryBank


logger = logging.getLogger("rag_testset_generator")

QuestionType = Literal["simple", "reasoning", "multi_context"]

QUESTION_TYPE_PROMPTS: dict[QuestionType, str] = {
    "simple": """
基于以下文档片段，生成一个简单直接的问题，答案可以直接从片段中找到。

【文档片段】
{context}

输出 JSON：
{{"question": "...", "ground_truth": "..."}}
""".strip(),
    "reasoning": """
基于以下文档片段，生成一个需要总结、判断或推理的问题。

【文档片段】
{context}

输出 JSON：
{{"question": "...", "ground_truth": "..."}}
""".strip(),
    "multi_context": """
基于以下多个文档片段，生成一个必须综合多个片段才能回答的问题。

【文档片段】
{contexts}

输出 JSON：
{{"question": "...", "ground_truth": "..."}}
""".strip(),
}


@dataclass(slots=True)
class RagTestItem:
    question: str
    ground_truth: str
    reference_contexts: list[str]
    question_type: QuestionType = "simple"
    tenant_id: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dataset_item(self) -> dict[str, Any]:
        return {
            "input": {"question": self.question},
            "expected_output": self.ground_truth,
            "metadata": {
                **self.metadata,
                "reference_contexts": list(self.reference_contexts),
                "ground_truth": self.ground_truth,
                "question_type": self.question_type,
            },
            "tags": ["rag_eval", self.question_type],
        }


class EnterpriseMemoryChunkProvider:
    """Turn enterprise memory/profile data into chunk texts."""

    def __init__(self) -> None:
        self._memory_bank = EnterpriseMemoryBank()

    async def fetch_chunks(self, tenant_id: str, sample_size: int = 150) -> list[str]:
        return await asyncio.to_thread(self._fetch_chunks_sync, tenant_id, sample_size)

    def _fetch_chunks_sync(self, tenant_id: str, sample_size: int = 150) -> list[str]:
        profile = self._memory_bank.load_profile(tenant_id)
        if profile is None:
            return []
        chunks: list[str] = []
        merged = self._memory_bank.get_merged_context(tenant_id)
        if isinstance(merged, dict):
            for key, value in merged.items():
                text = self._value_to_chunk(key, value)
                if text:
                    chunks.append(text)
        for entry in getattr(profile, "memory_entries", []) or []:
            if isinstance(entry, dict):
                text = self._value_to_chunk(str(entry.get("key") or "memory"), entry.get("value"))
                if text:
                    chunks.append(text)
        for campaign in getattr(profile, "growth_history", []) or []:
            if isinstance(campaign, dict):
                text = self._value_to_chunk(str(campaign.get("campaign_name") or "campaign"), campaign)
                if text:
                    chunks.append(text)
        deduped = list(dict.fromkeys(text for text in chunks if text.strip()))
        random.shuffle(deduped)
        return deduped[: max(1, sample_size)]

    def _value_to_chunk(self, key: str, value: Any) -> str:
        if value in (None, "", [], {}):
            return ""
        if isinstance(value, str):
            return f"{key}: {value}".strip()[:2000]
        if isinstance(value, (int, float, bool)):
            return f"{key}: {value}"
        try:
            return f"{key}: {json.dumps(value, ensure_ascii=False)}"[:2000]
        except Exception:
            return f"{key}: {value}"[:2000]


class RagTestsetGenerator:
    """Generate RAG eval datasets from enterprise memory chunks."""

    def __init__(
        self,
        judge_callable: Callable[[str], dict[str, Any] | None],
        *,
        chunk_provider: EnterpriseMemoryChunkProvider | None = None,
        concurrency: int = 6,
    ) -> None:
        self._judge_callable = judge_callable
        self._chunk_provider = chunk_provider or EnterpriseMemoryChunkProvider()
        self._concurrency = max(1, concurrency)

    async def generate(
        self,
        tenant_id: str,
        *,
        test_size: int = 50,
        distributions: dict[QuestionType, float] | None = None,
        save_to_dataset_store: bool = True,
        dataset_name: str | None = None,
    ) -> dict[str, Any]:
        distribution = dict(distributions or {
            "simple": 0.5,
            "reasoning": 0.25,
            "multi_context": 0.25,
        })
        distribution = {
            question_type: float(distribution.get(question_type, 0.0))
            for question_type in ("simple", "reasoning", "multi_context")
        }
        counts = self._build_counts(max(1, test_size), distribution)
        chunks = await self._chunk_provider.fetch_chunks(tenant_id, sample_size=max(30, test_size * 3))
        if not chunks:
            raise ValueError(f"no enterprise memory chunks found for tenant={tenant_id}")

        semaphore = asyncio.Semaphore(self._concurrency)
        tasks: list[asyncio.Task[RagTestItem | None]] = []
        for question_type, count in counts.items():
            for _ in range(count):
                if question_type == "multi_context":
                    selected_chunks = random.sample(chunks, k=min(3, len(chunks)))
                    tasks.append(asyncio.create_task(self._generate_with_semaphore(semaphore, tenant_id, question_type, selected_chunks)))
                else:
                    selected_chunk = random.choice(chunks)
                    tasks.append(asyncio.create_task(self._generate_with_semaphore(semaphore, tenant_id, question_type, [selected_chunk])))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        items: list[RagTestItem] = []
        failures = 0
        for result in results:
            if isinstance(result, RagTestItem):
                items.append(result)
            elif isinstance(result, Exception):
                failures += 1
                logger.warning("[RagTestset] item generation failed: %s", result)
        dataset_id = None
        dataset_label = dataset_name or f"rag_eval_{tenant_id}"
        if save_to_dataset_store and items:
            dataset_id = self._save_to_dataset_store(dataset_label, tenant_id, items)
        return {
            "tenant_id": tenant_id,
            "dataset_name": dataset_label,
            "dataset_id": dataset_id,
            "generated": len(items),
            "failed": failures,
            "question_type_breakdown": {
                "simple": sum(1 for item in items if item.question_type == "simple"),
                "reasoning": sum(1 for item in items if item.question_type == "reasoning"),
                "multi_context": sum(1 for item in items if item.question_type == "multi_context"),
            },
            "items": [item.to_dataset_item() for item in items],
        }

    async def _generate_with_semaphore(
        self,
        semaphore: asyncio.Semaphore,
        tenant_id: str,
        question_type: QuestionType,
        contexts: list[str],
    ) -> RagTestItem | None:
        async with semaphore:
            if question_type == "multi_context":
                return await self._generate_multi_context_item(tenant_id, contexts)
            return await self._generate_single_item(tenant_id, question_type, contexts[0])

    def _build_counts(
        self,
        test_size: int,
        distribution: dict[QuestionType, float],
    ) -> dict[QuestionType, int]:
        raw_counts = {
            question_type: max(1, int(math.floor(test_size * max(0.0, float(ratio)))))
            for question_type, ratio in distribution.items()
        }
        while sum(raw_counts.values()) > test_size:
            largest_key = max(raw_counts, key=raw_counts.get)
            if raw_counts[largest_key] <= 1:
                break
            raw_counts[largest_key] -= 1
        while sum(raw_counts.values()) < test_size:
            largest_ratio_key = max(distribution, key=distribution.get)
            raw_counts[largest_ratio_key] += 1
        return raw_counts

    async def _generate_single_item(
        self,
        tenant_id: str,
        question_type: QuestionType,
        chunk: str,
    ) -> RagTestItem:
        prompt = QUESTION_TYPE_PROMPTS[question_type].format(context=chunk[:1800])
        payload = await asyncio.to_thread(self._judge_callable, prompt)
        if not isinstance(payload, dict):
            raise RuntimeError("invalid generation payload")
        question = str(payload.get("question") or "").strip()
        ground_truth = str(payload.get("ground_truth") or "").strip()
        if not question or not ground_truth:
            raise RuntimeError("missing generated question or ground_truth")
        return RagTestItem(
            question=question,
            ground_truth=ground_truth,
            reference_contexts=[chunk],
            question_type=question_type,
            tenant_id=tenant_id,
        )

    async def _generate_multi_context_item(
        self,
        tenant_id: str,
        chunks: list[str],
    ) -> RagTestItem:
        prompt = QUESTION_TYPE_PROMPTS["multi_context"].format(
            contexts="\n\n---\n\n".join(chunk[:900] for chunk in chunks),
        )
        payload = await asyncio.to_thread(self._judge_callable, prompt)
        if not isinstance(payload, dict):
            raise RuntimeError("invalid multi_context generation payload")
        question = str(payload.get("question") or "").strip()
        ground_truth = str(payload.get("ground_truth") or "").strip()
        if not question or not ground_truth:
            raise RuntimeError("missing generated question or ground_truth")
        return RagTestItem(
            question=question,
            ground_truth=ground_truth,
            reference_contexts=list(chunks),
            question_type="multi_context",
            tenant_id=tenant_id,
        )

    def _save_to_dataset_store(self, dataset_name: str, tenant_id: str, items: list[RagTestItem]) -> str:
        store = get_dataset_store()
        dataset_id = store.create_dataset(
            dataset_name,
            description="RAG eval testset generated from enterprise memory",
            lobster="commander",
            skill="rag_eval",
            tenant_id=tenant_id,
        )
        for item in items:
            dataset_item = item.to_dataset_item()
            store.add_item(
                dataset_name=dataset_name,
                input=dataset_item["input"],
                expected_output=dataset_item["expected_output"],
                tags=dataset_item["tags"],
                metadata=dataset_item["metadata"],
                quality_score=1.0,
            )
        return dataset_id
