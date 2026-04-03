"""
Three-layer compression API for lobster-memory service.

This module intentionally mirrors the runtime semantics in
dragon-senate-saas-v2/memory_compressor.py:

- L0 raw entries are stored as markdown under layer/tenant directories.
- L1 reports preserve tenant/source token metadata and promotion flags.
- L2 wisdom entries merge by stable wisdom id.

Unlike the runtime version, the service keeps a built-in rule fallback so the
compression routes remain available even when an upstream LLM is unavailable.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

logger = logging.getLogger("lobster_memory.compression")
router = APIRouter(prefix="/compress", tags=["compression"])


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha(text: str, length: int = 16) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:length]


@dataclass(slots=True)
class L0RawEntry:
    entry_id: str
    lobster_id: str
    task_id: str
    content: str
    token_count: int
    tenant_id: str = "tenant_main"
    created_at: str = field(default_factory=_utc_now)
    content_hash: str = ""

    def __post_init__(self) -> None:
        if not self.content_hash:
            self.content_hash = _sha(f"{self.tenant_id}:{self.content}", 16)


@dataclass(slots=True)
class L1Report:
    report_id: str
    source_entry_id: str
    lobster_id: str
    task_summary: str
    decision: str
    outcome: str
    next_steps: list[str]
    key_entities: list[str]
    metrics: dict[str, Any]
    tenant_id: str = "tenant_main"
    created_at: str = field(default_factory=_utc_now)
    token_count: int = 0
    source_token_count: int = 0
    promoted_to_l2: bool = False


@dataclass(slots=True)
class L2Wisdom:
    wisdom_id: str
    category: str
    statement: str
    confidence: float
    source_reports: list[str]
    lobster_ids: list[str]
    tenant_id: str = "tenant_main"
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)
    merge_count: int = 1


class CompressL0ToL1Request(BaseModel):
    entry_id: str | None = None
    lobster_id: str = Field(..., min_length=1, max_length=120)
    task_id: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1, max_length=200_000)
    token_count: int = Field(default=0, ge=0, le=2_000_000)
    tenant_id: str = Field(default="tenant_main", min_length=1, max_length=120)


class CompressL1ToL2Request(BaseModel):
    tenant_id: str = Field(default="tenant_main", min_length=1, max_length=120)
    report_ids: list[str] = Field(default_factory=list)
    min_reports: int = Field(default=10, ge=2, le=500)
    batch_size: int = Field(default=10, ge=2, le=500)
    category: str = Field(default="general", min_length=1, max_length=64)


def _parse_json_object(text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _parse_json_array(text: str) -> list[dict[str, Any]] | None:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    except json.JSONDecodeError:
        pass
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


def _rule_fallback_l0_to_l1(entry: L0RawEntry) -> L1Report:
    lines = [line.strip() for line in entry.content.splitlines() if line.strip()]
    summary = next((line for line in lines if len(line) > 12), entry.content[:120])
    outcome = "success" if "success" in entry.content.lower() or "完成" in entry.content else "unknown"
    entities = []
    for token in ("客户", "tenant", "抖音", "小红书", "微信", "视频", "线索"):
        if token.lower() in entry.content.lower():
            entities.append(token)
    return L1Report(
        report_id=f"l1-{_sha(f'{entry.tenant_id}:{entry.content_hash}', 12)}",
        source_entry_id=entry.entry_id,
        lobster_id=entry.lobster_id,
        task_summary=summary[:240],
        decision="rule_fallback",
        outcome=outcome,
        next_steps=[],
        key_entities=entities,
        metrics={},
        tenant_id=entry.tenant_id,
        token_count=max(1, len(summary.split())),
        source_token_count=max(1, int(entry.token_count)),
    )


def _rule_fallback_l1_to_l2(reports: list[L1Report], category: str) -> list[dict[str, Any]]:
    by_lobster: dict[str, list[L1Report]] = {}
    for report in reports:
        by_lobster.setdefault(report.lobster_id, []).append(report)

    items: list[dict[str, Any]] = []
    for lobster_id, lobster_reports in by_lobster.items():
        success_count = sum(1 for report in lobster_reports if "success" in report.outcome.lower() or "完成" in report.outcome)
        statement = (
            f"{lobster_id} accumulated {len(lobster_reports)} reports; "
            f"success_like={success_count}; latest='{lobster_reports[0].task_summary[:120]}'"
        )
        items.append(
            {
                "statement": statement,
                "confidence": round(min(0.95, 0.45 + len(lobster_reports) * 0.05), 3),
                "category": category or "workflow_pattern",
            }
        )
    return items


async def _default_llm_call(prompt: str, max_tokens: int) -> str:
    base_url = str(os.getenv("DRAGON_SENATE_URL") or "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("DRAGON_SENATE_URL not configured")

    token = str(os.getenv("DRAGON_SENATE_BEARER_TOKEN") or "").strip()
    timeout_sec = float(os.getenv("DRAGON_SENATE_TIMEOUT_SEC", "25"))

    import httpx

    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload = {
        "prompt": prompt[:4000],
        "session_mode": "isolated",
        "execution_mode": "foreground",
        "fresh_context": True,
    }
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        response = await client.post(
            f"{base_url}/api/v1/lobsters/commander/execute",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
    output = str(data.get("result") or "").strip()
    if not output:
        raise RuntimeError("commander returned empty result")
    return output


class MemoryCompressor:
    """Service-side mirror of the runtime three-layer compressor."""

    def __init__(
        self,
        llm_call_fn: Callable[[str, int], Awaitable[str]] | None = None,
        storage_dir: str | None = None,
    ) -> None:
        self._llm = llm_call_fn
        self._storage = Path(storage_dir or os.getenv("MEMORY_STORAGE_DIR", "data/memory"))
        self._storage.mkdir(parents=True, exist_ok=True)
        for layer in ("l0", "l1", "l2"):
            (self._storage / layer).mkdir(parents=True, exist_ok=True)

    async def compress_l0_to_l1(self, entry: L0RawEntry) -> L1Report:
        self._save_l0(entry)
        report_id = f"l1-{_sha(f'{entry.tenant_id}:{entry.content_hash}', 12)}"
        existing = self._load_l1(report_id, entry.tenant_id)
        if existing is not None:
            return existing

        report: L1Report
        if self._llm is None:
            report = _rule_fallback_l0_to_l1(entry)
        else:
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
            try:
                response = await self._llm(prompt, 500)
                data = _parse_json_object(response) or {}
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
            except Exception as exc:  # noqa: BLE001
                logger.warning("L0->L1 upstream LLM failed, using rule fallback: %s", exc)
                report = _rule_fallback_l0_to_l1(entry)

        self._save_l1(report)
        return report

    async def maybe_promote_pending_to_l2(
        self,
        *,
        tenant_id: str = "tenant_main",
        min_reports: int = 10,
        batch_size: int = 10,
        category: str = "general",
    ) -> list[L2Wisdom]:
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
        if len(reports) < 3:
            return []

        tenant_id = reports[0].tenant_id if reports else "tenant_main"
        items: list[dict[str, Any]]
        if self._llm is None:
            items = _rule_fallback_l1_to_l2(reports, category)
        else:
            reports_text = "\n".join(
                f"- [{report.lobster_id}] {report.task_summary} -> {report.outcome} (decision: {report.decision})"
                for report in reports
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
            try:
                response = await self._llm(prompt, 800)
                items = _parse_json_array(response) or _rule_fallback_l1_to_l2(reports, category)
            except Exception as exc:  # noqa: BLE001
                logger.warning("L1->L2 upstream LLM failed, using rule fallback: %s", exc)
                items = _rule_fallback_l1_to_l2(reports, category)

        wisdoms: list[L2Wisdom] = []
        for item in items:
            statement = str(item.get("statement") or "").strip()
            if not statement:
                continue
            confidence_raw = item.get("confidence", 0.5)
            try:
                confidence = float(confidence_raw)
            except (TypeError, ValueError):
                confidence = 0.5
            wisdom = L2Wisdom(
                wisdom_id=_sha(f"{tenant_id}:{statement}", 12),
                category=str(item.get("category") or category or "general").strip() or "general",
                statement=statement[:500],
                confidence=max(0.0, min(1.0, confidence)),
                source_reports=[report.report_id for report in reports],
                lobster_ids=sorted({report.lobster_id for report in reports}),
                tenant_id=tenant_id,
            )
            wisdoms.append(self._save_l2(wisdom))
        return wisdoms

    def get_reports(
        self,
        *,
        tenant_id: str = "tenant_main",
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
        return reports[: max(1, int(limit))] if limit is not None else reports

    def get_wisdoms(
        self,
        *,
        tenant_id: str = "tenant_main",
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
        return wisdoms[: max(1, int(limit))] if limit is not None else wisdoms

    def get_stats(self, *, tenant_id: str = "tenant_main") -> dict[str, Any]:
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
        avg_reports_per_wisdom = (
            round(sum(len(item.source_reports) for item in l2_wisdoms) / max(len(l2_wisdoms), 1), 2)
            if l2_wisdoms
            else 0.0
        )
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
                confidence=round(
                    max(
                        existing.confidence,
                        wisdom.confidence,
                        min(1.0, len(set(existing.source_reports + wisdom.source_reports)) / 10),
                    ),
                    3,
                ),
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


_compressor: MemoryCompressor | None = None


def get_memory_compressor() -> MemoryCompressor:
    global _compressor
    if _compressor is None:
        llm_fn: Callable[[str, int], Awaitable[str]] | None = None
        if str(os.getenv("DRAGON_SENATE_URL") or "").strip():
            llm_fn = _default_llm_call
        _compressor = MemoryCompressor(llm_call_fn=llm_fn)
    return _compressor


@router.post("/l0-to-l1")
async def compress_l0_to_l1(payload: CompressL0ToL1Request) -> dict[str, Any]:
    compressor = get_memory_compressor()
    entry = L0RawEntry(
        entry_id=payload.entry_id or payload.task_id,
        lobster_id=payload.lobster_id,
        task_id=payload.task_id,
        content=payload.content,
        token_count=payload.token_count,
        tenant_id=payload.tenant_id,
    )
    report = await compressor.compress_l0_to_l1(entry)
    return {"ok": True, "report": asdict(report)}


@router.post("/l1-to-l2")
async def compress_l1_to_l2(payload: CompressL1ToL2Request) -> dict[str, Any]:
    compressor = get_memory_compressor()
    if payload.report_ids:
        reports = [report for report in compressor.get_reports(tenant_id=payload.tenant_id) if report.report_id in payload.report_ids]
        wisdoms = await compressor.compress_l1_batch_to_l2(reports, category=payload.category)
    else:
        wisdoms = await compressor.maybe_promote_pending_to_l2(
            tenant_id=payload.tenant_id,
            min_reports=payload.min_reports,
            batch_size=payload.batch_size,
            category=payload.category,
        )
    return {"ok": True, "wisdoms": [asdict(item) for item in wisdoms], "count": len(wisdoms)}


@router.get("/stats")
async def compression_stats(tenant_id: str = Query(default="tenant_main")) -> dict[str, Any]:
    compressor = get_memory_compressor()
    return {"ok": True, **compressor.get_stats(tenant_id=tenant_id)}
