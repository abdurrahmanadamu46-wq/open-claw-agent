"""
Answer relevance metric inspired by RAGAS.
"""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from typing import Any
from typing import Callable


logger = logging.getLogger("answer_relevance_metric")

REVERSE_QUESTION_PROMPT = """
基于以下回答，生成 {n} 个可能触发这个回答的真实用户问题。

要求：
- 问题要自然，像真实用户会提的
- 问题要尽量覆盖回答真正回答了什么
- 只输出 JSON

【回答】
{answer}

输出格式：
{{"questions": ["问题1", "问题2", "问题3"]}}
""".strip()


@dataclass(slots=True)
class AnswerRelevanceScore:
    value: float
    hypothesis_questions: list[str]
    avg_similarity: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "hypothesis_questions": self.hypothesis_questions,
            "avg_similarity": self.avg_similarity,
        }


class _DefaultEmbedder:
    """Embedding adapter with lexical fallback."""

    def __init__(self) -> None:
        self._backend: Any | None = None

    def _resolve_backend(self) -> Any | None:
        if self._backend is not None:
            return self._backend
        try:
            from qdrant_config import _get_embeddings  # type: ignore

            self._backend = _get_embeddings()[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("[AnswerRelevance] embedding backend unavailable, fallback to lexical similarity: %s", exc)
            self._backend = False
        return self._backend

    def embed(self, text: str) -> list[float]:
        backend = self._resolve_backend()
        if backend and hasattr(backend, "embed_query"):
            return list(backend.embed_query(text))
        if backend and hasattr(backend, "embed_documents"):
            embedded = backend.embed_documents([text])
            if embedded:
                return list(embedded[0])
        tokens = [token for token in str(text or "").lower().split() if token]
        token_set = sorted(set(tokens))
        return [float(len(token_set)), float(len(tokens)), float(sum(len(token) for token in token_set))]


class AnswerRelevanceMetric:
    """Reverse-question answer relevance metric."""

    METRIC_NAME = "answer_relevance"

    def __init__(
        self,
        judge_callable: Callable[[str], dict[str, Any] | None],
        *,
        embedder: Any | None = None,
        n_hypotheses: int = 3,
    ) -> None:
        self._judge_callable = judge_callable
        self._embedder = embedder or _DefaultEmbedder()
        self.n_hypotheses = max(1, n_hypotheses)

    async def score(self, question: str, answer: str) -> AnswerRelevanceScore:
        normalized_answer = str(answer or "").strip()
        if not normalized_answer:
            return AnswerRelevanceScore(value=0.0, hypothesis_questions=[], avg_similarity=0.0)

        hypotheses = await self._generate_hypotheses(normalized_answer)
        if not hypotheses:
            return AnswerRelevanceScore(value=0.5, hypothesis_questions=[], avg_similarity=0.5)

        embeddings = await asyncio.gather(
            asyncio.to_thread(self._embedder.embed, str(question or "")),
            *[asyncio.to_thread(self._embedder.embed, item) for item in hypotheses],
        )
        question_embedding = embeddings[0]
        similarities = [
            self._cosine_similarity(question_embedding, hypothesis_embedding)
            for hypothesis_embedding in embeddings[1:]
        ]
        avg_similarity = sum(similarities) / max(len(similarities), 1)
        return AnswerRelevanceScore(
            value=round(max(0.0, min(1.0, avg_similarity)), 3),
            hypothesis_questions=hypotheses,
            avg_similarity=round(avg_similarity, 3),
        )

    async def _generate_hypotheses(self, answer: str) -> list[str]:
        prompt = REVERSE_QUESTION_PROMPT.format(n=self.n_hypotheses, answer=answer[:2400])
        try:
            payload = await asyncio.to_thread(self._judge_callable, prompt)
            questions = payload.get("questions", []) if isinstance(payload, dict) else []
            return [str(item).strip() for item in questions if str(item).strip()][: self.n_hypotheses]
        except Exception as exc:  # noqa: BLE001
            logger.warning("[AnswerRelevance] failed to generate hypothesis questions: %s", exc)
            return []

    @staticmethod
    def _cosine_similarity(vector_a: list[float], vector_b: list[float]) -> float:
        if not vector_a or not vector_b:
            return 0.0
        width = min(len(vector_a), len(vector_b))
        if width <= 0:
            return 0.0
        dot = sum(vector_a[index] * vector_b[index] for index in range(width))
        norm_a = math.sqrt(sum(value * value for value in vector_a[:width]))
        norm_b = math.sqrt(sum(value * value for value in vector_b[:width]))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return max(0.0, min(1.0, dot / (norm_a * norm_b)))
