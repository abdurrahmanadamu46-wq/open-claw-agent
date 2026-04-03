import json
import operator
import os
import re
from datetime import UTC, datetime
from typing import Annotated, Any

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


def _clawhub_keys() -> dict[str, str]:
    raw = os.getenv("CLAWHUB_KEYS", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items()}
    except json.JSONDecodeError:
        pass
    return {}


def _agent_log(agent: str, summary: str, payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    keys = _clawhub_keys()
    return [
        {
            "ts": datetime.now(UTC).isoformat(),
            "agent": agent,
            "summary": summary,
            "skill_key": keys.get(agent),
            "payload": payload or {},
        }
    ]


def _keywords(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z0-9_\u4e00-\u9fff]{2,}", text.lower())
    seen = set()
    output = []
    for token in raw:
        if token in seen:
            continue
        seen.add(token)
        output.append(token)
    return output[:12]


class DragonState(TypedDict, total=False):
    task_description: str
    messages: list[Any]
    radar_data: dict[str, Any]
    strategy: dict[str, Any]
    inkwriter_output: dict[str, Any]
    visualizer_output: dict[str, Any]
    dispatch_plan: dict[str, Any]
    echoer_output: dict[str, Any]
    catcher_output: dict[str, Any]
    abacus_output: dict[str, Any]
    followup_output: dict[str, Any]
    leads: list[dict[str, Any]]
    score: float
    call_log: Annotated[list[dict[str, Any]], operator.add]
    evolution_log: Annotated[list[dict[str, Any]], operator.add]


def radar(state: DragonState):
    task = state.get("task_description", "")
    keywords = _keywords(task)
    radar_data = {
        "platforms": ["xiaohongshu", "douyin"],
        "keywords": keywords,
        "hot_posts": [f"post_{i}" for i in range(1, 4)],
    }
    return {
        "radar_data": radar_data,
        "call_log": _agent_log("radar", "竞品与热点扫描完成", {"keyword_count": len(keywords)}),
    }


def strategist(state: DragonState):
    radar_data = state.get("radar_data", {})
    strategy = {
        "persona": "务实型内容运营官",
        "goal": "提升私信询盘",
        "campaign_type": "短视频种草+评论转化",
        "primary_keywords": radar_data.get("keywords", [])[:5],
    }
    return {
        "strategy": strategy,
        "call_log": _agent_log("strategist", "完成策略路由与目标设定", strategy),
    }


def inkwriter(state: DragonState):
    strategy = state.get("strategy", {})
    keywords = strategy.get("primary_keywords", [])
    scripts = [
        {
            "scene": i + 1,
            "copy": f"分镜{i + 1}: 围绕关键词 {keywords[i % len(keywords)] if keywords else '产品价值'} 展开",
        }
        for i in range(7)
    ]
    return {
        "inkwriter_output": {"scripts": scripts, "template": "15秒故事带货"},
        "call_log": _agent_log("inkwriter", "文案与分镜生成完成", {"scenes": 7}),
    }


def visualizer(state: DragonState):
    scripts = state.get("inkwriter_output", {}).get("scripts", [])
    prompts = [
        {
            "scene": item["scene"],
            "prompt": f"高清商业风，真实用户场景，镜头{item['scene']}，重点突出转化触发点",
        }
        for item in scripts
    ] or [{"scene": 1, "prompt": "高清商业风，真实用户场景，突出卖点"}]
    return {
        "visualizer_output": {"prompts": prompts},
        "call_log": _agent_log("visualizer", "视觉提示词生成完成", {"prompt_count": len(prompts)}),
    }


def dispatcher(state: DragonState):
    scripts = state.get("inkwriter_output", {}).get("scripts", [])
    prompts = state.get("visualizer_output", {}).get("prompts", [])
    jobs = []
    for i in range(max(len(scripts), len(prompts))):
        jobs.append(
            {
                "job_id": f"job_{i + 1}",
                "script": scripts[i] if i < len(scripts) else None,
                "visual_prompt": prompts[i] if i < len(prompts) else None,
            }
        )
    dispatch_plan = {"jobs": jobs, "queue": "matrix_dispatch_queue"}
    return {
        "dispatch_plan": dispatch_plan,
        "call_log": _agent_log("dispatcher", "任务拆分与派发计划完成", {"jobs": len(jobs)}),
    }


def echoer(state: DragonState):
    jobs = state.get("dispatch_plan", {}).get("jobs", [])
    comments = [
        {"job_id": job["job_id"], "reply": "这个方案我试了，转化链路很顺，建议先小量A/B。"}
        for job in jobs[:3]
    ]
    return {
        "echoer_output": {"comment_replies": comments},
        "call_log": _agent_log("echoer", "互动回复策略已生成", {"replies": len(comments)}),
    }


def catcher(state: DragonState):
    strategy = state.get("strategy", {})
    kws = strategy.get("primary_keywords", [])
    leads = [
        {
            "lead_id": f"lead_{i + 1}",
            "intent": "hot" if i == 0 else "warm",
            "keyword": kws[i % len(kws)] if kws else "咨询",
            "text": "怎么买/多少钱/能私信吗",
        }
        for i in range(3)
    ]
    return {
        "catcher_output": {"captured_leads": leads},
        "call_log": _agent_log("catcher", "高意向线索识别完成", {"captured": len(leads)}),
    }


def abacus(state: DragonState):
    leads = state.get("catcher_output", {}).get("captured_leads", [])
    scored = []
    for lead in leads:
        score = 0.9 if lead.get("intent") == "hot" else 0.72
        scored.append({**lead, "score": score, "grade": "A" if score >= 0.85 else "B"})
    avg_score = sum(item["score"] for item in scored) / len(scored) if scored else 0.5
    return {
        "abacus_output": {"scored_leads": scored, "avg_score": round(avg_score, 4)},
        "leads": scored,
        "score": round(avg_score, 4),
        "call_log": _agent_log("abacus", "线索评分与CRM优先级完成", {"avg_score": round(avg_score, 4)}),
    }


def _route_after_abacus(state: DragonState) -> str:
    score = float(state.get("score", 0))
    hot_count = len([x for x in state.get("leads", []) if x.get("intent") == "hot"])
    if score >= 0.75 or hot_count > 0:
        return "followup"
    return "feedback"


def followup(state: DragonState):
    leads = state.get("leads", [])
    followup_actions = [
        {
            "lead_id": lead.get("lead_id"),
            "action": "dm_now" if lead.get("grade") == "A" else "dm_in_30m",
        }
        for lead in leads
    ]
    return {
        "followup_output": {"actions": followup_actions},
        "call_log": _agent_log("followup", "触发私信跟进计划", {"actions": len(followup_actions)}),
    }


def feedback(state: DragonState):
    evolution = {
        "timestamp": datetime.now(UTC).isoformat(),
        "summary": "完成闭环反馈，更新下一轮策略参数",
        "score": state.get("score", 0),
        "lead_count": len(state.get("leads", [])),
    }
    return {
        "evolution_log": [evolution],
        "call_log": _agent_log("feedback", "进化反馈完成", evolution),
    }


builder = StateGraph(DragonState)

builder.add_node("radar", radar)
builder.add_node("strategist", strategist)
builder.add_node("inkwriter", inkwriter)
builder.add_node("visualizer", visualizer)
builder.add_node("dispatcher", dispatcher)
builder.add_node("echoer", echoer)
builder.add_node("catcher", catcher)
builder.add_node("abacus", abacus)
builder.add_node("followup", followup)
builder.add_node("feedback", feedback)

builder.add_edge(START, "radar")
builder.add_edge("radar", "strategist")

builder.add_edge("strategist", "inkwriter")
builder.add_edge("strategist", "visualizer")
builder.add_edge("inkwriter", "dispatcher")
builder.add_edge("visualizer", "dispatcher")

builder.add_edge("dispatcher", "echoer")
builder.add_edge("dispatcher", "catcher")
builder.add_edge("echoer", "abacus")
builder.add_edge("catcher", "abacus")

builder.add_conditional_edges(
    "abacus",
    _route_after_abacus,
    {
        "followup": "followup",
        "feedback": "feedback",
    },
)
builder.add_edge("followup", "feedback")
builder.add_edge("feedback", END)

# Export builder so app.py can compile with postgres checkpointer.
app = builder
