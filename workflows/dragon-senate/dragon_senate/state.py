# -*- coding: utf-8 -*-
"""
龙虾元老院 — 全局状态定义
9 只龙虾 + 进化节点共享，支持 add_messages 归并与可中断恢复。
"""
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class DragonState(TypedDict, total=False):
    """工作流状态。total=False 表示所有键可选，便于初始 state 只带 task + messages。"""
    messages: Annotated[list[AnyMessage], add_messages]
    task_description: str
    comments_data: dict | None
    strategy_report: dict | None
    script_json: dict | None
    visual_prompts: list | None
    dispatched_tasks: list | None
    interaction_replies: list | None
    leads: list | None
    score: float | None
    settlement: dict | None
    call_log: dict | None
    evolution_log: list | None
