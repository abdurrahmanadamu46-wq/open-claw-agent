"""
Knowledge three-layer compression pipeline for lobster runtime memory.

L0 raw markdown keeps the original exchange for audit/replay.
L1 report extracts structured work summaries.
L2 wisdom distills reusable cross-task knowledge.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

logger = logging.getLogger("memory_compressor")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha(text: str, length: int = 16) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:length]


@dataclass(slots=True)
class L0RawEntry:
    """Original conversation record."""

    entry_id: str
    lobster_id: str
    task_id: str
    content: str
    token_count: int
    tenant_id: str = "default"
    created_at: str = field(default_factory=_utc_now)
    content_hash: str = ""

    def __post_init__(self) -> None:
        if not self.content_hash:
            self.content_hash = _sha(f"{self.tenant_id}:{self.content}", 16)


@dataclass(slots=True)
class L1Report:
    """Structured work report with strong compression ratio."""

    report_id: str
    source_entry_id: str
    lobster_id: str
    task_summary: str
    decision: str
    outcome: str
    next_steps: list[str]
    key_entities: list[str]
    metrics: dict[str, Any]
    tenant_id: str = "default"
    created_at: str = field(default_factory=_utc_now)
    token_count: int = 0
    source_token_count: int = 0
    promoted_to_l2: bool = False


@dataclass(slots=True)
class L2Wisdom:
    """Abstract reusable knowledge distilled from multiple reports."""

    wisdom_id: str
    category: str
    statement: str
    confidence: float
    source_reports: list[str]
    lobster_ids: list[str]
    tenant_id: str = "default"
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)
    merge_count: int = 1


class MemoryCompressor:
    """
    Three-layer compression manager.

    The LLM callable should accept `(prompt: str, max_tokens: int) -> Awaitable[str]`.
    """

    def __init__(
        self,
        llm_call_fn: Callable[[str, int], Awaitable[str]] | None,
        storage_dir: str = "data/memory",
    ):
        self._llm = llm_call_fn
        self._storage = Path(storage_dir)
        self._storage.mkdir(parents=True, exist_ok=True)
        for layer in ("l0", "l1", "l2"):
            (self._storage / layer).mkdir(parents=True, exist_ok=True)

    async def compress_l0_to_l1(self, entry: L0RawEntry) -> L1Report:
        """Compress one raw conversation into a structured report."""
        self._save_l0(entry)
        report_id = f"l1-{_sha(f'{entry.tenant_id}:{entry.content_hash}', 12)}"
        existing = self._load_l1(report_id, entry.tenant_id)
        if existing is not None:
            return existing
        if self._llm is None:
            raise RuntimeError("llm_call_fn is required for L0->L1 compression")

        prompt = (
            "你是一个知识压缩专家。请从以下对话记录中提取结构化工作报告。\n\n"
            f"对话记录:\n{entry.content[:3000]}\n\n"
            "请严格输出 JSON:\n"
            "{\n"
            '  "task_summary": "一句话描述任务",\n'
            '  "decision": "做了什么关键决策",\n'
            '  "outcome": "结果如何（success|failed|in_progress）",\n'
            '  "next_steps": ["后续动作1", "后续动作2"],\n'
            '  "key_entities": ["客户/产品/渠道"],\n'
            '  "metrics": {"关键指标名": 数值}\n'
            "}"
        )
        response = await self._llm(prompt, 500)
        try:
            data = json.loads(response)
            if not isinstance(data, dict):
                raise ValueError("response is not an object")
        except Exception:
            data = {
                "task_summary": response[:120],
                "decision": "parse_failed",
                "outcome": "unknown",
                "next_steps": [],
                "key_entities": [],
                "metrics": {},
            }

        report = L1Report(
            report_id=report_id,
            source_entry_id=entry.entry_id,
            lobster_id=entry.lobster_id,
            task_summary=str(data.get("task_summary") or "")[:240],
            decision=str(data.get("decision") or "")[:400],
            outcome=str(data.get("outcome") or "")[:120],
            next_steps=[str(item)[:200] for item in data.get("next_steps", []) if str(item).strip()],
            key_entities=[str(item)[:120] for item in data.get("key_entities", []) if str(item).strip()],
            metrics=data.get("metrics", {}) if isinstance(data.get("metrics"), dict) else {},
            tenant_id=entry.tenant_id,
            token_count=max(1, len(str(response).split())),
            source_token_count=max(1, int(entry.token_count)),
        )
        self._save_l1(report)
        ratio = round(report.source_token_count / max(report.token_count, 1), 2)
        logger.info(
            "L0->L1 compressed tenant=%s lobster=%s ratio=%sx",
            entry.tenant_id,
            entry.lobster_id,
            ratio,
        )
        return report

    async def maybe_promote_pending_to_l2(
        self,
        *,
        tenant_id: str = "default",
        min_reports: int = 10,
        batch_size: int = 10,
        category: str = "general",
    ) -> list[L2Wisdom]:
        """Promote a pending L1 batch to L2 wisdom when enough reports exist."""
        pending = [report for report in self.get_reports(tenant_id=tenant_id) if not report.promoted_to_l2]
        if len(pending) < min_reports:
            return []
        batch = pending[:batch_size]
        wisdoms = await self.compress_l1_batch_to_l2(batch, category=category)
        if wisdoms:
            for report in batch:
                report.promoted_to_l2 = True
                self._save_l1(report)
        return wisdoms

    async def compress_l1_batch_to_l2(
        self,
        reports: list[L1Report],
        category: str = "general",
    ) -> list[L2Wisdom]:
        """Compress a batch of reports into abstract wisdom entries."""
        if len(reports) < 3:
            logger.info("L1->L2 skipped: only %s reports", len(reports))
            return []
        if self._llm is None:
            raise RuntimeError("llm_call_fn is required for L1->L2 compression")

        tenant_id = reports[0].tenant_id if reports else "default"
        reports_text = "\n".join(
            [
                f"- [{report.lobster_id}] {report.task_summary} -> {report.outcome} (decision: {report.decision})"
                for report in reports
            ]
        )
        prompt = (
            f"你是一个知识提炼专家。请从以下 {len(reports)} 条工作报告中提炼出可复用的抽象知识。\n\n"
            f"工作报告:\n{reports_text}\n\n"
            "请输出 JSON 数组，每项包含:\n"
            "[\n"
            '  {"statement": "一句话知识", "confidence": 0.8, "category": "customer_insight|channel_pattern|content_rule|cost_model|workflow_pattern"}\n'
            "]\n"
            "只输出真正可复用的知识，不要复述原报告。"
        )
        response = await self._llm(prompt, 800)
        try:
            data = json.loads(response)
            if not isinstance(data, list):
                raise ValueError("response is not a list")
        except Exception as exc:
            logger.warning("L1->L2 parse failed: %s", exc)
            return []

        wisdoms: list[L2Wisdom] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            statement = str(item.get("statement") or "").strip()
            if not statement:
                continue
            wisdom = L2Wisdom(
                wisdom_id=_sha(f"{tenant_id}:{statement}", 12),
                category=str(item.get("category") or category or "general").strip() or "general",
                statement=statement[:500],
                confidence=float(item.get("confidence", 0.5) or 0.5),
                source_reports=[report.report_id for report in reports],
                lobster_ids=sorted({report.lobster_id for report in reports}),
                tenant_id=tenant_id,
            )
            saved = self._save_l2(wisdom)
            wisdoms.append(saved)

        logger.info("L1->L2 compressed tenant=%s reports=%s wisdoms=%s", tenant_id, len(reports), len(wisdoms))
        return wisdoms

    def get_reports(
        self,
        *,
        tenant_id: str = "default",
        lobster_id: str | None = None,
        limit: int | None = None,
    ) -> list[L1Report]:
        reports: list[L1Report] = []
        for path in sorted(self._tenant_layer_dir("l1", tenant_id).glob("*.json")):
            report = L1Report(**json.loads(path.read_text(encoding="utf-8")))
            if lobster_id and report.lobster_id != lobster_id:
                continue
            reports.append(report)
        reports.sort(key=lambda item: item.created_at, reverse=True)
        if limit is not None:
            return reports[: max(1, int(limit))]
        return reports

    def get_wisdoms(
        self,
        *,
        tenant_id: str = "default",
        category: str | None = None,
        lobster_id: str | None = None,
        limit: int | None = None,
    ) -> list[L2Wisdom]:
        wisdoms: list[L2Wisdom] = []
        for path in sorted(self._tenant_layer_dir("l2", tenant_id).glob("*.json")):
            wisdom = L2Wisdom(**json.loads(path.read_text(encoding="utf-8")))
            if category and wisdom.category != category:
                continue
            if lobster_id and lobster_id not in wisdom.lobster_ids:
                continue
            wisdoms.append(wisdom)
        wisdoms.sort(key=lambda item: (item.confidence, item.updated_at), reverse=True)
        if limit is not None:
            return wisdoms[: max(1, int(limit))]
        return wisdoms

    def get_stats(self, *, tenant_id: str = "default") -> dict[str, Any]:
        l0_dir = self._tenant_layer_dir("l0", tenant_id)
        l1_dir = self._tenant_layer_dir("l1", tenant_id)
        l2_dir = self._tenant_layer_dir("l2", tenant_id)
        l0_files = list(l0_dir.glob("*.md"))
        l1_reports = self.get_reports(tenant_id=tenant_id)
        l2_wisdoms = self.get_wisdoms(tenant_id=tenant_id)
        l0_bytes = sum(path.stat().st_size for path in l0_files)
        l1_bytes = sum(path.stat().st_size for path in l1_dir.glob("*.json"))
        l2_bytes = sum(path.stat().st_size for path in l2_dir.glob("*.json"))
        l0_tokens = sum(report.source_token_count for report in l1_reports)
        l1_tokens = sum(report.token_count for report in l1_reports)
        avg_l0_to_l1_ratio = round(l0_tokens / max(l1_tokens, 1), 2) if l1_reports else 0.0
        avg_reports_per_wisdom = round(
            sum(len(wisdom.source_reports) for wisdom in l2_wisdoms) / max(len(l2_wisdoms), 1),
            2,
        ) if l2_wisdoms else 0.0
        categories: dict[str, int] = {}
        for wisdom in l2_wisdoms:
            categories[wisdom.category] = categories.get(wisdom.category, 0) + 1
        return {
            "tenant_id": tenant_id,
            "layers": {
                "l0": {"count": len(l0_files), "bytes": l0_bytes},
                "l1": {"count": len(l1_reports), "bytes": l1_bytes},
                "l2": {"count": len(l2_wisdoms), "bytes": l2_bytes},
            },
            "compression": {
                "avg_l0_to_l1_ratio": avg_l0_to_l1_ratio,
                "avg_reports_per_wisdom": avg_reports_per_wisdom,
            },
            "categories": categories,
        }

    def _tenant_layer_dir(self, layer: str, tenant_id: str) -> Path:
        path = self._storage / layer / tenant_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _save_l0(self, entry: L0RawEntry) -> Path:
        path = self._tenant_layer_dir("l0", entry.tenant_id) / f"{entry.content_hash}.md"
        if path.exists():
            return path
        header = (
            f"<!-- entry_id: {entry.entry_id}; lobster_id: {entry.lobster_id}; task_id: {entry.task_id}; "
            f"token_count: {entry.token_count}; created_at: {entry.created_at}; content_hash: {entry.content_hash} -->\n\n"
        )
        path.write_text(header + entry.content, encoding="utf-8")
        return path

    def _save_l1(self, report: L1Report) -> L1Report:
        path = self._tenant_layer_dir("l1", report.tenant_id) / f"{report.report_id}.json"
        path.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2), encoding="utf-8")
        return report

    def _load_l1(self, report_id: str, tenant_id: str) -> L1Report | None:
        path = self._tenant_layer_dir("l1", tenant_id) / f"{report_id}.json"
        if not path.exists():
            return None
        return L1Report(**json.loads(path.read_text(encoding="utf-8")))

    def _save_l2(self, wisdom: L2Wisdom) -> L2Wisdom:
        path = self._tenant_layer_dir("l2", wisdom.tenant_id) / f"{wisdom.wisdom_id}.json"
        if path.exists():
            existing = L2Wisdom(**json.loads(path.read_text(encoding="utf-8")))
            merged = L2Wisdom(
                wisdom_id=existing.wisdom_id,
                category=wisdom.category if existing.category == "general" and wisdom.category != "general" else existing.category,
                statement=existing.statement,
                confidence=round(max(existing.confidence, wisdom.confidence, min(1.0, len(set(existing.source_reports + wisdom.source_reports)) / 10)), 3),
                source_reports=sorted(set(existing.source_reports + wisdom.source_reports)),
                lobster_ids=sorted(set(existing.lobster_ids + wisdom.lobster_ids)),
                tenant_id=existing.tenant_id,
                created_at=existing.created_at,
                updated_at=_utc_now(),
                merge_count=existing.merge_count + 1,
            )
            path.write_text(json.dumps(asdict(merged), ensure_ascii=False, indent=2), encoding="utf-8")
            return merged
        path.write_text(json.dumps(asdict(wisdom), ensure_ascii=False, indent=2), encoding="utf-8")
        return wisdom
