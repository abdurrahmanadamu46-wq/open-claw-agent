"""
Lobster bootstrap manager.

Tracks whether a lobster has completed its first-run onboarding in a session,
persists the result into session metadata, and mirrors the summary into the
lobster's lightweight file memory.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lobsters.lobster_memory import LobsterMemory
from session_manager import SessionContext, get_session_manager


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


PACKAGES_ROOT = Path(__file__).resolve().parent.parent / "packages" / "lobsters"
DEFAULT_TENANT_ID = os.getenv("LOBSTER_DEFAULT_TENANT_ID", "tenant_main").strip() or "tenant_main"


BOOTSTRAP_SCHEMAS: dict[str, dict[str, Any]] = {
    "commander": {
        "fields": ["account", "industry", "primary_goal"],
        "defaults": {"industry": "综合电商", "primary_goal": "品牌曝光"},
    },
    "radar": {
        "fields": ["account", "competitor_watchlist"],
        "defaults": {"competitor_watchlist": "默认监控同城头部账号"},
    },
    "strategist": {
        "fields": ["industry", "primary_kpi"],
        "defaults": {"industry": "综合电商", "primary_kpi": "曝光量"},
    },
    "inkwriter": {
        "fields": ["account", "brand_tone"],
        "defaults": {"brand_tone": "亲切可信"},
    },
    "visualizer": {
        "fields": ["platform", "visual_style"],
        "defaults": {"platform": "抖音", "visual_style": "真实种草"},
    },
    "dispatcher": {
        "fields": ["account", "best_time_window"],
        "defaults": {"best_time_window": "晚上"},
    },
    "echoer": {
        "fields": ["account", "reply_style", "forbidden_keywords"],
        "defaults": {"reply_style": "亲切活泼", "forbidden_keywords": "无"},
    },
    "catcher": {
        "fields": ["product", "high_intent_signals"],
        "defaults": {"high_intent_signals": "主动问价格、问地址、要联系方式"},
    },
    "abacus": {
        "fields": ["reporting_cycle", "primary_metric"],
        "defaults": {"reporting_cycle": "周报", "primary_metric": "ROI"},
    },
    "followup": {
        "fields": ["followup_scenario", "silence_threshold"],
        "defaults": {"followup_scenario": "咨询未下单", "silence_threshold": "24小时"},
    },
}


OPTION_MAPPINGS: dict[str, dict[str, str]] = {
    "primary_goal": {
        "a": "涨粉涨流量",
        "b": "带货转化",
        "c": "品牌曝光",
        "d": "其他",
    },
    "reply_style": {
        "a": "亲切活泼",
        "b": "专业正式",
        "c": "幽默搞笑",
        "d": "由我决定",
    },
    "high_intent_signals": {
        "a": "主动问价格",
        "b": "询问门店地址",
        "c": "要求加微信",
        "d": "以上都是",
    },
    "followup_scenario": {
        "a": "咨询过但未下单",
        "b": "下单后复购引导",
        "c": "流失客户唤醒",
        "d": "以上都要",
    },
}


def load_bootstrap_md(lobster_id: str) -> str:
    path = PACKAGES_ROOT / f"lobster-{lobster_id}" / "BOOTSTRAP.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _schema_for(lobster_id: str) -> dict[str, Any]:
    return BOOTSTRAP_SCHEMAS.get(str(lobster_id or "").strip().lower(), {"fields": ["account", "primary_goal"], "defaults": {}})


def _ensure_session(session_id: str, lobster_id: str) -> SessionContext:
    session_mgr = get_session_manager()
    existing = session_mgr.get_session(session_id)
    if existing is not None:
        return existing
    return session_mgr.get_or_create(
        peer_id=session_id,
        lobster_id=lobster_id,
        mode="per-peer",
        channel="bootstrap",
        tenant_id=DEFAULT_TENANT_ID,
        session_id=session_id,
    )


def _normalize_value(field_name: str, raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    lowered = text.lower()
    mapping = OPTION_MAPPINGS.get(field_name, {})
    if lowered in mapping:
        return mapping[lowered]
    if len(lowered) == 1 and lowered in mapping:
        return mapping[lowered]
    return text


def _matches_field(field_name: str, text: str) -> bool:
    lowered = str(text or "").strip().lower()
    if not lowered:
        return False
    if field_name == "account":
        return any(token in lowered for token in ["@", "抖音", "小红书", "视频号", "账号", "平台"])
    if field_name == "industry":
        return any(token in lowered for token in ["餐饮", "服饰", "美妆", "教育", "家装", "珠宝", "本地生活", "电商"])
    if field_name in {"primary_goal", "reply_style", "high_intent_signals", "followup_scenario"}:
        return lowered in OPTION_MAPPINGS.get(field_name, {}) or any(ch in lowered for ch in ["a", "b", "c", "d", "涨粉", "曝光", "正式", "活泼", "价格", "地址", "复购", "唤醒"])
    if field_name in {"platform", "best_time_window", "reporting_cycle", "primary_metric", "brand_tone", "visual_style", "silence_threshold", "product", "competitor_watchlist", "primary_kpi"}:
        return True
    return True


def _bootstrap_bucket(session: SessionContext) -> dict[str, Any]:
    metadata = dict(session.metadata or {})
    bucket = metadata.get("bootstrap")
    if isinstance(bucket, dict):
        return bucket
    return {}


def check_bootstrap_status(lobster_id: str, session_id: str) -> bool:
    session = _ensure_session(session_id, lobster_id)
    bucket = _bootstrap_bucket(session)
    entry = bucket.get(lobster_id)
    return bool(isinstance(entry, dict) and entry.get("bootstrap_complete"))


def get_bootstrap_data(lobster_id: str, session_id: str) -> dict[str, Any] | None:
    session = _ensure_session(session_id, lobster_id)
    bucket = _bootstrap_bucket(session)
    entry = bucket.get(lobster_id)
    if isinstance(entry, dict):
        return dict(entry)
    return None


def get_bootstrap_status_payload(lobster_id: str, session_id: str) -> dict[str, Any]:
    session = _ensure_session(session_id, lobster_id)
    schema = _schema_for(lobster_id)
    user_turns = [
        str(item.get("content") or "").strip()
        for item in (session.messages or [])
        if isinstance(item, dict) and str(item.get("role") or "").strip() == "user" and str(item.get("content") or "").strip()
    ]
    data = get_bootstrap_data(lobster_id, session_id)
    return {
        "session_id": session.session_id,
        "lobster_id": lobster_id,
        "bootstrap_complete": bool(data and data.get("bootstrap_complete")),
        "required_fields": list(schema.get("fields", [])),
        "captured_user_turns": len(user_turns),
        "bootstrap_data": data,
    }


async def mark_bootstrap_complete(lobster_id: str, session_id: str, bootstrap_data: dict[str, Any]) -> dict[str, Any]:
    session = _ensure_session(session_id, lobster_id)
    schema = _schema_for(lobster_id)
    defaults = dict(schema.get("defaults", {}))
    normalized = {
        key: _normalize_value(key, value)
        for key, value in dict(bootstrap_data or {}).items()
        if str(key).strip()
    }
    for key, default_value in defaults.items():
        if not str(normalized.get(key) or "").strip():
            normalized[key] = default_value
    normalized["bootstrap_complete"] = True
    normalized["bootstrap_at"] = str(normalized.get("bootstrap_at") or _utc_now())
    normalized["session_id"] = session.session_id
    normalized["tenant_id"] = session.tenant_id

    bucket = _bootstrap_bucket(session)
    bucket[lobster_id] = normalized
    get_session_manager().update_metadata(session.session_id, {"bootstrap": bucket})

    memory = LobsterMemory(lobster_id, session.tenant_id)
    await memory.remember(
        "context",
        f"bootstrap_{session.session_id}",
        json.dumps(normalized, ensure_ascii=False, indent=2),
        metadata={"kind": "bootstrap", "session_id": session.session_id},
    )
    return normalized


async def reset_bootstrap(lobster_id: str, session_id: str) -> bool:
    session = _ensure_session(session_id, lobster_id)
    bucket = _bootstrap_bucket(session)
    if lobster_id not in bucket:
        return False
    bucket.pop(lobster_id, None)
    get_session_manager().update_metadata(session.session_id, {"bootstrap": bucket})
    memory = LobsterMemory(lobster_id, session.tenant_id)
    await memory.forget("context", f"bootstrap_{session.session_id}")
    return True


def infer_bootstrap_payload(lobster_id: str, session_id: str) -> dict[str, Any] | None:
    session = _ensure_session(session_id, lobster_id)
    schema = _schema_for(lobster_id)
    fields = list(schema.get("fields", []))
    user_turns = [
        str(item.get("content") or "").strip()
        for item in (session.messages or [])
        if isinstance(item, dict) and str(item.get("role") or "").strip() == "user" and str(item.get("content") or "").strip()
    ]
    if len(user_turns) < len(fields):
        return None
    payload = {}
    remaining = list(user_turns)
    for field_name in fields:
        chosen = ""
        for index, text in enumerate(remaining):
            if _matches_field(field_name, text):
                chosen = text
                remaining.pop(index)
                break
        payload[field_name] = _normalize_value(field_name, chosen)
    return payload


async def maybe_complete_bootstrap(lobster_id: str, session_id: str) -> dict[str, Any] | None:
    if check_bootstrap_status(lobster_id, session_id):
        return get_bootstrap_data(lobster_id, session_id)
    inferred = infer_bootstrap_payload(lobster_id, session_id)
    if inferred is None:
        return None
    return await mark_bootstrap_complete(lobster_id, session_id, inferred)
