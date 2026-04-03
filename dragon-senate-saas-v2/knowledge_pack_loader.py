"""
knowledge_pack_loader.py — 行业知识包加载器
==========================================

从训练师生成的 knowledge-packs 目录中加载行业专属规则与触发钩子，
并格式化成可直接注入到 lobster system prompt 的 Markdown 段落。
"""

from __future__ import annotations

import csv
import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
KNOWLEDGE_PACKS_DIR = BASE_DIR / "data" / "knowledge-packs"
INDUSTRY_SUBCATEGORIES_JSON = BASE_DIR / "data" / "industry_subcategories.json"
INDUSTRY_SUBCATEGORIES_CSV = BASE_DIR / "data" / "industry_subcategories.csv"

PACK_FILE_NAMES = (
    "industry-rules.json",
    "hooks-library.json",
    "scoring-features.json",
    "expanded-golden-cases.json",
)

PRIORITY_LABELS = {
    "high": "高优先级",
    "medium": "中优先级",
    "low": "低优先级",
}


def _normalize_text(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"[\s/\\|·・,，、.:：;；\-]+", "_", text)
    text = re.sub(r"_+", "_", text)
    return text.strip("_").lower()


def _collapse_text(value: str) -> str:
    text = _normalize_text(value)
    return text.replace("_", "")


def _safe_read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to read knowledge pack %s: %s", path, exc)
        return {}


@lru_cache(maxsize=64)
def _list_available_industry_dirs(lobster_id: str) -> tuple[str, ...]:
    lobster_root = KNOWLEDGE_PACKS_DIR / str(lobster_id or "").strip()
    if not lobster_root.exists() or not lobster_root.is_dir():
        return ()
    return tuple(
        sorted(
            child.name
            for child in lobster_root.iterdir()
            if child.is_dir()
        )
    )


@lru_cache(maxsize=1)
def _load_official_industry_aliases() -> dict[str, set[str]]:
    alias_map: dict[str, set[str]] = {}

    def _bind(alias: str, directory_name: str) -> None:
        normalized = _normalize_text(alias)
        collapsed = _collapse_text(alias)
        if normalized:
            alias_map.setdefault(normalized, set()).add(directory_name)
        if collapsed:
            alias_map.setdefault(collapsed, set()).add(directory_name)

    if INDUSTRY_SUBCATEGORIES_JSON.exists():
        try:
            payload = json.loads(INDUSTRY_SUBCATEGORIES_JSON.read_text(encoding="utf-8-sig"))
            for category in payload if isinstance(payload, list) else []:
                if not isinstance(category, dict):
                    continue
                category_name = str(category.get("category_name") or "").strip()
                category_tag = str(category.get("category_tag") or "").strip()
                sub_industries = category.get("sub_industries") or []
                if not isinstance(sub_industries, list):
                    continue
                for sub in sub_industries:
                    if not isinstance(sub, dict):
                        continue
                    sub_name = str(sub.get("name") or "").strip()
                    sub_tag = str(sub.get("tag") or "").strip()
                    if not category_name or not sub_name:
                        continue
                    directory_name = f"{category_name}_{sub_name}"
                    aliases = [
                        directory_name,
                        sub_name,
                        f"{category_name}/{sub_name}",
                        f"{category_name}_{sub_name}",
                        f"{category_name}-{sub_name}",
                        category_tag,
                        sub_tag,
                        f"{category_tag}.{sub_tag}" if category_tag and sub_tag else "",
                        f"{category_tag}_{sub_tag}" if category_tag and sub_tag else "",
                    ]
                    for item in sub.get("aliases") or []:
                        aliases.append(str(item or "").strip())
                    for alias in aliases:
                        if alias:
                            _bind(alias, directory_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to read %s: %s", INDUSTRY_SUBCATEGORIES_JSON, exc)
    elif INDUSTRY_SUBCATEGORIES_CSV.exists():
        try:
            with INDUSTRY_SUBCATEGORIES_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    category_name = str(row.get("category_name") or row.get("category") or "").strip()
                    sub_name = str(row.get("sub_industry_name") or row.get("name") or "").strip()
                    category_tag = str(row.get("category_tag") or "").strip()
                    sub_tag = str(row.get("sub_industry_tag") or row.get("tag") or "").strip()
                    if not category_name or not sub_name:
                        continue
                    directory_name = f"{category_name}_{sub_name}"
                    for alias in (directory_name, sub_name, category_tag, sub_tag):
                        if alias:
                            _bind(alias, directory_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to read %s: %s", INDUSTRY_SUBCATEGORIES_CSV, exc)

    return alias_map


def _resolve_industry_dir_name(lobster_id: str, industry_tag: str) -> str | None:
    raw = str(industry_tag or "").strip()
    if not raw:
        return None

    available = list(_list_available_industry_dirs(str(lobster_id or "").strip()))
    if not available:
        return None

    available_set = set(available)
    normalized_available = {name: _normalize_text(name) for name in available}
    collapsed_available = {name: _collapse_text(name) for name in available}

    if raw in available_set:
        return raw

    normalized_raw = _normalize_text(raw)
    collapsed_raw = _collapse_text(raw)

    normalized_to_name = {value: key for key, value in normalized_available.items() if value}
    collapsed_to_name = {value: key for key, value in collapsed_available.items() if value}

    if normalized_raw in normalized_to_name:
        return normalized_to_name[normalized_raw]
    if collapsed_raw in collapsed_to_name:
        return collapsed_to_name[collapsed_raw]

    alias_map = _load_official_industry_aliases()
    alias_hits = []
    for key in (normalized_raw, collapsed_raw):
        alias_hits.extend(sorted(alias_map.get(key, set())))
    for candidate in alias_hits:
        if candidate in available_set:
            return candidate

    ranked: list[tuple[int, str]] = []
    for directory_name in available:
        normalized_dir = normalized_available[directory_name]
        collapsed_dir = collapsed_available[directory_name]
        score = 0
        if normalized_raw and normalized_raw in normalized_dir:
            score = max(score, 60)
        if normalized_raw and normalized_dir.endswith(normalized_raw):
            score = max(score, 80)
        if collapsed_raw and collapsed_raw in collapsed_dir:
            score = max(score, 55)
        if collapsed_raw and collapsed_dir.endswith(collapsed_raw):
            score = max(score, 75)
        if score:
            ranked.append((score, directory_name))

    if not ranked:
        return None

    ranked.sort(key=lambda item: (-item[0], len(item[1]), item[1]))
    return ranked[0][1]


def _pack_file_paths(lobster_id: str, industry_dir_name: str) -> dict[str, Path]:
    pack_dir = KNOWLEDGE_PACKS_DIR / str(lobster_id or "").strip() / str(industry_dir_name or "").strip()
    return {name: pack_dir / name for name in PACK_FILE_NAMES}


def _format_item_lines(items: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("id") or "").strip()
        description = str(item.get("description") or "").strip()
        if not title and not description:
            continue
        priority = PRIORITY_LABELS.get(str(item.get("priority") or "").strip().lower(), "普通优先级")
        line = f"- {title}：{description} 【{priority}】" if description else f"- {title} 【{priority}】"
        examples = [str(example or "").strip() for example in (item.get("examples") or []) if str(example or "").strip()]
        if examples:
            line += f"\n  例：{'；'.join(examples[:2])}"
        lines.append(line)
    return lines


def _format_golden_case_lines(cases: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for case in cases[:2]:  # 最多 2 条，控制 token
        if not isinstance(case, dict):
            continue
        case_id = str(case.get("id") or "").strip()
        must_include = [str(m or "").strip() for m in (case.get("mustInclude") or []) if str(m or "").strip()]
        must_avoid = [str(m or "").strip() for m in (case.get("mustAvoid") or []) if str(m or "").strip()]
        if not must_include and not must_avoid:
            continue
        parts_inner: list[str] = []
        if case_id:
            parts_inner.append(f"案例：{case_id}")
        if must_include:
            parts_inner.append(f"  必须包含：{'；'.join(must_include[:3])}")
        if must_avoid:
            parts_inner.append(f"  必须避免：{'；'.join(must_avoid[:3])}")
        lines.append("\n".join(parts_inner))
    return lines


@lru_cache(maxsize=512)
def _load_industry_section_cached(lobster_id: str, industry_dir_name: str) -> str:
    paths = _pack_file_paths(lobster_id, industry_dir_name)
    rules_payload = _safe_read_json(paths["industry-rules.json"])
    hooks_payload = _safe_read_json(paths["hooks-library.json"])
    scoring_payload = _safe_read_json(paths["scoring-features.json"])
    cases_payload = _safe_read_json(paths["expanded-golden-cases.json"])

    sections: list[str] = []
    if isinstance(rules_payload.get("items"), list) and rules_payload.get("items"):
        sections.append(
            f"## 行业专属规则（{industry_dir_name}）\n"
            + "\n".join(_format_item_lines(rules_payload["items"]))
        )
    if isinstance(hooks_payload.get("items"), list) and hooks_payload.get("items"):
        sections.append(
            "## 行业触发钩子\n"
            + "\n".join(_format_item_lines(hooks_payload["items"]))
        )
    if isinstance(scoring_payload.get("items"), list) and scoring_payload.get("items"):
        sections.append(
            "## 评分标准\n"
            + "\n".join(_format_item_lines(scoring_payload["items"]))
        )
    # golden cases 使用 "cases" 键
    cases_list = cases_payload.get("cases") or cases_payload.get("items") or []
    if isinstance(cases_list, list) and cases_list:
        golden_lines = _format_golden_case_lines(cases_list)
        if golden_lines:
            sections.append("## 金样例参考\n" + "\n\n".join(golden_lines))
    return "\n\n".join(section for section in sections if section.strip())


def load_industry_section(lobster_id: str, industry_tag: str) -> str:
    """
    返回可以直接拼入 system_prompt 的行业知识段落。
    找不到对应行业时返回空字符串，不抛出异常。
    """

    try:
        industry_dir_name = _resolve_industry_dir_name(lobster_id, industry_tag)
        if not industry_dir_name:
            return ""
        return _load_industry_section_cached(str(lobster_id or "").strip(), industry_dir_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Knowledge pack loading failed for lobster=%s industry=%s: %s",
            lobster_id,
            industry_tag,
            exc,
        )
        return ""


def load_industry_pack_payloads(lobster_id: str, industry_tag: str, file_names: list[str] | None = None) -> dict[str, dict[str, Any]]:
    try:
        industry_dir_name = _resolve_industry_dir_name(lobster_id, industry_tag)
        if not industry_dir_name:
            return {}
        paths = _pack_file_paths(str(lobster_id or "").strip(), industry_dir_name)
        selected = file_names or list(PACK_FILE_NAMES)
        return {
            name: _safe_read_json(paths[name])
            for name in selected
            if name in paths
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Knowledge pack payload loading failed for lobster=%s industry=%s: %s",
            lobster_id,
            industry_tag,
            exc,
        )
        return {}
