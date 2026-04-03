"""
LobsterSkillRegistry — 龙虾技能注册系统

借鉴 openclaw-manager 的 SkillDefinition 模型，为龙虾创建可插拔技能注册表。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

from skill_manifest_loader import load_all_skill_manifests
from skill_manifest_loader import load_skill_manifest
from skill_manifest_loader import load_prompt_assets_for_manifest
from skill_publish_policy import SkillPublishPolicy
from tenant_audit_log import AuditEventType
from tenant_audit_log import get_audit_service

logger = logging.getLogger(__name__)


class SkillFieldType(str, Enum):
    TEXT = "text"
    PASSWORD = "password"
    SELECT = "select"
    TOGGLE = "toggle"
    NUMBER = "number"
    TEXTAREA = "textarea"


class SkillSource(str, Enum):
    BUILTIN = "builtin"
    OFFICIAL = "official"
    COMMUNITY = "community"
    CUSTOM = "custom"


@dataclass
class SkillSelectOption:
    value: str
    label: str


@dataclass
class SkillConfigField:
    """技能配置字段定义，驱动前端动态表单生成"""

    key: str
    label: str
    field_type: SkillFieldType = SkillFieldType.TEXT
    required: bool = False
    default_value: str | None = None
    placeholder: str | None = None
    help_text: str | None = None
    options: list[SkillSelectOption] | None = None


@dataclass
class SkillEffectivenessRating:
    """Seeded or calibrated skill effectiveness metadata."""

    overall: int = 3
    by_industry: dict[str, int] = field(default_factory=dict)
    by_channel: dict[str, int] = field(default_factory=dict)
    sample_size: int = 0
    last_calibrated: str | None = None
    confidence: float = 0.0

    def get_industry_rating(self, industry: str | None) -> int:
        if not industry:
            return self.overall
        return int(self.by_industry.get(str(industry), self.overall))

    def get_channel_rating(self, channel: str | None) -> int:
        if not channel:
            return self.overall
        return int(self.by_channel.get(str(channel), self.overall))

    def to_dict(self) -> dict[str, Any]:
        return {
            "overall": int(self.overall),
            "by_industry": dict(self.by_industry),
            "by_channel": dict(self.by_channel),
            "sample_size": int(self.sample_size),
            "last_calibrated": self.last_calibrated,
            "confidence": round(float(self.confidence), 3),
        }


@dataclass
class LobsterSkill:
    """龙虾技能定义"""

    id: str
    name: str
    description: str
    icon: str = "🧩"
    source: SkillSource = SkillSource.BUILTIN
    version: str | None = None
    author: str | None = None
    category: str | None = None
    docs_url: str | None = None
    bound_lobsters: list[str] = field(default_factory=list)
    enabled: bool = True
    config_fields: list[SkillConfigField] = field(default_factory=list)
    config_values: dict[str, Any] = field(default_factory=dict)
    execute_fn: Callable | None = None
    gotchas: list[str] = field(default_factory=list)
    references: dict[str, str] = field(default_factory=dict)
    scripts: dict[str, str] = field(default_factory=dict)
    skill_dir: str | None = None
    prompt_templates: list[dict[str, Any]] = field(default_factory=list)
    effectiveness: SkillEffectivenessRating = field(default_factory=SkillEffectivenessRating)
    trigger_keywords: list[str] = field(default_factory=list)
    industry_tags: list[str] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)
    priority: str = "medium"
    publish_status: str = "approved"
    max_tokens_budget: int = 4000
    scan_status: str = "not_scanned"
    scan_report: dict[str, Any] = field(default_factory=dict)
    manifest_id: str | None = None
    manifest_path: str | None = None

    def to_api_dict(self) -> dict[str, Any]:
        """转换为 API 返回格式，脱敏 PASSWORD 字段。"""
        password_keys = {f.key for f in self.config_fields if f.field_type == SkillFieldType.PASSWORD}
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "source": self.source.value,
            "version": self.version,
            "author": self.author,
            "category": self.category,
            "docs_url": self.docs_url,
            "bound_lobsters": self.bound_lobsters,
            "enabled": self.enabled,
            "config_fields": [
                {
                    "key": f.key,
                    "label": f.label,
                    "field_type": f.field_type.value,
                    "required": f.required,
                    "default_value": f.default_value,
                    "placeholder": f.placeholder,
                    "help_text": f.help_text,
                    "options": [{"value": o.value, "label": o.label} for o in (f.options or [])],
                }
                for f in self.config_fields
            ],
            "config_values": {
                key: ("***" if key in password_keys and value else value)
                for key, value in self.config_values.items()
            },
            "gotchas": list(self.gotchas),
            "references": dict(self.references),
            "scripts": dict(self.scripts),
            "skill_dir": self.skill_dir,
            "prompt_templates": [dict(item) for item in self.prompt_templates],
            "effectiveness": self.effectiveness.to_dict(),
            "trigger_keywords": list(self.trigger_keywords),
            "industry_tags": list(self.industry_tags),
            "allowed_tools": list(self.allowed_tools),
            "priority": self.priority,
            "publish_status": self.publish_status,
            "max_tokens_budget": int(self.max_tokens_budget),
            "scan_status": self.scan_status,
            "scan_report": dict(self.scan_report),
            "manifest_id": self.manifest_id,
            "manifest_path": self.manifest_path,
        }


class LobsterSkillRegistry:
    """龙虾技能注册表 — 单例"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._skills = {}
            cls._instance._manifest_records = {}
        return cls._instance

    @staticmethod
    def _state_path() -> Path:
        raw = os.getenv("SKILL_REGISTRY_STATE_PATH", "./data/skill_registry_state.json")
        path = Path(raw)
        if not path.is_absolute():
            path = (Path(__file__).resolve().parent / path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _load_state(self) -> dict[str, Any]:
        path = self._state_path()
        if not path.exists():
            return {"skills": {}}
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            payload = {"skills": {}}
        if not isinstance(payload, dict):
            payload = {"skills": {}}
        if not isinstance(payload.get("skills"), dict):
            payload["skills"] = {}
        return payload

    def _save_state(self, payload: dict[str, Any]) -> None:
        self._state_path().write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _runtime_row(self, skill_id: str) -> dict[str, Any]:
        payload = self._load_state()
        row = payload.get("skills", {}).get(skill_id)
        return dict(row) if isinstance(row, dict) else {}

    def _apply_runtime_row(self, skill: LobsterSkill) -> None:
        row = self._runtime_row(skill.id)
        if row.get("publish_status"):
            skill.publish_status = str(row["publish_status"])
        if row.get("priority"):
            skill.priority = str(row["priority"])
        if row.get("scan_status"):
            skill.scan_status = str(row["scan_status"])
        if isinstance(row.get("scan_report"), dict):
            skill.scan_report = dict(row.get("scan_report") or {})
        if row.get("enabled") is not None:
            skill.enabled = bool(row.get("enabled"))

    def _persist_skill_runtime(
        self,
        skill_id: str,
        *,
        publish_status: str | None = None,
        priority: str | None = None,
        scan_status: str | None = None,
        scan_report: dict[str, Any] | None = None,
        enabled: bool | None = None,
        note: str | None = None,
        updated_by: str | None = None,
    ) -> dict[str, Any]:
        payload = self._load_state()
        skills = payload.setdefault("skills", {})
        row = dict(skills.get(skill_id) or {})
        if publish_status is not None:
            row["publish_status"] = publish_status
        if priority is not None:
            row["priority"] = priority
        if scan_status is not None:
            row["scan_status"] = scan_status
        if scan_report is not None:
            row["scan_report"] = scan_report
        if enabled is not None:
            row["enabled"] = enabled
        if note is not None:
            row["note"] = note
        if updated_by is not None:
            row["updated_by"] = updated_by
        skills[skill_id] = row
        self._save_state(payload)
        return row

    def set_manifest_records(self, records: dict[str, Any]) -> None:
        self._manifest_records = dict(records or {})

    def get_manifest_record_for_skill(self, skill_id: str) -> dict[str, Any] | None:
        skill = self.get(skill_id)
        if skill is None:
            return None
        lobster_id = skill.bound_lobsters[0] if skill.bound_lobsters else ""
        record = self._manifest_records.get(lobster_id)
        return record.to_dict() if hasattr(record, "to_dict") else None

    def register(self, skill: LobsterSkill) -> None:
        self._skills[skill.id] = skill
        self._apply_runtime_row(skill)

    def unregister(self, skill_id: str) -> bool:
        return self._skills.pop(skill_id, None) is not None

    def get(self, skill_id: str) -> LobsterSkill | None:
        return self._skills.get(skill_id)

    def get_skill(self, skill_id: str) -> LobsterSkill | None:
        return self.get(skill_id)

    def get_all(self) -> list[LobsterSkill]:
        return list(self._skills.values())

    def get_by_lobster(self, lobster_id: str) -> list[LobsterSkill]:
        return [
            s for s in self._skills.values()
            if s.enabled and (not s.bound_lobsters or lobster_id in s.bound_lobsters)
        ]

    def get_skills_for_lobster(self, lobster_id: str) -> list[LobsterSkill]:
        return self.get_by_lobster(lobster_id)

    def get_by_source(self, source: SkillSource) -> list[LobsterSkill]:
        return [s for s in self._skills.values() if s.source == source]

    def get_by_category(self, category: str) -> list[LobsterSkill]:
        return [s for s in self._skills.values() if s.category == category]

    def configure(self, skill_id: str, config: dict[str, Any]) -> bool:
        skill = self._skills.get(skill_id)
        if not skill:
            return False
        skill.config_values.update(config)
        return True

    def update_publish_status(
        self,
        skill_id: str,
        status: str,
        *,
        note: str = "",
        updated_by: str = "system",
        scan_status: str | None = None,
        scan_report: dict[str, Any] | None = None,
    ) -> bool:
        skill = self._skills.get(skill_id)
        if not skill:
            return False
        skill.publish_status = status
        if scan_status is not None:
            skill.scan_status = scan_status
        if scan_report is not None:
            skill.scan_report = dict(scan_report)
        self._persist_skill_runtime(
            skill_id,
            publish_status=status,
            scan_status=scan_status,
            scan_report=scan_report,
            note=note,
            updated_by=updated_by,
        )
        return True

    def enable(self, skill_id: str) -> bool:
        skill = self._skills.get(skill_id)
        if not skill:
            return False
        skill.enabled = True
        return True

    def disable(self, skill_id: str) -> bool:
        skill = self._skills.get(skill_id)
        if not skill:
            return False
        skill.enabled = False
        return True

    def search(self, query: str) -> list[LobsterSkill]:
        q = query.lower()
        return [
            s for s in self._skills.values()
            if q in s.name.lower() or q in s.description.lower() or q in s.id.lower()
        ]

    def to_api_list(self, lobster_id: str | None = None) -> list[dict[str, Any]]:
        skills = self.get_by_lobster(lobster_id) if lobster_id else self.get_all()
        return [s.to_api_dict() for s in skills]

    def load_gotchas(self, skill_id: str) -> list[str]:
        skill = self.get(skill_id)
        if skill is None:
            return []
        if skill.gotchas:
            return list(skill.gotchas)
        lobster_id = skill.bound_lobsters[0] if skill.bound_lobsters else ""
        if not lobster_id:
            return []
        return _parse_gotchas_for_skill(lobster_id, skill_id)


def _select(*pairs: tuple[str, str]) -> list[SkillSelectOption]:
    return [SkillSelectOption(value=v, label=l) for v, l in pairs]


def _gotchas_doc_path(lobster_id: str) -> Path:
    return Path(__file__).resolve().parent.parent / "packages" / "lobsters" / f"lobster-{lobster_id}" / "skills" / "GOTCHAS.md"


def _parse_gotchas_for_skill(lobster_id: str, skill_id: str) -> list[str]:
    path = _gotchas_doc_path(lobster_id)
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8-sig")
    match = re.search(
        rf"^##\s+{re.escape(skill_id)}\s*$([\s\S]*?)(?=^##\s+|\Z)",
        text,
        flags=re.MULTILINE,
    )
    if not match:
        return []
    body = match.group(1)
    gotchas: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            gotchas.append(stripped[2:].strip())
    return [item for item in gotchas if item]


_DEFAULT_EFFECTIVENESS_BY_LOBSTER: dict[str, dict[str, dict[str, int] | int]] = {
    "radar": {
        "overall": 4,
        "by_industry": {"beauty": 4, "mother_baby": 4, "3c": 5, "b2b": 4, "education": 4, "medical_health": 3},
        "by_channel": {"xiaohongshu": 4, "douyin": 4, "wechat": 3, "weibo": 5},
    },
    "strategist": {
        "overall": 4,
        "by_industry": {"beauty": 4, "mother_baby": 4, "3c": 4, "b2b": 5, "education": 4, "medical_health": 4},
        "by_channel": {"xiaohongshu": 4, "douyin": 4, "wechat": 4, "weibo": 3},
    },
    "inkwriter": {
        "overall": 4,
        "by_industry": {"beauty": 5, "mother_baby": 4, "3c": 3, "b2b": 2, "education": 4, "medical_health": 3},
        "by_channel": {"xiaohongshu": 5, "douyin": 4, "wechat": 4, "weibo": 3},
    },
    "visualizer": {
        "overall": 4,
        "by_industry": {"beauty": 5, "mother_baby": 4, "3c": 4, "b2b": 2, "education": 3, "medical_health": 3},
        "by_channel": {"xiaohongshu": 5, "douyin": 5, "wechat": 3, "weibo": 3},
    },
    "dispatcher": {
        "overall": 4,
        "by_industry": {"beauty": 4, "mother_baby": 4, "3c": 4, "b2b": 3, "education": 4, "medical_health": 3},
        "by_channel": {"xiaohongshu": 4, "douyin": 5, "wechat": 4, "weibo": 3},
    },
    "echoer": {
        "overall": 4,
        "by_industry": {"beauty": 4, "mother_baby": 4, "3c": 3, "b2b": 3, "education": 4, "medical_health": 4},
        "by_channel": {"xiaohongshu": 4, "douyin": 4, "wechat": 5, "weibo": 3},
    },
    "catcher": {
        "overall": 4,
        "by_industry": {"beauty": 4, "mother_baby": 4, "3c": 3, "b2b": 4, "education": 4, "medical_health": 4},
        "by_channel": {"xiaohongshu": 4, "douyin": 4, "wechat": 5, "weibo": 3},
    },
    "abacus": {
        "overall": 4,
        "by_industry": {"beauty": 4, "mother_baby": 4, "3c": 4, "b2b": 5, "education": 4, "medical_health": 4},
        "by_channel": {"xiaohongshu": 3, "douyin": 3, "wechat": 4, "weibo": 3},
    },
    "followup": {
        "overall": 4,
        "by_industry": {"beauty": 4, "mother_baby": 4, "3c": 3, "b2b": 4, "education": 5, "medical_health": 4},
        "by_channel": {"xiaohongshu": 3, "douyin": 4, "wechat": 5, "weibo": 3},
    },
}

_SKILL_EFFECTIVENESS_SEEDS: dict[str, dict[str, Any]] = {
    "radar_web_search": {"overall": 4, "by_industry": {"3c": 5, "b2b": 4}, "by_channel": {"weibo": 5}},
    "radar_trend_analysis": {"overall": 4, "by_industry": {"beauty": 5, "3c": 5}, "by_channel": {"xiaohongshu": 4}},
    "radar_hotspot_monitor": {"overall": 5, "by_industry": {"beauty": 5, "mother_baby": 5}, "by_channel": {"weibo": 5, "douyin": 5}},
    "radar_competitor_track": {"overall": 4, "by_industry": {"3c": 5, "beauty": 4}, "by_channel": {"xiaohongshu": 5}},
    "radar_keyword_radar": {"overall": 4, "by_industry": {"b2b": 5, "education": 4}, "by_channel": {"wechat": 4}},
    "radar_user_profiling": {"overall": 4, "by_industry": {"mother_baby": 5, "beauty": 4}, "by_channel": {"xiaohongshu": 4}},
    "radar_metrics_feedback": {"overall": 4, "by_industry": {"beauty": 4, "education": 4}, "by_channel": {"douyin": 5}},
    "radar_sentiment_alert": {"overall": 5, "by_industry": {"medical_health": 5, "beauty": 4}, "by_channel": {"weibo": 5, "wechat": 4}},
    "strategist_goal_decompose": {"overall": 5, "by_industry": {"b2b": 5, "education": 5}, "by_channel": {"wechat": 4}},
    "strategist_platform_allocation": {"overall": 4, "by_industry": {"beauty": 5, "3c": 4}, "by_channel": {"douyin": 5, "xiaohongshu": 5}},
    "strategist_content_calendar": {"overall": 4, "by_industry": {"education": 5, "mother_baby": 4}, "by_channel": {"xiaohongshu": 4}},
    "strategist_ab_test_design": {"overall": 5, "by_industry": {"beauty": 5, "3c": 5}, "by_channel": {"douyin": 5}},
    "strategist_budget_suggestion": {"overall": 4, "by_industry": {"b2b": 5, "medical_health": 4}, "by_channel": {"wechat": 4}},
    "strategist_adaptive_adjust": {"overall": 4, "by_industry": {"beauty": 4, "education": 4}, "by_channel": {"douyin": 4}},
    "strategist_competitor_playbook": {"overall": 4, "by_industry": {"3c": 5, "beauty": 4}, "by_channel": {"xiaohongshu": 4, "weibo": 4}},
    "inkwriter_copy_generate": {"overall": 5, "by_industry": {"beauty": 5, "education": 4}, "by_channel": {"xiaohongshu": 5, "douyin": 4}},
    "inkwriter_multiplatform_adapt": {"overall": 4, "by_industry": {"3c": 4, "mother_baby": 4}, "by_channel": {"douyin": 5, "wechat": 4}},
    "inkwriter_hashtag_gen": {"overall": 4, "by_industry": {"beauty": 5, "3c": 4}, "by_channel": {"xiaohongshu": 5, "weibo": 4}},
    "inkwriter_banned_word_check": {"overall": 5, "by_industry": {"medical_health": 5, "beauty": 4}, "by_channel": {"xiaohongshu": 5, "douyin": 5}},
    "inkwriter_dm_script": {"overall": 4, "by_industry": {"education": 5, "b2b": 4}, "by_channel": {"wechat": 5, "douyin": 4}},
    "visualizer_storyboard": {"overall": 5, "by_industry": {"beauty": 5, "3c": 4}, "by_channel": {"douyin": 5}},
    "visualizer_ai_prompt": {"overall": 4, "by_industry": {"beauty": 5, "mother_baby": 4}, "by_channel": {"xiaohongshu": 5}},
    "visualizer_image_gen": {"overall": 4, "by_industry": {"beauty": 5, "3c": 4}, "by_channel": {"xiaohongshu": 5}},
    "visualizer_cover_design": {"overall": 4, "by_industry": {"beauty": 5, "education": 3}, "by_channel": {"xiaohongshu": 5, "douyin": 4}},
    "visualizer_digital_human_script": {"overall": 4, "by_industry": {"medical_health": 4, "education": 4}, "by_channel": {"douyin": 5}},
    "visualizer_digital_human_video": {"overall": 5, "by_industry": {"beauty": 5, "medical_health": 4}, "by_channel": {"douyin": 5}},
    "visualizer_video_edit": {"overall": 4, "by_industry": {"3c": 4, "beauty": 4}, "by_channel": {"douyin": 5, "weibo": 4}},
    "visualizer_subtitle_gen": {"overall": 4, "by_industry": {"education": 4, "medical_health": 4}, "by_channel": {"douyin": 5, "wechat": 3}},
    "dispatcher_task_split": {"overall": 4, "by_industry": {"b2b": 4, "education": 4}, "by_channel": {"wechat": 4}},
    "dispatcher_scheduled_publish": {"overall": 5, "by_industry": {"beauty": 5, "mother_baby": 4}, "by_channel": {"douyin": 5, "xiaohongshu": 5}},
    "dispatcher_multi_account_rotate": {"overall": 4, "by_industry": {"beauty": 5, "3c": 4}, "by_channel": {"douyin": 5, "weibo": 4}},
    "dispatcher_emergency_takedown": {"overall": 5, "by_industry": {"medical_health": 5, "beauty": 4}, "by_channel": {"xiaohongshu": 4, "douyin": 4}},
    "echoer_reply_generate": {"overall": 5, "by_industry": {"beauty": 4, "education": 5}, "by_channel": {"wechat": 5, "xiaohongshu": 4}},
    "echoer_comment_manage": {"overall": 4, "by_industry": {"beauty": 5, "medical_health": 4}, "by_channel": {"xiaohongshu": 5, "douyin": 4}},
    "echoer_dm_auto_reply": {"overall": 4, "by_industry": {"education": 5, "b2b": 4}, "by_channel": {"wechat": 5, "douyin": 4}},
    "echoer_wechat_funnel": {"overall": 5, "by_industry": {"education": 5, "medical_health": 4}, "by_channel": {"wechat": 5}},
    "catcher_lead_score": {"overall": 5, "by_industry": {"b2b": 5, "education": 5}, "by_channel": {"wechat": 5}},
    "catcher_crm_push": {"overall": 4, "by_industry": {"b2b": 5, "medical_health": 4}, "by_channel": {"wechat": 5}},
    "catcher_cross_platform_dedup": {"overall": 4, "by_industry": {"beauty": 4, "education": 4}, "by_channel": {"wechat": 4, "weibo": 4}},
    "abacus_roi_calc": {"overall": 5, "by_industry": {"b2b": 5, "3c": 4}, "by_channel": {"douyin": 4, "wechat": 4}},
    "abacus_multi_touch_attribution": {"overall": 5, "by_industry": {"education": 5, "b2b": 5}, "by_channel": {"wechat": 5}},
    "abacus_strategy_report": {"overall": 4, "by_industry": {"b2b": 5, "medical_health": 4}, "by_channel": {"wechat": 4}},
    "abacus_feedback_loop": {"overall": 4, "by_industry": {"beauty": 4, "education": 4}, "by_channel": {"douyin": 4, "wechat": 4}},
    "followup_sop_generate": {"overall": 4, "by_industry": {"b2b": 4, "education": 5}, "by_channel": {"wechat": 5}},
    "followup_multi_touch": {"overall": 5, "by_industry": {"education": 5, "medical_health": 4}, "by_channel": {"wechat": 5, "douyin": 4}},
    "followup_dormant_wake": {"overall": 4, "by_industry": {"beauty": 4, "education": 5}, "by_channel": {"wechat": 5, "xiaohongshu": 3}},
}


def _build_effectiveness_seed(skill_id: str, bound_lobsters: list[str]) -> SkillEffectivenessRating:
    lobster_id = bound_lobsters[0] if bound_lobsters else "radar"
    base = _DEFAULT_EFFECTIVENESS_BY_LOBSTER.get(lobster_id, {})
    seed = _SKILL_EFFECTIVENESS_SEEDS.get(skill_id, {})
    by_industry = dict(base.get("by_industry", {})) | dict(seed.get("by_industry", {}))
    by_channel = dict(base.get("by_channel", {})) | dict(seed.get("by_channel", {}))
    return SkillEffectivenessRating(
        overall=int(seed.get("overall", base.get("overall", 3))),
        by_industry=by_industry,
        by_channel=by_channel,
        sample_size=0,
        last_calibrated=None,
        confidence=0.0,
    )


def _apply_effectiveness_seeds(registry: LobsterSkillRegistry) -> None:
    for skill in registry.get_all():
        skill.effectiveness = _build_effectiveness_seed(skill.id, skill.bound_lobsters)


def register_builtin_skills(registry: LobsterSkillRegistry):
    """注册所有内置龙虾技能。"""
    if registry.get_all():
        return

    def reg(**kwargs: Any) -> None:
        registry.register(LobsterSkill(source=SkillSource.BUILTIN, version="v1", author="Codex", **kwargs))

    # Radar (8)
    reg(id="radar_web_search", name="全网信号搜索", description="跨平台搜索行业关键词、竞品线索和公开讨论。", icon="📡", category="信号采集", bound_lobsters=["radar"], config_fields=[SkillConfigField(key="search_depth", label="搜索深度", field_type=SkillFieldType.SELECT, options=_select(("shallow", "浅层"), ("deep", "深层")), default_value="shallow"), SkillConfigField(key="max_results", label="最大结果数", field_type=SkillFieldType.NUMBER, default_value="20", placeholder="10-100")])
    reg(id="radar_trend_analysis", name="趋势归纳分析", description="对信号结果做聚类、归纳和趋势判断。", icon="📈", category="信号采集", bound_lobsters=["radar"])
    reg(id="radar_hotspot_monitor", name="全网热点监控", description="监控微博、抖音、小红书等平台热点。", icon="🔥", category="信号采集", bound_lobsters=["radar"], config_fields=[SkillConfigField(key="platforms", label="监控平台", field_type=SkillFieldType.TEXT, default_value="weibo,douyin,xiaohongshu"), SkillConfigField(key="refresh_interval", label="刷新间隔(分钟)", field_type=SkillFieldType.NUMBER, default_value="30")])
    reg(id="radar_competitor_track", name="竞品内容追踪", description="持续追踪竞品账号的新内容和互动表现。", icon="🕵️", category="信号采集", bound_lobsters=["radar"], config_fields=[SkillConfigField(key="competitor_accounts", label="竞品账号列表", field_type=SkillFieldType.TEXTAREA, placeholder="每行一个账号ID")])
    reg(id="radar_keyword_radar", name="行业关键词雷达", description="构建行业关键词雷达并持续监听提及量变化。", icon="📶", category="信号采集", bound_lobsters=["radar"])
    reg(id="radar_user_profiling", name="用户画像分析", description="分析目标平台用户画像、兴趣偏好和活跃节奏。", icon="👤", category="信号采集", bound_lobsters=["radar"])
    reg(id="radar_metrics_feedback", name="内容效果反馈接收", description="接收已发布内容的播放、互动、转化等反馈。", icon="📬", category="信号采集", bound_lobsters=["radar"])
    reg(id="radar_sentiment_alert", name="舆情风险预警", description="检测品牌相关负面舆情并进行告警。", icon="🚨", category="信号采集", bound_lobsters=["radar"])

    # Strategist (7)
    reg(id="strategist_goal_decompose", name="目标拆解", description="将增长目标拆解为可执行子任务。", icon="🧠", category="策略规划", bound_lobsters=["strategist"])
    reg(id="strategist_platform_allocation", name="多平台投放策略", description="根据目标和预算分配各平台内容和投放比重。", icon="🗺️", category="策略规划", bound_lobsters=["strategist"])
    reg(id="strategist_content_calendar", name="内容日历排期", description="生成 7 天 / 30 天内容日历和发布节奏。", icon="🗓️", category="策略规划", bound_lobsters=["strategist"])
    reg(id="strategist_ab_test_design", name="A/B 测试设计", description="为同一主题设计多种内容或转化变体。", icon="🧪", category="策略规划", bound_lobsters=["strategist"])
    reg(id="strategist_budget_suggestion", name="预算分配建议", description="根据历史效果和目标给出预算分配建议。", icon="💰", category="策略规划", bound_lobsters=["strategist"])
    reg(id="strategist_adaptive_adjust", name="策略自适应调整", description="根据反馈数据自动调整下一轮策略参数。", icon="🔁", category="策略规划", bound_lobsters=["strategist"])
    reg(id="strategist_competitor_playbook", name="竞品打法对标", description="归纳竞品打法并提出差异化建议。", icon="📚", category="策略规划", bound_lobsters=["strategist"])

    # Inkwriter (5)
    reg(id="inkwriter_copy_generate", name="成交文案生成", description="生成适合当前业务目标的成交导向文案。", icon="✍️", category="内容生产", bound_lobsters=["inkwriter"])
    reg(id="inkwriter_multiplatform_adapt", name="多平台文案适配", description="将同一核心信息改写为不同平台风格。", icon="🪄", category="内容生产", bound_lobsters=["inkwriter"], config_fields=[SkillConfigField(key="target_platforms", label="目标平台", field_type=SkillFieldType.TEXT, default_value="douyin,xiaohongshu,wechat")])
    reg(id="inkwriter_hashtag_gen", name="话题标签生成", description="为每条内容生成最适合的 hashtag 组合。", icon="#️⃣", category="内容生产", bound_lobsters=["inkwriter"])
    reg(id="inkwriter_banned_word_check", name="违禁词检测", description="检查敏感词、违规承诺和平台禁用表达。", icon="🛡️", category="风控", bound_lobsters=["inkwriter"])
    reg(id="inkwriter_dm_script", name="私信话术链", description="生成多轮私信跟进与转化话术。", icon="💬", category="互动", bound_lobsters=["inkwriter"])

    # Visualizer (8)
    reg(id="visualizer_storyboard", name="分镜脚本生成", description="将文案转换为可执行分镜脚本和镜头顺序。", icon="🎬", category="内容生产", bound_lobsters=["visualizer"])
    reg(id="visualizer_ai_prompt", name="AI 绘图提示词生成", description="根据脚本和场景生成 AI 绘图提示词。", icon="🖼️", category="视觉生产", bound_lobsters=["visualizer"])
    reg(id="visualizer_image_gen", name="AI 图片生成", description="调用图像生成服务直接产出配图。", icon="🖌️", category="视觉生产", bound_lobsters=["visualizer"], config_fields=[SkillConfigField(key="image_provider", label="图片生成服务", field_type=SkillFieldType.SELECT, options=_select(("midjourney", "Midjourney"), ("stable_diffusion", "Stable Diffusion"), ("dalle", "DALL-E"), ("flux", "Flux"))), SkillConfigField(key="image_api_key", label="API Key", field_type=SkillFieldType.PASSWORD)])
    reg(id="visualizer_cover_design", name="封面图设计", description="生成高点击封面图与文案排版建议。", icon="🧲", category="视觉生产", bound_lobsters=["visualizer"])
    reg(id="visualizer_digital_human_script", name="数字人视频脚本", description="生成数字人口播视频脚本和演绎标注。", icon="🗣️", category="视频生产", bound_lobsters=["visualizer"])
    reg(id="visualizer_digital_human_video", name="数字人视频生成", description="调用数字人平台生成口播视频。", icon="🤖", category="视频生产", bound_lobsters=["visualizer"], config_fields=[SkillConfigField(key="dh_provider", label="数字人平台", field_type=SkillFieldType.SELECT, options=_select(("heygen", "HeyGen"), ("did", "D-ID"), ("silicon", "硅基智能"), ("tencent_zhiying", "腾讯智影"))), SkillConfigField(key="dh_api_key", label="API Key", field_type=SkillFieldType.PASSWORD), SkillConfigField(key="avatar_id", label="数字人形象 ID", field_type=SkillFieldType.TEXT)])
    reg(id="visualizer_video_edit", name="视频剪辑", description="生成剪辑指令并驱动视频后期。", icon="✂️", category="视频生产", bound_lobsters=["visualizer"])
    reg(id="visualizer_subtitle_gen", name="字幕生成", description="自动生成字幕（SRT/ASS）并支持语音转文字。", icon="🔤", category="视频生产", bound_lobsters=["visualizer"], config_fields=[SkillConfigField(key="stt_provider", label="语音识别服务", field_type=SkillFieldType.SELECT, options=_select(("whisper", "OpenAI Whisper"), ("xunfei", "讯飞语音")))])

    # Dispatcher (4)
    reg(id="dispatcher_task_split", name="任务拆包分发", description="将内容生产和执行任务拆包并分发。", icon="📦", category="调度执行", bound_lobsters=["dispatcher"])
    reg(id="dispatcher_scheduled_publish", name="定时发布", description="按最佳时间窗口定时发布到目标渠道。", icon="⏰", category="调度执行", bound_lobsters=["dispatcher"])
    reg(id="dispatcher_multi_account_rotate", name="多账号轮转", description="多账号轮转执行，降低单账号风险。", icon="🔄", category="调度执行", bound_lobsters=["dispatcher"])
    reg(id="dispatcher_emergency_takedown", name="紧急下架", description="发现风险时对已发布内容执行紧急下架。", icon="🧯", category="风控", bound_lobsters=["dispatcher"])

    # Echoer (4)
    reg(id="echoer_reply_generate", name="真人感互动回复", description="生成自然、可信、带引导性的互动回复。", icon="💡", category="互动", bound_lobsters=["echoer"])
    reg(id="echoer_comment_manage", name="评论区管理", description="回复、置顶、管理评论区互动节奏。", icon="🗨️", category="互动", bound_lobsters=["echoer"])
    reg(id="echoer_dm_auto_reply", name="私信自动回复", description="根据用户意图自动回复私信。", icon="📨", category="互动", bound_lobsters=["echoer"])
    reg(id="echoer_wechat_funnel", name="私信→微信引流", description="把高价值用户从平台私信引导到微信。", icon="🧲", category="转化", bound_lobsters=["echoer"])

    # Catcher (3)
    reg(id="catcher_lead_score", name="高意向线索识别", description="识别高意向客户并给出初步价值分。", icon="🎯", category="线索管理", bound_lobsters=["catcher"])
    reg(id="catcher_crm_push", name="线索自动入 CRM", description="将高分线索自动推送到 CRM。", icon="🗂️", category="线索管理", bound_lobsters=["catcher"])
    reg(id="catcher_cross_platform_dedup", name="跨平台线索去重", description="将多平台重复线索归并成一个主体。", icon="🧹", category="线索管理", bound_lobsters=["catcher"])

    # Abacus (4)
    reg(id="abacus_roi_calc", name="ROI 归因计算", description="计算内容、渠道、客户维度的 ROI。", icon="🧮", category="数据分析", bound_lobsters=["abacus"])
    reg(id="abacus_multi_touch_attribution", name="多触点归因分析", description="支持首触、末触、线性、时间衰减等归因模型。", icon="🕸️", category="数据分析", bound_lobsters=["abacus"])
    reg(id="abacus_strategy_report", name="策略效果报告", description="生成每周/每月策略效果分析报告。", icon="📊", category="数据分析", bound_lobsters=["abacus"])
    reg(id="abacus_feedback_loop", name="策略反馈闭环", description="将效果反馈给前链路，驱动下一轮策略优化。", icon="♻️", category="闭环优化", bound_lobsters=["abacus"])

    # Followup (3)
    reg(id="followup_sop_generate", name="跟进 SOP 生成", description="生成适配客户状态的跟进 SOP。", icon="📋", category="客户跟进", bound_lobsters=["followup"])
    reg(id="followup_multi_touch", name="多触点跟进编排", description="私信、微信、电话、邮件多触点编排推进。", icon="📞", category="客户跟进", bound_lobsters=["followup"])
    reg(id="followup_dormant_wake", name="沉默用户唤醒", description="对长时间沉默用户进行再激活。", icon="🔔", category="客户跟进", bound_lobsters=["followup"])

    skill_dirs = {
        "radar_web_search": {
            "skill_dir": "packages/lobsters/lobster-radar/skills/web-search",
            "gotchas": [
                "不要一次搜索过宽关键词，先具体再扩展。",
                "不要忽略结果时间戳，先看日期。",
                "不要直接复制搜索结果，必须提炼并标注来源。"
            ],
            "references": {"search-api-guide.md": "首次使用或 API 报错时", "search-scoring.md": "需要对搜索结果打分时"},
            "scripts": {"agent-reach-search.sh": "调用 Agent Reach API 执行搜索"}
        },
        "radar_competitor_track": {
            "skill_dir": "packages/lobsters/lobster-radar/skills/competitor-tracking",
            "gotchas": [
                "不要只看单条爆款，要看连续发布节奏。",
                "不要把互动高低直接等同转化效果。",
                "不要忽略负面内容和下架迹象。"
            ],
            "references": {"competitor-data-schema.md": "理解竞品数据结构时", "scoring-criteria.md": "需要评估竞品影响时"},
            "scripts": {"fetch-competitor-data.py": "拉取竞品内容与互动数据"}
        },
        "strategist_goal_decompose": {
            "skill_dir": "packages/lobsters/lobster-strategist/skills/goal-decompose",
            "gotchas": [
                "不要把目标拆得过细导致执行成本失控。",
                "不要忽视预算和审批边界。",
                "不要输出只有一种方案的僵硬策略。"
            ],
            "references": {"goal-breakdown-patterns.md": "拆解复杂目标时"},
            "scripts": {"goal-decompose.py": "生成目标拆解结构"}
        },
        "strategist_content_calendar": {
            "skill_dir": "packages/lobsters/lobster-strategist/skills/calendar-plan",
            "gotchas": [
                "不要排满全部时段，要留灰度空间。",
                "不要忽略不同平台发布时间窗差异。",
                "不要把固定排期当成永远不变。"
            ],
            "references": {"calendar-best-practices.md": "生成内容日历前"},
            "scripts": {"calendar-plan.py": "生成内容排期计划"}
        },
        "inkwriter_copy_generate": {
            "skill_dir": "packages/lobsters/lobster-inkwriter/skills/copy-generate",
            "gotchas": [
                "不要只追求华丽措辞，必须保留成交目标。",
                "不要忽略平台语境。",
                "不要默认用户已经理解产品背景。"
            ],
            "references": {"copy-structures.md": "生成成交文案前"},
            "scripts": {"copy-generate.py": "生成多版本文案"}
        },
        "inkwriter_banned_word_check": {
            "skill_dir": "packages/lobsters/lobster-inkwriter/skills/compliance-check",
            "gotchas": [
                "不要只查显性违禁词，要查隐性承诺。",
                "不要忽略医疗/教育等高敏行业差异。",
                "不要把风险提示写得模糊。"
            ],
            "references": {"platform-compliance.md": "遇到高风险内容时"},
            "scripts": {"compliance-check.py": "执行违禁词与风险表达检查"}
        },
        "visualizer_storyboard": {
            "skill_dir": "packages/lobsters/lobster-visualizer/skills/storyboard",
            "gotchas": [
                "不要只给抽象意象，必须落到镜头。",
                "不要忽略素材依赖和执行可行性。",
                "不要跳过首屏点击要素。"
            ],
            "references": {"storyboard-rules.md": "生成分镜前"},
            "scripts": {"storyboard-build.py": "生成分镜结构"}
        },
        "visualizer_image_gen": {
            "skill_dir": "packages/lobsters/lobster-visualizer/skills/ai-image",
            "gotchas": [
                "不要忽略尺寸和平台比例。",
                "不要忽略版权与可商用限制。",
                "不要把提示词写成无法执行的堆砌。"
            ],
            "references": {"image-provider-guide.md": "切换图像服务时"},
            "scripts": {"ai-image-generate.sh": "调用图像生成服务"}
        },
        "dispatcher_scheduled_publish": {
            "skill_dir": "packages/lobsters/lobster-dispatcher/skills/schedule-publish",
            "gotchas": [
                "不要在审批未完成时发出任务。",
                "不要忽略账号时间窗和限流。",
                "不要把失败任务直接丢弃。"
            ],
            "references": {"publish-schedule-policy.md": "配置发布时间时"},
            "scripts": {"schedule-publish.py": "生成发布调度计划"}
        },
        "dispatcher_multi_account_rotate": {
            "skill_dir": "packages/lobsters/lobster-dispatcher/skills/account-rotate",
            "gotchas": [
                "不要重复命中同一账号导致风控。",
                "不要跨租户串号。",
                "不要轮转到状态异常账号。"
            ],
            "references": {"account-rotation-policy.md": "进行账号轮转前"},
            "scripts": {"rotate-account.py": "根据规则选择发布账号"}
        },
        "echoer_reply_generate": {
            "skill_dir": "packages/lobsters/lobster-echoer/skills/reply-generate",
            "gotchas": [
                "不要像机器人一样回复。",
                "不要激化用户情绪。",
                "不要越权承诺优惠或结果。"
            ],
            "references": {"reply-style-guide.md": "生成互动回复时"},
            "scripts": {"reply-generate.py": "生成互动回复建议"}
        },
        "echoer_dm_auto_reply": {
            "skill_dir": "packages/lobsters/lobster-echoer/skills/dm-reply",
            "gotchas": [
                "不要直接把所有私信都推到微信。",
                "不要忽略对方意图和语言风格。",
                "不要在投诉场景继续营销。"
            ],
            "references": {"dm-routing-guide.md": "进行私信分流时"},
            "scripts": {"dm-reply.py": "生成私信自动回复"}
        },
        "catcher_lead_score": {
            "skill_dir": "packages/lobsters/lobster-catcher/skills/lead-score",
            "gotchas": [
                "不要把高互动误判为高意向。",
                "不要忽略跨平台重复身份。",
                "不要遗漏风险标签。"
            ],
            "references": {"lead-score-rules.md": "执行线索评分时"},
            "scripts": {"lead-score.py": "计算线索得分"}
        },
        "catcher_crm_push": {
            "skill_dir": "packages/lobsters/lobster-catcher/skills/crm-sync",
            "gotchas": [
                "不要重复写入同一线索。",
                "不要把低质量线索直接推 CRM。",
                "不要丢失来源和评分信息。"
            ],
            "references": {"crm-payload-schema.md": "同步线索到 CRM 时"},
            "scripts": {"crm-sync.py": "推送高分线索到 CRM"}
        },
        "abacus_roi_calc": {
            "skill_dir": "packages/lobsters/lobster-abacus/skills/roi-calc",
            "gotchas": [
                "不要混淆投入和产出时间窗口。",
                "不要忽略样本不足。",
                "不要把估算值当成精确值。"
            ],
            "references": {"roi-formula.md": "计算 ROI 时"},
            "scripts": {"roi-calc.py": "计算 ROI 和关键指标"}
        },
        "abacus_multi_touch_attribution": {
            "skill_dir": "packages/lobsters/lobster-abacus/skills/attribution",
            "gotchas": [
                "不要默认单触点归因。",
                "不要忽略时间衰减影响。",
                "不要遗漏低频高价值触点。"
            ],
            "references": {"attribution-models.md": "选择归因模型时"},
            "scripts": {"attribution.py": "执行多触点归因分析"}
        },
        "followup_sop_generate": {
            "skill_dir": "packages/lobsters/lobster-followup/skills/sop-generate",
            "gotchas": [
                "不要让 SOP 过长导致执行断裂。",
                "不要忽略审批和触达频率限制。",
                "不要在缺少上下文时硬推成交。"
            ],
            "references": {"followup-sop-guide.md": "生成跟进 SOP 时"},
            "scripts": {"sop-generate.py": "生成跟进 SOP"}
        },
        "followup_multi_touch": {
            "skill_dir": "packages/lobsters/lobster-followup/skills/multi-touch",
            "gotchas": [
                "不要多个触点同时轰炸用户。",
                "不要忽略前一次触达结果。",
                "不要跨触点重复表达相同内容。"
            ],
            "references": {"multi-touch-playbook.md": "编排多触点链路时"},
            "scripts": {"multi-touch.py": "生成多触点跟进序列"}
        }
    }

    for skill_id, meta in skill_dirs.items():
        skill = registry.get(skill_id)
        if skill is None:
            continue
        skill.gotchas = list(meta["gotchas"])
        skill.references = dict(meta["references"])
        skill.scripts = dict(meta["scripts"])
        skill.skill_dir = str(meta["skill_dir"])

    _apply_effectiveness_seeds(registry)
    _apply_prompt_asset_metadata(registry)


def _apply_prompt_asset_metadata(registry: LobsterSkillRegistry) -> None:
    try:
        from prompt_asset_loader import get_prompt_loader

        loader = get_prompt_loader()
        loader.load_all_prompts()
    except Exception:
        return

    for skill in registry.get_all():
        try:
            skill.prompt_templates = loader.get_prompt_refs_for_skill(skill.id)
        except Exception:
            skill.prompt_templates = []


def _apply_skill_gotchas_metadata(registry: LobsterSkillRegistry) -> None:
    for skill in registry.get_all():
        lobster_id = skill.bound_lobsters[0] if skill.bound_lobsters else ""
        if not lobster_id:
            continue
        doc_gotchas = _parse_gotchas_for_skill(lobster_id, skill.id)
        if doc_gotchas:
            skill.gotchas = doc_gotchas


def _apply_manifest_metadata(registry: LobsterSkillRegistry) -> None:
    records = load_all_skill_manifests()
    registry.set_manifest_records(records)
    if records:
        logger.info("Loaded %d skills from skill.manifest.yaml", len(records))
    policy = SkillPublishPolicy()
    for skill in registry.get_all():
        lobster_id = skill.bound_lobsters[0] if skill.bound_lobsters else ""
        if not lobster_id:
            continue
        record = records.get(lobster_id)
        if record is None:
            continue
        try:
            system_prompt, user_template = load_prompt_assets_for_manifest(record)
            violations = policy.validate(
                record.to_dict(),
                [str(item) for item in [record.system_prompt_path, record.user_template_path] if str(item).strip()],
                system_prompt=system_prompt,
                user_template=user_template,
            )
            if violations:
                logger.warning("Skill manifest policy rejected lobster=%s violations=%s", lobster_id, violations)
                try:
                    import asyncio
                    coro = get_audit_service().log(
                        AuditEventType.SYSTEM_CONFIG_UPDATE,
                        tenant_id="tenant_main",
                        user_id="system",
                        resource_type="skill_manifest",
                        resource_id=record.id,
                        details={"lobster_id": lobster_id, "violations": violations},
                        severity="WARNING",
                    )
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(coro)
                    except RuntimeError:
                        asyncio.run(coro)
                except Exception:
                    pass
                continue
        except Exception as exc:  # noqa: BLE001
            logger.warning("Skill manifest policy validation skipped for lobster=%s: %s", lobster_id, exc)
        if record.trigger_keywords:
            skill.trigger_keywords = list(record.trigger_keywords)
        if record.industry_tags:
            skill.industry_tags = list(record.industry_tags)
        if record.allowed_tools:
            skill.allowed_tools = list(record.allowed_tools)
        skill.priority = str(record.priority or skill.priority)
        skill.publish_status = str(record.publish_status or skill.publish_status)
        skill.max_tokens_budget = int(record.max_tokens_budget or skill.max_tokens_budget)
        skill.scan_status = str(record.scan_status or skill.scan_status)
        skill.scan_report = dict(record.scan_report or skill.scan_report)
        skill.manifest_id = record.id
        skill.manifest_path = record.manifest_path
        registry._apply_runtime_row(skill)


def get_skill_registry() -> LobsterSkillRegistry:
    """获取全局技能注册表实例。"""
    registry = LobsterSkillRegistry()
    if not registry.get_all():
        register_builtin_skills(registry)
    _apply_manifest_metadata(registry)
    _apply_skill_gotchas_metadata(registry)
    return registry
