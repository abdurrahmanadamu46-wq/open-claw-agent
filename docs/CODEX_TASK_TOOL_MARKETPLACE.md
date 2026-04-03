# CODEX TASK: MCP 工具市场（Tool Marketplace）

**优先级：P2**  
**来源：TOOLHIVE_BORROWING_ANALYSIS.md P2-#4（ToolHive Tool Registry）**

---

## 背景

我们的 `provider_registry.py` 只管理 LLM 提供商，没有工具市场。龙虾要用新工具，需要手动配置 MCP Gateway。借鉴 ToolHive 工具市场（类 Docker Hub），新增工具注册中心：运营上架工具（含描述/图标），租户可以订阅工具，龙虾的 ToolPermissionPolicy 与工具市场联动。

---

## 实现

```python
# dragon-senate-saas-v2/tool_marketplace.py

from dataclasses import dataclass, field
from typing import Optional
import logging
import time

logger = logging.getLogger(__name__)


@dataclass
class ToolListing:
    """工具市场上架条目"""
    tool_id: str            # 唯一标识，如 "web_search_v2"
    name: str               # 显示名称
    description: str        # 工具描述
    category: str           # 分类：search / write / data / communication / edge
    icon: str               # emoji 或 CDN URL
    mcp_endpoint: str       # MCP Server 端点（运行时地址）
    version: str = "1.0.0"
    author: str = "system"
    is_builtin: bool = True  # 内置工具 vs 社区工具
    is_active: bool = True
    monthly_cost_usd: float = 0.0  # 工具月费（0 = 免费）
    created_at: float = field(default_factory=time.time)
    tags: list[str] = field(default_factory=list)


# 内置工具目录（系统预置）
BUILTIN_TOOL_CATALOG: list[ToolListing] = [
    ToolListing("web_search", "网页搜索", "搜索互联网获取实时信息", "search",
                "🔍", "mcp://search.internal/web", tags=["search", "internet"]),
    ToolListing("web_reader", "网页阅读", "读取指定URL的网页内容", "search",
                "📄", "mcp://search.internal/reader", tags=["read", "scrape"]),
    ToolListing("image_generate", "图像生成", "AI生成图片（DALL-E/Stable Diffusion）", "write",
                "🎨", "mcp://image.internal/gen", monthly_cost_usd=5.0, tags=["image", "ai"]),
    ToolListing("send_email", "发送邮件", "通过SMTP/SendGrid发送邮件", "communication",
                "📧", "mcp://notify.internal/email", tags=["email", "notify"]),
    ToolListing("send_message", "发送IM消息", "发送企业微信/飞书/钉钉消息", "communication",
                "💬", "mcp://notify.internal/im", tags=["im", "notify"]),
    ToolListing("db_query", "数据库查询", "查询企业数据库", "data",
                "🗄️", "mcp://data.internal/query", tags=["database", "query"]),
    ToolListing("edge_file_read", "边缘文件读取", "读取边缘节点本地文件", "edge",
                "📁", "edge://local/file", tags=["edge", "file"]),
]


class ToolMarketplace:
    """
    MCP 工具市场
    
    管理：工具上架 / 租户订阅 / 与 ToolPermissionPolicy 联动
    
    使用方式：
      marketplace = ToolMarketplace(db)
      
      # 运营上架工具
      marketplace.publish(ToolListing(...))
      
      # 租户订阅工具
      marketplace.subscribe(tenant_id, tool_id)
      
      # 查询租户可用工具
      tools = marketplace.get_tenant_tools(tenant_id)
    """

    def __init__(self, db):
        self.db = db
        self._catalog: dict[str, ToolListing] = {
            t.tool_id: t for t in BUILTIN_TOOL_CATALOG
        }

    def list_all(self, category: str = None, tag: str = None) -> list[ToolListing]:
        """列出所有工具（可按分类/标签过滤）"""
        tools = [t for t in self._catalog.values() if t.is_active]
        if category:
            tools = [t for t in tools if t.category == category]
        if tag:
            tools = [t for t in tools if tag in t.tags]
        return sorted(tools, key=lambda t: t.name)

    def publish(self, listing: ToolListing) -> bool:
        """运营/开发者上架工具"""
        self._catalog[listing.tool_id] = listing
        self.db.upsert("tool_listings", vars(listing))
        logger.info(f"[ToolMarket] 上架工具: {listing.tool_id} v{listing.version}")
        return True

    def subscribe(self, tenant_id: str, tool_id: str) -> bool:
        """租户订阅工具"""
        if tool_id not in self._catalog:
            return False
        self.db.upsert("tenant_tool_subscriptions", {
            "tenant_id": tenant_id,
            "tool_id": tool_id,
            "subscribed_at": time.time(),
            "is_active": True,
        })
        logger.info(f"[ToolMarket] 租户 {tenant_id} 订阅工具: {tool_id}")
        return True

    def unsubscribe(self, tenant_id: str, tool_id: str):
        """取消订阅"""
        self.db.update("tenant_tool_subscriptions",
                       {"is_active": False},
                       where={"tenant_id": tenant_id, "tool_id": tool_id})

    def get_tenant_tools(self, tenant_id: str) -> list[ToolListing]:
        """获取租户已订阅的工具列表"""
        subs = self.db.query(
            "tenant_tool_subscriptions",
            where={"tenant_id": tenant_id, "is_active": True},
        )
        tool_ids = {s["tool_id"] for s in subs}
        # 始终包含免费内置工具
        free_builtins = {t.tool_id for t in BUILTIN_TOOL_CATALOG if t.monthly_cost_usd == 0}
        all_tool_ids = tool_ids | free_builtins
        return [self._catalog[tid] for tid in all_tool_ids if tid in self._catalog]

    def get_allowed_tool_ids(self, tenant_id: str) -> set[str]:
        """快速返回租户可用工具 ID 集合（供 ToolPermissionPolicy 校验）"""
        return {t.tool_id for t in self.get_tenant_tools(tenant_id)}
```

---

## 前端页面结构（工具市场页）

```
/tools/marketplace
  ├── 左侧分类导航：全部 / 搜索 / 写作 / 数据 / 通讯 / 边缘
  ├── 工具卡片列表（shadcn Card 布局）
  │     每张卡片：图标 + 名称 + 描述 + 版本 + 订阅状态 + 月费
  ├── 已订阅工具管理（/tools/my-tools）
  │     表格：工具名 / 订阅时间 / 状态 / 取消订阅
  └── 工具详情页（/tools/:tool_id）
        描述 / 使用示例 / 适用龙虾角色 / 订阅按钮
```

---

## 验收标准

- [ ] `ToolListing` 数据结构：工具 ID / 名称 / 分类 / 图标 / MCP 端点 / 月费
- [ ] `BUILTIN_TOOL_CATALOG`：7个内置工具预置
- [ ] `ToolMarketplace.publish()`：运营上架工具
- [ ] `ToolMarketplace.subscribe()` / `unsubscribe()`：租户订阅管理
- [ ] `ToolMarketplace.get_tenant_tools()`：含免费内置 + 租户订阅
- [ ] `get_allowed_tool_ids()`：供 `ToolPermissionPolicy` 动态校验
- [ ] REST API：`GET /api/v1/tools/marketplace` / `POST /api/v1/tools/subscribe`
- [ ] 前端工具市场页面（shadcn 卡片布局，含分类过滤）

---

*Codex Task | 来源：TOOLHIVE_BORROWING_ANALYSIS.md P2-#4 | 2026-04-02*
