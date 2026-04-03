"""
Tool marketplace for MCP tools.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any


DB_PATH = Path(os.getenv("TOOL_MARKETPLACE_DB", "./data/tool_marketplace.sqlite"))


@dataclass(slots=True)
class ToolListing:
    tool_id: str
    name: str
    description: str
    category: str
    icon: str
    mcp_endpoint: str
    version: str = "1.0.0"
    author: str = "system"
    is_builtin: bool = True
    is_active: bool = True
    monthly_cost_usd: float = 0.0
    created_at: float = field(default_factory=time.time)
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


BUILTIN_TOOL_CATALOG: list[ToolListing] = [
    ToolListing("web_search", "网页搜索", "搜索互联网实时信息", "search", "🔎", "mcp://search.internal/web", tags=["search", "internet"]),
    ToolListing("web_reader", "网页阅读", "读取指定 URL 页面内容", "search", "📄", "mcp://search.internal/reader", tags=["read", "scrape"]),
    ToolListing("image_generate", "图像生成", "AI 生成图像", "write", "🖼️", "mcp://image.internal/generate", monthly_cost_usd=5.0, tags=["image", "ai"]),
    ToolListing("send_email", "发送邮件", "SMTP / 邮件服务发送邮件", "communication", "📧", "mcp://notify.internal/email", tags=["email", "notify"]),
    ToolListing("send_message", "发送消息", "企业 IM / 聊天消息发送", "communication", "💬", "mcp://notify.internal/message", tags=["im", "notify"]),
    ToolListing("db_query", "数据库查询", "查询业务数据库", "data", "🗄️", "mcp://data.internal/query", tags=["database", "query"]),
    ToolListing("edge_file_read", "边缘文件读取", "读取边缘节点本地文件", "edge", "📁", "edge://local/file", tags=["edge", "file"]),
    ToolListing("edge_browser_screenshot", "边缘截图", "抓取边缘浏览器当前截图", "edge", "📸", "edge://local/screenshot", tags=["edge", "browser"]),
    ToolListing("edge_local_db_query", "边缘 SQLite 查询", "查询边缘节点本地 SQLite", "edge", "🧮", "edge://local/sqlite", tags=["edge", "sqlite"]),
]


class ToolMarketplace:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        self._seed_builtins()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _ensure_schema(self) -> None:
        conn = self._conn()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS tool_listings (
                    tool_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    category TEXT DEFAULT '',
                    icon TEXT DEFAULT '',
                    mcp_endpoint TEXT DEFAULT '',
                    version TEXT DEFAULT '1.0.0',
                    author TEXT DEFAULT 'system',
                    is_builtin INTEGER DEFAULT 1,
                    is_active INTEGER DEFAULT 1,
                    monthly_cost_usd REAL DEFAULT 0.0,
                    created_at REAL DEFAULT 0,
                    tags_json TEXT DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_tool_category ON tool_listings(category, is_active);

                CREATE TABLE IF NOT EXISTS tenant_tool_subscriptions (
                    tenant_id TEXT NOT NULL,
                    tool_id TEXT NOT NULL,
                    subscribed_at REAL DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    PRIMARY KEY (tenant_id, tool_id)
                );
                CREATE INDEX IF NOT EXISTS idx_tool_subscriptions_tenant ON tenant_tool_subscriptions(tenant_id, is_active);
                """
            )
            conn.commit()
        finally:
            conn.close()

    def _seed_builtins(self) -> None:
        for listing in BUILTIN_TOOL_CATALOG:
            self.publish(listing)

    def _serialize_listing(self, row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["tags"] = json.loads(data.pop("tags_json", "[]"))
        data["is_builtin"] = bool(data.get("is_builtin"))
        data["is_active"] = bool(data.get("is_active"))
        return data

    def list_all(self, *, category: str | None = None, tag: str | None = None, tenant_id: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM tool_listings WHERE is_active=1"
        params: list[Any] = []
        if category:
            query += " AND category=?"
            params.append(category)
        query += " ORDER BY is_builtin DESC, name ASC"
        conn = self._conn()
        try:
            rows = conn.execute(query, params).fetchall()
            subscribed = self.get_allowed_tool_ids(tenant_id) if tenant_id else set()
            items = []
            for row in rows:
                item = self._serialize_listing(row)
                if tag and tag not in item.get("tags", []):
                    continue
                item["subscribed"] = item["tool_id"] in subscribed if tenant_id else bool(item.get("monthly_cost_usd", 0.0) == 0 or item.get("is_builtin"))
                items.append(item)
            return items
        finally:
            conn.close()

    def publish(self, listing: ToolListing) -> bool:
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO tool_listings (
                    tool_id, name, description, category, icon, mcp_endpoint,
                    version, author, is_builtin, is_active, monthly_cost_usd, created_at, tags_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tool_id) DO UPDATE SET
                    name=excluded.name,
                    description=excluded.description,
                    category=excluded.category,
                    icon=excluded.icon,
                    mcp_endpoint=excluded.mcp_endpoint,
                    version=excluded.version,
                    author=excluded.author,
                    is_builtin=excluded.is_builtin,
                    is_active=excluded.is_active,
                    monthly_cost_usd=excluded.monthly_cost_usd,
                    tags_json=excluded.tags_json
                """,
                (
                    listing.tool_id,
                    listing.name,
                    listing.description,
                    listing.category,
                    listing.icon,
                    listing.mcp_endpoint,
                    listing.version,
                    listing.author,
                    1 if listing.is_builtin else 0,
                    1 if listing.is_active else 0,
                    float(listing.monthly_cost_usd or 0.0),
                    float(listing.created_at),
                    json.dumps(listing.tags, ensure_ascii=False),
                ),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def subscribe(self, tenant_id: str, tool_id: str) -> bool:
        if not self.get_listing(tool_id):
            return False
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO tenant_tool_subscriptions (tenant_id, tool_id, subscribed_at, is_active)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(tenant_id, tool_id) DO UPDATE SET
                    subscribed_at=excluded.subscribed_at,
                    is_active=1
                """,
                (tenant_id, tool_id, time.time()),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def unsubscribe(self, tenant_id: str, tool_id: str) -> bool:
        conn = self._conn()
        try:
            conn.execute(
                "UPDATE tenant_tool_subscriptions SET is_active=0 WHERE tenant_id=? AND tool_id=?",
                (tenant_id, tool_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def list_subscriptions(self, tenant_id: str) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT s.tenant_id, s.tool_id, s.subscribed_at, s.is_active,
                       l.name, l.description, l.category, l.icon, l.version, l.monthly_cost_usd, l.tags_json
                FROM tenant_tool_subscriptions s
                LEFT JOIN tool_listings l ON l.tool_id=s.tool_id
                WHERE s.tenant_id=? AND s.is_active=1
                ORDER BY s.subscribed_at DESC
                """,
                (tenant_id,),
            ).fetchall()
            items = []
            for row in rows:
                item = dict(row)
                item["tags"] = json.loads(item.pop("tags_json", "[]"))
                item["is_active"] = bool(item.get("is_active"))
                items.append(item)
            return items
        finally:
            conn.close()

    def get_listing(self, tool_id: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            row = conn.execute("SELECT * FROM tool_listings WHERE tool_id=?", (tool_id,)).fetchone()
            return self._serialize_listing(row) if row else {}
        finally:
            conn.close()

    def get_tenant_tools(self, tenant_id: str) -> list[dict[str, Any]]:
        allowed = self.get_allowed_tool_ids(tenant_id)
        return [item for item in self.list_all(tenant_id=tenant_id) if item["tool_id"] in allowed]

    def get_allowed_tool_ids(self, tenant_id: str | None) -> set[str]:
        conn = self._conn()
        try:
            free_rows = conn.execute(
                "SELECT tool_id FROM tool_listings WHERE is_active=1 AND (is_builtin=1 OR monthly_cost_usd<=0)",
            ).fetchall()
            allowed = {str(row["tool_id"]) for row in free_rows}
            if not tenant_id:
                return allowed
            sub_rows = conn.execute(
                "SELECT tool_id FROM tenant_tool_subscriptions WHERE tenant_id=? AND is_active=1",
                (tenant_id,),
            ).fetchall()
            allowed.update(str(row["tool_id"]) for row in sub_rows)
            return allowed
        finally:
            conn.close()

    def is_tool_available_for_tenant(self, tenant_id: str | None, tool_id: str) -> bool:
        listing = self.get_listing(tool_id)
        if not listing:
            return True
        return tool_id in self.get_allowed_tool_ids(tenant_id)


_default_marketplace: ToolMarketplace | None = None


def get_tool_marketplace() -> ToolMarketplace:
    global _default_marketplace
    if _default_marketplace is None:
        _default_marketplace = ToolMarketplace()
    return _default_marketplace
