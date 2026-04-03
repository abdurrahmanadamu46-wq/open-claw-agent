"""
Agent Reach 工具包装器 — 为龙虾提供全网搜索能力

借鉴自 openclaw-docker-cn-im 的 Agent Reach 集成方案。
Agent Reach 项目: https://github.com/Panniantong/Agent-Reach
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx


PlatformName = Literal[
    "xiaohongshu",
    "weibo",
    "douyin",
    "twitter",
    "xiaoyuzhou",
    "bilibili",
    "zhihu",
    "toutiao",
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


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


class AgentReachTool:
    """
    Agent Reach 工具 — 全网搜索能力

    两种工作模式:
    1. API 模式
    2. SDK 模式（预留）
    """

    def __init__(self) -> None:
        self.enabled: bool = False
        self.mode: str = "api"
        self.api_url: str = ""
        self.use_cn_mirror: bool = True
        self._sdk = None
        self.reload_from_env()

    def reload_from_env(self) -> None:
        self.enabled = os.getenv("AGENT_REACH_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
        self.mode = os.getenv("AGENT_REACH_MODE", "api").strip().lower()
        self.api_url = os.getenv("AGENT_REACH_API_URL", "http://localhost:8050").strip().rstrip("/")
        self.use_cn_mirror = os.getenv("AGENT_REACH_USE_CN_MIRROR", "true").strip().lower() in {"1", "true", "yes", "on"}

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
        """全网搜索"""
        if not self.enabled:
            return []

        try:
            if self.mode == "sdk":
                return await self._search_via_sdk(platform, query, count=count, sort_by=sort_by, time_range=time_range)
            return await self._search_via_api(platform, query, count=count, sort_by=sort_by, time_range=time_range, client=client)
        except Exception as exc:  # noqa: BLE001
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
        """通过 Agent Reach Python SDK 直接搜索（预留）"""
        print("[agent_reach] SDK mode not yet implemented, falling back to empty results")
        return []

    def _parse_result(self, platform: str, item: dict[str, Any]) -> SearchResult:
        """将 Agent Reach 返回的原始数据解析为统一 SearchResult"""
        tags = item.get("tags", [])
        if not isinstance(tags, list):
            tags = []
        return SearchResult(
            platform=platform,
            title=str(item.get("title", "")),
            content=str(item.get("content", item.get("desc", ""))),
            url=str(item.get("url", item.get("link", ""))),
            author=str(item.get("author", item.get("user_name", ""))),
            author_id=str(item.get("author_id", item.get("user_id", ""))),
            likes=_to_int(item.get("likes", item.get("like_count", 0))),
            comments=_to_int(item.get("comments", item.get("comment_count", 0))),
            shares=_to_int(item.get("shares", item.get("share_count", 0))),
            publish_time=str(item.get("publish_time", item.get("created_at", ""))),
            tags=[str(tag) for tag in tags if str(tag).strip()],
            raw=item,
        )

    async def fetch_user_profile(
        self,
        platform: PlatformName,
        user_id: str,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> dict[str, Any]:
        """获取用户画像"""
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
        except Exception as exc:  # noqa: BLE001
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
        """获取帖子/视频详情"""
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
        except Exception as exc:  # noqa: BLE001
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
        """获取平台热搜/趋势"""
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
        except Exception as exc:  # noqa: BLE001
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


agent_reach_tool = AgentReachTool()
