"""
Radar 🦐 触须虾 — 信号扫描、噪音过滤、趋势归纳

Primary Artifact: SignalBrief
Upstream: Commander
Downstream: Strategist

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

from typing import Any

from lobsters.base_lobster import BaseLobster
from lobsters.shared import agent_log, keywords, invoke_clawhub_skill

_instance: RadarLobster | None = None


class RadarLobster(BaseLobster):
    role_id = "radar"


def _get() -> RadarLobster:
    global _instance
    if _instance is None:
        _instance = RadarLobster()
    return _instance


async def _fetch_agent_reach_signals(industry: str, keywords: list[str]) -> list[dict]:
    """通过 Agent Reach 采集全网信号。"""
    from tools.agent_reach import agent_reach_tool

    if not agent_reach_tool.enabled:
        return []

    signals: list[dict[str, Any]] = []
    platforms = ["xiaohongshu", "weibo", "douyin"]

    for kw in keywords[:3]:
        for platform in platforms:
            results = await agent_reach_tool.search(
                platform, kw, count=5, sort_by="hot", time_range="7d"
            )
            for result in results:
                signals.append(
                    {
                        "source": f"agent_reach:{platform}",
                        "title": result.title,
                        "content": result.content[:200],
                        "url": result.url,
                        "engagement": result.likes + result.comments + result.shares,
                        "author": result.author,
                        "tags": result.tags,
                        "industry": industry,
                    }
                )

    return signals


async def radar(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full radar implementation.

    Scans for signals, extracts keywords, invokes browser+summarize skills,
    and computes source credibility scores.
    """
    from senate_kernel import compute_source_credibility as kernel_compute_source_credibility

    task = state.get("task_description", "")
    kw = keywords(task)

    input_sources = state.get("source_credibility", {}).get("source_scores", [])
    seed_sources = [
        str(item.get("source"))
        for item in input_sources
        if isinstance(item, dict) and item.get("source")
    ]
    if not seed_sources:
        seed_sources = ["openalex", "github_projects", "huggingface_papers"]

    await invoke_clawhub_skill("radar", "agent-browser", {"task": task})
    await invoke_clawhub_skill("radar", "summarize", {"keywords": kw})

    industry = str(state.get("industry_tag") or "general").strip().lower() or "general"
    agent_reach_signals = await _fetch_agent_reach_signals(industry, kw)

    radar_data = {
        "platforms": ["xiaohongshu", "douyin"],
        "sources": seed_sources,
        "keywords": kw,
        "hot_posts": [f"hot_post_{i}" for i in range(1, 6)],
        "signals": agent_reach_signals,
        "agent_reach_signal_count": len(agent_reach_signals),
    }

    source_credibility = kernel_compute_source_credibility(radar_data)

    return {
        "radar_data": radar_data,
        "source_credibility": source_credibility,
        "call_log": agent_log(
            "radar",
            "Radar scan finished with source scoring",
            {
                "keyword_count": len(kw),
                "agent_reach_signal_count": len(agent_reach_signals),
                "source_credibility": source_credibility.get("overall"),
                "weak_source_count": len(source_credibility.get("weak_sources", [])),
            },
        ),
    }


# Expose metadata for Commander roster selection
role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
