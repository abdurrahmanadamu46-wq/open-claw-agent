# -*- coding: utf-8 -*-
"""
龙虾元老院 — 9 只龙虾节点 + 进化节点
每个节点预留 ClawHub skill 绑定：可用 get_tools_for_agent(agent_id) 绑定到 llm.bind_tools(tools).
"""
from langchain_core.messages import AIMessage, HumanMessage

from .state import DragonState


def _ensure_llm_tools(agent_id: str):
    """占位：从 clawhub-langchain-tools 加载该 Agent 的 tools，供 llm.bind_tools(tools) 使用。"""
    try:
        import sys
        from pathlib import Path
        root = Path(__file__).resolve().parents[2]
        docs = root / "docs"
        if str(docs) not in sys.path:
            sys.path.insert(0, str(docs))
        from clawhub_langchain_tools import get_tools_for_agent
        return get_tools_for_agent(agent_id)
    except Exception:
        return []


def radar_node(state: DragonState) -> dict:
    """触须虾 — 爬虫采集。绑定: agent-browser + summarize。"""
    print("[Radar] 触须虾: agent-browser + summarize ...")
    # tools = _ensure_llm_tools("radar")
    # radar_agent = llm.bind_tools(tools).invoke([HumanMessage(content=state["task_description"])])
    return {
        "messages": [AIMessage(content="雷达已采集 10w 条评论并清洗为 Markdown")],
        "comments_data": {"video_id": "demo123", "comments_count": 10000, "data": "JSON 评论列表"},
    }


def strategist_node(state: DragonState) -> dict:
    """脑虫虾 — 策略大脑。绑定: ontology + self-improving-agent + proactive-agent。"""
    print("[Strategist] 脑虫虾: Qdrant + 聚类 ...")
    # tools = _ensure_llm_tools("strategist")
    return {
        "messages": [AIMessage(content="策略报告：短平快打法，痛点 Top3 已生成")],
        "strategy_report": {"pain_points": ["宝妈痛点1", "成分党痛点2"], "type": "short_fast"},
    }


def inkwriter_node(state: DragonState) -> dict:
    """吐墨虾 — 剧本生成。绑定: humanizer + summarize（模板+查重）。"""
    print("[InkWriter] 吐墨虾: 模板 + 去AI味 ...")
    # tools = _ensure_llm_tools("ink-writer")
    return {
        "messages": [AIMessage(content="剧本 JSON 已锁定 5 个分镜")],
        "script_json": {"frames": 5, "content": "分镜详情 JSON"},
    }


def visualizer_node(state: DragonState) -> dict:
    """幻影虾 — 视觉提示词。绑定: nano-banana-pro。"""
    print("[Visualizer] 幻影虾: 分镜提示词 ...")
    # tools = _ensure_llm_tools("visualizer")
    return {
        "messages": [AIMessage(content="5 个分镜提示词 + Seed 已生成")],
        "visual_prompts": ["prompt1", "prompt2", "prompt3", "prompt4", "prompt5"],
    }


def dispatcher_node(state: DragonState) -> dict:
    """点兵虾 — 调度中心。上游 fan-in：需同时具备 script_json 与 visual_prompts 才执行真实下发。绑定: proactive-agent + auto-updater。"""
    script_ok = bool(state.get("script_json"))
    visual_ok = bool(state.get("visual_prompts"))
    if not (script_ok and visual_ok):
        return {"messages": [AIMessage(content="等待内容兵工厂收齐剧本与视觉...")]}
    print("[Dispatcher] 点兵虾: 节点健康 + Policy Tensor ...")
    return {
        "messages": [AIMessage(content="任务已下发至 100 个边缘节点")],
        "dispatched_tasks": ["task_echo", "task_catch"],
    }


def echoer_node(state: DragonState) -> dict:
    """回声虾 — 互动生成。绑定: humanizer。"""
    print("[Echoer] 回声虾: 真人味评论 ...")
    # tools = _ensure_llm_tools("echoer")
    return {
        "messages": [AIMessage(content="已生成 50 条高熵回复")],
        "interaction_replies": ["家人们绝绝子回复1", "回复2"],
    }


def catcher_node(state: DragonState) -> dict:
    """铁网虾 — 意图猎手。绑定: ontology + summarize（高意向+NER）。"""
    print("[Catcher] 铁网虾: 微信号/求购意图 ...")
    # tools = _ensure_llm_tools("catcher")
    return {
        "messages": [AIMessage(content="捕获 12 条 Hot Lead")],
        "leads": [{"wx": "wx123", "intent": "求购"}],
    }


def abacus_node(state: DragonState) -> dict:
    """金算虾 — 评分与推送。上游 fan-in：需同时具备 interaction_replies 与 leads 才执行打分。绑定: api-gateway + gog。"""
    replies_ok = state.get("interaction_replies") is not None
    leads_ok = state.get("leads") is not None
    if not (replies_ok and leads_ok):
        return {"messages": [AIMessage(content="等待收网层 Echoer+Catcher 收齐...")]}
    print("[Abacus] 金算虾: 打分 + 飞书 + 虾粮 ...")
    score = 87.5
    return {
        "messages": [AIMessage(content=f"Hot Lead 评分 {score} 已推送")],
        "score": score,
        "settlement": {"reward": 500},
    }


def followup_node(state: DragonState) -> dict:
    """回访虾 — 语音电销。仅当 Abacus 评分 >80 时进入。绑定: openai-whisper + ElevenLabs TTS。"""
    print("[FollowUp] 回访虾: VAD + 异议话术 ...")
    # tools = _ensure_llm_tools("follow-up")
    return {
        "messages": [AIMessage(content="语音通话完成，已存 CRM")],
        "call_log": {"duration": 180, "result": "成交"},
    }


def feedback_node(state: DragonState) -> dict:
    """进化大脑 — self-improving-agent 闭环，每次任务结束执行。"""
    print("[Feedback] 进化大脑: 记录踩坑 + Qdrant ...")
    evolution = list(state.get("evolution_log") or [])
    evolution.append("本次优化：缩短 Radar 爬取时间 40%")
    return {
        "messages": [AIMessage(content="元老院已进化，下次更强！")],
        "evolution_log": evolution,
    }
