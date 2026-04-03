# -*- coding: utf-8 -*-
"""
龙虾元老院 — LangGraph 编排
Radar → Strategist → [InkWriter || Visualizer] → Dispatcher → [Echoer || Catcher] → Abacus
→ 条件(score>80 ? FollowUp : 跳过) → Feedback → END
Fan-in：Dispatcher 与 Abacus 在上游并行分支都写满状态后才执行真实逻辑（见 nodes 内判断）。
"""
from typing import Literal

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from .state import DragonState
from . import nodes


def abacus_router(state: DragonState) -> Literal["followup", "feedback"]:
    """Abacus 后：>80 分走语音电销，否则直接进化。"""
    if (state.get("score") or 0) > 80:
        return "followup"
    return "feedback"


def build_graph():
    graph = StateGraph(DragonState)

    graph.add_node("radar", nodes.radar_node)
    graph.add_node("strategist", nodes.strategist_node)
    graph.add_node("inkwriter", nodes.inkwriter_node)
    graph.add_node("visualizer", nodes.visualizer_node)
    graph.add_node("dispatcher", nodes.dispatcher_node)
    graph.add_node("echoer", nodes.echoer_node)
    graph.add_node("catcher", nodes.catcher_node)
    graph.add_node("abacus", nodes.abacus_node)
    graph.add_node("followup", nodes.followup_node)
    graph.add_node("feedback", nodes.feedback_node)

    # 线性：任务入口 → 情报层
    graph.add_edge(START, "radar")
    graph.add_edge("radar", "strategist")

    # 并行内容兵工厂（Strategist 后 fan-out）
    graph.add_edge("strategist", "inkwriter")
    graph.add_edge("strategist", "visualizer")
    # Fan-in：两条分支都指向 Dispatcher，Dispatcher 内等 script_json + visual_prompts 齐备再下发
    graph.add_edge("inkwriter", "dispatcher")
    graph.add_edge("visualizer", "dispatcher")

    # 并行收网层（Dispatcher 后 fan-out）
    graph.add_edge("dispatcher", "echoer")
    graph.add_edge("dispatcher", "catcher")
    # Fan-in：Echoer、Catcher 都指向 Abacus，Abacus 内等 interaction_replies + leads 齐备再打分
    graph.add_edge("echoer", "abacus")
    graph.add_edge("catcher", "abacus")

    # 条件：Abacus → FollowUp（>80）或直接进化
    graph.add_conditional_edges(
        "abacus",
        abacus_router,
        {"followup": "followup", "feedback": "feedback"},
    )
    graph.add_edge("followup", "feedback")
    graph.add_edge("feedback", END)

    return graph


def compile_app(*, checkpointer=None):
    """编译可运行、可中断恢复的 App。"""
    memory = checkpointer or MemorySaver()
    return build_graph().compile(checkpointer=memory, name="龙虾元老院")
