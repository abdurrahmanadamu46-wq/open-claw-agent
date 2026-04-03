"""
Artifact classifier for lobster outputs.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class ArtifactBlock:
    artifact_type: str
    content: str
    language: str = ""
    title: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["type"] = payload.pop("artifact_type")
        return payload


class ArtifactClassifier:
    MERMAID_PATTERN = re.compile(r"```mermaid\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
    CODE_PATTERN = re.compile(r"```([a-zA-Z0-9_+-]+)?\s*\n(.*?)```", re.DOTALL)
    HTML_PATTERN = re.compile(r"```html\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
    SVG_PATTERN = re.compile(r"(<svg[\s\S]*?</svg>)", re.IGNORECASE)
    CSV_PATTERN = re.compile(r"```csv\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
    IMAGE_URL_PATTERN = re.compile(
        r"!\[[^\]]*\]\((https?://[^\s)]+)\)|\b(https?://[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg))",
        re.IGNORECASE,
    )

    def classify(self, content: str, lobster_id: str = "") -> list[ArtifactBlock]:
        text = str(content or "").strip()
        if not text:
            return [ArtifactBlock(artifact_type="text", content="")]
        blocks: list[ArtifactBlock] = []
        consumed_spans: list[tuple[int, int]] = []

        def _mark(match: re.Match[str], block: ArtifactBlock) -> None:
            consumed_spans.append((match.start(), match.end()))
            blocks.append(block)

        for match in self.MERMAID_PATTERN.finditer(text):
            _mark(match, ArtifactBlock("mermaid", match.group(1).strip(), title="Mermaid Diagram"))
        for match in self.HTML_PATTERN.finditer(text):
            _mark(match, ArtifactBlock("html", match.group(1).strip(), title="HTML Preview"))
        for match in self.CSV_PATTERN.finditer(text):
            csv_text = match.group(1).strip()
            _mark(match, ArtifactBlock("table_csv", csv_text, title="CSV Table", metadata=self._parse_csv(csv_text)))
        for match in self.SVG_PATTERN.finditer(text):
            _mark(match, ArtifactBlock("svg", match.group(1).strip(), title="SVG Preview"))
        for match in self.IMAGE_URL_PATTERN.finditer(text):
            url = match.group(1) or match.group(2) or ""
            if url:
                _mark(match, ArtifactBlock("image_url", url, title="Image Preview"))

        stripped = self._strip_consumed(text, consumed_spans)
        stripped = self.HTML_PATTERN.sub("", stripped)
        stripped = self.CSV_PATTERN.sub("", stripped)
        stripped = self.MERMAID_PATTERN.sub("", stripped)
        for match in self.CODE_PATTERN.finditer(stripped):
            language = str(match.group(1) or "text").strip().lower()
            if language in {"mermaid", "html", "csv"}:
                continue
            blocks.append(ArtifactBlock("code", match.group(2).strip(), language=language, title=f"{language} code"))
        stripped = self.CODE_PATTERN.sub("", stripped).strip()
        if stripped:
            blocks.insert(0, self._classify_rich_text(stripped, lobster_id))
        if not blocks:
            blocks.append(ArtifactBlock("markdown_rich", text))
        return blocks

    def enrich_task_output(self, task_output: dict[str, Any]) -> dict[str, Any]:
        content = str(task_output.get("content") or task_output.get("output") or "")
        lobster_id = str(task_output.get("lobster_id") or task_output.get("lobster") or "")
        return {**task_output, "artifacts": [block.to_dict() for block in self.classify(content, lobster_id)]}

    def enrich_artifact_payload(self, artifact_payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(artifact_payload, dict):
            return {"artifacts": []}
        content = str(
            artifact_payload.get("content")
            or artifact_payload.get("expected_output")
            or json.dumps(artifact_payload.get("payload", {}), ensure_ascii=False, indent=2)
        )
        lobster_id = str(artifact_payload.get("lobster") or artifact_payload.get("role_id") or "")
        return {**artifact_payload, "artifacts": [block.to_dict() for block in self.classify(content, lobster_id)]}

    def _classify_rich_text(self, text: str, lobster_id: str) -> ArtifactBlock:
        stripped = text.strip()
        if self._looks_like_json(stripped):
            return ArtifactBlock("json_data", stripped, title="JSON")
        title = "Rich Markdown"
        if lobster_id == "strategist":
            title = "Strategy Notes"
        elif lobster_id == "inkwriter":
            title = "Copy Draft"
        elif lobster_id == "abacus":
            title = "Analysis Summary"
        return ArtifactBlock("markdown_rich", stripped, title=title)

    @staticmethod
    def _parse_csv(content: str) -> dict[str, Any]:
        try:
            reader = csv.reader(io.StringIO(content))
            rows = [row for row in reader]
        except Exception:
            return {"headers": [], "rows": []}
        if not rows:
            return {"headers": [], "rows": []}
        return {
            "headers": [str(cell) for cell in rows[0]],
            "rows": [[str(cell) for cell in row] for row in rows[1:]],
        }

    @staticmethod
    def _looks_like_json(text: str) -> bool:
        if not text or text[0] not in {"{", "["}:
            return False
        try:
            json.loads(text)
            return True
        except Exception:
            return False

    @staticmethod
    def _strip_consumed(text: str, spans: list[tuple[int, int]]) -> str:
        if not spans:
            return text
        ordered = sorted(spans, key=lambda item: item[0])
        chunks: list[str] = []
        cursor = 0
        for start, end in ordered:
            if start > cursor:
                chunks.append(text[cursor:start])
            cursor = max(cursor, end)
        if cursor < len(text):
            chunks.append(text[cursor:])
        return "".join(chunks)


_artifact_classifier: ArtifactClassifier | None = None


def get_artifact_classifier() -> ArtifactClassifier:
    global _artifact_classifier
    if _artifact_classifier is None:
        _artifact_classifier = ArtifactClassifier()
    return _artifact_classifier
