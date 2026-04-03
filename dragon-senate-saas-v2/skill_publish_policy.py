"""
skill_publish_policy.py — 技能发布策略门
======================================

把技能包格式、安全边界和行业约束当成一等领域策略，
在注册/加载时统一校验。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def _estimate_tokens(text: str) -> int:
    raw = str(text or "").strip()
    if not raw:
        return 0
    # 粗略估算：中文按 1~2 token，英文按 4 chars ≈ 1 token
    return max(1, int(len(raw) / 4))


@dataclass
class SkillPublishPolicy:
    required_manifest_fields: list[str] = field(
        default_factory=lambda: ["id", "lobster_id", "name", "description", "publish_status"]
    )
    max_system_prompt_tokens: int = 8000
    max_user_template_tokens: int = 4000
    allowed_file_extensions: set[str] = field(
        default_factory=lambda: {".md", ".json", ".yaml", ".yml", ".txt", ".csv"}
    )
    industry_tag_required_for_lobsters: list[str] = field(
        default_factory=lambda: ["radar", "inkwriter", "strategist"]
    )

    def validate(
        self,
        manifest: dict[str, Any],
        files: list[str],
        *,
        system_prompt: str = "",
        user_template: str = "",
    ) -> list[str]:
        violations: list[str] = []
        payload = dict(manifest or {})

        for field_name in self.required_manifest_fields:
            value = payload.get(field_name)
            if value is None or (isinstance(value, str) and not str(value).strip()):
                violations.append(f"required field '{field_name}' missing")

        lobster_id = str(payload.get("lobster_id") or "").strip()
        publish_status = str(payload.get("publish_status") or "").strip()
        if publish_status and publish_status not in {"draft", "review", "approved", "deprecated"}:
            violations.append("publish_status must be one of draft|review|approved|deprecated")

        priority = str(payload.get("priority") or "").strip()
        if priority and priority not in {"high", "medium", "low"}:
            violations.append("priority must be one of high|medium|low")

        version = str(payload.get("version") or "").strip()
        if version and "." not in version:
            violations.append("version must look like semantic version, e.g. 1.0.0")

        industry_tags = payload.get("industry_tags") or []
        if lobster_id in self.industry_tag_required_for_lobsters:
            if not isinstance(industry_tags, list) or not [str(item).strip() for item in industry_tags if str(item).strip()]:
                violations.append(f"industry_tags required for lobster '{lobster_id}'")

        for item in files:
            name = str(item or "").strip()
            if not name:
                continue
            suffix = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if suffix not in self.allowed_file_extensions:
                violations.append(f"file extension '{suffix or '[none]'}' not allowed")

        system_prompt_tokens = _estimate_tokens(system_prompt)
        user_template_tokens = _estimate_tokens(user_template)
        if system_prompt_tokens > self.max_system_prompt_tokens:
            violations.append(
                f"system prompt exceeds token budget ({system_prompt_tokens}>{self.max_system_prompt_tokens})"
            )
        if user_template_tokens > self.max_user_template_tokens:
            violations.append(
                f"user template exceeds token budget ({user_template_tokens}>{self.max_user_template_tokens})"
            )

        return violations
