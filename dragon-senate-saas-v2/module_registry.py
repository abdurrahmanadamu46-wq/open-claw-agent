"""
Fleet/Manus-style module registry for lobster capabilities.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class ModuleSpec:
    module_id: str
    name: str
    description: str
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    available_to: list[str] = field(default_factory=list)
    avg_tokens: int = 0
    avg_latency_ms: int = 0
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


MODULE_SPECS: list[ModuleSpec] = [
    ModuleSpec("lead_reader", "线索读取器", "读取线索画像、标签和历史互动。", ["lead_id"], ["lead_profile", "history", "tags"], ["dispatcher", "radar", "catcher", "followup"], 800, 500, ["crm"]),
    ModuleSpec("memory_searcher", "记忆搜索器", "检索历史记忆、偏好和上下文。", ["query", "tenant_id", "lead_id"], ["memories", "relevance_scores"], ["all"], 600, 300, ["memory"]),
    ModuleSpec("message_generator", "消息生成器", "根据策略和画像生成个性化消息。", ["lead_profile", "strategy", "voice_style"], ["message_text", "message_type"], ["inkwriter", "echoer", "followup"], 1500, 2000, ["copywriting"]),
    ModuleSpec("compliance_rewriter", "合规改写器", "对消息或内容做风险规避与合规改写。", ["draft_text", "channel"], ["safe_text", "risk_notes"], ["inkwriter", "catcher", "echoer"], 1200, 1500, ["compliance"]),
    ModuleSpec("signal_scanner", "信号扫描器", "扫描热点、竞品、趋势与舆情。", ["query", "platform"], ["signals", "scores"], ["radar", "strategist"], 1800, 2500, ["research"]),
    ModuleSpec("strategy_planner", "策略规划器", "把目标拆成策略、节奏和优先级。", ["goal", "signals", "constraints"], ["strategy_plan", "risk_list"], ["strategist", "commander"], 2200, 3000, ["planning"]),
    ModuleSpec("dispatch_planner", "调度规划器", "把任务分配给龙虾或边缘节点。", ["strategy_plan", "resource_limits"], ["dispatch_plan"], ["dispatcher", "commander"], 900, 800, ["routing"]),
    ModuleSpec("content_renderer", "内容渲染器", "产出文案、脚本、标题和 CTA。", ["brief", "channel"], ["content_pack"], ["inkwriter", "visualizer"], 1800, 2200, ["content"]),
    ModuleSpec("lead_scorer", "线索评分器", "根据行为和画像做线索评分与分类。", ["lead_profile", "history"], ["lead_score", "reasons"], ["catcher", "abacus"], 700, 600, ["scoring"]),
    ModuleSpec("report_synthesizer", "报告综合器", "把执行、效果和洞察汇总成报告。", ["runs", "metrics"], ["report", "next_actions"], ["abacus", "strategist"], 1400, 1800, ["report"]),
]


class ModuleRegistry:
    def __init__(self, modules: list[ModuleSpec] | None = None) -> None:
        self._modules = {item.module_id: item for item in (modules or MODULE_SPECS)}

    def get_module(self, module_id: str) -> dict[str, Any] | None:
        item = self._modules.get(str(module_id or "").strip())
        return item.to_dict() if item else None

    def get_available_modules(self, lobster_id: str) -> list[dict[str, Any]]:
        role = str(lobster_id or "").strip()
        rows = []
        for item in self._modules.values():
            if "all" in item.available_to or role in item.available_to:
                rows.append(item.to_dict())
        rows.sort(key=lambda row: row["module_id"])
        return rows

    def estimate_cost(self, module_id: str, count: int = 1) -> dict[str, int]:
        item = self._modules[module_id]
        n = max(1, int(count))
        return {
            "tokens": int(item.avg_tokens) * n,
            "latency_ms": int(item.avg_latency_ms) * n,
        }

    def list_all(self) -> list[dict[str, Any]]:
        return [item.to_dict() for item in sorted(self._modules.values(), key=lambda row: row.module_id)]


_registry: ModuleRegistry | None = None


def get_module_registry() -> ModuleRegistry:
    global _registry
    if _registry is None:
        _registry = ModuleRegistry()
    return _registry
