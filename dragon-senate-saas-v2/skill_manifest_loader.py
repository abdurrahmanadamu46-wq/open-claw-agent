"""
skill_manifest_loader.py — 龙虾技能包 Manifest 读写器
==================================================

每只龙虾目录下维护一个 `skill.manifest.yaml`，作为技能包机器可读元数据：
- skill_loader / registry 启动时只索引 manifest
- 审批/扫描结果也写回 manifest
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import yaml
except Exception:  # noqa: BLE001
    yaml = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

PACKAGES_ROOT = Path(__file__).resolve().parent.parent / "packages" / "lobsters"


@dataclass(slots=True)
class SkillManifestRecord:
    id: str
    lobster_id: str
    name: str
    description: str
    trigger_keywords: list[str] = field(default_factory=list)
    industry_tags: list[str] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)
    priority: str = "medium"
    publish_status: str = "approved"
    version: str = "1.0.0"
    max_tokens_budget: int = 4000
    system_prompt_path: str = "prompt-kit/system.prompt.md"
    user_template_path: str = "prompt-kit/user-template.md"
    scan_status: str = "not_scanned"
    scan_report: dict[str, Any] = field(default_factory=dict)
    manifest_path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "lobster_id": self.lobster_id,
            "name": self.name,
            "description": self.description,
            "trigger_keywords": list(self.trigger_keywords),
            "industry_tags": list(self.industry_tags),
            "allowed_tools": list(self.allowed_tools),
            "priority": self.priority,
            "publish_status": self.publish_status,
            "version": self.version,
            "max_tokens_budget": int(self.max_tokens_budget),
            "system_prompt_path": self.system_prompt_path,
            "user_template_path": self.user_template_path,
            "scan_status": self.scan_status,
            "scan_report": dict(self.scan_report),
            "manifest_path": self.manifest_path,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any], *, manifest_path: str = "") -> "SkillManifestRecord":
        return cls(
            id=str(payload.get("id") or "").strip(),
            lobster_id=str(payload.get("lobster_id") or "").strip(),
            name=str(payload.get("name") or "").strip(),
            description=str(payload.get("description") or "").strip(),
            trigger_keywords=[str(item).strip() for item in (payload.get("trigger_keywords") or []) if str(item).strip()],
            industry_tags=[str(item).strip() for item in (payload.get("industry_tags") or []) if str(item).strip()],
            allowed_tools=[str(item).strip() for item in (payload.get("allowed_tools") or []) if str(item).strip()],
            priority=str(payload.get("priority") or "medium").strip() or "medium",
            publish_status=str(payload.get("publish_status") or "approved").strip() or "approved",
            version=str(payload.get("version") or "1.0.0").strip() or "1.0.0",
            max_tokens_budget=max(1, int(payload.get("max_tokens_budget") or 4000)),
            system_prompt_path=str(payload.get("system_prompt_path") or "prompt-kit/system.prompt.md").strip() or "prompt-kit/system.prompt.md",
            user_template_path=str(payload.get("user_template_path") or "prompt-kit/user-template.md").strip() or "prompt-kit/user-template.md",
            scan_status=str(payload.get("scan_status") or "not_scanned").strip() or "not_scanned",
            scan_report=dict(payload.get("scan_report") or {}),
            manifest_path=manifest_path,
        )


def _manifest_path_for_lobster(lobster_id: str) -> Path:
    return PACKAGES_ROOT / f"lobster-{lobster_id}" / "skill.manifest.yaml"


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8-sig")
    if yaml is not None:
        payload = yaml.safe_load(text) or {}
        return payload if isinstance(payload, dict) else {}
    return json.loads(text) if text.strip().startswith("{") else {}


def _write_yaml(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if yaml is not None:
        path.write_text(
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        return
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def list_manifest_paths() -> list[Path]:
    if not PACKAGES_ROOT.exists():
        return []
    return sorted(PACKAGES_ROOT.glob("lobster-*/skill.manifest.yaml"))


def load_all_skill_manifests() -> dict[str, SkillManifestRecord]:
    records: dict[str, SkillManifestRecord] = {}
    for path in list_manifest_paths():
        payload = _read_yaml(path)
        lobster_id = str(payload.get("lobster_id") or path.parent.name.replace("lobster-", "")).strip()
        if not lobster_id:
            continue
        try:
            record = SkillManifestRecord.from_dict(payload, manifest_path=str(path))
            if record.id and record.lobster_id:
                records[record.lobster_id] = record
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to parse skill manifest %s: %s", path, exc)
    return records


def load_skill_manifest(lobster_id: str) -> SkillManifestRecord | None:
    path = _manifest_path_for_lobster(str(lobster_id or "").strip())
    if not path.exists():
        return None
    payload = _read_yaml(path)
    if not payload:
        return None
    return SkillManifestRecord.from_dict(payload, manifest_path=str(path))


def update_skill_manifest(lobster_id: str, patch: dict[str, Any]) -> SkillManifestRecord | None:
    path = _manifest_path_for_lobster(str(lobster_id or "").strip())
    payload = _read_yaml(path) if path.exists() else {}
    payload.update(patch or {})
    _write_yaml(path, payload)
    return SkillManifestRecord.from_dict(payload, manifest_path=str(path))


def resolve_prompt_paths(record: SkillManifestRecord) -> tuple[Path, Path]:
    manifest_dir = Path(record.manifest_path).parent if record.manifest_path else _manifest_path_for_lobster(record.lobster_id).parent
    system_prompt_path = (manifest_dir / record.system_prompt_path).resolve()
    user_template_path = (manifest_dir / record.user_template_path).resolve()
    return system_prompt_path, user_template_path


def load_prompt_assets_for_manifest(record: SkillManifestRecord) -> tuple[str, str]:
    system_prompt_path, user_template_path = resolve_prompt_paths(record)
    system_prompt = system_prompt_path.read_text(encoding="utf-8-sig") if system_prompt_path.exists() else ""
    user_template = user_template_path.read_text(encoding="utf-8-sig") if user_template_path.exists() else ""
    return system_prompt, user_template
