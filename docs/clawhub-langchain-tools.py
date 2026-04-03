# -*- coding: utf-8 -*-
"""
龙虾元老院 ClawHub Skill → LangChain @tool 装饰器代码
按 Agent 分组，可直接复制到 Python Agent 运行时使用。

安全（必须先做）：
  npx clawhub@latest install skill-vetter
  clawhub vet <skill-name>

依赖：pip install langchain-core（或 langchain）
工具内实现可调用 subprocess / npx clawhub run <skill> 或自有网关。
"""
from __future__ import annotations

from typing import Optional
from langchain_core.tools import tool


# ===================== 通用安全（所有 Agent 安装前必调） =====================

@tool
def skill_vetter(skill_name: str) -> str:
    """安装任何 ClawHub 技能前必须调用的安全审查器。对 skill_name 做红旗检测与权限审计，通过后才允许安装。"""
    # 实现：调用 npx clawhub vet <skill_name> 或等价 API
    return f"Vetting skill: {skill_name}. Run: npx clawhub@latest install skill-vetter && clawhub vet {skill_name}"


# ===================== 触须虾 radar =====================

@tool
def agent_browser_execute(url: str, commands_json: str) -> str:
    """无头浏览器执行：打开 URL 并执行结构化命令（点、填、滚、截图、绕 Cloudflare/极验）。Rust 引擎抗 bot。"""
    # 实现：调用 agent-browser skill
    return f"agent_browser_execute(url={url}, commands={commands_json})"


@tool
def summarize_page(content_or_url: str, format: str = "markdown") -> str:
    """将 HTML/页面/评论清洗为 Markdown（去广告），供大模型消费。"""
    # 实现：调用 summarize skill
    return f"summarize_page(input={content_or_url[:80]}..., format={format})"


# ===================== 脑虫虾 strategist =====================

@tool
def self_improving_agent_record(event_type: str, content: str, context_json: Optional[str] = None) -> str:
    """自动记录错误与用户纠正，写入 Qdrant RAG 历史兵法，供 Strategist memory loop 进化。"""
    # 实现：调用 self-improving-agent
    return f"self_improving_agent_record(type={event_type}, content={content[:80]}...)"


@tool
def ontology_query(query: str, mode: str, payload: Optional[str] = None) -> str:
    """知识图谱结构化记忆：评论聚类、历史打法检索。"""
    # 实现：调用 ontology skill
    return f"ontology_query(query={query[:80]}..., mode={mode})"


@tool
def proactive_agent_scan(scope: str, analysis_type: Optional[str] = "trend") -> str:
    """主动巡检数据趋势，触发 Pandas 分析或策略建议。"""
    # 实现：调用 proactive-agent
    return f"proactive_agent_scan(scope={scope}, type={analysis_type})"


# ===================== 吐墨虾 ink-writer =====================

@tool
def humanizer_text(text: str, style: str = "casual", intensity: Optional[float] = None) -> str:
    """去 AI 味：注入错别字、口语、宝妈黑话、绝绝子等，生成后必调。"""
    # 实现：调用 humanizer skill
    return f"humanizer_text(len={len(text)}, style={style})"


@tool
def summarize_for_dedup(content: str, template_id: Optional[str] = None) -> str:
    """模板结构强控 + 查重前清洗，用于吐墨虾成稿前。"""
    return f"summarize_for_dedup(len={len(content)}, template={template_id})"


# ===================== 幻影虾 visualizer =====================

@tool
def nano_banana_pro_image(
    prompt: str,
    mode: str = "generate",
    reference_image_url: Optional[str] = None,
    seed: Optional[int] = None,
) -> str:
    """Gemini 图像生成/编辑 + 一致性种子 + Reference Image，做分镜。"""
    # 实现：调用 nano-banana-pro
    return f"nano_banana_pro_image(prompt={prompt[:60]}..., mode={mode})"


# ===================== 点兵虾 dispatcher =====================

@tool
def proactive_agent_node_health(node_ids: Optional[str] = None, policy_tensor_json: Optional[str] = None) -> str:
    """节点健康巡检 + 动态注入 Policy Tensor + 自动剔除死节点。"""
    return f"proactive_agent_node_health(nodes={node_ids})"


@tool
def auto_updater_run(target: str, node_ids: Optional[str] = None) -> str:
    """对边缘节点执行技能/依赖自动更新（如 cron）。"""
    return f"auto_updater_run(target={target}, node_ids={node_ids})"


# ===================== 回声虾 echoer =====================

@tool
def humanizer_reply(
    reply_draft: str,
    platform: str = "generic",
    entropy_level: str = "medium",
) -> str:
    """评论区回复真人化：高熵情绪、错别字、Emoji。"""
    return f"humanizer_reply(len={len(reply_draft)}, platform={platform}, entropy={entropy_level})"


# ===================== 铁网虾 catcher =====================

@tool
def summarize_intent(comments_batch: str, extract_entities: bool = True) -> str:
    """高意向评论快速提取 + NER 兜底，配合 ontology 做意图分类。"""
    return f"summarize_intent(comments_batch_len={len(comments_batch)}, extract_entities={extract_entities})"


@tool
def ontology_extract_lead(text: str, upsert: bool = False) -> str:
    """结构化提取微信号/手机号/求购意图，可选写入知识库。"""
    return f"ontology_extract_lead(text={text[:80]}..., upsert={upsert})"


# ===================== 金算虾 abacus =====================

@tool
def api_gateway_webhook(channel: str, payload_json: str, webhook_url: Optional[str] = None) -> str:
    """一键连飞书/钉钉/CRM Webhook，推送 Hot Lead（可带 XAI 解释）。"""
    return f"api_gateway_webhook(channel={channel}, payload_len={len(payload_json)})"


@tool
def gog_push_lead(lead_json: str, destination: str) -> str:
    """通过 Google Workspace / Gmail / Calendar 推送销售线索。"""
    return f"gog_push_lead(destination={destination})"


# ===================== 回访虾 follow-up =====================

@tool
def openai_whisper_transcribe(
    audio_input: str,
    language: str = "zh",
    vad_enabled: bool = True,
) -> str:
    """本地语音转文字 + VAD 打断检测，用于 WebRTC 实时倾听。结合 ElevenLabs TTS 做语音电销闭环。"""
    return f"openai_whisper_transcribe(audio={audio_input[:60]}..., lang={language}, vad={vad_enabled})"


# ===================== 按 Agent 聚合（便于绑定到对应 Agent） =====================

RADAR_TOOLS = [agent_browser_execute, summarize_page]
STRATEGIST_TOOLS = [self_improving_agent_record, ontology_query, proactive_agent_scan]
INKWRITER_TOOLS = [humanizer_text, summarize_for_dedup]
VISUALIZER_TOOLS = [nano_banana_pro_image]
DISPATCHER_TOOLS = [proactive_agent_node_health, auto_updater_run]
ECHOER_TOOLS = [humanizer_reply]
CATCHER_TOOLS = [summarize_intent, ontology_extract_lead]
ABACUS_TOOLS = [api_gateway_webhook, gog_push_lead]
FOLLOWUP_TOOLS = [openai_whisper_transcribe]

UNIVERSAL_SAFETY_TOOLS = [skill_vetter]

def get_tools_for_agent(agent_id: str):
    """返回指定 Agent 的 LangChain tools 列表。"""
    m = {
        "radar": RADAR_TOOLS,
        "strategist": STRATEGIST_TOOLS,
        "ink-writer": INKWRITER_TOOLS,
        "visualizer": VISUALIZER_TOOLS,
        "dispatcher": DISPATCHER_TOOLS,
        "echoer": ECHOER_TOOLS,
        "catcher": CATCHER_TOOLS,
        "abacus": ABACUS_TOOLS,
        "follow-up": FOLLOWUP_TOOLS,
    }
    return m.get(agent_id, [])
