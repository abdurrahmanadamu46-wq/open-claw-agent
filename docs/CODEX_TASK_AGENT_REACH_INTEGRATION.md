# Codex 任务：CODEX-DCIM-01 — Agent Reach 全网搜索工具集成

> **来源**：借鉴 [openclaw-docker-cn-im](https://github.com/justlovemaki/openclaw-docker-cn-im) 中集成的 [Agent Reach](https://github.com/Panniantong/Agent-Reach)
> **优先级**：🔴 P0 | **算力**：中 | **预计耗时**：2-3小时
> **前置依赖**：无（可独立推进）

---

## 任务背景

Agent Reach 项目 (`Panniantong/Agent-Reach`) 提供了对中国主流社交平台的搜索与数据采集能力，覆盖 Twitter、小红书、微博、抖音、小宇宙等。openclaw-docker-cn-im 已成功集成此工具，通过环境变量 `AGENT_REACH_ENABLED` 和 `AGENT_REACH_USE_CN_MIRROR` 控制。

**对我们的价值**：
- **触须虾 (Radar)**：用 Agent Reach 替代手动爬虫，扫描竞品动态和行业趋势
- **回声虾 (Echoer)**：跨平台搜索相关评论和话题，生成更精准的回复
- **铁网虾 (Catcher)**：通过搜索验证线索真实性和意向度
- **边缘感知层**：Agent Reach 可作为上行事件 `competitor_event` / `metrics_event` 的数据源

---

## 你的任务

创建一个 Agent Reach 工具适配层，让 9 只龙虾可以通过统一接口调用全网搜索能力。

---

## 任务 1：创建 Agent Reach 工具包装器

**文件路径**: `dragon-senate-saas-v2/tools/agent_reach.py`

```python
"""
Agent Reach 工具包装器 — 为龙虾提供全网搜索能力

借鉴自 openclaw-docker-cn-im 的 Agent Reach 集成方案。
Agent Reach 项目: https://github.com/Panniantong/Agent-Reach

支持的平台:
- 小红书 (Xiaohongshu / RED)
- 微博 (Weibo)
- 抖音 (Douyin / TikTok CN)
- Twitter / X
- 小宇宙 (Xiaoyuzhou / Podcast)

使用方式:
  from tools.agent_reach import agent_reach_tool
  results = await agent_reach_tool.search("小红书", "美白精华 推荐", count=10)
"""
from __future__ import annotations

import os
import json
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx


PlatformName = Literal[
    "xiaohongshu", "weibo", "douyin", "twitter", "xiaoyuzhou",
    "bilibili", "zhihu", "toutiao"
]


@dataclass(slots=True)
class SearchResult:
    """统一搜索结果"""
    platform: str
    title: str
    content: str
    url: str
    author: str = ""
    author_id: str = ""
    likes: int = 0
    comments: int = 0
    shares: int = 0
    publish_time: str = ""
    tags: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


class AgentReachTool:
    """
    Agent Reach 工具 — 全网搜索能力
    
    两种工作模式:
    1. API 模式: 通过 Agent Reach HTTP API 调用（推荐生产环境）
    2. 直连模式: 直接使用 Agent Reach Python SDK（需 pip install agent-reach）
    
    配置环境变量:
    - AGENT_REACH_ENABLED: 是否启用 (true/false)
    - AGENT_REACH_MODE: api / sdk (默认 api)
    - AGENT_REACH_API_URL: API 模式的服务地址
    - AGENT_REACH_USE_CN_MIRROR: 是否使用中国镜像 (true/false)
    """

    def __init__(self) -> None:
        self.enabled: bool = False
        self.mode: str = "api"
        self.api_url: str = ""
        self.use_cn_mirror: bool = True
        self._sdk = None
        self.reload_from_env()

    def reload_from_env(self) -> None:
        self.enabled = os.getenv("AGENT_REACH_ENABLED", "").strip().lower() in {"1", "true", "yes"}
        self.mode = os.getenv("AGENT_REACH_MODE", "api").strip().lower()
        self.api_url = os.getenv("AGENT_REACH_API_URL", "http://localhost:8050").strip()
        self.use_cn_mirror = os.getenv("AGENT_REACH_USE_CN_MIRROR", "true").strip().lower() in {"1", "true", "yes"}

    async def search(
        self,
        platform: PlatformName,
        query: str,
        *,
        count: int = 10,
        sort_by: str = "relevance",
        time_range: str = "",
        client: httpx.AsyncClient | None = None,
    ) -> list[SearchResult]:
        """
        全网搜索

        Args:
            platform: 目标平台 ("xiaohongshu", "weibo", "douyin", "twitter", "xiaoyuzhou" 等)
            query: 搜索关键词
            count: 结果数量 (默认 10)
            sort_by: 排序方式 ("relevance" | "time" | "hot")
            time_range: 时间范围 ("1h" | "24h" | "7d" | "30d" | "")
            client: 可选的 httpx 客户端

        Returns:
            SearchResult 列表
        """
        if not self.enabled:
            return []

        try:
            if self.mode == "sdk":
                return await self._search_via_sdk(platform, query, count=count, sort_by=sort_by, time_range=time_range)
            else:
                return await self._search_via_api(platform, query, count=count, sort_by=sort_by, time_range=time_range, client=client)
        except Exception as exc:
            print(f"[agent_reach] search error on {platform}: {exc}")
            return []

    async def _search_via_api(
        self,
        platform: PlatformName,
        query: str,
        *,
        count: int = 10,
        sort_by: str = "relevance",
        time_range: str = "",
        client: httpx.AsyncClient | None = None,
    ) -> list[SearchResult]:
        """通过 Agent Reach HTTP API 搜索"""
        owned = False
        if client is None:
            client = httpx.AsyncClient(timeout=30.0)
            owned = True

        try:
            resp = await client.post(
                f"{self.api_url}/api/v1/search",
                json={
                    "platform": platform,
                    "query": query,
                    "count": count,
                    "sort_by": sort_by,
                    "time_range": time_range,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return [self._parse_result(platform, item) for item in data.get("results", [])]
        finally:
            if owned:
                await client.aclose()

    async def _search_via_sdk(
        self,
        platform: PlatformName,
        query: str,
        *,
        count: int = 10,
        sort_by: str = "relevance",
        time_range: str = "",
    ) -> list[SearchResult]:
        """通过 Agent Reach Python SDK 直接搜索（需要 pip install agent-reach）"""
        # SDK 模式预留 — 当前返回空
        # TODO: 当 Agent Reach SDK 稳定后实现
        print("[agent_reach] SDK mode not yet implemented, falling back to empty results")
        return []

    def _parse_result(self, platform: str, item: dict[str, Any]) -> SearchResult:
        """将 Agent Reach 返回的原始数据解析为统一 SearchResult"""
        return SearchResult(
            platform=platform,
            title=item.get("title", ""),
            content=item.get("content", item.get("desc", "")),
            url=item.get("url", item.get("link", "")),
            author=item.get("author", item.get("user_name", "")),
            author_id=item.get("author_id", item.get("user_id", "")),
            likes=int(item.get("likes", item.get("like_count", 0))),
            comments=int(item.get("comments", item.get("comment_count", 0))),
            shares=int(item.get("shares", item.get("share_count", 0))),
            publish_time=item.get("publish_time", item.get("created_at", "")),
            tags=item.get("tags", []),
            raw=item,
        )

    async def fetch_user_profile(
        self,
        platform: PlatformName,
        user_id: str,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> dict[str, Any]:
        """获取用户画像（用于触须虾分析粉丝/竞品账号）"""
        if not self.enabled:
            return {}

        owned = False
        if client is None:
            client = httpx.AsyncClient(timeout=30.0)
            owned = True

        try:
            resp = await client.post(
                f"{self.api_url}/api/v1/user/profile",
                json={"platform": platform, "user_id": user_id},
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            print(f"[agent_reach] fetch_user_profile error: {exc}")
            return {}
        finally:
            if owned:
                await client.aclose()

    async def fetch_post_detail(
        self,
        platform: PlatformName,
        post_url: str,
        *,
        include_comments: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> dict[str, Any]:
        """获取帖子/视频详情（含评论可选）"""
        if not self.enabled:
            return {}

        owned = False
        if client is None:
            client = httpx.AsyncClient(timeout=30.0)
            owned = True

        try:
            resp = await client.post(
                f"{self.api_url}/api/v1/post/detail",
                json={
                    "platform": platform,
                    "url": post_url,
                    "include_comments": include_comments,
                },
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            print(f"[agent_reach] fetch_post_detail error: {exc}")
            return {}
        finally:
            if owned:
                await client.aclose()

    async def fetch_trending(
        self,
        platform: PlatformName,
        *,
        category: str = "",
        count: int = 20,
        client: httpx.AsyncClient | None = None,
    ) -> list[dict[str, Any]]:
        """获取平台热搜/趋势（触须虾使用）"""
        if not self.enabled:
            return []

        owned = False
        if client is None:
            client = httpx.AsyncClient(timeout=30.0)
            owned = True

        try:
            resp = await client.post(
                f"{self.api_url}/api/v1/trending",
                json={"platform": platform, "category": category, "count": count},
            )
            resp.raise_for_status()
            return resp.json().get("trends", [])
        except Exception as exc:
            print(f"[agent_reach] fetch_trending error: {exc}")
            return []
        finally:
            if owned:
                await client.aclose()

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "api_url": self.api_url if self.mode == "api" else "N/A",
            "use_cn_mirror": self.use_cn_mirror,
        }


# 模块级单例
agent_reach_tool = AgentReachTool()
```

---

## 任务 2：将 Agent Reach 注册为龙虾可用工具

**文件路径**: `dragon-senate-saas-v2/tools/__init__.py`

```python
"""
龙虾工具注册表

所有外部工具在此统一注册，供 LobsterRunner 和各龙虾模块调用。
"""
from tools.agent_reach import agent_reach_tool, SearchResult

__all__ = ["agent_reach_tool", "SearchResult"]
```

---

## 任务 3：在触须虾 (Radar) 中接入 Agent Reach

**文件路径**: 修改 `dragon-senate-saas-v2/lobsters/radar.py`

在触须虾的 `run()` 方法中，添加 Agent Reach 作为信号源。**不要删除或覆盖**现有的 `_run_radar_logic()` 代码，而是在其中**追加**一个新的信号采集步骤。

找到 `_run_radar_logic` 或等效的主执行函数，在其中添加：

```python
# ── Agent Reach 全网搜索（新增信号源） ──
from tools.agent_reach import agent_reach_tool

async def _fetch_agent_reach_signals(industry: str, keywords: list[str]) -> list[dict]:
    """通过 Agent Reach 采集全网信号"""
    if not agent_reach_tool.enabled:
        return []
    
    signals = []
    platforms = ["xiaohongshu", "weibo", "douyin"]
    
    for kw in keywords[:3]:  # 限制关键词数量避免 rate limit
        for platform in platforms:
            results = await agent_reach_tool.search(
                platform, kw, count=5, sort_by="hot", time_range="7d"
            )
            for r in results:
                signals.append({
                    "source": f"agent_reach:{platform}",
                    "title": r.title,
                    "content": r.content[:200],
                    "url": r.url,
                    "engagement": r.likes + r.comments + r.shares,
                    "author": r.author,
                    "tags": r.tags,
                })
    
    return signals
```

**注意**：
- 只追加，不覆盖现有逻辑
- Agent Reach 搜索结果应合并到现有的 `signals` 列表中
- 如果 `agent_reach_tool.enabled` 为 False，此步骤静默跳过

---

## 任务 4：在回声虾 (Echoer) 中接入 Agent Reach

**文件路径**: 修改 `dragon-senate-saas-v2/lobsters/echoer.py`

回声虾生成回复前，可以通过 Agent Reach 搜索相关话题，让回复更贴近当前热点。

在回声虾的回复生成逻辑中**追加**：

```python
async def _enrich_context_with_trends(platform: str, topic: str) -> str:
    """用 Agent Reach 搜索当前热点，丰富回复上下文"""
    from tools.agent_reach import agent_reach_tool
    
    if not agent_reach_tool.enabled:
        return ""
    
    results = await agent_reach_tool.search(platform, topic, count=3, sort_by="hot", time_range="24h")
    if not results:
        return ""
    
    trends_summary = "\n".join([
        f"- {r.title}: {r.content[:100]}（{r.likes}赞/{r.comments}评）"
        for r in results[:3]
    ])
    
    return f"\n\n[当前{platform}热点参考]\n{trends_summary}"
```

**注意**：
- 这个上下文丰富是可选的，仅在 Agent Reach 启用时生效
- 搜索结果作为 Prompt 的额外上下文注入，不改变回声虾的核心逻辑

---

## 任务 5：更新 .env.example

**文件路径**: 修改 `dragon-senate-saas-v2/.env.example`

在文件末尾追加：

```bash
# ── Agent Reach 全网搜索 ──
# 参考: https://github.com/Panniantong/Agent-Reach
# 借鉴: https://github.com/justlovemaki/openclaw-docker-cn-im
AGENT_REACH_ENABLED=false
AGENT_REACH_MODE=api
AGENT_REACH_API_URL=http://localhost:8050
AGENT_REACH_USE_CN_MIRROR=true
```

---

## 验证标准

1. ✅ `tools/agent_reach.py` 创建成功，包含 `AgentReachTool` 类
2. ✅ `tools/__init__.py` 正确导出
3. ✅ `SearchResult` 数据类结构完整（platform/title/content/url/author/likes/comments/shares）
4. ✅ 支持 `search()` / `fetch_user_profile()` / `fetch_post_detail()` / `fetch_trending()` 四个方法
5. ✅ 所有方法在 `enabled=False` 时静默返回空
6. ✅ 所有 HTTP 调用有 `try/except` 保护
7. ✅ 触须虾 `radar.py` 中追加了 Agent Reach 信号采集（不覆盖现有逻辑）
8. ✅ 回声虾 `echoer.py` 中追加了热点上下文丰富（不覆盖现有逻辑）
9. ✅ `.env.example` 追加了 Agent Reach 配置
10. ✅ 模块级单例 `agent_reach_tool` 正确创建

---

## 文件清单

```
dragon-senate-saas-v2/
├── tools/
│   ├── __init__.py              # 新建
│   └── agent_reach.py           # 新建
├── lobsters/
│   ├── radar.py                 # 修改 — 追加 Agent Reach 信号采集
│   └── echoer.py                # 修改 — 追加热点上下文丰富
└── .env.example                 # 修改 — 追加 Agent Reach 配置
```
