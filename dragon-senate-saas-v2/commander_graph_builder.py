from __future__ import annotations

import importlib
import inspect
import logging
from typing import Any, Awaitable, Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from commander_router import GOVERNANCE_NODES, RoutePlan
from lobster_pool_manager import get_lobster_registry

# ────────────────────────────────────────────────────────────────────
# ★ Coordinator System Prompt 升级
# 灵感来源：cccback-master coordinator/coordinatorMode.ts
# 核心：四阶段工作流 + 并行优先原则 + task-notification 解析规则
# ────────────────────────────────────────────────────────────────────

COORDINATOR_SYSTEM_PROMPT_ADDON = """
## 你的角色：协调者（Coordinator）

你是 ClawCommerce 龙虾元老院的协调大脑。你的职责：
- 分解用户目标为具体子任务
- 向业务龙虾下达清晰、自包含的任务指令
- 整合龙虾结果并向用户汇报进展
- 能直接回答的问题，不要委托给龙虾

---

## 四阶段工作流（必须遵守）

| 阶段 | 执行者 | 目的 |
|------|--------|------|
| **Research（情报）** | radar + strategist（并行） | 了解账号状态、竞品、趋势信号 |
| **Synthesis（综合）** | 你（commander）| 读取情报，制定具体执行规格，不猜测 |
| **Implementation（执行）** | dispatcher + inkwriter + visualizer | 按规格执行，不自由发挥 |
| **Verification（验收）** | followup + abacus | 证明结果有效，不只确认存在 |

---

## 并行是你的超能力

**独立任务必须并行启动。不要串行等待可以同时进行的工作。**

✅ 正确示范：
- 同时启动 radar（热点情报）和 abacus（账号数据）
- 同时启动账号A、账号B、账号C 的 dispatcher 任务
- 同时让 inkwriter 写文案 + visualizer 设计封面

❌ 错误示范：
- 等 radar 完成再启动 strategist（如果它们不依赖彼此）
- 一个账号发完再发下一个账号（应并行）
- 等所有任务完成再开始验收（可以边执行边验收）

---

## 龙虾任务通知格式（必须掌握）

当业务龙虾完成任务时，系统会向你发送如下格式的通知：

```xml
<task-notification>
<task-id>{龙虾运行ID}</task-id>
<status>completed|failed|killed</status>
<summary>{人类可读的状态摘要}</summary>
<result>{龙虾最终输出内容}</result>
<usage>
  <total_tokens>{tokens}</total_tokens>
  <tool_uses>{工具调用次数}</tool_uses>
  <duration_ms>{耗时毫秒}</duration_ms>
</usage>
</task-notification>
```

**收到 `<task-notification>` 时的处理规则**：
1. 这是系统消息，不是用户发言
2. 不要感谢龙虾，不要回应龙虾
3. 检查 status：completed → 提炼结果；failed → 决定是否重试或升级
4. 向用户简要汇报进展（不要转述原始 XML）
5. 如果还有未完成的并行任务，等待其他通知再汇总

---

## 向龙虾下指令的要则

龙虾**看不到**你和用户的对话历史。**每个指令必须自包含**：

✅ 好的指令：
> "分析账号 @beauty_lab 最近30天数据。重点：互动率趋势、最佳发布时间、表现最好的内容类型。
> 只分析，不要发布任何内容。完成后报告关键发现。"

❌ 坏的指令：
> "基于我们之前的讨论，帮我分析一下"（龙虾没有上下文）
> "继续刚才的工作"（歧义，不明确）

---

## 继续龙虾上下文（SendMessage 模式）

龙虾完成后，你可以继续其上下文（它记得之前做了什么）：

- 研究龙虾完成后 → 继续让它深入分析某个发现
- 执行龙虾遇到错误 → 继续让它重试或换方案
- 不同任务 → 启动新龙虾（避免上下文污染）

---

## 对话压缩感知

系统会在 Token 超过阈值时自动压缩对话历史。
你可能会看到如下边界标记：

```
[系统：对话已自动压缩]
压缩时间：...
```

这是正常现象。压缩后的上下文已包含所有关键信息，请继续执行任务，勿重复已完成的操作。
"""


def build_coordinator_system_prompt(base_prompt: str = "") -> str:
    """
    构建完整的 commander/coordinator system prompt。
    在基础 prompt 之后追加 Coordinator 协议。
    """
    parts = []
    if base_prompt.strip():
        parts.append(base_prompt.strip())
    parts.append(COORDINATOR_SYSTEM_PROMPT_ADDON.strip())
    return "\n\n---\n\n".join(parts)


class DynamicDragonState(TypedDict, total=False):
    verification_gate: dict[str, Any]
    hitl_decision: str
    hitl_required: bool
    score: float
    route_plan: dict[str, Any]
    pending_approval_node: str


NodeCallable = Callable[[dict[str, Any]], Awaitable[dict[str, Any]] | dict[str, Any]]
logger = logging.getLogger(__name__)


def _make_lazy_node(module_name: str, attr_name: str) -> NodeCallable:
    async def _node(state: dict[str, Any]) -> dict[str, Any]:
        module = importlib.import_module(module_name)
        func = getattr(module, attr_name)
        result = func(state)
        if inspect.isawaitable(result):
            result = await result
        return result

    return _node


_BUSINESS_NODE_FACTORIES: dict[str, NodeCallable] = {
    "radar": _make_lazy_node("lobsters.radar", "radar"),
    "strategist": _make_lazy_node("lobsters.strategist", "strategist"),
    "inkwriter": _make_lazy_node("lobsters.inkwriter", "inkwriter"),
    "visualizer": _make_lazy_node("lobsters.visualizer", "visualizer"),
    "dispatcher": _make_lazy_node("lobsters.dispatcher", "dispatcher"),
    "echoer": _make_lazy_node("lobsters.echoer", "echoer"),
    "catcher": _make_lazy_node("lobsters.catcher", "catcher"),
    "abacus": _make_lazy_node("lobsters.abacus", "abacus"),
    "followup": _make_lazy_node("lobsters.followup", "followup"),
}


def _resolve_registered_lobster_roles(preferred: list[str] | tuple[str, ...] | None = None) -> list[str]:
    candidates = [
        role_id
        for role_id in list(preferred or _BUSINESS_NODE_FACTORIES.keys())
        if role_id in _BUSINESS_NODE_FACTORIES
    ]
    try:
        registry = get_lobster_registry()
    except Exception as exc:  # noqa: BLE001
        logger.debug("load lobster registry failed, fallback to local node factory order: %s", exc)
        return candidates

    if not isinstance(registry, dict) or not registry:
        return candidates

    ordered = [role_id for role_id in registry.keys() if role_id in candidates]
    for role_id in candidates:
        if role_id not in ordered:
            ordered.append(role_id)
    return ordered


def _route_after_verification_gate(state: DynamicDragonState) -> str:
    route = str((state.get("verification_gate") or {}).get("route", "continue")).strip().lower()
    if route == "continue":
        return "continue"
    if route == "review":
        return "review"
    return "reject"


def _make_approval_router(approved_target: str) -> Callable[[DynamicDragonState], str]:
    def _route_after_approval(state: DynamicDragonState) -> str:
        decision = str(state.get("hitl_decision", "rejected")).strip().lower()
        if decision == "approved":
            return approved_target
        return "feedback"

    return _route_after_approval


class DynamicGraphBuilder:
    """Build a LangGraph StateGraph dynamically from RoutePlan."""

    def __init__(self, node_registry: dict[str, NodeCallable] | None = None) -> None:
        self.node_registry = node_registry or self._default_node_registry()

    def build(self, route_plan: RoutePlan) -> StateGraph:
        route_plan = self._align_route_plan(route_plan)
        builder = StateGraph(DynamicDragonState)

        for node_name in self._required_nodes(route_plan):
            builder.add_node(node_name, self.node_registry[node_name])

        builder.add_edge(START, "constitutional_guardian_node")
        builder.add_edge("constitutional_guardian_node", "verification_gate_node")

        preflight_gate = "human_approval_gate_preflight"
        first_exec = route_plan.lobster_sequence[0] if route_plan.lobster_sequence else "feedback"

        builder.add_conditional_edges(
            "verification_gate_node",
            _route_after_verification_gate,
            {
                "continue": "memory_governor_node",
                "review": preflight_gate,
                "reject": "feedback",
            },
        )
        builder.add_conditional_edges(
            preflight_gate,
            _make_approval_router("memory_governor_node"),
            {
                "memory_governor_node": "memory_governor_node",
                "feedback": "feedback",
            },
        )
        builder.add_edge("memory_governor_node", first_exec)

        self._wire_execution_flow(builder, route_plan)

        builder.add_edge("feedback", "self_improving_loop")
        builder.add_edge("self_improving_loop", END)
        return builder

    def _align_route_plan(self, route_plan: RoutePlan) -> RoutePlan:
        ordered_roles = _resolve_registered_lobster_roles(route_plan.lobster_sequence)
        ordered_set = set(ordered_roles)
        route_plan.lobster_sequence = [role_id for role_id in ordered_roles if role_id in route_plan.lobster_sequence]
        route_plan.parallelizable = [
            pair for pair in route_plan.parallelizable if pair[0] in ordered_set and pair[1] in ordered_set
        ]
        route_plan.approval_insert_after = [
            role_id for role_id in route_plan.approval_insert_after if role_id in ordered_set
        ]
        route_plan.skip_lobsters = [
            role_id for role_id in route_plan.skip_lobsters if role_id in ordered_set
        ]
        route_plan.estimated_steps = len(route_plan.lobster_sequence)
        return route_plan

    def _wire_execution_flow(self, builder: StateGraph, route_plan: RoutePlan) -> None:
        sequence = route_plan.lobster_sequence
        if not sequence:
            builder.add_edge("memory_governor_node", "feedback")
            return

        parallel_pairs = {
            tuple(pair) for pair in route_plan.parallelizable
        } | {tuple(reversed(pair)) for pair in route_plan.parallelizable}
        approval_after = set(route_plan.approval_insert_after)

        index = 0
        previous_node = "memory_governor_node"
        current_is_already_connected = False

        while index < len(sequence):
            current = sequence[index]

            if index + 1 < len(sequence) and (current, sequence[index + 1]) in parallel_pairs:
                # 并行对：previous → current 和 previous → partner 同时出发，汇聚到 merge_target
                partner = sequence[index + 1]
                merge_target = sequence[index + 2] if index + 2 < len(sequence) else "feedback"
                # 只在这里连接 previous→current，避免与下方 add_edge 重复
                builder.add_edge(previous_node, current)
                builder.add_edge(previous_node, partner)
                builder.add_edge(current, merge_target)
                builder.add_edge(partner, merge_target)
                previous_node = merge_target
                index += 2
                current_is_already_connected = True
                continue

            if not current_is_already_connected:
                builder.add_edge(previous_node, current)

            next_node = sequence[index + 1] if index + 1 < len(sequence) else "feedback"
            if current in approval_after:
                approval_node = f"human_approval_gate_after_{current}"
                builder.add_edge(current, approval_node)
                builder.add_conditional_edges(
                    approval_node,
                    _make_approval_router(next_node),
                    {
                        next_node: next_node,
                        "feedback": "feedback",
                    },
                )
            else:
                builder.add_edge(current, next_node)

            previous_node = current
            current_is_already_connected = False
            index += 1

    def _required_nodes(self, route_plan: RoutePlan) -> list[str]:
        nodes = list(GOVERNANCE_NODES) + [
            "human_approval_gate_preflight",
            *route_plan.lobster_sequence,
            *[f"human_approval_gate_after_{node}" for node in route_plan.approval_insert_after],
            "feedback",
            "self_improving_loop",
        ]
        seen: set[str] = set()
        unique_nodes: list[str] = []
        for node in nodes:
            if node in seen:
                continue
            seen.add(node)
            unique_nodes.append(node)
        return unique_nodes

    def _default_node_registry(self) -> dict[str, NodeCallable]:
        business_nodes = {
            role_id: _BUSINESS_NODE_FACTORIES[role_id]
            for role_id in _resolve_registered_lobster_roles()
        }
        return {
            **business_nodes,
            # ── commander（元老院总脑）治理节点 ──────────────────────────
            # commander 以治理节点形式存在于图中，负责编排/仲裁/复盘：
            "constitutional_guardian_node": _make_lazy_node("dragon_senate", "constitutional_guardian_node"),
            "verification_gate_node":       _make_lazy_node("dragon_senate", "verification_gate_node"),
            "memory_governor_node":         _make_lazy_node("dragon_senate", "memory_governor_node"),
            "human_approval_gate_preflight": _make_lazy_node("dragon_senate", "human_approval_gate"),
            "feedback":            _make_lazy_node("dragon_senate", "feedback"),
            "self_improving_loop": _make_lazy_node("dragon_senate", "self_improving_loop"),
            # ── 各业务龙虾执行后可插入的人工审批节点 ─────────────────────
            **{
                f"human_approval_gate_after_{role_id}": _make_lazy_node("dragon_senate", "human_approval_gate")
                for role_id in ("dispatcher", "abacus", "catcher", "followup")
            },
        }
