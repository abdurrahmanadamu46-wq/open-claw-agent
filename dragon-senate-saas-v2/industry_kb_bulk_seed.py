from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from industry_kb_pool import ingest_entries
from industry_kb_pool import upsert_profile
from industry_taxonomy import all_subindustry_records
from industry_taxonomy import profile_seed_from_tag


def _default_profile_template() -> dict[str, Any]:
    return {
        "industry_name": "中餐馆",
        "pain_points": [
            f"消费者痛点{i}：担心价格不透明、服务不稳定、售后难追溯"
            for i in range(1, 31)
        ],
        "jargon_terms": [f"行业消费术语{i}" for i in range(1, 121)],
        "solutions": [
            f"转化钩子{i}：明码标价、流程可视、履约可追踪、售后可达"
            for i in range(1, 31)
        ],
        "objections": [
            {
                "objection": f"消费者异议{i}：担心花钱不值。",
                "response_logic": "先给低门槛体验与可验证证据，再做方案匹配和风险兜底。",
            }
            for i in range(1, 21)
        ],
        "banned_absolute": [
            {
                "term": f"绝对化词{i}",
                "reason": "属于绝对化或保证性承诺，存在监管与平台审核风险。",
                "safer_alternative": "改为可验证、非保证、非极限的中性描述。",
            }
            for i in range(1, 41)
        ],
        "banned_industry": [
            {
                "term": f"行业红线词{i}",
                "reason": "属于行业高敏表达，可能触发违规宣传、导流或欺诈判定。",
                "safer_alternative": "改为平台内承接、事实描述、风险提示完整的表达。",
            }
            for i in range(1, 41)
        ],
        "risk_behaviors": [
            {
                "behavior": f"风险行为{i}：口播或评论引导用户站外沟通与交易。",
                "risk_type": "违规引流/私下交易",
                "platform_hint": "抖音/视频号/快手/小红书通用",
                "safer_alternative": "统一使用平台内留资组件、官方私信与店铺链路承接。",
            }
            for i in range(1, 26)
        ],
    }


DEFAULT_BASE_PROFILE: dict[str, Any] = _default_profile_template()


def _safe_read_text(path: str | None) -> str:
    if not path:
        return ""
    target = Path(path)
    if not target.exists():
        return ""
    try:
        return target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return target.read_text(encoding="gbk", errors="ignore")


def load_json_profile(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    text = _safe_read_text(path)
    if not text.strip():
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _normalize_str_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [str(item).strip() for item in values if str(item).strip()]


def _normalize_object_list(values: Any, fallback_key: str) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, dict):
            rows.append({str(k): v for k, v in item.items()})
        else:
            text = str(item).strip()
            if text:
                rows.append({fallback_key: text})
    return rows


def normalize_profile(payload: dict[str, Any] | None) -> dict[str, Any]:
    src = dict(payload or {})
    out: dict[str, Any] = {}
    out["industry_name"] = str(src.get("industry_name") or DEFAULT_BASE_PROFILE["industry_name"]).strip()
    out["pain_points"] = _normalize_str_list(src.get("pain_points"))
    out["jargon_terms"] = _normalize_str_list(src.get("jargon_terms"))
    out["solutions"] = _normalize_str_list(src.get("solutions"))
    out["objections"] = _normalize_object_list(src.get("objections"), "objection")
    out["banned_absolute"] = _normalize_object_list(src.get("banned_absolute"), "term")
    out["banned_industry"] = _normalize_object_list(src.get("banned_industry"), "term")
    out["risk_behaviors"] = _normalize_object_list(src.get("risk_behaviors"), "behavior")
    return out


def _replace_industry_words(text: str, target_name: str) -> str:
    if not text:
        return text
    result = str(text)
    for token in ("中餐馆", "餐饮门店", "门店"):
        result = result.replace(token, target_name)
    return result


def _profile_for_subindustry(base_profile: dict[str, Any], target_name: str) -> dict[str, Any]:
    profile = normalize_profile(deepcopy(base_profile))
    profile["industry_name"] = target_name

    def _map_items(values: list[Any]) -> list[Any]:
        mapped: list[Any] = []
        for item in values:
            if isinstance(item, str):
                mapped.append(_replace_industry_words(item, target_name))
            elif isinstance(item, dict):
                mapped.append(
                    {
                        key: _replace_industry_words(value, target_name) if isinstance(value, str) else value
                        for key, value in item.items()
                    }
                )
        return mapped

    profile["pain_points"] = _map_items(list(profile.get("pain_points") or []))
    profile["jargon_terms"] = _map_items(list(profile.get("jargon_terms") or []))
    profile["solutions"] = _map_items(list(profile.get("solutions") or []))
    profile["objections"] = _map_items(list(profile.get("objections") or []))
    profile["banned_absolute"] = _map_items(list(profile.get("banned_absolute") or []))
    profile["banned_industry"] = _map_items(list(profile.get("banned_industry") or []))
    profile["risk_behaviors"] = _map_items(list(profile.get("risk_behaviors") or []))
    return profile


def _term_content(industry_name: str, term: str) -> str:
    return f"{industry_name}术语：{term}。用于经营、投放、线索转化与团队协同场景。"


def profile_to_entries(profile: dict[str, Any], prompt_text: str = "") -> list[dict[str, Any]]:
    industry_name = str(profile.get("industry_name") or "通用行业")
    entries: list[dict[str, Any]] = []

    for item in list(profile.get("pain_points") or []):
        text = str(item).strip()
        if not text:
            continue
        entries.append(
            {
                "entry_type": "pain_point",
                "title": text[:80],
                "content": text,
                "effect_score": 72.0,
                "metadata": {"industry_name": industry_name, "source": "bulk_seed"},
            }
        )

    for item in list(profile.get("jargon_terms") or []):
        term = str(item).strip()
        if not term:
            continue
        entries.append(
            {
                "entry_type": "jargon",
                "title": term[:80],
                "content": _term_content(industry_name, term),
                "effect_score": 65.0,
                "metadata": {"industry_name": industry_name, "source": "bulk_seed"},
            }
        )

    for item in list(profile.get("solutions") or []):
        text = str(item).strip()
        if not text:
            continue
        entries.append(
            {
                "entry_type": "solution",
                "title": text[:80],
                "content": text,
                "effect_score": 84.0,
                "metadata": {"industry_name": industry_name, "source": "bulk_seed"},
            }
        )

    for item in list(profile.get("objections") or []):
        objection = str(item.get("objection") or "").strip() if isinstance(item, dict) else str(item).strip()
        response = str(item.get("response_logic") or "").strip() if isinstance(item, dict) else ""
        if not objection:
            continue
        content = objection if not response else f"客户异议：{objection}\n应对逻辑：{response}"
        entries.append(
            {
                "entry_type": "sales_objection",
                "title": objection[:80],
                "content": content,
                "effect_score": 78.0,
                "metadata": {"industry_name": industry_name, "source": "bulk_seed"},
            }
        )

    for item in list(profile.get("banned_absolute") or []):
        term = str(item.get("term") or "").strip() if isinstance(item, dict) else str(item).strip()
        reason = str(item.get("reason") or "").strip() if isinstance(item, dict) else ""
        safer = str(item.get("safer_alternative") or "").strip() if isinstance(item, dict) else ""
        if not term:
            continue
        entries.append(
            {
                "entry_type": "compliance_ban_absolute",
                "title": term[:80],
                "content": (
                    f"违禁词：{term}\n"
                    f"原因：{reason or '绝对化/夸大风险'}\n"
                    f"安全替代表述：{safer or '改为可验证、非保证性表达'}"
                ),
                "effect_score": 92.0,
                "metadata": {"industry_name": industry_name, "source": "bulk_seed"},
            }
        )

    for item in list(profile.get("banned_industry") or []):
        term = str(item.get("term") or "").strip() if isinstance(item, dict) else str(item).strip()
        reason = str(item.get("reason") or "").strip() if isinstance(item, dict) else ""
        safer = str(item.get("safer_alternative") or "").strip() if isinstance(item, dict) else ""
        if not term:
            continue
        entries.append(
            {
                "entry_type": "compliance_ban_industry",
                "title": term[:80],
                "content": (
                    f"行业红线词：{term}\n"
                    f"原因：{reason or '行业特定高风险表达'}\n"
                    f"安全替代表述：{safer or '改为合规业务描述'}"
                ),
                "effect_score": 94.0,
                "metadata": {"industry_name": industry_name, "source": "bulk_seed"},
            }
        )

    for item in list(profile.get("risk_behaviors") or []):
        behavior = str(item.get("behavior") or "").strip() if isinstance(item, dict) else str(item).strip()
        risk_type = str(item.get("risk_type") or "").strip() if isinstance(item, dict) else ""
        platform_hint = str(item.get("platform_hint") or "").strip() if isinstance(item, dict) else ""
        safer = str(item.get("safer_alternative") or "").strip() if isinstance(item, dict) else ""
        if not behavior:
            continue
        entries.append(
            {
                "entry_type": "risk_behavior",
                "title": behavior[:80],
                "content": (
                    f"风险行为：{behavior}\n"
                    f"风险类型：{risk_type or '合规风险'}\n"
                    f"平台提示：{platform_hint or '全平台通用'}\n"
                    f"更安全替代：{safer or '改为平台内合规承接'}"
                ),
                "effect_score": 90.0,
                "metadata": {"industry_name": industry_name, "source": "bulk_seed"},
            }
        )

    if prompt_text.strip():
        entries.append(
            {
                "entry_type": "system_prompt",
                "title": f"{industry_name}知识官提示词",
                "content": prompt_text.replace("{{industry_name}}", industry_name),
                "effect_score": 70.0,
                "metadata": {"industry_name": industry_name, "source": "lobster_system_prompt_v2"},
            }
        )

    return entries


def seed_all_subindustries(
    *,
    tenant_id: str,
    actor_user_id: str,
    base_profile: dict[str, Any] | None = None,
    prompt_template_path: str | None = None,
    selected_tags: list[str] | None = None,
) -> dict[str, Any]:
    profile_source = normalize_profile(base_profile or DEFAULT_BASE_PROFILE)
    prompt_text = _safe_read_text(prompt_template_path)

    rows = all_subindustry_records()
    allow = {str(item).strip() for item in (selected_tags or []) if str(item).strip()}
    if allow:
        rows = [row for row in rows if str(row.get("tag", "")).strip() in allow]

    summaries: list[dict[str, Any]] = []
    total_ingested = 0
    total_rejected = 0
    total_duplicates = 0

    for row in rows:
        tag = str(row.get("tag") or "general").strip() or "general"
        name = str(row.get("name") or tag)
        seed = profile_seed_from_tag(tag)
        generated = _profile_for_subindustry(profile_source, name)

        merged_config = dict(seed.get("config", {}) or {})
        merged_config["structured_profile"] = generated
        merged_config["profile_stats"] = {
            "pain_points": len(generated.get("pain_points") or []),
            "jargon_terms": len(generated.get("jargon_terms") or []),
            "solutions": len(generated.get("solutions") or []),
            "objections": len(generated.get("objections") or []),
            "banned_absolute": len(generated.get("banned_absolute") or []),
            "banned_industry": len(generated.get("banned_industry") or []),
            "risk_behaviors": len(generated.get("risk_behaviors") or []),
        }

        upsert_profile(
            tenant_id=tenant_id,
            industry_tag=tag,
            display_name=str(seed.get("display_name") or f"{name}知识库"),
            description=str(seed.get("description") or f"{name}专属知识资产"),
            status="active",
            config=merged_config,
        )

        entries = profile_to_entries(generated, prompt_text=prompt_text)
        ingest_result = ingest_entries(
            tenant_id=tenant_id,
            industry_tag=tag,
            entries=entries,
            trace_id=f"bulk_seed_{tenant_id}_{tag}",
            actor_user_id=actor_user_id,
        )

        ingested_count = int(ingest_result.get("ingested_count", 0) or 0)
        rejected_count = int(ingest_result.get("rejected_count", 0) or 0)
        duplicate_count = int(ingest_result.get("duplicate_count", 0) or 0)
        vector_count = int(ingest_result.get("vector_count", 0) or 0)

        total_ingested += ingested_count
        total_rejected += rejected_count
        total_duplicates += duplicate_count

        summaries.append(
            {
                "industry_tag": tag,
                "industry_name": name,
                "ingested_count": ingested_count,
                "rejected_count": rejected_count,
                "duplicate_count": duplicate_count,
                "vector_count": vector_count,
            }
        )

    return {
        "ok": True,
        "tenant_id": tenant_id,
        "industry_count": len(rows),
        "total_ingested": total_ingested,
        "total_rejected": total_rejected,
        "total_duplicates": total_duplicates,
        "summaries": summaries,
        "prompt_template_loaded": bool(prompt_text.strip()),
    }
