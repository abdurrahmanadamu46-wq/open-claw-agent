from __future__ import annotations

import os
from typing import Any

from industry_taxonomy import all_subindustry_records
from workflow_template_registry import resolve_active_template


COARSE_KEYWORDS: dict[str, list[str]] = {
    "hotel": ["酒店", "民宿", "客栈", "旅店", "hotel", "resort"],
    "restaurant": ["餐饮", "火锅", "烧烤", "奶茶", "咖啡", "restaurant", "food"],
    "beauty": ["美业", "美容", "美甲", "医美", "护肤", "beauty"],
    "education": ["教育", "培训", "考研", "课程", "education"],
    "retail": ["零售", "门店", "生鲜", "药店", "母婴", "retail"],
    "housekeeping": ["家政", "保洁", "搬家", "开锁", "维修", "housekeeping"],
    "tcm": ["中医", "理疗", "养生", "艾灸", "药方", "tcm"],
}


def _specific_env_key(industry_tag: str) -> str:
    return f"COMFYUI_WORKFLOW_PATH_{industry_tag.upper()}"


def _env_workflow_path(industry_tag: str) -> str:
    for key in (_specific_env_key(industry_tag), "COMFYUI_WORKFLOW_PATH"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    return ""


def detect_industry(task_description: str, topics: list[str] | None = None) -> str:
    text = " ".join([task_description or ""] + (topics or [])).strip().lower()
    if not text:
        return "general"

    for row in all_subindustry_records():
        aliases = [str(row.get("name", "")).strip().lower()] + [
            str(item).strip().lower() for item in row.get("aliases", []) if str(item).strip()
        ]
        if any(alias and alias in text for alias in aliases):
            return str(row.get("tag", "general"))

    for coarse, keywords in COARSE_KEYWORDS.items():
        if any(keyword.lower() in text for keyword in keywords):
            return coarse
    return "general"


def resolve_workflow(industry: str) -> dict[str, Any]:
    selected = str(industry or "general").strip().lower() or "general"
    registry_row = resolve_active_template(selected)
    if bool(registry_row.get("has_workflow")):
        return {
            "industry": selected,
            "env_key": "",
            "workflow_path": str(registry_row.get("workflow_path", "")),
            "has_workflow": True,
            "source": str(registry_row.get("source", "registry")),
        }

    env_key = _specific_env_key(selected)
    workflow_path = _env_workflow_path(selected)
    return {
        "industry": selected,
        "env_key": env_key,
        "workflow_path": workflow_path,
        "has_workflow": bool(workflow_path),
        "source": "env",
    }


def list_workflow_templates() -> list[dict[str, Any]]:
    tags = sorted({str(row.get("tag", "general")) for row in all_subindustry_records()} | {"general"})
    return [resolve_workflow(tag) for tag in tags]

