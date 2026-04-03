"""
Lightweight lobster memory layer inspired by memU.

Each lobster gets a small structured file-backed memory space under:
memory/{tenant_id}/{lobster_id}/
  - knowledge/
  - skills/
  - preferences/
  - context/
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class MemoryRecord:
    category: str
    key: str
    value: str
    path: str
    score: int
    metadata: dict[str, Any]


class LobsterMemory:
    """Small file-backed memory space for one lobster in one tenant."""

    CATEGORIES = ("knowledge", "skills", "preferences", "context")

    def __init__(self, lobster_id: str, tenant_id: str, base_path: str | None = None):
        self.lobster_id = lobster_id
        self.tenant_id = tenant_id
        resolved_base = base_path or os.getenv("LOBSTER_MEMORY_DIR", "memory")
        self.root = Path(resolved_base) / tenant_id / lobster_id
        self._ensure_structure()

    def _ensure_structure(self) -> None:
        for category in self.CATEGORIES:
            (self.root / category).mkdir(parents=True, exist_ok=True)

    async def remember(
        self,
        category: str,
        key: str,
        value: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Persist a single memory record as markdown."""
        safe_category = str(category or "context").strip()
        if safe_category not in self.CATEGORIES:
            raise ValueError(f"unsupported memory category: {safe_category}")
        safe_key = self._slugify(key or "memory")
        path = self.root / safe_category / f"{safe_key}.md"
        content_hash = hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]

        content = f"# {safe_key}\n\n{value.strip()}\n\n---\n"
        content += f"_recorded: {_utc_now()}_  \n"
        content += f"_hash: {content_hash}_  \n"
        if metadata:
            content += f"_metadata: {json.dumps(metadata, ensure_ascii=False)}_  \n"

        path.write_text(content, encoding="utf-8")
        return content_hash

    async def recall(
        self,
        query: str,
        category: str | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Retrieve relevant records via simple keyword scoring."""
        normalized_query = str(query or "").strip().lower()
        if not normalized_query:
            return []

        results: list[MemoryRecord] = []
        search_dirs = [self.root / category] if category else [self.root / item for item in self.CATEGORIES]
        for search_dir in search_dirs:
            if not search_dir.exists():
                continue
            for md_file in search_dir.glob("*.md"):
                content = md_file.read_text(encoding="utf-8")
                lowered = content.lower()
                if normalized_query not in lowered:
                    continue
                score = lowered.count(normalized_query)
                metadata = self._parse_metadata(content)
                results.append(
                    MemoryRecord(
                        category=search_dir.name,
                        key=md_file.stem,
                        value=content,
                        path=str(md_file),
                        score=score,
                        metadata=metadata,
                    )
                )

        results.sort(key=lambda item: (item.score, item.key), reverse=True)
        return [
            {
                "category": item.category,
                "key": item.key,
                "content": item.value,
                "path": item.path,
                "score": item.score,
                "metadata": item.metadata,
            }
            for item in results[: max(1, top_k)]
        ]

    async def list_by_category(self, category: str) -> list[dict[str, Any]]:
        """List all memory items for one category, newest files first."""
        safe_category = str(category or "").strip()
        if safe_category not in self.CATEGORIES:
            return []
        category_dir = self.root / safe_category
        if not category_dir.exists():
            return []
        items: list[dict[str, Any]] = []
        for md_file in sorted(category_dir.glob("*.md"), key=lambda path: path.stat().st_mtime, reverse=True):
            content = md_file.read_text(encoding="utf-8")
            items.append(
                {
                    "category": safe_category,
                    "key": md_file.stem,
                    "content": content,
                    "path": str(md_file),
                    "metadata": self._parse_metadata(content),
                    "updated_at": datetime.fromtimestamp(md_file.stat().st_mtime, timezone.utc).isoformat(),
                }
            )
        return items

    async def forget(self, category: str, key: str) -> bool:
        """Delete one memory item by category/key."""
        safe_category = str(category or "").strip()
        if safe_category not in self.CATEGORIES:
            return False
        safe_key = self._slugify(key or "")
        path = self.root / safe_category / f"{safe_key}.md"
        if not path.exists():
            return False
        path.unlink()
        return True

    async def extract_from_session(
        self,
        session_log: str,
        llm_call_fn: Callable[[str, int], Awaitable[str]] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Extract reusable knowledge from a session transcript.

        When no LLM callback is provided, returns an empty list so the caller can
        keep the rest of the execution path lightweight.
        """
        if llm_call_fn is None or not str(session_log or "").strip():
            return []

        prompt = (
            "从以下会话日志中提取最多 5 条可复用经验，按 preferences/knowledge/skills 三类输出。\n"
            "输出 JSON 数组，每项包含 category, key, value。\n\n"
            f"会话日志:\n{session_log[:5000]}"
        )
        try:
            response = await llm_call_fn(prompt, 600)
            payload = json.loads(response)
            if not isinstance(payload, list):
                return []
            extracted: list[dict[str, Any]] = []
            for item in payload:
                if not isinstance(item, dict):
                    continue
                category = str(item.get("category") or "").strip()
                key = str(item.get("key") or "").strip()
                value = str(item.get("value") or "").strip()
                if category not in self.CATEGORIES or not key or not value:
                    continue
                extracted.append({"category": category, "key": key, "value": value})
            return extracted[:5]
        except Exception:
            return []

    def get_stats(self) -> dict[str, int]:
        """Return per-category file counts."""
        return {
            category: len(list((self.root / category).glob("*.md"))) if (self.root / category).exists() else 0
            for category in self.CATEGORIES
        }

    @staticmethod
    def _slugify(text: str) -> str:
        normalized = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in str(text))
        return normalized.strip("_") or "memory"

    @staticmethod
    def _parse_metadata(content: str) -> dict[str, Any]:
        marker = "_metadata: "
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith(marker):
                raw = stripped[len(marker):].strip().strip("_")
                try:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        return data
                except json.JSONDecodeError:
                    return {}
        return {}
