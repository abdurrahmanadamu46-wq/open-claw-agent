"""
PromptAssetLoader — 从 TS design-time 目录加载标准化 Prompt 资产。

Source of truth:
- packages/lobsters/lobster-*/prompts/prompt-catalog.json
- packages/lobsters/lobster-*/prompts/**/*.prompt.md
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _default_lobsters_root() -> Path:
    return Path(__file__).resolve().parent.parent / "packages" / "lobsters"


@dataclass(slots=True)
class PromptTemplate:
    id: str
    lobster_id: str
    category: str
    file_path: Path
    relative_path: str
    skill_id: str
    effectiveness_rating: int
    industries: list[str] = field(default_factory=list)
    variants: list[str] = field(default_factory=list)
    raw_content: str = ""

    def extract_template_block(self) -> str:
        """
        Extract the fenced code block under `## 2. 规范化模板`.
        """
        match = re.search(
            r"^##\s*2\.\s*规范化模板\s*$.*?```(?:\w+)?\n(.*?)\n```",
            self.raw_content,
            flags=re.MULTILINE | re.DOTALL,
        )
        if not match:
            return ""
        return match.group(1).strip()

    def fill(self, **kwargs: Any) -> str:
        """
        Fill `{variable_name}` placeholders with provided values.
        Unprovided variables remain untouched for downstream debugging.
        """
        template = self.extract_template_block()
        for key, value in kwargs.items():
            rendered = ", ".join(str(item) for item in value) if isinstance(value, list) else str(value)
            template = template.replace(f"{{{key}}}", rendered)
        return template

    def to_api_ref(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "file": self.relative_path.replace("\\", "/"),
            "effectiveness_rating": self.effectiveness_rating,
            "industries": list(self.industries),
            "variants": list(self.variants),
        }


class PromptAssetLoader:
    """Load and cache prompt assets for lobster skills."""

    def __init__(self, lobsters_root: str | Path | None = None) -> None:
        self._root = Path(lobsters_root) if lobsters_root else _default_lobsters_root()
        self._cache: dict[str, PromptTemplate] = {}
        self._loaded_lobsters: set[str] = set()

    def load_all_prompts(self) -> list[PromptTemplate]:
        templates: list[PromptTemplate] = []
        for catalog_path in sorted(self._root.glob("lobster-*/prompts/prompt-catalog.json")):
            lobster_dir = catalog_path.parent.parent.name
            lobster_id = lobster_dir.replace("lobster-", "", 1)
            templates.extend(self.load_lobster_prompts(lobster_id))
        return templates

    def load_lobster_prompts(self, lobster_id: str) -> list[PromptTemplate]:
        if lobster_id in self._loaded_lobsters:
            return [tpl for tpl in self._cache.values() if tpl.lobster_id == lobster_id]

        catalog_path = self._root / f"lobster-{lobster_id}" / "prompts" / "prompt-catalog.json"
        if not catalog_path.exists():
            self._loaded_lobsters.add(lobster_id)
            return []

        catalog = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
        prompts_dir = catalog_path.parent
        templates: list[PromptTemplate] = []

        for category in catalog.get("categories", []):
            category_name = str(category.get("category") or "")
            for item in category.get("prompts", []):
                relative_path = str(item.get("file") or "")
                file_path = prompts_dir / relative_path
                raw_content = file_path.read_text(encoding="utf-8-sig") if file_path.exists() else ""
                template = PromptTemplate(
                    id=str(item.get("id") or ""),
                    lobster_id=lobster_id,
                    category=category_name,
                    file_path=file_path,
                    relative_path=relative_path,
                    skill_id=str(item.get("skill_id") or ""),
                    effectiveness_rating=int(item.get("effectiveness_rating", 3) or 3),
                    industries=[str(v) for v in item.get("industries", []) if str(v).strip()],
                    variants=[str(v) for v in item.get("variants", []) if str(v).strip()],
                    raw_content=raw_content,
                )
                if template.id:
                    self._cache[template.id] = template
                    templates.append(template)

        self._loaded_lobsters.add(lobster_id)
        return templates

    def get_prompt(self, prompt_id: str) -> PromptTemplate | None:
        if prompt_id in self._cache:
            return self._cache[prompt_id]
        self.load_all_prompts()
        return self._cache.get(prompt_id)

    def get_by_skill(self, skill_id: str) -> list[PromptTemplate]:
        self.load_all_prompts()
        return [tpl for tpl in self._cache.values() if tpl.skill_id == skill_id]

    def get_by_industry(self, industry: str) -> list[PromptTemplate]:
        self.load_all_prompts()
        return [tpl for tpl in self._cache.values() if industry in tpl.industries]

    def get_best_for(self, skill_id: str, industry: str | None = None) -> PromptTemplate | None:
        candidates = self.get_by_skill(skill_id)
        if industry:
            industry_candidates = [tpl for tpl in candidates if industry in tpl.industries]
            if industry_candidates:
                candidates = industry_candidates
        if not candidates:
            return None
        return max(candidates, key=lambda tpl: (tpl.effectiveness_rating, tpl.id))

    def get_prompt_refs_for_skill(self, skill_id: str) -> list[dict[str, Any]]:
        return [tpl.to_api_ref() for tpl in self.get_by_skill(skill_id)]


_loader: PromptAssetLoader | None = None


def get_prompt_loader() -> PromptAssetLoader:
    global _loader
    if _loader is None:
        _loader = PromptAssetLoader()
    return _loader
