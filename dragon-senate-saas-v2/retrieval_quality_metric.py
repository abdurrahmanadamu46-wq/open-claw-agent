"""
Retrieval quality metrics inspired by RAGAS context precision/recall.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any
from typing import Callable


logger = logging.getLogger("retrieval_quality_metric")

CONTEXT_PRECISION_PROMPT = """
判断以下召回上下文中，每个片段是否对回答问题有帮助。

【问题】
{question}

【参考答案】
{ground_truth}

【召回片段】
{contexts_numbered}

输出 JSON：
{{"scores": [1, 0, 1]}}

其中 1 表示该片段相关，0 表示无关或噪声。
""".strip()

CONTEXT_RECALL_PROMPT = """
请把参考答案拆成关键主张，并判断这些主张能否从召回上下文中找到依据。

【问题】
{question}

【参考答案】
{ground_truth}

【召回上下文】
{contexts_text}

输出 JSON：
{{"claims": [{{"claim": "主张1", "supported": true}}, {{"claim": "主张2", "supported": false}}]}}
""".strip()


@dataclass(slots=True)
class RetrievalQualityScore:
    context_precision: float
    context_recall: float
    retrieved_count: int
    relevant_count: int
    claims_total: int
    claims_supported: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "context_precision": self.context_precision,
            "context_recall": self.context_recall,
            "retrieved_count": self.retrieved_count,
            "relevant_count": self.relevant_count,
            "claims_total": self.claims_total,
            "claims_supported": self.claims_supported,
        }


class RetrievalQualityMetric:
    """Evaluate retrieval precision and recall using judge prompts."""

    METRIC_NAMES = ["context_precision", "context_recall"]

    def __init__(self, judge_callable: Callable[[str], dict[str, Any] | None]) -> None:
        self._judge_callable = judge_callable

    async def score(
        self,
        *,
        question: str,
        ground_truth: str,
        retrieved_contexts: list[str],
    ) -> RetrievalQualityScore:
        if not retrieved_contexts:
            return RetrievalQualityScore(0.0, 0.0, 0, 0, 0, 0)

        precision_result, recall_result = await asyncio.gather(
            self._calc_precision(question=question, ground_truth=ground_truth, contexts=retrieved_contexts),
            self._calc_recall(question=question, ground_truth=ground_truth, contexts=retrieved_contexts),
        )
        context_precision, relevant_count = precision_result
        context_recall, claims_total, claims_supported = recall_result
        return RetrievalQualityScore(
            context_precision=context_precision,
            context_recall=context_recall,
            retrieved_count=len(retrieved_contexts),
            relevant_count=relevant_count,
            claims_total=claims_total,
            claims_supported=claims_supported,
        )

    async def batch_score(
        self,
        eval_items: list[dict[str, Any]],
        concurrency: int = 5,
    ) -> list[RetrievalQualityScore]:
        semaphore = asyncio.Semaphore(max(1, concurrency))

        async def _score_one(item: dict[str, Any]) -> RetrievalQualityScore:
            async with semaphore:
                return await self.score(
                    question=str(item.get("question") or ""),
                    ground_truth=str(item.get("ground_truth") or ""),
                    retrieved_contexts=[str(entry) for entry in (item.get("retrieved_contexts") or []) if str(entry).strip()],
                )

        return await asyncio.gather(*[_score_one(item) for item in eval_items])

    async def _calc_precision(
        self,
        *,
        question: str,
        ground_truth: str,
        contexts: list[str],
    ) -> tuple[float, int]:
        contexts_numbered = "\n".join(f"[{index + 1}] {str(context)[:700]}" for index, context in enumerate(contexts))
        prompt = CONTEXT_PRECISION_PROMPT.format(
            question=str(question or "")[:1200],
            ground_truth=str(ground_truth or "")[:1200],
            contexts_numbered=contexts_numbered,
        )
        try:
            payload = await asyncio.to_thread(self._judge_callable, prompt)
            raw_scores = payload.get("scores", []) if isinstance(payload, dict) else []
            scores = [1 if bool(item) else 0 for item in raw_scores][: len(contexts)]
            if not scores:
                return 0.0, 0
            relevant_count = sum(scores)
            weighted_sum = 0.0
            running_relevant = 0
            for index, score in enumerate(scores):
                if score == 1:
                    running_relevant += 1
                    weighted_sum += running_relevant / (index + 1)
            precision = weighted_sum / max(relevant_count, 1)
            return round(precision, 3), int(relevant_count)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[RetrievalQuality] precision scoring failed: %s", exc)
            return 0.5, 0

    async def _calc_recall(
        self,
        *,
        question: str,
        ground_truth: str,
        contexts: list[str],
    ) -> tuple[float, int, int]:
        prompt = CONTEXT_RECALL_PROMPT.format(
            question=str(question or "")[:1200],
            ground_truth=str(ground_truth or "")[:1800],
            contexts_text="\n---\n".join(str(context)[:800] for context in contexts),
        )
        try:
            payload = await asyncio.to_thread(self._judge_callable, prompt)
            claims = payload.get("claims", []) if isinstance(payload, dict) else []
            claims_total = len(claims)
            claims_supported = sum(1 for claim in claims if isinstance(claim, dict) and bool(claim.get("supported")))
            recall = claims_supported / max(claims_total, 1)
            return round(recall, 3), claims_total, claims_supported
        except Exception as exc:  # noqa: BLE001
            logger.warning("[RetrievalQuality] recall scoring failed: %s", exc)
            return 0.5, 0, 0
