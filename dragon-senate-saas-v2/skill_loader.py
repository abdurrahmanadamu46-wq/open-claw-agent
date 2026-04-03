"""
Skill loader for on-demand lobster skill selection.

Reads from LobsterSkillRegistry and narrows the candidate skill set by simple
task/channel/industry/category heuristics so runners do not need to carry the
entire skill catalog into every prompt.
"""

from __future__ import annotations

from typing import Any

from lobster_skill_registry import LobsterSkill
from lobster_skill_registry import LobsterSkillRegistry


class SkillLoader:
    def __init__(self, registry: LobsterSkillRegistry):
        self.registry = registry
        self._loaded_cache: dict[str, list[LobsterSkill]] = {}

    def load_on_demand(self, lobster_id: str, context: dict[str, Any]) -> list[LobsterSkill]:
        cache_key = self._cache_key(lobster_id, context)
        if cache_key in self._loaded_cache:
            return list(self._loaded_cache[cache_key])
        all_skills = self.registry.get_skills_for_lobster(lobster_id)
        selected = [skill for skill in all_skills if skill.enabled and self._match_context(skill, context)]
        if not selected:
            selected = [skill for skill in all_skills if skill.enabled]
        self._loaded_cache[cache_key] = selected
        return list(selected)

    def _cache_key(self, lobster_id: str, context: dict[str, Any]) -> str:
        return "|".join(
            [
                lobster_id,
                str(context.get("task_type") or ""),
                str(context.get("channel") or context.get("target_channel") or ""),
                str(context.get("industry") or context.get("industry_tag") or ""),
            ]
        )

    def _match_context(self, skill: LobsterSkill, context: dict[str, Any]) -> bool:
        industry = str(context.get("industry") or context.get("industry_tag") or "").lower()
        if skill.industry_tags and industry:
            normalized_tags = {str(item).strip().lower() for item in skill.industry_tags if str(item).strip()}
            if "general" not in normalized_tags and industry not in normalized_tags:
                return False

        haystack = " ".join(
            [
                str(skill.id or ""),
                str(skill.name or ""),
                str(skill.description or ""),
                str(skill.category or ""),
                " ".join(skill.trigger_keywords or []),
                str(context.get("task_type") or ""),
                str(context.get("channel") or context.get("target_channel") or ""),
                industry,
                str(context.get("task_description") or context.get("user_prompt") or ""),
            ]
        ).lower()

        category_rules = {
            "信号采集": ["search", "trend", "competitor", "hotspot", "signal", "舆情", "热点", "情报"],
            "策略规划": ["plan", "strategy", "budget", "calendar", "ab", "策略", "投放", "排期"],
            "内容生产": ["copy", "content", "script", "title", "文案", "脚本", "标题"],
            "视觉生产": ["image", "visual", "storyboard", "cover", "subtitle", "video", "视觉", "封面"],
            "调度执行": ["publish", "dispatch", "account", "rotate", "发布", "调度", "账号"],
            "互动": ["reply", "comment", "dm", "wechat", "互动", "回复", "私信"],
            "线索管理": ["lead", "crm", "dedup", "线索", "客户", "去重"],
            "数据分析": ["roi", "attribution", "report", "analysis", "复盘", "归因", "分析"],
            "客户跟进": ["followup", "wake", "sop", "multi_touch", "回访", "跟进", "唤醒"],
        }
        keywords = category_rules.get(str(skill.category or ""), [])
        if keywords and any(token in haystack for token in keywords):
            return True

        channel = str(context.get("channel") or context.get("target_channel") or "").lower()
        if channel and channel in haystack:
            return True
        task_type = str(context.get("task_type") or "").lower()
        if task_type and task_type in haystack:
            return True
        if industry and industry in haystack:
            return True
        return not keywords

    def check_gotchas(self, skill_id: str) -> list[str]:
        skill = self.registry.get_skill(skill_id)
        return list(skill.gotchas) if skill else []
