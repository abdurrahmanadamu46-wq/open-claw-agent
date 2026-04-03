from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from llm_router import RouteMeta
from llm_router import llm_router


REQUIRED_KEYS = [
    "industry_name",
    "pain_points",
    "jargon_terms",
    "solutions",
    "objections",
    "banned_absolute",
    "banned_industry",
    "risk_behaviors",
]

STRICT_COUNTS: dict[str, int] = {
    "pain_points": 30,
    "jargon_terms": 120,
    "solutions": 30,
    "objections": 20,
    "banned_absolute": 40,
    "banned_industry": 40,
    "risk_behaviors": 25,
}

# 经营侧词汇（用于拦截“老板视角”污染消费者洞察）
OWNER_VIEW_HINTS = [
    "获客成本",
    "投流",
    "核销",
    "翻台率",
    "坪效",
    "人效",
    "营收",
    "净利",
    "毛利",
    "sku",
    "老板",
    "门店经营",
    "加盟商",
    "招商",
    "供应链",
    "私域沉淀",
]


def profile_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": REQUIRED_KEYS,
        "properties": {
            "industry_name": {"type": "string", "minLength": 1},
            "pain_points": {"type": "array", "items": {"type": "string"}},
            "jargon_terms": {"type": "array", "items": {"type": "string"}},
            "solutions": {"type": "array", "items": {"type": "string"}},
            "objections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["objection", "response_logic"],
                    "properties": {
                        "objection": {"type": "string"},
                        "response_logic": {"type": "string"},
                    },
                    "additionalProperties": True,
                },
            },
            "banned_absolute": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["term", "reason", "safer_alternative"],
                    "properties": {
                        "term": {"type": "string"},
                        "reason": {"type": "string"},
                        "safer_alternative": {"type": "string"},
                    },
                    "additionalProperties": True,
                },
            },
            "banned_industry": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["term", "reason", "safer_alternative"],
                    "properties": {
                        "term": {"type": "string"},
                        "reason": {"type": "string"},
                        "safer_alternative": {"type": "string"},
                    },
                    "additionalProperties": True,
                },
            },
            "risk_behaviors": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["behavior", "risk_type", "platform_hint", "safer_alternative"],
                    "properties": {
                        "behavior": {"type": "string"},
                        "risk_type": {"type": "string"},
                        "platform_hint": {"type": "string"},
                        "safer_alternative": {"type": "string"},
                    },
                    "additionalProperties": True,
                },
            },
        },
    }


def _extract_json(text: str) -> dict[str, Any]:
    content = str(text or "").strip()
    if not content:
        raise ValueError("empty llm output")

    if content.startswith("```"):
        fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", content, flags=re.DOTALL | re.IGNORECASE)
        if fence:
            content = fence.group(1).strip()

    if content.startswith("{") and content.endswith("}"):
        return json.loads(content)

    match = re.search(r"(\{[\s\S]*\})", content)
    if not match:
        raise ValueError("json object not found")
    return json.loads(match.group(1))


def _normalize_str_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = str(item).strip()
        if not text:
            continue
        key = re.sub(r"\s+", " ", text).strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def _normalize_object_list(values: Any, fields: list[str]) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []

    rows: list[dict[str, str]] = []
    for item in values:
        if isinstance(item, dict):
            row = {field: str(item.get(field) or "").strip() for field in fields}
            if any(row.values()):
                rows.append(row)
            continue
        text = str(item).strip()
        if not text:
            continue
        row = {field: "" for field in fields}
        row[fields[0]] = text
        rows.append(row)

    deduped: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        key = "||".join(re.sub(r"\s+", " ", str(row.get(field) or "")).strip().lower() for field in fields)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _trim_to_required_counts(profile: dict[str, Any]) -> dict[str, Any]:
    trimmed = dict(profile)
    for key, required in STRICT_COUNTS.items():
        value = trimmed.get(key)
        if isinstance(value, list) and len(value) > required:
            trimmed[key] = value[:required]
    return trimmed


def normalize_profile(payload: dict[str, Any], industry_name: str) -> dict[str, Any]:
    profile: dict[str, Any] = {}
    # 强制使用请求中的行业名，避免模型返回乱码/漂移行业名污染主键
    profile["industry_name"] = str(industry_name).strip() or "general"
    profile["pain_points"] = _normalize_str_list(payload.get("pain_points"))
    profile["jargon_terms"] = _normalize_str_list(payload.get("jargon_terms"))
    profile["solutions"] = _normalize_str_list(payload.get("solutions"))
    profile["objections"] = _normalize_object_list(payload.get("objections"), ["objection", "response_logic"])
    profile["banned_absolute"] = _normalize_object_list(
        payload.get("banned_absolute"),
        ["term", "reason", "safer_alternative"],
    )
    profile["banned_industry"] = _normalize_object_list(
        payload.get("banned_industry"),
        ["term", "reason", "safer_alternative"],
    )
    profile["risk_behaviors"] = _normalize_object_list(
        payload.get("risk_behaviors"),
        ["behavior", "risk_type", "platform_hint", "safer_alternative"],
    )
    return _trim_to_required_counts(profile)


def _validation_errors(profile: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    for key in REQUIRED_KEYS:
        if key not in profile:
            errors.append(f"missing key: {key}")

    def _bad_text(value: Any) -> bool:
        text = str(value or "").strip()
        if not text:
            return True
        if text in {"???", "unknown", "n/a", "待补充", "未设置"}:
            return True
        if text.count("?") >= max(2, len(text) // 3):
            return True
        return False

    if _bad_text(profile.get("industry_name")):
        errors.append("industry_name invalid")

    for key, required in STRICT_COUNTS.items():
        value = profile.get(key)
        if not isinstance(value, list):
            errors.append(f"{key} is not list")
            continue
        if len(value) != required:
            errors.append(f"{key} count invalid ({len(value)} != {required})")

    pain_points = [x for x in (profile.get("pain_points") or []) if not _bad_text(x)]
    jargon_terms = [x for x in (profile.get("jargon_terms") or []) if not _bad_text(x)]
    solutions = [x for x in (profile.get("solutions") or []) if not _bad_text(x)]
    objections = [
        x
        for x in (profile.get("objections") or [])
        if isinstance(x, dict) and not _bad_text(x.get("objection")) and not _bad_text(x.get("response_logic"))
    ]
    banned_absolute = [
        x
        for x in (profile.get("banned_absolute") or [])
        if isinstance(x, dict)
        and not _bad_text(x.get("term"))
        and not _bad_text(x.get("reason"))
        and not _bad_text(x.get("safer_alternative"))
    ]
    banned_industry = [
        x
        for x in (profile.get("banned_industry") or [])
        if isinstance(x, dict)
        and not _bad_text(x.get("term"))
        and not _bad_text(x.get("reason"))
        and not _bad_text(x.get("safer_alternative"))
    ]
    risk_behaviors = [
        x
        for x in (profile.get("risk_behaviors") or [])
        if isinstance(x, dict)
        and not _bad_text(x.get("behavior"))
        and not _bad_text(x.get("risk_type"))
        and not _bad_text(x.get("platform_hint"))
        and not _bad_text(x.get("safer_alternative"))
    ]

    if len(pain_points) != STRICT_COUNTS["pain_points"]:
        errors.append("pain_points quality invalid")
    if len(jargon_terms) != STRICT_COUNTS["jargon_terms"]:
        errors.append("jargon_terms quality invalid")
    if len(solutions) != STRICT_COUNTS["solutions"]:
        errors.append("solutions quality invalid")
    if len(objections) != STRICT_COUNTS["objections"]:
        errors.append("objections quality invalid")
    if len(banned_absolute) != STRICT_COUNTS["banned_absolute"]:
        errors.append("banned_absolute quality invalid")
    if len(banned_industry) != STRICT_COUNTS["banned_industry"]:
        errors.append("banned_industry quality invalid")
    if len(risk_behaviors) != STRICT_COUNTS["risk_behaviors"]:
        errors.append("risk_behaviors quality invalid")

    combined = [str(x) for x in pain_points] + [str(x) for x in solutions]
    if combined:
        owner_hits = 0
        for text in combined:
            text_norm = str(text).lower()
            if any(hint.lower() in text_norm for hint in OWNER_VIEW_HINTS):
                owner_hits += 1
        if owner_hits > max(3, int(len(combined) * 0.1)):
            errors.append("consumer_perspective_invalid: too many owner-view terms")

    return errors


def _build_system_prompt(system_prompt_template: str | None = None) -> str:
    schema_text = json.dumps(profile_schema(), ensure_ascii=False, indent=2)
    base = (
        "你是行业消费者洞察知识官与内容风控专家。你必须输出一个严格 JSON 对象，不要输出任何解释文字。\n"
        "禁止 markdown 代码块、禁止额外字段、禁止省略字段。\n"
        "输出必须满足以下 JSON Schema：\n"
        f"{schema_text}\n"
        "内容要求：\n"
        "1) 只允许中国大陆语境，且必须是细分赛道目标客户（消费者/终端用户）视角，不得输出老板经营视角。\n"
        "2) 严格满足数量：pain_points=30, jargon_terms=120, solutions=30, objections=20, banned_absolute=40, banned_industry=40, risk_behaviors=25。\n"
        "3) 不得出现绝对化承诺、收益保证、医疗疗效暗示、私域导流、站外交易引导。\n"
        "4) 数组内容必须去重，不得出现空值、占位符、同上/等等。\n"
        "5) safer_alternative 必须给出可执行合规改写方向。\n"
    )
    tail = str(system_prompt_template or "").strip()
    return base if not tail else f"{base}\n附加系统约束：\n{tail}"


def _build_user_prompt(industry_name: str, base_profile: dict[str, Any]) -> str:
    sample = json.dumps(base_profile, ensure_ascii=False, indent=2)
    return (
        f"目标行业：{industry_name}\n"
        "请生成目标行业专属消费者洞察与合规词库 JSON。\n"
        "字段结构必须一致，内容必须完全重写并严格满足数量要求。\n"
        "禁止老板经营视角词（如获客成本/坪效/投流/核销）主导内容。\n"
        "母版仅用于字段结构参考，不能机械替换。\n"
        f"母版 JSON：\n{sample}"
    )


def _fallback_profile(industry_name: str, base_profile: dict[str, Any]) -> dict[str, Any]:
    raw = normalize_profile(base_profile, industry_name=industry_name)
    replaced = json.loads(json.dumps(raw, ensure_ascii=False))

    def _patch_text(text: str) -> str:
        result = str(text or "")
        for token in ("中餐馆", "餐饮门店", "门店"):
            result = result.replace(token, industry_name)
        return result

    replaced["industry_name"] = industry_name
    for key in ("pain_points", "jargon_terms", "solutions"):
        replaced[key] = [_patch_text(item) for item in list(replaced.get(key) or [])]

    for key in ("objections", "banned_absolute", "banned_industry", "risk_behaviors"):
        out: list[dict[str, Any]] = []
        for item in list(replaced.get(key) or []):
            if not isinstance(item, dict):
                continue
            out.append({k: _patch_text(v) if isinstance(v, str) else v for k, v in item.items()})
        replaced[key] = out

    return normalize_profile(replaced, industry_name=industry_name)


async def generate_profile_with_retry(
    *,
    industry_name: str,
    tenant_id: str,
    user_id: str,
    base_profile: dict[str, Any],
    system_prompt_template: str = "",
    max_retries: int = 3,
    sleep_sec: float = 0.8,
    allow_fallback: bool = True,
) -> dict[str, Any]:
    retries = max(1, int(max_retries))
    system_prompt = _build_system_prompt(system_prompt_template)
    user_prompt = _build_user_prompt(industry_name, base_profile)
    last_error = ""

    for attempt in range(1, retries + 1):
        try:
            text = await llm_router.routed_ainvoke_text(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=max(1500, len(system_prompt + user_prompt) // 2),
                    tenant_tier="pro",
                    user_id=user_id,
                    tenant_id=tenant_id,
                    task_type="industry_kb_generate",
                ),
                temperature=0.2,
            )
            payload = _extract_json(text)
            profile = normalize_profile(payload, industry_name=industry_name)
            errors = _validation_errors(profile)
            if errors:
                raise ValueError("; ".join(errors))
            return {
                "ok": True,
                "attempt": attempt,
                "profile": profile,
                "raw_text": text,
            }
        except Exception as exc:
            last_error = str(exc)
            if attempt < retries and sleep_sec > 0:
                await asyncio.sleep(float(sleep_sec))

    if allow_fallback:
        fallback = _fallback_profile(industry_name, base_profile)
        fallback_errors = _validation_errors(fallback)
        if fallback_errors:
            return {
                "ok": False,
                "attempt": retries,
                "error": (last_error + "; fallback_invalid: " + "; ".join(fallback_errors)).strip("; "),
                "profile": normalize_profile({}, industry_name=industry_name),
                "raw_text": "",
            }
        return {
            "ok": True,
            "attempt": retries,
            "fallback_used": True,
            "error": last_error or "generation_failed",
            "profile": fallback,
            "raw_text": "",
        }

    return {
        "ok": False,
        "attempt": retries,
        "error": last_error or "generation_failed",
        "profile": normalize_profile({}, industry_name=industry_name),
        "raw_text": "",
    }
