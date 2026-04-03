from __future__ import annotations

import os
from typing import Any

import httpx


OFFICIAL_INDEX_URL = "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/index.json"


def _timeout() -> float:
    try:
        return float(os.getenv("COMFYUI_TEMPLATE_CATALOG_TIMEOUT_SEC", "20").strip())
    except ValueError:
        return 20.0


def _industry_keywords(industry: str) -> list[str]:
    mapping = {
        "hotel": ["hotel", "travel", "tourism", "resort", "room", "hospitality"],
        "restaurant": ["food", "restaurant", "dish", "menu", "cafe", "drink", "kitchen"],
        "tcm": ["medical", "health", "wellness", "herbal", "traditional", "body"],
        "housekeeping": ["home", "clean", "service", "lifestyle", "family"],
        "beauty": ["beauty", "face", "makeup", "skincare", "fashion", "portrait"],
        "education": ["education", "learning", "training", "class", "school"],
        "fitness": ["fitness", "sport", "workout", "training", "body"],
        "retail": ["product", "ecommerce", "shop", "retail", "ad", "marketing"],
        "general": ["marketing", "video", "image", "advertising", "product"],
    }
    return mapping.get(industry, mapping["general"])


def _score_row(row: dict[str, Any], keywords: list[str]) -> float:
    tags = row.get("tags")
    tag_text = ""
    if isinstance(tags, list):
        tag_text = " ".join(str(item) for item in tags)
    elif isinstance(tags, str):
        tag_text = tags
    text = " ".join(
        [
            str(row.get("title", "")),
            str(row.get("description", "")),
            str(row.get("category", "")),
            str(row.get("moduleName", "")),
            str(row.get("id", "")),
            str(row.get("name", "")),
            str(row.get("parentTitle", "")),
            tag_text,
            str(row.get("mediaType", "")),
            str(row.get("mediaSubtype", "")),
        ]
    ).lower()
    score = 0.0
    for kw in keywords:
        if kw in text:
            score += 1.0
    if "video" in text:
        score += 0.3
    if "marketing" in text or "ad" in text:
        score += 0.3
    return score


async def fetch_official_index() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=max(3.0, min(_timeout(), 120.0))) as client:
            resp = await client.get(OFFICIAL_INDEX_URL)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "items": []}
    if not isinstance(payload, list):
        return {"ok": False, "error": "index_not_list", "items": []}
    rows = [item for item in payload if isinstance(item, dict)]
    return {"ok": True, "items": rows}


def _flatten_templates(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    stack: list[dict[str, Any]] = [item for item in items if isinstance(item, dict)]
    while stack:
        current = stack.pop()
        templates = current.get("templates")
        if isinstance(templates, list) and templates:
            for child in templates:
                if isinstance(child, dict):
                    if "parentTitle" not in child and current.get("title"):
                        child = dict(child)
                        child["parentTitle"] = current.get("title")
                    stack.append(child)
            continue
        if current.get("name") or current.get("title"):
            rows.append(current)
    return rows


async def recommend_official_templates(industry: str, limit: int = 20) -> dict[str, Any]:
    idx = await fetch_official_index()
    if not idx.get("ok"):
        return {
            "ok": False,
            "industry": industry,
            "error": idx.get("error"),
            "count": 0,
            "templates": [],
        }
    keywords = _industry_keywords(industry)
    flattened = _flatten_templates([row for row in idx.get("items", []) if isinstance(row, dict)])
    ranked = []
    for row in flattened:
        if not isinstance(row, dict):
            continue
        score = _score_row(row, keywords)
        ranked.append((score, row))
    ranked.sort(key=lambda x: x[0], reverse=True)
    output = []
    for score, row in ranked[: max(1, min(limit, 100))]:
        name = str(row.get("name", "")).strip()
        raw_url = ""
        if name:
            raw_url = f"https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/{name}.json"
        output.append(
            {
                "score": round(score, 3),
                "id": row.get("id"),
                "name": name,
                "title": row.get("title"),
                "category": row.get("category"),
                "parentTitle": row.get("parentTitle"),
                "description": row.get("description"),
                "moduleName": row.get("moduleName"),
                "mediaType": row.get("mediaType"),
                "tags": row.get("tags"),
                "raw_url": raw_url,
            }
        )
    return {
        "ok": True,
        "industry": industry,
        "keywords": keywords,
        "count": len(output),
        "total_candidates": len(flattened),
        "templates": output,
        "index_source": OFFICIAL_INDEX_URL,
    }
