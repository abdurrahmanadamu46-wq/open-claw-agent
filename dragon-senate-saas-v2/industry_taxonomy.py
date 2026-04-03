from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any


def _slug(value: str, default: str = "general") -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip().lower()).strip("_")
    return normalized or default


def _schema_template(industry_name: str) -> dict[str, Any]:
    return {
        "industry_name": industry_name,
        "pain_points": [],
        "jargon_terms": [],
        "solutions": [],
        "objections": [],
        "banned_absolute": ["全网第一", "稳赚不赔", "保证收益", "100%有效"],
        "banned_industry": ["刷单上榜", "平台漏洞套利"],
        "risk_behaviors": ["违规导流", "夸大承诺", "虚假案例", "诱导交易"],
    }


def _taxonomy_candidates() -> list[Path]:
    base = Path(__file__).resolve().parent
    repo_root = base.parent
    return [
        base / "data" / "industry_subcategories.json",
        repo_root / "docs" / "industry_subcategories.json",
    ]


def _normalize_taxonomy(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    out: list[dict[str, Any]] = []
    for category in raw:
        if not isinstance(category, dict):
            continue

        category_tag = _slug(str(category.get("category_tag") or "general"), "general")
        category_name = str(category.get("category_name") or category_tag).strip() or category_tag
        sub_items = category.get("sub_industries")
        if not isinstance(sub_items, list):
            sub_items = []

        normalized_subs: list[dict[str, Any]] = []
        for item in sub_items:
            if not isinstance(item, dict):
                continue

            tag = _slug(str(item.get("tag") or "general"), "general")
            name = str(item.get("name") or tag).strip() or tag

            aliases_raw = item.get("aliases")
            aliases: list[str] = []
            if isinstance(aliases_raw, list):
                aliases = [str(x).strip() for x in aliases_raw if str(x).strip()]
            if name not in aliases:
                aliases.insert(0, name)

            schema = item.get("schema")
            if not isinstance(schema, dict):
                schema = _schema_template(name)

            normalized_subs.append(
                {
                    "tag": tag,
                    "name": name,
                    "aliases": aliases,
                    "schema": schema,
                }
            )

        out.append(
            {
                "category_tag": category_tag,
                "category_name": category_name,
                "sub_industries": normalized_subs,
            }
        )

    return out


def _fallback_taxonomy() -> list[dict[str, Any]]:
    return [
        {
            "category_tag": "general",
            "category_name": "通用行业",
            "sub_industries": [
                {
                    "tag": "general",
                    "name": "通用",
                    "aliases": ["通用", "general"],
                    "schema": _schema_template("通用"),
                }
            ],
        }
    ]


def _load_taxonomy() -> list[dict[str, Any]]:
    for path in _taxonomy_candidates():
        if not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8")
            parsed = json.loads(text)
            normalized = _normalize_taxonomy(parsed)
            if normalized:
                return normalized
        except Exception:
            continue
    return _fallback_taxonomy()


INDUSTRY_TAXONOMY: list[dict[str, Any]] = _load_taxonomy()


COARSE_TAG_MAP: dict[str, str] = {
    "general": "general",
    "restaurant": "food_chinese_restaurant",
    "hotel": "hotel_business",
    "beauty": "beauty_salon",
    "education": "edu_vocational",
    "automotive": "auto_used_car",
    "auto": "auto_used_car",
    "home": "home_decor_company",
    "retail": "retail_fresh",
    "local_service": "life_housekeeping",
    "medical": "medical_tcm_clinic",
    "enterprise": "enterprise_tax",
    "travel": "travel_scenic",
    "crossborder": "overseas_crossborder",
    "ecommerce": "overseas_crossborder",
    "tcm": "medical_tcm_clinic",
    "housekeeping": "life_housekeeping",
}


def list_industry_taxonomy() -> list[dict[str, Any]]:
    return deepcopy(INDUSTRY_TAXONOMY)


def all_subindustry_records() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for category in INDUSTRY_TAXONOMY:
        category_tag = str(category.get("category_tag", "general"))
        category_name = str(category.get("category_name", "通用行业"))
        for item in category.get("sub_industries", []) or []:
            row = dict(item)
            row["category_tag"] = category_tag
            row["category_name"] = category_name
            row["tag"] = _slug(str(row.get("tag", "general")), "general")
            records.append(row)
    return records


def resolve_subindustry_tag(raw: str | None, fallback: str = "general") -> str:
    source = str(raw or "").strip()
    if not source:
        return _slug(fallback, "general")

    source_slug = _slug(source, "general")
    source_lower = source.lower()

    for row in all_subindustry_records():
        tag = str(row.get("tag", "general"))
        name = str(row.get("name", "")).strip()
        aliases = [str(item).strip() for item in row.get("aliases", []) if str(item).strip()]
        aliases_lower = [item.lower() for item in aliases]

        if source_slug == tag:
            return tag
        if source == name or source in aliases:
            return tag
        if source_lower == name.lower() or source_lower in aliases_lower:
            return tag

    return _slug(source, _slug(fallback, "general"))


def coarse_to_subindustry_tag(coarse_tag: str | None) -> str:
    key = _slug(str(coarse_tag or "general"), "general")
    return COARSE_TAG_MAP.get(key, "general")


def profile_seed_from_tag(industry_tag: str) -> dict[str, Any]:
    target = resolve_subindustry_tag(industry_tag)
    for row in all_subindustry_records():
        if row["tag"] != target:
            continue
        name = str(row.get("name", target))
        return {
            "industry_tag": target,
            "display_name": f"{name}知识库",
            "description": f"{name}专属爆款公式、起号策略与合规规则库",
            "config": {
                "category_tag": str(row.get("category_tag", "")),
                "category_name": str(row.get("category_name", "")),
                "industry_name": name,
                "aliases": [str(item) for item in row.get("aliases", [])],
                "schema": deepcopy(row.get("schema", _schema_template(name))),
                "version": "v1",
            },
        }

    return {
        "industry_tag": target,
        "display_name": f"{target}知识库",
        "description": f"{target}专属知识库",
        "config": {
            "category_tag": "general",
            "category_name": "通用行业",
            "industry_name": target,
            "aliases": [target],
            "schema": _schema_template(target),
            "version": "v1",
        },
    }


def bootstrap_profile_seeds() -> list[dict[str, Any]]:
    return [profile_seed_from_tag(str(row.get("tag", "general"))) for row in all_subindustry_records()]
