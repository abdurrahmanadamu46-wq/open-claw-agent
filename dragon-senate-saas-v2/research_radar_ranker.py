from __future__ import annotations

import re
from typing import Any


HIGH_VALUE_KEYWORDS = {
    "multi-agent",
    "agentic",
    "memory",
    "governance",
    "verification",
    "tool",
    "planner",
    "world model",
    "reward",
    "rag",
    "workflow",
    "compliance",
    "auditing",
    "sandbox",
}


SOURCE_CREDIBILITY = {
    "openalex": 0.92,
    "arxiv_csai": 0.88,
    "huggingface_papers": 0.82,
    "github_projects": 0.78,
    "qbitai": 0.72,
    "manual": 0.65,
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def extract_tags(title: str, summary: str = "") -> list[str]:
    txt = _norm(f"{title} {summary}")
    tags: list[str] = []
    for kw in sorted(HIGH_VALUE_KEYWORDS):
        if kw in txt:
            tags.append(kw)
    if "llm" in txt:
        tags.append("llm")
    if "langgraph" in txt:
        tags.append("langgraph")
    if "feishu" in txt:
        tags.append("feishu")
    if "edge" in txt:
        tags.append("edge-runtime")
    return sorted(set(tags))


def actionability_score(*, title: str, summary: str, tags: list[str]) -> float:
    text = _norm(f"{title} {summary}")
    score = 0.25
    if any(k in text for k in ["framework", "architecture", "system", "runtime"]):
        score += 0.2
    if any(k in text for k in ["open-source", "github", "code", "benchmark"]):
        score += 0.2
    if any(k in text for k in ["agent", "multi-agent", "workflow"]):
        score += 0.15
    if any(k in text for k in ["memory", "rag", "retrieval", "tool"]):
        score += 0.1
    score += min(0.2, len(tags) * 0.02)
    return max(0.0, min(1.0, score))


def normalize_hot_score(raw: Any) -> float:
    try:
        v = float(raw)
    except Exception:  # noqa: BLE001
        return 0.0
    # simple squash to [0,1]
    if v <= 0:
        return 0.0
    if v >= 10_000:
        return 1.0
    if v >= 1_000:
        return 0.9
    if v >= 100:
        return 0.75
    if v >= 10:
        return 0.55
    return 0.35


def combined_score(*, source: str, hot_score: float, actionability: float, freshness: float) -> tuple[float, float]:
    credibility = float(SOURCE_CREDIBILITY.get(source, 0.6))
    score = (credibility * 0.35) + (hot_score * 0.25) + (actionability * 0.25) + (freshness * 0.15)
    return max(0.0, min(1.0, score)), credibility

