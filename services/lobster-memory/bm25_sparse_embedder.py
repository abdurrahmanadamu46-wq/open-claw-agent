from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Iterable


TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)


@dataclass
class SparseVector:
    indices: list[int]
    values: list[float]
    term_weights: dict[str, float]


class BM25SparseEmbedder:
    """
    Lightweight BM25 sparse scorer.

    If `fastembed` is available, keep the door open for later replacement.
    For now we provide a pure-Python implementation so the project can run
    without a native sparse embedding dependency.
    """

    def __init__(self, model_name: str = "Qdrant/bm25") -> None:
        self.model_name = model_name
        self._term_index: dict[str, int] = {}

    @staticmethod
    def tokenize(text: str) -> list[str]:
        return [token.lower() for token in TOKEN_RE.findall(str(text or "")) if token.strip()]

    def embed(self, text: str) -> SparseVector:
        terms = self.tokenize(text)
        counts = Counter(terms)
        indices: list[int] = []
        values: list[float] = []
        term_weights: dict[str, float] = {}
        for term, count in counts.items():
            index = self._term_index.setdefault(term, len(self._term_index))
            weight = float(count)
            indices.append(index)
            values.append(weight)
            term_weights[term] = weight
        return SparseVector(indices=indices, values=values, term_weights=term_weights)

    def embed_batch(self, texts: list[str]) -> list[SparseVector]:
        return [self.embed(text) for text in texts]

    def score_documents(
        self,
        query: str,
        documents: Iterable[str],
        *,
        k1: float = 1.5,
        b: float = 0.75,
    ) -> list[float]:
        tokenized_docs = [self.tokenize(doc) for doc in documents]
        if not tokenized_docs:
            return []
        avgdl = sum(len(doc) for doc in tokenized_docs) / max(1, len(tokenized_docs))
        doc_freq: dict[str, int] = defaultdict(int)
        for doc in tokenized_docs:
            for term in set(doc):
                doc_freq[term] += 1

        query_terms = self.tokenize(query)
        scores: list[float] = []
        total_docs = len(tokenized_docs)
        for doc in tokenized_docs:
            tf = Counter(doc)
            doc_len = len(doc)
            score = 0.0
            for term in query_terms:
                if term not in tf:
                    continue
                df = doc_freq.get(term, 0)
                idf = math.log(1 + ((total_docs - df + 0.5) / (df + 0.5)))
                numerator = tf[term] * (k1 + 1)
                denominator = tf[term] + k1 * (1 - b + b * (doc_len / max(avgdl, 1.0)))
                score += idf * (numerator / max(denominator, 1e-6))
            scores.append(score)
        return scores
