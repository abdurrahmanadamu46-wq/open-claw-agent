from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Iterable

from policy_bandit import recommend_policy


REPO_ROOT = Path(__file__).resolve().parent.parent
OPERATING_MODEL_PATH = REPO_ROOT / "packages" / "lobsters" / "lobster-operating-model.json"
ROLE_CARD_GLOB = REPO_ROOT.glob("packages/lobsters/lobster-*/role-card.json")
DEFAULT_STRATEGY_INTENSITY_FRAMEWORK_PATH = REPO_ROOT / "packages" / "lobsters" / "strategy-intensity-framework.json"
DEFAULT_STRATEGY_INTENSITY_STATE_PATH = Path(__file__).resolve().parent / "runtime" / "strategy-intensity-state.json"
DEFAULT_TENANT_ID = "tenant_main"

LOBSTER_ORDER = [
    "radar",
    "strategist",
    "inkwriter",
    "visualizer",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
]

ALL_LOBSTERS = tuple(LOBSTER_ORDER)
GOVERNANCE_NODES = (
    "constitutional_guardian_node",
    "verification_gate_node",
    "memory_governor_node",
)

VISUAL_HEAVY_INDUSTRIES = {
    "restaurant",
    "hotel",
    "beauty",
    "retail",
    "culture_tour_leisure",
    "food_service",
    "hotel_stay",
    "beauty_health",
    "local_retail",
    "auto_service",
    "home_decor",
}
FOLLOWUP_HEAVY_INDUSTRIES = {
    "education",
    "education_training",
    "medical_health",
    "enterprise_service",
    "crossborder_ecommerce",
    "hotel",
}
COMPLAINT_SENSITIVE_INDUSTRIES = {
    "beauty",
    "beauty_health",
    "medical_health",
    "education",
    "education_training",
    "enterprise_service",
}

WORKFLOW_LIBRARY: dict[str, dict[str, Any]] = {
    "wf_signal_scan": {
        "roles": ["radar", "strategist"],
        "keywords": ["信号", "扫描", "热点", "趋势", "竞品", "规则", "scan", "signal", "trend", "competitor"],
        "approvals": [],
        "parallelizable": [],
        "risk": "low",
    },
    "wf_strategy_seed": {
        "roles": ["radar", "strategist"],
        "keywords": ["策略", "路线", "打法", "规划", "定位", "strategy", "route", "plan"],
        "approvals": [],
        "parallelizable": [],
        "risk": "low",
    },
    "wf_topic_scoring": {
        "roles": ["strategist", "inkwriter"],
        "keywords": ["选题", "打分", "话题", "标题方向", "topic", "angle", "scoring"],
        "approvals": [],
        "parallelizable": [],
        "risk": "low",
    },
    "wf_copy_compliance": {
        "roles": ["inkwriter", "visualizer"],
        "keywords": ["文案", "脚本", "合规", "违规", "审稿", "copy", "script", "compliance"],
        "approvals": ["sensitive_claims"],
        "parallelizable": [("inkwriter", "visualizer")],
        "risk": "medium",
    },
    "wf_visual_production": {
        "roles": ["visualizer", "dispatcher"],
        "keywords": ["视觉", "分镜", "字幕", "bgm", "数字人", "画面", "视频", "封面", "visual", "storyboard", "video"],
        "approvals": [],
        "parallelizable": [],
        "risk": "medium",
    },
    "wf_title_cover": {
        "roles": ["inkwriter", "visualizer"],
        "keywords": ["标题", "封面", "headline", "cover"],
        "approvals": [],
        "parallelizable": [("inkwriter", "visualizer")],
        "risk": "low",
    },
    "wf_cloud_archive": {
        "roles": ["dispatcher"],
        "keywords": ["归档", "保存", "云端", "archive", "cloud"],
        "approvals": [],
        "parallelizable": [],
        "risk": "low",
    },
    "wf_edge_publish": {
        "roles": ["dispatcher"],
        "keywords": ["发布", "投放", "抖音", "小红书", "publish", "post", "douyin", "xiaohongshu"],
        "approvals": ["publish_external"],
        "parallelizable": [],
        "risk": "high",
    },
    "wf_edge_inbox": {
        "roles": ["echoer", "catcher"],
        "keywords": ["评论", "私信", "互动", "dm", "comment", "inbox"],
        "approvals": ["price_commitment"],
        "parallelizable": [("echoer", "catcher")],
        "risk": "medium",
    },
    "wf_interaction_triage": {
        "roles": ["echoer", "catcher", "abacus"],
        "keywords": ["互动", "分流", "意向", "互动分诊", "triage", "qualification"],
        "approvals": ["price_commitment"],
        "parallelizable": [("echoer", "catcher")],
        "risk": "medium",
    },
    "wf_lead_scoring": {
        "roles": ["catcher", "abacus"],
        "keywords": ["线索", "评分", "意向", "lead", "score", "qualification"],
        "approvals": [],
        "parallelizable": [],
        "risk": "low",
    },
    "wf_conversion_push": {
        "roles": ["abacus", "followup"],
        "keywords": ["转化", "预约", "成交", "推进", "followup", "conversion", "appointment"],
        "approvals": ["outbound_call", "price_commitment"],
        "parallelizable": [],
        "risk": "medium",
    },
    "wf_high_score_call": {
        "roles": ["followup"],
        "keywords": ["电话", "外呼", "高分", "call", "phone"],
        "approvals": ["outbound_call", "high_risk_customer_touchpoint", "price_commitment"],
        "parallelizable": [],
        "risk": "high",
    },
    "wf_reactivation": {
        "roles": ["abacus", "followup"],
        "keywords": ["激活", "再激活", "唤醒", "沉默客户", "reactivation", "reactivate"],
        "approvals": ["outbound_call"],
        "parallelizable": [],
        "risk": "medium",
    },
    "wf_recovery_replay": {
        "roles": ["dispatcher", "feedback"],
        "keywords": ["恢复", "回放", "补偿", "故障", "重试", "recovery", "replay"],
        "approvals": [],
        "parallelizable": [],
        "risk": "medium",
    },
    "wf_weekly_review": {
        "roles": ["radar", "abacus", "feedback"],
        "keywords": ["周报", "复盘", "review", "weekly", "retro"],
        "approvals": [],
        "parallelizable": [],
        "risk": "low",
    },
    "wf_complaint_guard": {
        "roles": ["echoer", "catcher", "followup"],
        "keywords": ["投诉", "差评", "危机", "complaint", "angry", "refund"],
        "approvals": ["outbound_call", "price_commitment", "high_risk_customer_touchpoint"],
        "parallelizable": [("echoer", "catcher")],
        "risk": "high",
    },
    "wf_growth_retrofit": {
        "roles": ["strategist", "abacus", "feedback"],
        "keywords": ["改造", "升级", "优化", "retrofit", "improve", "upgrade"],
        "approvals": [],
        "parallelizable": [],
        "risk": "low",
    },
}

INTENT_KEYWORDS: dict[str, list[str]] = {
    "complaint_guard": ["投诉", "差评", "退款", "危机", "complaint", "angry", "crisis"],
    "weekly_review": ["周报", "周复盘", "weekly", "review", "复盘"],
    "signal_scan": ["扫描", "竞品", "趋势", "热点", "规则", "signal", "scan", "trend"],
    "reactivation": ["激活", "再激活", "唤醒", "沉默客户", "reactivation", "reactivate"],
    "conversion_push": ["成交", "预约", "转化", "跟进", "followup", "conversion", "appointment"],
    "lead_acquisition": ["获客", "线索", "私信", "评论", "lead", "comment", "dm", "客户"],
    "content_production": ["内容", "视频", "脚本", "选题", "封面", "发布", "douyin", "xiaohongshu", "content", "video"],
    "full_funnel": ["全链路", "闭环", "从内容到成交", "all in one", "end to end", "端到端"],
    "growth_retrofit": ["增长改造", "打法升级", "优化增长", "retrofit", "upgrade growth"],
}

INDUSTRY_WORKFLOW_BIASES: dict[str, list[str]] = {
    "education": ["wf_conversion_push"],
    "education_training": ["wf_conversion_push"],
    "medical_health": ["wf_conversion_push", "wf_high_score_call"],
    "enterprise_service": ["wf_conversion_push"],
    "beauty_health": ["wf_complaint_guard"],
}

_STRATEGY_INTENSITY_LOCK = RLock()
_STRATEGY_INTENSITY_MANAGERS: dict[str, "StrategyIntensityManager"] = {}


def _strategy_intensity_framework_path() -> Path:
    return Path(
        os.getenv(
            "STRATEGY_INTENSITY_FRAMEWORK_PATH",
            str(DEFAULT_STRATEGY_INTENSITY_FRAMEWORK_PATH),
        )
    )


def _strategy_intensity_state_path() -> Path:
    return Path(
        os.getenv(
            "STRATEGY_INTENSITY_STATE_PATH",
            str(DEFAULT_STRATEGY_INTENSITY_STATE_PATH),
        )
    )


class StrategyIntensityManager:
    """Tenant-scoped business strategy intensity controls."""

    _ACTION_LIMIT_KEYS = {
        "posts": "max_daily_posts",
        "replies": "max_daily_replies",
        "dms": "max_daily_dms",
        "llm_calls": "max_llm_calls_per_task",
    }
    _ACTION_ALIASES = {
        "posts": {
            "post",
            "posts",
            "publish",
            "content_publish",
            "publish_external",
            "dispatcher",
        },
        "replies": {
            "reply",
            "replies",
            "comment_reply",
            "comment",
            "engagement",
            "engagement_reply",
            "echoer",
        },
        "dms": {
            "dm",
            "dms",
            "private_message",
            "dm_outreach",
            "lead_capture",
            "followup",
            "followup_touch",
        },
        "llm_calls": {
            "llm",
            "llm_call",
            "llm_calls",
            "model_call",
        },
    }
    _ACTION_CHANNELS = {
        "posts": "content_publish",
        "replies": "comment_reply",
        "dms": "dm_outreach",
    }

    def __init__(
        self,
        tenant_id: str = DEFAULT_TENANT_ID,
        framework_path: Path | str | None = None,
        state_path: Path | str | None = None,
    ) -> None:
        self.tenant_id = str(tenant_id or DEFAULT_TENANT_ID).strip() or DEFAULT_TENANT_ID
        self._framework_path = Path(framework_path) if framework_path is not None else _strategy_intensity_framework_path()
        self._state_path = Path(state_path) if state_path is not None else _strategy_intensity_state_path()
        self._framework = json.loads(self._framework_path.read_text(encoding="utf-8-sig"))
        self._levels = {
            int(item["level"]): dict(item)
            for item in self._framework.get("levels", [])
            if isinstance(item, dict) and "level" in item
        }
        if not self._levels:
            raise ValueError("strategy intensity framework has no levels")
        self._default_level = int(self._framework.get("default_level", min(self._levels)))
        self.last_transition_error: str | None = None

    def _default_usage(self) -> dict[str, int]:
        return {
            "posts": 0,
            "replies": 0,
            "dms": 0,
            "llm_calls": 0,
        }

    def _utc_now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _today(self) -> str:
        return datetime.now(timezone.utc).date().isoformat()

    def _load_state_payload(self) -> dict[str, Any]:
        if not self._state_path.exists():
            return {"tenants": {}}
        try:
            payload = json.loads(self._state_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            payload = {"tenants": {}}
        if not isinstance(payload, dict):
            payload = {"tenants": {}}
        tenants = payload.get("tenants")
        if not isinstance(tenants, dict):
            payload["tenants"] = {}
        return payload

    def _save_state_payload(self, payload: dict[str, Any]) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _normalize_tenant_state(self, state: dict[str, Any]) -> dict[str, Any]:
        today = self._today()
        usage = state.get("usage_today")
        if not isinstance(usage, dict):
            usage = {}
        normalized_usage = self._default_usage()
        for key in normalized_usage:
            try:
                normalized_usage[key] = max(0, int(usage.get(key, 0)))
            except (TypeError, ValueError):
                normalized_usage[key] = 0

        usage_date = str(state.get("usage_date") or today)
        if usage_date != today:
            normalized_usage = self._default_usage()
            usage_date = today

        try:
            current_level = int(state.get("current_level", self._default_level))
        except (TypeError, ValueError):
            current_level = self._default_level
        if current_level not in self._levels:
            current_level = self._default_level

        history = state.get("history")
        normalized_history: list[dict[str, Any]] = []
        if isinstance(history, list):
            for item in history[-500:]:
                if not isinstance(item, dict):
                    continue
                try:
                    old_level = int(item.get("old_level"))
                    new_level = int(item.get("new_level"))
                except (TypeError, ValueError):
                    continue
                normalized_history.append(
                    {
                        "ts": str(item.get("ts") or ""),
                        "lobster_id": str(item.get("lobster_id") or "tenant"),
                        "old_level": old_level,
                        "new_level": new_level,
                        "triggered_by": str(item.get("triggered_by") or "auto"),
                        "reason": str(item.get("reason") or ""),
                    }
                )

        return {
            "current_level": current_level,
            "updated_at": str(state.get("updated_at") or ""),
            "updated_by": str(state.get("updated_by") or ""),
            "reason": str(state.get("reason") or ""),
            "usage_date": usage_date,
            "usage_today": normalized_usage,
            "history": normalized_history,
        }

    def _with_tenant_state(self, mutate: Any = None) -> dict[str, Any]:
        with _STRATEGY_INTENSITY_LOCK:
            payload = self._load_state_payload()
            tenants = payload.setdefault("tenants", {})
            raw = tenants.get(self.tenant_id)
            if not isinstance(raw, dict):
                raw = {}
            state = self._normalize_tenant_state(raw)
            if callable(mutate):
                mutate(state)
            tenants[self.tenant_id] = state
            self._save_state_payload(payload)
            return state

    def _read_tenant_state(self) -> dict[str, Any]:
        return self._with_tenant_state()

    @property
    def current_level(self) -> int:
        return int(self._read_tenant_state()["current_level"])

    @property
    def current_config(self) -> dict[str, Any]:
        return dict(self._levels.get(self.current_level, self._levels[self._default_level]))

    def get_resource_limits(self) -> dict[str, Any]:
        return dict(self.current_config.get("resource_limits", {}))

    def requires_approval(self) -> bool:
        return bool(self.current_config.get("approval_required", True))

    def resolve_usage_bucket(self, action: str) -> str | None:
        normalized = str(action or "").strip().lower()
        if not normalized:
            return None
        for bucket, aliases in self._ACTION_ALIASES.items():
            if normalized == bucket or normalized in aliases:
                return bucket
        if normalized in self._ACTION_LIMIT_KEYS:
            return normalized
        return None

    def resolve_channel(self, action: str) -> str | None:
        bucket = self.resolve_usage_bucket(action)
        if not bucket:
            return None
        return self._ACTION_CHANNELS.get(bucket)

    def is_channel_allowed(self, channel: str) -> bool:
        allowed = self.get_resource_limits().get("allowed_channels", [])
        if not allowed:
            return True
        return str(channel or "").strip() in {str(item).strip() for item in allowed}

    def check_limits(self, action: str, count: int) -> bool:
        bucket = self.resolve_usage_bucket(action)
        if not bucket:
            return True
        limit_key = self._ACTION_LIMIT_KEYS[bucket]
        limits = self.get_resource_limits()
        max_val = limits.get(limit_key)
        try:
            current_count = max(0, int(count))
        except (TypeError, ValueError):
            current_count = 0
        if max_val is not None and current_count >= int(max_val):
            return False
        return True

    def set_level(
        self,
        level: int,
        *,
        manual: bool = False,
        updated_by: str | None = None,
        reason: str = "",
        lobster_id: str | None = None,
    ) -> bool:
        if level not in self._levels:
            self.last_transition_error = "invalid_level"
            return False
        current_level = self.current_level
        if level == current_level:
            self.last_transition_error = "no_change"
            return False
        if level == 4 and current_level < 4 and not manual:
            self.last_transition_error = "l4_requires_manual_enable"
            return False

        def _mutate(state: dict[str, Any]) -> None:
            history = list(state.get("history") or [])
            history.append(
                {
                    "ts": self._utc_now(),
                    "lobster_id": str(lobster_id or "tenant").strip() or "tenant",
                    "old_level": current_level,
                    "new_level": level,
                    "triggered_by": str(updated_by or ("manual" if manual else "auto")).strip() or "auto",
                    "reason": reason,
                }
            )
            state["current_level"] = level
            state["updated_at"] = self._utc_now()
            state["updated_by"] = str(updated_by or "")
            state["reason"] = reason
            state["history"] = history[-500:]

        self._with_tenant_state(_mutate)
        self.last_transition_error = None
        return True

    def escalate(
        self,
        *,
        manual: bool = False,
        updated_by: str | None = None,
        reason: str = "",
        lobster_id: str | None = None,
    ) -> bool:
        current_level = self.current_level
        next_level = current_level + 1
        if next_level not in self._levels:
            self.last_transition_error = "already_at_max"
            return False
        if next_level == 4 and not manual:
            self.last_transition_error = "l4_requires_manual_enable"
            return False
        return self.set_level(
            next_level,
            manual=manual,
            updated_by=updated_by,
            reason=reason,
            lobster_id=lobster_id,
        )

    def deescalate(
        self,
        *,
        updated_by: str | None = None,
        reason: str = "",
        lobster_id: str | None = None,
    ) -> bool:
        current_level = self.current_level
        next_level = current_level - 1
        if next_level not in self._levels:
            self.last_transition_error = "already_at_min"
            return False
        return self.set_level(
            next_level,
            manual=True,
            updated_by=updated_by,
            reason=reason,
            lobster_id=lobster_id,
        )

    def record_usage(self, *, action: str | None = None, count: int = 1, llm_calls: int = 0) -> dict[str, Any]:
        bucket = self.resolve_usage_bucket(str(action or ""))
        safe_count = max(0, int(count))
        safe_llm_calls = max(0, int(llm_calls))

        def _mutate(state: dict[str, Any]) -> None:
            usage = dict(state.get("usage_today") or self._default_usage())
            if bucket:
                usage[bucket] = max(0, int(usage.get(bucket, 0))) + safe_count
            if safe_llm_calls:
                usage["llm_calls"] = max(0, int(usage.get("llm_calls", 0))) + safe_llm_calls
            state["usage_today"] = self._normalize_tenant_state({"usage_today": usage}).get("usage_today", usage)
            state["updated_at"] = self._utc_now()

        self._with_tenant_state(_mutate)
        return self.get_snapshot()

    def get_snapshot(self) -> dict[str, Any]:
        state = self._read_tenant_state()
        config = self.current_config
        return {
            "tenant_id": self.tenant_id,
            "current_level": int(state["current_level"]),
            "name": str(config.get("name") or f"L{state['current_level']}"),
            "label": str(config.get("label") or ""),
            "description": str(config.get("description") or ""),
            "autonomy": str(config.get("autonomy") or "auto"),
            "approval_required": bool(config.get("approval_required", True)),
            "resource_limits": dict(config.get("resource_limits", {})),
            "risk_threshold": float(config.get("risk_threshold", 0)),
            "rollback_policy": str(config.get("rollback_policy") or "auto"),
            "applicable_scenarios": list(config.get("applicable_scenarios", []) or []),
            "typical_lobsters": list(config.get("typical_lobsters", []) or []),
            "escalation_trigger": str(config.get("escalation_trigger") or ""),
            "downgrade_rules": dict(self._framework.get("downgrade_rules", {}) or {}),
            "usage_today": dict(state.get("usage_today", self._default_usage())),
            "usage_date": str(state.get("usage_date") or self._today()),
            "updated_at": str(state.get("updated_at") or ""),
            "updated_by": str(state.get("updated_by") or ""),
            "reason": str(state.get("reason") or ""),
            "history_count": len(state.get("history") or []),
        }

    def get_history(
        self,
        *,
        lobster_id: str | None = None,
        days: int = 7,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        state = self._read_tenant_state()
        history = list(state.get("history") or [])
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))
        normalized_lobster = str(lobster_id or "").strip()
        items: list[dict[str, Any]] = []
        for item in reversed(history):
            if not isinstance(item, dict):
                continue
            ts_raw = str(item.get("ts") or "").strip()
            if not ts_raw:
                continue
            try:
                ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
            if ts < cutoff:
                continue
            item_lobster = str(item.get("lobster_id") or "tenant").strip() or "tenant"
            if normalized_lobster and item_lobster not in {normalized_lobster, "tenant"}:
                continue
            items.append(
                {
                    "ts": ts_raw,
                    "lobster_id": item_lobster,
                    "old_level": int(item.get("old_level") or 0),
                    "new_level": int(item.get("new_level") or 0),
                    "triggered_by": str(item.get("triggered_by") or "auto"),
                    "reason": str(item.get("reason") or ""),
                }
            )
            if len(items) >= max(1, int(limit)):
                break
        return items


def clear_strategy_intensity_manager_cache() -> None:
    _STRATEGY_INTENSITY_MANAGERS.clear()


def get_strategy_intensity_manager(tenant_id: str = DEFAULT_TENANT_ID) -> StrategyIntensityManager:
    tenant_key = str(tenant_id or DEFAULT_TENANT_ID).strip() or DEFAULT_TENANT_ID
    manager = _STRATEGY_INTENSITY_MANAGERS.get(tenant_key)
    if manager is None:
        manager = StrategyIntensityManager(tenant_id=tenant_key)
        _STRATEGY_INTENSITY_MANAGERS[tenant_key] = manager
    return manager


def get_strategy_intensity_snapshot(tenant_id: str = DEFAULT_TENANT_ID) -> dict[str, Any]:
    return get_strategy_intensity_manager(tenant_id).get_snapshot()


@dataclass(slots=True)
class RoutePlan:
    workflow_id: str
    lobster_sequence: list[str]
    skip_lobsters: list[str]
    parallelizable: list[tuple[str, str]]
    estimated_steps: int
    risk_level: str
    approval_required: list[str]
    workflow_chain: list[str] = field(default_factory=list)
    approval_insert_after: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    matched_keywords: list[str] = field(default_factory=list)
    governance_nodes: tuple[str, ...] = GOVERNANCE_NODES
    fallback_mode: str = "none"
    policy_recommendation: dict[str, Any] = field(default_factory=dict)
    strategy_intensity: dict[str, Any] = field(default_factory=dict)


def _load_role_cards() -> dict[str, dict[str, Any]]:
    cards: dict[str, dict[str, Any]] = {}
    for card_path in ROLE_CARD_GLOB:
        data = json.loads(card_path.read_text(encoding="utf-8-sig"))
        role_id = str(data.get("roleId", "")).strip()
        if role_id:
            cards[role_id] = data
    return cards


def _load_workflow_catalog() -> dict[str, dict[str, Any]]:
    model = json.loads(OPERATING_MODEL_PATH.read_text(encoding="utf-8-sig"))
    workflow_catalog = {str(item["workflowId"]): item for item in model.get("workflowCatalog", [])}
    for workflow_id, meta in WORKFLOW_LIBRARY.items():
        base = workflow_catalog.get(workflow_id, {"workflowId": workflow_id, "label": workflow_id, "goal": ""})
        workflow_catalog[workflow_id] = {
            **base,
            **meta,
        }
    return workflow_catalog


def _normalize_text(*parts: Any) -> str:
    text = " ".join(str(part or "") for part in parts).strip().lower()
    return re.sub(r"\s+", " ", text)


def _extract_keywords(text: str) -> list[str]:
    return re.findall(r"[a-z0-9_\u4e00-\u9fff]{2,}", text)


def _normalize_industry_tag(industry_context: dict[str, Any]) -> str:
    raw = _normalize_text(
        industry_context.get("industry"),
        industry_context.get("sub_industry"),
        industry_context.get("industry_tag"),
    )
    replacements = {
        "本地生活_医疗口腔": "medical_health",
        "医疗口腔": "medical_health",
        "口腔": "medical_health",
        "教育培训": "education_training",
        "企业服务": "enterprise_service",
        "美业健康": "beauty_health",
    }
    for alias, normalized in replacements.items():
        if alias.lower() in raw:
            return normalized
    for candidate in list(VISUAL_HEAVY_INDUSTRIES | FOLLOWUP_HEAVY_INDUSTRIES | COMPLAINT_SENSITIVE_INDUSTRIES):
        if candidate in raw:
            return candidate
    return raw or "general"


def _score_workflow_match(goal_text: str, workflow_id: str) -> tuple[int, list[str]]:
    config = WORKFLOW_LIBRARY[workflow_id]
    matched: list[str] = []
    score = 0
    for keyword in config["keywords"]:
        if keyword.lower() in goal_text:
            matched.append(keyword)
            score += 2
    return score, matched


def _infer_intent_family(goal_text: str) -> str:
    if not goal_text.strip():
        return "signal_scan"
    priority_order = [
        "complaint_guard",
        "weekly_review",
        "signal_scan",
        "full_funnel",
        "reactivation",
        "growth_retrofit",
        "conversion_push",
        "lead_acquisition",
        "content_production",
    ]
    for family in priority_order:
        keywords = INTENT_KEYWORDS[family]
        if any(keyword.lower() in goal_text for keyword in keywords):
            return family
    return "content_production"


def _sequence_from_roles(roles: Iterable[str]) -> list[str]:
    role_set = {role for role in roles if role in ALL_LOBSTERS}
    return [role for role in LOBSTER_ORDER if role in role_set]


def _parallel_pairs_for_sequence(sequence: list[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if "inkwriter" in sequence and "visualizer" in sequence:
        pairs.append(("inkwriter", "visualizer"))
    if "echoer" in sequence and "catcher" in sequence:
        pairs.append(("echoer", "catcher"))
    return pairs


def _approval_insert_after(sequence: list[str], approvals: list[str]) -> list[str]:
    nodes: list[str] = []
    if "publish_external" in approvals and "dispatcher" in sequence:
        nodes.append("dispatcher")
    if any(action in approvals for action in {"outbound_call", "price_commitment", "high_risk_customer_touchpoint"}):
        if "abacus" in sequence:
            nodes.append("abacus")
        elif "catcher" in sequence:
            nodes.append("catcher")
        elif "followup" in sequence:
            nodes.append("followup")
    return list(dict.fromkeys(nodes))


def _fallback_all_shrimp_plan(reason: str, strategy_intensity: dict[str, Any] | None = None) -> RoutePlan:
    sequence = list(ALL_LOBSTERS)
    approvals = ["publish_external", "outbound_call", "price_commitment"]
    return RoutePlan(
        workflow_id="wf_growth_retrofit",
        workflow_chain=["wf_signal_scan", "wf_topic_scoring", "wf_copy_compliance", "wf_visual_production", "wf_edge_publish", "wf_interaction_triage", "wf_lead_scoring", "wf_conversion_push", "wf_high_score_call", "wf_weekly_review", "wf_growth_retrofit"],
        lobster_sequence=sequence,
        skip_lobsters=[],
        parallelizable=_parallel_pairs_for_sequence(sequence),
        estimated_steps=len(sequence),
        risk_level="high",
        approval_required=approvals,
        approval_insert_after=_approval_insert_after(sequence, approvals),
        reasons=[reason, "fallback=all_shrimp"],
        fallback_mode="all_shrimp",
        strategy_intensity=dict(strategy_intensity or {}),
    )


class CommanderRouter:
    """Rule-first Commander router with workflow matching and optional policy-bandit nudging."""

    def __init__(self) -> None:
        self.workflow_catalog = _load_workflow_catalog()
        self.role_cards = _load_role_cards()

    async def route(self, goal: str, industry_context: dict[str, Any]) -> RoutePlan:
        normalized_goal = _normalize_text(goal)
        intent_family = _infer_intent_family(normalized_goal)
        industry_tag = _normalize_industry_tag(industry_context)
        tenant_id = str(industry_context.get("tenant_id") or industry_context.get("user_id") or DEFAULT_TENANT_ID).strip() or DEFAULT_TENANT_ID
        intensity = get_strategy_intensity_snapshot(tenant_id)
        reasons = [
            f"intent_family={intent_family}",
            f"industry={industry_tag or 'general'}",
            f"strategy_intensity={intensity.get('name', 'L1')}",
            f"strategy_autonomy={intensity.get('autonomy', 'auto')}",
        ]

        if not normalized_goal:
            sequence = ["radar", "strategist"]
            return RoutePlan(
                workflow_id="wf_signal_scan",
                workflow_chain=["wf_signal_scan"],
                lobster_sequence=sequence,
                skip_lobsters=[role for role in ALL_LOBSTERS if role not in sequence],
                parallelizable=[],
                estimated_steps=len(sequence),
                risk_level="low",
                approval_required=[],
                approval_insert_after=[],
                reasons=reasons + ["empty_goal_degraded_to_signal_scan"],
                fallback_mode="empty_goal",
                strategy_intensity=intensity,
            )

        candidate_chain = self._candidate_workflow_chain(intent_family, normalized_goal, industry_context, industry_tag)
        if not candidate_chain:
            return _fallback_all_shrimp_plan("no_workflow_chain_matched", intensity)

        primary_workflow, matched_keywords = self._match_primary_workflow(candidate_chain, normalized_goal)
        if not primary_workflow:
            return _fallback_all_shrimp_plan("workflow_match_failed", intensity)

        policy_rec = self._recommend_policy_branch(
            user_id=str(industry_context.get("user_id") or industry_context.get("tenant_id") or "shared"),
            candidate_chain=candidate_chain,
            default_workflow=primary_workflow,
        )
        recommended_workflow = str(policy_rec.get("workflow_template") or primary_workflow)
        if recommended_workflow in candidate_chain and not str(policy_rec.get("workflow_template_mode", "")).startswith("explore"):
            primary_workflow = recommended_workflow
            reasons.append(f"policy_bandit={policy_rec.get('workflow_template_mode', policy_rec.get('mode', 'unknown'))}")

        sequence = self._build_lobster_sequence(candidate_chain, intent_family, industry_tag, industry_context)
        approvals = self._collect_approvals(candidate_chain, normalized_goal, industry_tag, industry_context)
        risk_level = self._infer_risk_level(candidate_chain, approvals, industry_tag, industry_context)
        if int(intensity.get("current_level", 1)) >= 4:
            risk_level = "high"
        elif int(intensity.get("current_level", 1)) >= 3 and risk_level == "low":
            risk_level = "medium"

        return RoutePlan(
            workflow_id=primary_workflow,
            workflow_chain=candidate_chain,
            lobster_sequence=sequence,
            skip_lobsters=[role for role in ALL_LOBSTERS if role not in sequence],
            parallelizable=_parallel_pairs_for_sequence(sequence),
            estimated_steps=len(sequence),
            risk_level=risk_level,
            approval_required=approvals,
            approval_insert_after=_approval_insert_after(sequence, approvals),
            reasons=reasons,
            matched_keywords=matched_keywords,
            policy_recommendation=policy_rec,
            strategy_intensity=intensity,
        )

    def _candidate_workflow_chain(
        self,
        intent_family: str,
        normalized_goal: str,
        industry_context: dict[str, Any],
        industry_tag: str,
    ) -> list[str]:
        has_leads = bool(industry_context.get("has_leads"))
        existing_content = bool(industry_context.get("existing_content"))
        urgency = _normalize_text(industry_context.get("urgency", "normal"))

        if intent_family == "complaint_guard":
            return ["wf_complaint_guard"]
        if intent_family == "weekly_review":
            return ["wf_weekly_review"]
        if intent_family == "signal_scan":
            return ["wf_signal_scan"]
        if intent_family == "growth_retrofit":
            return ["wf_weekly_review", "wf_growth_retrofit"]
        if intent_family == "reactivation":
            return ["wf_reactivation"]
        if intent_family == "full_funnel":
            return [
                "wf_signal_scan",
                "wf_topic_scoring",
                "wf_copy_compliance",
                "wf_visual_production",
                "wf_title_cover",
                "wf_cloud_archive",
                "wf_edge_publish",
                "wf_edge_inbox",
                "wf_lead_scoring",
                "wf_conversion_push",
                "wf_high_score_call",
            ]
        if intent_family == "content_production":
            chain = ["wf_topic_scoring", "wf_copy_compliance", "wf_visual_production", "wf_title_cover", "wf_cloud_archive"]
            if any(token in normalized_goal for token in ["发布", "post", "publish", "抖音", "小红书", "douyin", "xiaohongshu"]):
                chain.append("wf_edge_publish")
            if not existing_content:
                chain.insert(0, "wf_signal_scan")
            return chain
        if intent_family == "lead_acquisition":
            chain = ["wf_edge_inbox", "wf_interaction_triage", "wf_lead_scoring"]
            if industry_tag in FOLLOWUP_HEAVY_INDUSTRIES or has_leads or urgency in {"high", "urgent"}:
                chain.append("wf_conversion_push")
            return chain
        if intent_family == "conversion_push":
            chain = ["wf_lead_scoring", "wf_conversion_push"]
            if any(token in normalized_goal for token in ["电话", "外呼", "call", "phone"]) or has_leads:
                chain.append("wf_high_score_call")
            return chain
        return []

    def _match_primary_workflow(self, candidate_chain: list[str], goal_text: str) -> tuple[str | None, list[str]]:
        best_workflow: str | None = None
        best_score = -1
        best_keywords: list[str] = []
        for workflow_id in candidate_chain:
            score, matched = _score_workflow_match(goal_text, workflow_id)
            if score > best_score:
                best_workflow = workflow_id
                best_score = score
                best_keywords = matched
        if best_workflow is None:
            return None, []
        if best_score <= 0:
            return candidate_chain[0], []
        return best_workflow, best_keywords

    def _recommend_policy_branch(
        self,
        *,
        user_id: str,
        candidate_chain: list[str],
        default_workflow: str,
    ) -> dict[str, Any]:
        if len(candidate_chain) <= 1:
            return {}
        try:
            return recommend_policy(
                user_id=user_id,
                template_scope="workflow_template:routing",
                template_candidates=candidate_chain,
                default_template=default_workflow,
            )
        except Exception:
            return {}

    def _build_lobster_sequence(
        self,
        candidate_chain: list[str],
        intent_family: str,
        industry_tag: str,
        industry_context: dict[str, Any],
    ) -> list[str]:
        roles: list[str] = []
        for workflow_id in candidate_chain:
            roles.extend(self.workflow_catalog[workflow_id]["roles"])

        sequence = _sequence_from_roles(roles)

        if (
            industry_tag not in VISUAL_HEAVY_INDUSTRIES
            and "visualizer" in sequence
            and intent_family != "content_production"
        ):
            goal = _normalize_text(industry_context.get("goal"), industry_context.get("platform"))
            if not any(token in goal for token in ["视频", "video", "封面", "visual", "画面", "数字人"]):
                sequence = [role for role in sequence if role != "visualizer"]

        if industry_tag in FOLLOWUP_HEAVY_INDUSTRIES and "followup" not in sequence and (
            industry_context.get("has_leads") or _normalize_text(industry_context.get("urgency")) in {"high", "urgent"}
        ):
            sequence = _sequence_from_roles([*sequence, "followup"])

        if intent_family == "complaint_guard" and industry_tag in COMPLAINT_SENSITIVE_INDUSTRIES and "catcher" in sequence and "followup" in sequence:
            sequence = _sequence_from_roles(["echoer", "catcher", "followup"])

        return sequence or list(ALL_LOBSTERS)

    def _collect_approvals(
        self,
        candidate_chain: list[str],
        goal_text: str,
        industry_tag: str,
        industry_context: dict[str, Any],
    ) -> list[str]:
        approvals: list[str] = []
        for workflow_id in candidate_chain:
            approvals.extend(self.workflow_catalog[workflow_id]["approvals"])

        if any(token in goal_text for token in ["价格", "报价", "优惠", "price", "quote"]):
            approvals.append("price_commitment")

        if any(token in goal_text for token in ["发布", "post", "publish", "投放"]):
            approvals.append("publish_external")

        if any(token in goal_text for token in ["外呼", "电话", "call", "phone"]) or industry_context.get("has_leads"):
            approvals.append("outbound_call")

        if industry_tag in COMPLAINT_SENSITIVE_INDUSTRIES and "outbound_call" in approvals:
            approvals.append("high_risk_customer_touchpoint")

        approvals = list(dict.fromkeys(approvals))
        if "publish_external" in approvals and "price_commitment" not in approvals and industry_tag in COMPLAINT_SENSITIVE_INDUSTRIES:
            approvals.append("price_commitment")
        return approvals

    def _infer_risk_level(
        self,
        candidate_chain: list[str],
        approvals: list[str],
        industry_tag: str,
        industry_context: dict[str, Any],
    ) -> str:
        urgency = _normalize_text(industry_context.get("urgency", "normal"))
        if "wf_complaint_guard" in candidate_chain:
            return "high"
        if "publish_external" in approvals or "outbound_call" in approvals:
            if industry_tag in COMPLAINT_SENSITIVE_INDUSTRIES or urgency in {"high", "urgent"}:
                return "high"
            return "medium"
        if any(workflow_id in candidate_chain for workflow_id in {"wf_visual_production", "wf_edge_publish", "wf_conversion_push"}):
            return "medium"
        return "low"
