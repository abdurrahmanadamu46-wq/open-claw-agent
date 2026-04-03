"""
Content citation processor for lobster outputs.

约定：
- 模型在内容中可以使用 [REF:xxx] 标识来源
- 处理器负责把 ref 解析为脚注与结构化 citations 列表
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("content_citation")


@dataclass(slots=True)
class Citation:
    ref_id: str
    source_type: str
    source_name: str
    created_at: str
    url: str | None = None
    excerpt: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContentCitationProcessor:
    REF_PATTERN = re.compile(r"\[REF:([a-zA-Z0-9_\-]+)\]")

    def process(
        self,
        content: str,
        *,
        tenant_id: str,
        lobster_id: str = "",
    ) -> tuple[str, list[dict[str, Any]]]:
        text = str(content or "")
        ref_ids = self.REF_PATTERN.findall(text)
        if not ref_ids:
            return text, []

        ordered_unique = list(dict.fromkeys(ref_ids))
        citations: list[Citation] = []
        index_map: dict[str, int] = {}

        for ref_id in ordered_unique:
            citation = self._resolve_citation(ref_id, tenant_id=tenant_id, lobster_id=lobster_id)
            if citation is None:
                continue
            index_map[ref_id] = len(citations) + 1
            citations.append(citation)

        def _replace(match: re.Match[str]) -> str:
            ref_id = match.group(1)
            index = index_map.get(ref_id)
            return f"[^{index}]" if index is not None else match.group(0)

        processed = self.REF_PATTERN.sub(_replace, text)
        if citations:
            processed = self._append_footnotes(processed, citations)
        return processed, [item.to_dict() for item in citations]

    def _append_footnotes(self, content: str, citations: list[Citation]) -> str:
        footnotes = []
        for index, citation in enumerate(citations, start=1):
            created = self._format_time(citation.created_at)
            parts = [citation.source_name]
            if created:
                parts.append(created)
            if citation.url:
                parts.append(citation.url)
            if citation.excerpt:
                parts.append(citation.excerpt[:160])
            footnotes.append(f"[^{index}]: " + " | ".join(part for part in parts if part))
        return f"{content.rstrip()}\n\n---\n" + "\n".join(footnotes)

    def _resolve_citation(self, ref_id: str, *, tenant_id: str, lobster_id: str) -> Citation | None:
        signal = self._lookup_signal(ref_id, tenant_id)
        if signal is not None:
            return signal
        memory = self._lookup_memory(ref_id, tenant_id, lobster_id)
        if memory is not None:
            return memory
        return None

    def _lookup_signal(self, ref_id: str, tenant_id: str) -> Citation | None:
        try:
            from research_radar_store import _db_path  # type: ignore[attr-defined]

            db_path = _db_path()
        except Exception:
            return None
        if not os.path.exists(db_path):
            return None
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                """
                SELECT signal_id, title, url, summary, published_at, created_at
                FROM research_signals
                WHERE tenant_id=? AND signal_id=?
                LIMIT 1
                """,
                (tenant_id, ref_id),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return Citation(
            ref_id=str(row["signal_id"]),
            source_type="signal",
            source_name=str(row["title"] or row["signal_id"]),
            created_at=str(row["published_at"] or row["created_at"] or ""),
            url=str(row["url"] or "") or None,
            excerpt=str(row["summary"] or "")[:240],
        )

    def _lookup_memory(self, ref_id: str, tenant_id: str, lobster_id: str) -> Citation | None:
        base_dir = Path(os.getenv("LOBSTER_MEMORY_DIR", "memory")) / tenant_id
        if not base_dir.exists():
            return None
        candidate_dirs: list[Path]
        if lobster_id:
            candidate_dirs = [base_dir / lobster_id]
        else:
            candidate_dirs = [path for path in base_dir.iterdir() if path.is_dir()]
        for lobster_root in candidate_dirs:
            if not lobster_root.exists():
                continue
            direct = list(lobster_root.glob(f"*/{ref_id}.md"))
            if direct:
                path = direct[0]
                content = path.read_text(encoding="utf-8")
                return Citation(
                    ref_id=ref_id,
                    source_type="memory",
                    source_name=f"{lobster_root.name}:{path.parent.name}/{path.stem}",
                    created_at=self._mtime_to_iso(path),
                    url=None,
                    excerpt=self._strip_markdown_excerpt(content),
                )
            for file_path in lobster_root.glob("*/*.md"):
                try:
                    content = file_path.read_text(encoding="utf-8")
                except Exception:
                    continue
                metadata = self._parse_metadata(content)
                if str(metadata.get("ref_id") or "").strip() == ref_id:
                    return Citation(
                        ref_id=ref_id,
                        source_type="memory",
                        source_name=f"{lobster_root.name}:{file_path.parent.name}/{file_path.stem}",
                        created_at=self._mtime_to_iso(file_path),
                        url=None,
                        excerpt=self._strip_markdown_excerpt(content),
                    )
        return None

    @staticmethod
    def _parse_metadata(content: str) -> dict[str, Any]:
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("_metadata: "):
                raw = stripped[len("_metadata: "):].strip().strip("_")
                try:
                    payload = json.loads(raw)
                    if isinstance(payload, dict):
                        return payload
                except json.JSONDecodeError:
                    return {}
        return {}

    @staticmethod
    def _strip_markdown_excerpt(content: str) -> str:
        lines = []
        for line in content.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("_") or stripped.startswith("#"):
                continue
            lines.append(stripped)
            if sum(len(item) for item in lines) > 200:
                break
        return " ".join(lines)[:220]

    @staticmethod
    def _mtime_to_iso(path: Path) -> str:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()

    @staticmethod
    def _format_time(value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            return datetime.fromisoformat(text).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            return text


_citation_processor: ContentCitationProcessor | None = None


def get_content_citation_processor() -> ContentCitationProcessor:
    global _citation_processor
    if _citation_processor is None:
        _citation_processor = ContentCitationProcessor()
    return _citation_processor
