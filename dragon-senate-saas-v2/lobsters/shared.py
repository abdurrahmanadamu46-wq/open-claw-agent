"""
Shared utilities for all lobsters.
Extracted from dragon_senate.py to enable per-lobster modularization.

These are pure utility functions that don't depend on any lobster logic.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

from langchain_core.documents import Document


# ────────────────────────────────────────────────────────────────────
# Constants (from dragon_senate.py)
# ────────────────────────────────────────────────────────────────────

FORMULA_CATEGORIES = ["short_fast", "deep_long", "baoma", "chengfendang", "yangmaodang"]
HOOK_TYPES = [
    "pain-question",
    "benefit-hook",
    "visual-surprise",
    "counter-intuition",
    "identity-callout",
]
CONTENT_STRUCTURES = [
    "hook->pain->solution->proof->cta",
    "scenario->conflict->turn->proof->cta",
    "hook->comparison->showcase->offer->cta",
]
MUSIC_SUGGESTIONS = [
    "upbeat-electronic-95bpm",
    "warm-lifestyle-88bpm",
    "fast-cut-trending-110bpm",
    "soft-storytelling-82bpm",
]
PERSONA_SLANGS = [
    "mom_style: practical, family-safe, easy-to-use",
    "ingredient_nerd: concentration, formula, active-components",
    "deal_hunter: discount, effective-price, coupon",
    "student_style: budget-friendly, value, easy-setup",
]
STORYBOARD_OPTIONS = [5, 7, 15]

SKILL_BINDINGS: dict[str, list[str]] = {
    "radar": ["agent-browser", "summarize"],
    "hotspot_investigation": ["proactive-agent"],
    "strategist": ["ontology", "self-improving-agent", "proactive-agent"],
    "constitutional_guardian": ["ontology", "skill-vetter"],
    "verification_gate": ["ontology"],
    "memory_governor": ["self-improving-agent", "ontology"],
    "competitor_analysis": ["agent-browser", "summarize", "ontology"],
    "competitor_formula_analyzer": ["agent-browser", "ontology", "summarize"],
    "rag_ingest_node": ["ontology", "self-improving-agent"],
    "inkwriter": ["humanizer", "summarize"],
    "visualizer": ["nano-banana-pro", "comfyui-local", "libtv-skill"],
    "dispatcher": ["proactive-agent", "auto-updater"],
    "discover_edge_skills": ["skill-vetter", "cli-anything"],
    "distribute_to_edge": ["api-gateway"],
    "echoer": ["humanizer"],
    "catcher": ["summarize", "ontology"],
    "abacus": ["api-gateway", "gog"],
    "human_approval_gate": ["human-in-the-loop"],
    "followup": ["openai-whisper"],
    "feedback": ["self-improving-agent", "ontology"],
}


# ────────────────────────────────────────────────────────────────────
# Env helpers
# ────────────────────────────────────────────────────────────────────

def bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return int(default)
    try:
        return int(raw)
    except ValueError:
        return int(default)


# ────────────────────────────────────────────────────────────────────
# Text / parsing helpers
# ────────────────────────────────────────────────────────────────────

def keywords(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z0-9_\u4e00-\u9fff]{2,}", text.lower())
    seen: set[str] = set()
    output: list[str] = []
    for token in raw:
        if token in seen:
            continue
        seen.add(token)
        output.append(token)
    return output[:12]


def safe_slug(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\-:/\.]+", "_", text).strip("_")
    return cleaned[:120] or "unknown_source"


def strip_markdown_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 2:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def safe_json_parse(raw: str) -> Any | None:
    cleaned = strip_markdown_fence(raw)
    if not cleaned:
        return None
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


# ────────────────────────────────────────────────────────────────────
# Logging helpers
# ────────────────────────────────────────────────────────────────────

def _clawhub_keys() -> dict[str, str]:
    raw = os.getenv("CLAWHUB_KEYS", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items()}
    except json.JSONDecodeError:
        pass
    return {}


def agent_log(agent: str, summary: str, payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    keys = _clawhub_keys()
    return [
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "agent": agent,
            "skills": SKILL_BINDINGS.get(agent, []),
            "skill_key": keys.get(agent),
            "summary": summary,
            "payload": payload or {},
        }
    ]


# ────────────────────────────────────────────────────────────────────
# Skill invocation (stub)
# ────────────────────────────────────────────────────────────────────

async def invoke_clawhub_skill(agent: str, skill_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    keys = _clawhub_keys()
    return {
        "agent": agent,
        "skill": skill_name,
        "skill_key": keys.get(agent),
        "ok": True,
        "payload_echo": payload,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


# ────────────────────────────────────────────────────────────────────
# Formula / RAG helpers
# ────────────────────────────────────────────────────────────────────

def build_formula_json(source_handle: str, hot_topics: list[str], radar_data: dict[str, Any]) -> dict[str, Any]:
    seed = abs(hash(source_handle)) % 100000
    category = FORMULA_CATEGORIES[seed % len(FORMULA_CATEGORIES)]
    storyboard_count = STORYBOARD_OPTIONS[seed % len(STORYBOARD_OPTIONS)]
    hook_type = HOOK_TYPES[seed % len(HOOK_TYPES)]
    structure = CONTENT_STRUCTURES[seed % len(CONTENT_STRUCTURES)]
    music = MUSIC_SUGGESTIONS[seed % len(MUSIC_SUGGESTIONS)]
    slang = PERSONA_SLANGS[seed % len(PERSONA_SLANGS)]
    topic = hot_topics[seed % len(hot_topics)] if hot_topics else "generic_conversion_topic"

    if storyboard_count == 5:
        duration_range = {"min": 8, "max": 12}
        pacing = [2, 6, 10]
    elif storyboard_count == 7:
        duration_range = {"min": 13, "max": 18}
        pacing = [3, 9, 14]
    else:
        duration_range = {"min": 24, "max": 36}
        pacing = [5, 16, 28]

    effect_score = round(68 + (seed % 29) + (4 if hot_topics else 0), 2)
    now_iso = datetime.now(timezone.utc).isoformat()

    return {
        "source_account": safe_slug(source_handle),
        "source_url": source_handle if source_handle.startswith("http") else f"https://platform.local/{safe_slug(source_handle)}",
        "analysis_time": now_iso,
        "hook_type": hook_type,
        "content_structure": structure,
        "storyboard_count": storyboard_count,
        "cta": f"Close with DM CTA and offer the {topic} checklist",
        "rhythm_peak_seconds": pacing,
        "music_suggestion": music,
        "persona_slang": slang,
        "duration_golden_seconds": duration_range,
        "topic_focus": topic,
        "category": category,
        "effect_score": effect_score,
        "radar_context": {
            "keywords": radar_data.get("keywords", []),
            "platforms": radar_data.get("platforms", []),
        },
    }


def formula_to_document(formula: dict[str, Any]) -> Document:
    metadata = {
        "category": formula.get("category", "unknown"),
        "account": formula.get("source_account", "unknown"),
        "date": formula.get("analysis_time"),
        "effect_score": float(formula.get("effect_score", 0) or 0),
        "source_url": formula.get("source_url", ""),
        "storyboard_count": int(formula.get("storyboard_count", 0) or 0),
        "ingest_ts": int(time.time()),
    }
    page_content = json.dumps(
        {
            "hook_type": formula.get("hook_type"),
            "content_structure": formula.get("content_structure"),
            "cta": formula.get("cta"),
            "rhythm_peak_seconds": formula.get("rhythm_peak_seconds"),
            "music_suggestion": formula.get("music_suggestion"),
            "persona_slang": formula.get("persona_slang"),
            "duration_golden_seconds": formula.get("duration_golden_seconds"),
            "topic_focus": formula.get("topic_focus"),
        },
        ensure_ascii=False,
    )
    return Document(page_content=page_content, metadata=metadata)


def extract_rag_reference(doc: Document) -> dict[str, Any]:
    metadata = doc.metadata or {}
    return {
        "category": metadata.get("category"),
        "account": metadata.get("account"),
        "effect_score": metadata.get("effect_score"),
        "storyboard_count": metadata.get("storyboard_count"),
        "source_url": metadata.get("source_url"),
        "snippet": doc.page_content[:200],
    }


def extract_industry_kb_reference(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {}
    return {
        "category": item.get("entry_type") or metadata.get("entry_type") or metadata.get("category"),
        "account": item.get("source_account") or metadata.get("source_account") or metadata.get("account"),
        "effect_score": item.get("effect_score", metadata.get("effect_score")),
        "storyboard_count": item.get("storyboard_count", metadata.get("storyboard_count")),
        "source_url": item.get("source_url") or metadata.get("source_url"),
        "snippet": str(item.get("snippet") or item.get("content") or "")[:200],
        "source": "industry_kb",
        "industry_tag": metadata.get("industry_tag") or item.get("industry_tag"),
    }


# ────────────────────────────────────────────────────────────────────
# Edge helpers
# ────────────────────────────────────────────────────────────────────

def normalize_skill_names(raw: Any) -> list[str]:
    if isinstance(raw, list):
        data = raw
    elif isinstance(raw, str):
        data = [part.strip() for part in raw.split(",")]
    else:
        data = []
    out: list[str] = []
    seen: set[str] = set()
    for item in data:
        value = str(item).strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def normalize_command_names(raw: Any) -> list[str]:
    if isinstance(raw, list):
        data = raw
    elif isinstance(raw, str):
        data = [part.strip() for part in raw.split(",")]
    else:
        data = []
    out: list[str] = []
    seen: set[str] = set()
    for item in data:
        value = re.sub(r"\s+", " ", str(item).strip())
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def default_competitor_handles(state: dict[str, Any]) -> list[str]:
    handles = [h.strip() for h in state.get("competitor_handles", []) if str(h).strip()]
    target_url = str(state.get("target_account_url") or "").strip()
    if target_url:
        handles.append(target_url)
    if not handles:
        handles = ["benchmark_a", "benchmark_b"]
    dedup: list[str] = []
    seen: set[str] = set()
    for h in handles:
        if h in seen:
            continue
        seen.add(h)
        dedup.append(h)
    return dedup[:8]
