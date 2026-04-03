"""
QueryExpander — Commander 前置意图扩展器

借鉴 Onyx secondary_llm_flows/query_expansion.py 的思路，
在进入主图执行前对用户查询做一次轻量扩写，生成更适合龙虾分工的任务摘要。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from llm_router import RouteMeta, llm_router

logger = logging.getLogger("query_expander")

VALID_LOBSTER_IDS = (
    "commander",
    "radar",
    "strategist",
    "inkwriter",
    "visualizer",
    "dispatcher",
    "echoer",
    "catcher",
    "abacus",
    "followup",
)

LOBSTER_DESC: dict[str, str] = {
    "commander": "编排任务、风险兜底、决策仲裁",
    "radar": "信号发现、热点监控、竞品情报",
    "strategist": "策略规划、实验设计、增长路径",
    "inkwriter": "文案、脚本、标题、内容总结",
    "visualizer": "图片、视频、分镜、视觉创意",
    "dispatcher": "任务排期、渠道分发、发布时间窗",
    "echoer": "评论回复、私信承接、访客对话",
    "catcher": "线索识别、意向评分、CRM 入库",
    "abacus": "数据分析、ROI、归因与报表",
    "followup": "跟进、催办、成交推进与回访",
}

EXPAND_PROMPT = """
你是龙虾池 Commander 的任务拆解助手。

用户原始请求：
{user_query}

当前可用龙虾：
{active_lobsters}

请把用户请求拆成 3 到 5 个更具体、更可执行的子查询，并为每个子查询指定最合适的龙虾。

输出要求：
1. 只输出 JSON，不要输出 Markdown。
2. JSON 结构必须是：
{{
  "intent_summary": "一句话总结用户真正想要的结果",
  "expanded": [
    {{"query": "...", "target_lobster": "radar", "priority": 1}},
    {{"query": "...", "target_lobster": "strategist", "priority": 2}}
  ]
}}
3. 同一只龙虾最多出现 2 次。
4. priority 只能是 1-5，1 最高。
5. 如果原始请求已经非常明确，也可以只返回 1-2 个子查询，但仍需保持 JSON 结构。
""".strip()


def _dedupe_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        normalized = str(item or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


def _extract_json_block(raw: str) -> dict[str, Any]:
    text = str(raw or "").strip()
    if not text:
        raise ValueError("empty llm output")
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    candidate = fenced.group(1).strip() if fenced else text
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start >= 0 and end > start:
        candidate = candidate[start:end + 1]
    return json.loads(candidate)


@dataclass(slots=True)
class ExpandedQuery:
    query: str
    target_lobster: str
    priority: int = 1
    original_query: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ExpansionResult:
    original: str
    intent_summary: str
    expanded: list[ExpandedQuery] = field(default_factory=list)
    skipped: bool = False
    method: str = "skipped"
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "original": self.original,
            "intent_summary": self.intent_summary,
            "expanded": [item.to_dict() for item in self.expanded],
            "skipped": self.skipped,
            "method": self.method,
            "reason": self.reason,
        }


class QueryExpander:
    """轻量查询扩展器。"""

    def __init__(self, *, min_query_length: int = 15) -> None:
        self.min_query_length = max(8, int(min_query_length))

    async def expand(
        self,
        user_query: str,
        active_lobsters: list[str] | None = None,
        tenant_id: str = "tenant_main",
        trace_id: str = "",
    ) -> ExpansionResult:
        query = str(user_query or "").strip()
        if not query:
            return ExpansionResult(
                original="",
                intent_summary="",
                skipped=True,
                method="skipped",
                reason="empty_query",
            )

        effective_lobsters = [
            item for item in _dedupe_keep_order(active_lobsters or list(VALID_LOBSTER_IDS))
            if item in VALID_LOBSTER_IDS
        ] or list(VALID_LOBSTER_IDS)

        if self._should_skip(query, effective_lobsters):
            return ExpansionResult(
                original=query,
                intent_summary=query,
                skipped=True,
                method="skipped",
                reason="query_already_specific_or_short",
            )

        lobster_desc = "\n".join(
            f"- {lobster_id}: {LOBSTER_DESC.get(lobster_id, lobster_id)}"
            for lobster_id in effective_lobsters
        )
        prompt = EXPAND_PROMPT.format(
            user_query=query,
            active_lobsters=lobster_desc,
        )

        try:
            raw = await llm_router.routed_ainvoke_text(
                system_prompt="你只输出合法 JSON，不输出额外解释。",
                user_prompt=prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=512,
                    tenant_tier="basic",
                    user_id="query-expander",
                    tenant_id=tenant_id,
                    task_type="query_expansion",
                    trace_id=trace_id,
                ),
                temperature=0.2,
                force_tier="flash",
            )
            parsed = _extract_json_block(raw)
            result = self._normalize_result(
                parsed=parsed,
                user_query=query,
                effective_lobsters=effective_lobsters,
            )
            if result.expanded:
                return result
        except Exception as exc:  # noqa: BLE001
            logger.warning("QueryExpander llm path failed: %s", exc)

        heuristic = self._heuristic_expand(query, effective_lobsters)
        if heuristic.expanded:
            return heuristic
        return ExpansionResult(
            original=query,
            intent_summary=query,
            skipped=True,
            method="fallback_skip",
            reason="no_reliable_expansion",
        )

    def format_for_task_description(self, result: ExpansionResult) -> str:
        if result.skipped or not result.expanded:
            return result.original
        lines = [
            result.original,
            "",
            "【Commander 意图扩展】",
            f"核心意图：{result.intent_summary}",
            "建议子查询：",
        ]
        for index, item in enumerate(sorted(result.expanded, key=lambda row: row.priority), start=1):
            lines.append(f"{index}. [{item.target_lobster}] {item.query}")
        return "\n".join(lines).strip()

    def _should_skip(self, query: str, active_lobsters: list[str]) -> bool:
        if len(query) < self.min_query_length:
            return True
        lower = query.lower()
        lobster_hits = sum(1 for lobster_id in active_lobsters if lobster_id in lower)
        if lobster_hits >= 2:
            return True
        direct_patterns = (
            "请让",
            "请用",
            "只要",
            "直接给我",
            "帮我写",
            "帮我做一份",
            "帮我生成",
            "请输出",
            "只需要",
        )
        return any(token in query for token in direct_patterns)

    def _normalize_result(
        self,
        *,
        parsed: dict[str, Any],
        user_query: str,
        effective_lobsters: list[str],
    ) -> ExpansionResult:
        raw_items = parsed.get("expanded", [])
        if not isinstance(raw_items, list):
            raw_items = []
        expanded: list[ExpandedQuery] = []
        lobster_counts: dict[str, int] = {}
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            query = str(item.get("query") or "").strip()
            target = str(item.get("target_lobster") or "").strip()
            try:
                priority = int(item.get("priority", 1) or 1)
            except (TypeError, ValueError):
                priority = 1
            if not query or target not in effective_lobsters:
                continue
            if lobster_counts.get(target, 0) >= 2:
                continue
            lobster_counts[target] = lobster_counts.get(target, 0) + 1
            expanded.append(
                ExpandedQuery(
                    query=query,
                    target_lobster=target,
                    priority=max(1, min(priority, 5)),
                    original_query=user_query,
                )
            )
        expanded.sort(key=lambda row: (row.priority, row.target_lobster, row.query))
        intent_summary = str(parsed.get("intent_summary") or user_query).strip() or user_query
        return ExpansionResult(
            original=user_query,
            intent_summary=intent_summary,
            expanded=expanded[:5],
            skipped=not expanded,
            method="llm_json" if expanded else "llm_empty",
            reason="" if expanded else "llm_returned_no_valid_children",
        )

    def _heuristic_expand(self, query: str, effective_lobsters: list[str]) -> ExpansionResult:
        lower = query.lower()
        items: list[ExpandedQuery] = []
        rules: list[tuple[tuple[str, ...], str, str]] = [
            (("竞品", "热点", "趋势", "舆情", "监控", "competitor", "trend", "signal"), "radar", "收集过去 7 天相关信号、热点与竞品动态"),
            (("策略", "方案", "规划", "实验", "strategy", "plan"), "strategist", "基于任务目标给出可执行的策略拆解与实验路径"),
            (("文案", "脚本", "标题", "总结", "copy", "script", "summary"), "inkwriter", "输出适合当前目标的文案、脚本或内容表达"),
            (("图片", "视频", "海报", "封面", "visual", "image", "video"), "visualizer", "设计对应的视觉表达、分镜或素材需求"),
            (("排期", "分发", "发布", "schedule", "dispatch", "publish"), "dispatcher", "给出渠道分发与发布时间窗建议"),
            (("评论", "私信", "回复", "客服", "reply", "dm", "chat"), "echoer", "设计对话承接、评论回复或官网访客回应"),
            (("线索", "留资", "客户", "lead", "crm", "转化"), "catcher", "判断线索意向、收集关键信息并准备入库"),
            (("数据", "roi", "归因", "指标", "report", "analytics"), "abacus", "补充数据衡量、ROI 与归因分析"),
            (("跟进", "催单", "回访", "follow", "remind"), "followup", "规划后续跟进动作与触达节奏"),
        ]
        used_targets: set[str] = set()
        priority = 1
        for keywords, lobster_id, suffix in rules:
            if lobster_id not in effective_lobsters:
                continue
            if lobster_id in used_targets:
                continue
            if any(keyword in lower or keyword in query for keyword in keywords):
                items.append(
                    ExpandedQuery(
                        query=f"{query}，并重点：{suffix}",
                        target_lobster=lobster_id,
                        priority=priority,
                        original_query=query,
                    )
                )
                used_targets.add(lobster_id)
                priority += 1
        if not items and "commander" in effective_lobsters:
            items.append(
                ExpandedQuery(
                    query=f"{query}，请先拆成执行步骤与需要协同的龙虾角色",
                    target_lobster="commander",
                    priority=1,
                    original_query=query,
                )
            )
        return ExpansionResult(
            original=query,
            intent_summary=query,
            expanded=items[:5],
            skipped=not items,
            method="heuristic" if items else "heuristic_empty",
            reason="" if items else "no_keyword_match",
        )
