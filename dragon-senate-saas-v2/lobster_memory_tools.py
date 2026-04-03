"""
Lobster KB search and expansion tools inspired by lossless-claw.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

logger = logging.getLogger("lobster_memory_tools")

KB_BASE = Path(__file__).resolve().parent.parent / "docs" / "lobster-kb"
ALL_LOBSTERS = [
    "commander",
    "strategist",
    "inkwriter",
    "visualizer",
    "radar",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
]
_QUERY_CACHE: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = OrderedDict()
_CACHE_TTL_SEC = 300.0
_CACHE_MAX_ITEMS = 32


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _lobster_ids(scope_lobster_id: str) -> list[str]:
    normalized = str(scope_lobster_id or "").strip().lower()
    if normalized == "all":
        return list(ALL_LOBSTERS)
    return [normalized]


def _skills_path(lobster_id: str) -> Path:
    return KB_BASE / lobster_id / "skills.json"


def _battle_log_path(lobster_id: str) -> Path:
    return KB_BASE / lobster_id / "battle_log.json"


def _entry_text(entry: dict[str, Any]) -> str:
    return json.dumps(entry, ensure_ascii=False)


def kb_grep(
    lobster_id: str,
    pattern: str,
    scope: str = "both",
    mode: str = "full_text",
    limit: int = 10,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    normalized_scope = str(scope or "both").strip().lower()
    normalized_mode = str(mode or "full_text").strip().lower()
    regex = re.compile(pattern, re.I) if normalized_mode == "regex" else None
    keyword = str(pattern or "").strip().lower()

    for current_lobster_id in _lobster_ids(lobster_id):
        if normalized_scope in {"both", "skills"}:
            skills_file = _skills_path(current_lobster_id)
            if skills_file.exists():
                skills_data = _load_json(skills_file)
                for entry in list(skills_data.get("skills_v3") or []) + list(skills_data.get("skills") or []):
                    text = _entry_text(entry)
                    score = 0
                    if regex is not None:
                        if regex.search(text):
                            score = 1
                    else:
                        score = text.lower().count(keyword)
                    if score <= 0:
                        continue
                    results.append(
                        {
                            "source": "skills_v3" if entry in list(skills_data.get("skills_v3") or []) else "skills",
                            "lobster_id": current_lobster_id,
                            "entry_id": str(entry.get("entry_id") or ""),
                            "title": str(entry.get("title") or ""),
                            "snippet": text[:240],
                            "score": float(score),
                            "tags": list(entry.get("tags") or []),
                        }
                    )

        if normalized_scope in {"both", "battle_log"}:
            battle_file = _battle_log_path(current_lobster_id)
            if battle_file.exists():
                battle_data = _load_json(battle_file)
                for entry in list(battle_data.get("entries") or []):
                    text = _entry_text(entry)
                    score = 0
                    if regex is not None:
                        if regex.search(text):
                            score = 1
                    else:
                        score = text.lower().count(keyword)
                    if score <= 0:
                        continue
                    results.append(
                        {
                            "source": "battle_log",
                            "lobster_id": current_lobster_id,
                            "entry_id": str(entry.get("entry_id") or entry.get("log_id") or ""),
                            "title": str(entry.get("task_type") or entry.get("description") or ""),
                            "snippet": text[:240],
                            "score": float(score),
                            "tags": [],
                        }
                    )

    results.sort(key=lambda item: (item["score"], item["entry_id"]), reverse=True)
    return results[: max(1, int(limit))]


def kb_describe(entry_id: str, lobster_id: str | None = None) -> dict[str, Any] | None:
    target_lobsters = _lobster_ids(lobster_id or "all")
    for current_lobster_id in target_lobsters:
        skills_file = _skills_path(current_lobster_id)
        if not skills_file.exists():
            continue
        skills_data = _load_json(skills_file)
        for entry in list(skills_data.get("skills_v3") or []):
            if str(entry.get("entry_id") or "") != str(entry_id):
                continue
            related_logs: list[dict[str, Any]] = []
            battle_file = _battle_log_path(current_lobster_id)
            if battle_file.exists():
                battle_data = _load_json(battle_file)
                for item in list(battle_data.get("entries") or []):
                    if str(item.get("skill_v3_ref") or item.get("skill_ref") or "") == str(entry_id):
                        related_logs.append(item)
            return {
                "lobster_id": current_lobster_id,
                "entry": entry,
                "related_battle_logs": related_logs,
            }
    return None


async def kb_expand_query(lobster_id: str, query: str, top_k: int = 3, llm_router: Any | None = None) -> list[dict[str, Any]]:
    cache_key = f"{lobster_id}:{query}:{top_k}"
    cached = _QUERY_CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SEC:
        return cached[1]

    keywords = _extract_keywords(query)
    candidates: list[dict[str, Any]] = []
    for keyword in keywords:
        candidates.extend(kb_grep(lobster_id, keyword, scope="skills", mode="full_text", limit=max(5, top_k * 3)))

    dedup: dict[str, dict[str, Any]] = {}
    for item in candidates:
        key = f"{item['lobster_id']}::{item['entry_id']}"
        if key not in dedup or item["score"] > dedup[key]["score"]:
            dedup[key] = item
    ranked = sorted(dedup.values(), key=lambda item: (item["score"], item["entry_id"]), reverse=True)[: max(1, top_k)]

    expanded: list[dict[str, Any]] = []
    for item in ranked:
        described = kb_describe(str(item["entry_id"]), lobster_id=str(item["lobster_id"]))
        if described is None:
            continue
        expanded.append(
            {
                "entry_id": item["entry_id"],
                "relevance_reason": f"命中关键词：{', '.join(keywords[:4])}",
                "entry": described["entry"],
                "lobster_id": item["lobster_id"],
            }
        )

    _QUERY_CACHE[cache_key] = (time.time(), expanded)
    while len(_QUERY_CACHE) > _CACHE_MAX_ITEMS:
        _QUERY_CACHE.popitem(last=False)
    return expanded


def _extract_keywords(query: str) -> list[str]:
    text = str(query or "").strip()
    parts = [part for part in re.split(r"[\s,，。！？!?:：/]+", text) if len(part) >= 2]
    dedup: list[str] = []
    for part in parts:
        if part not in dedup:
            dedup.append(part)
    return dedup[:6] or [text]
