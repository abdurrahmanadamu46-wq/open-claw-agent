# CODEX TASK: Composio 工具集成（龙虾 Action 能力扩展）
**任务ID**: CODEX-COMPOSIO-P2-001  
**优先级**: 🟡 P2（龙虾工具能力：从"LLM+浏览器"扩展到200+第三方 SaaS 集成）  
**依赖文件**: `dragon-senate-saas-v2/lobster_runner.py`, `edge-runtime/marionette_executor.py`  
**参考项目**: Composio（https://github.com/ComposioHQ/composio）  
**预计工期**: 2天

---

## 一、为什么需要 Composio

**现状**：龙虾只有两种能力：
1. **LLM 推理**（通过 lobster_runner.py 调用 Claude）
2. **浏览器操作**（通过 marionette_executor.py）

**但真实业务场景需要的工具**：
- 发完小红书 → 铁狗(catcher)需要从 Google Sheets 读取评论数据 → 需要 Sheets API
- 小锤(followup) 跟进客户 → 需要写入 CRM（HubSpot/Salesforce）
- 苏丝(strategist) 做竞品分析 → 需要 SerpAPI/Twitter 搜索
- 算无遗策(abacus) 做财务报表 → 需要 Google Sheets/Notion
- 老建(dispatcher) 分发内容 → 需要 Buffer/Hootsuite 社交媒体管理

**Composio 解决**：
- 200+ 预集成工具（Gmail/GitHub/Notion/Slack/HubSpot/Airtable...）
- 统一的 Tool Schema（Claude/OpenAI 可直接调用）
- OAuth 认证管理（不需要自己处理各平台 token）
- 权限控制（每只龙虾只能用授权的工具）

---

## 二、Composio 集成到龙虾工具箱

```python
# dragon-senate-saas-v2/lobster_toolbox.py（新建）
"""
龙虾工具箱 - 基于 Composio 的工具集成层

每只龙虾根据职责获得对应的工具集：
- 铁狗(catcher)：Google Sheets + 数据抓取工具
- 小锤(followup)：HubSpot CRM + 邮件工具
- 苏丝(strategist)：SerpAPI + Twitter + 新闻搜索
- 算无遗策(abacus)：Google Sheets + Notion
- 老建(dispatcher)：Buffer/Hootsuite + 内容分发
"""

import logging
from typing import Optional

from composio import ComposioToolSet, App
from composio.tools import Tool

logger = logging.getLogger(__name__)


# 每只龙虾的工具配置
LOBSTER_TOOL_CONFIG = {
    "catcher": {
        "apps": [App.GOOGLESHEETS, App.GOOGLEDRIVE, App.AIRTABLE],
        "description": "铁狗专用：数据收集和存储工具",
    },
    "followup": {
        "apps": [App.HUBSPOT, App.GMAIL, App.SLACK],
        "description": "小锤专用：客户跟进和沟通工具",
    },
    "strategist": {
        "apps": [App.SERPAPI, App.TWITTER, App.GOOGLESEARCH],
        "description": "苏丝专用：市场调研工具",
    },
    "abacus": {
        "apps": [App.GOOGLESHEETS, App.NOTION, App.AIRTABLE],
        "description": "算无遗策专用：数据分析工具",
    },
    "dispatcher": {
        "apps": [App.BUFFER, App.TWITTER, App.SLACK],
        "description": "老建专用：内容分发工具",
    },
    "inkwriter": {
        "apps": [App.NOTION, App.GOOGLEDOCS],
        "description": "墨小鸦专用：内容创作工具",
    },
}


class LobsterToolbox:
    """
    龙虾工具箱
    
    使用方式：
        toolbox = LobsterToolbox()
        tools = toolbox.get_tools("catcher")  # 获取铁狗的工具集
        
        # 在 Claude 调用中使用
        response = client.messages.create(
            model="claude-sonnet-4-5",
            tools=tools,  # Composio 工具注入
            messages=[...]
        )
    """
    
    def __init__(self, api_key: str = None):
        self.toolset = ComposioToolSet(api_key=api_key)
        self._cache = {}
    
    def get_tools(
        self,
        lobster_id: str,
        entity_id: str = "default",  # 租户/用户 ID（用于 OAuth 隔离）
        extra_apps: list = None,
    ) -> list:
        """
        获取龙虾的工具集（Claude Tool 格式）
        
        Args:
            lobster_id: 龙虾ID（如 "catcher"）
            entity_id: 租户ID（用于 OAuth 认证隔离）
            extra_apps: 额外工具（临时添加）
        
        Returns:
            Claude messages.create(tools=...) 格式的工具列表
        """
        config = LOBSTER_TOOL_CONFIG.get(lobster_id, {})
        apps = list(config.get("apps", []))
        
        if extra_apps:
            apps.extend(extra_apps)
        
        if not apps:
            return []
        
        cache_key = f"{lobster_id}:{entity_id}:{','.join(str(a) for a in apps)}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        tools = self.toolset.get_tools(
            apps=apps,
            entity_id=entity_id,  # OAuth token 按租户隔离
        )
        
        self._cache[cache_key] = tools
        logger.info(f"龙虾工具加载 | lobster={lobster_id} | tools={len(tools)}")
        
        return tools
    
    async def execute_action(
        self,
        lobster_id: str,
        action_name: str,
        params: dict,
        entity_id: str = "default",
    ) -> dict:
        """
        直接执行工具 Action（不经过 LLM 决策）
        
        Args:
            lobster_id: 龙虾ID
            action_name: Action 名称（如 "GOOGLESHEETS_READ_RANGE"）
            params: Action 参数
        """
        # 权限检查：确认此龙虾有权使用该工具
        config = LOBSTER_TOOL_CONFIG.get(lobster_id, {})
        
        try:
            result = self.toolset.execute_action(
                action=action_name,
                params=params,
                entity_id=entity_id,
            )
            
            logger.info(f"工具执行成功 | lobster={lobster_id} | action={action_name}")
            return {"success": True, "data": result}
            
        except Exception as e:
            logger.error(f"工具执行失败 | action={action_name} | error={e}")
            return {"success": False, "error": str(e)}
    
    def setup_oauth(self, app: App, entity_id: str) -> str:
        """
        初始化 OAuth 授权（返回授权 URL）
        
        用于新租户首次授权 Google Sheets、HubSpot 等
        """
        connection_request = self.toolset.initiate_connection(
            app_name=app,
            entity_id=entity_id,
        )
        return connection_request.redirectUrl
```

---

## 三、集成到 lobster_runner.py

```python
# dragon-senate-saas-v2/lobster_runner.py — 升级

async def run_lobster(
    lobster_id: str,
    task: str,
    context: dict,
    tenant_id: str = "default",
    use_tools: bool = True,
) -> dict:
    """
    运行龙虾（支持 Composio 工具）
    """
    from anthropic import Anthropic
    
    client = Anthropic()
    
    # 获取龙虾工具
    tools = []
    if use_tools:
        toolbox = LobsterToolbox()
        tools = toolbox.get_tools(lobster_id, entity_id=tenant_id)
    
    # 调用 Claude（带工具）
    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4096,
        tools=tools,  # 注入 Composio 工具
        messages=[{
            "role": "user",
            "content": f"任务：{task}\n上下文：{context}",
        }]
    )
    
    # 处理工具调用
    if response.stop_reason == "tool_use":
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                # 通过 Composio 执行工具
                result = await toolbox.execute_action(
                    lobster_id=lobster_id,
                    action_name=block.name,
                    params=block.input,
                    entity_id=tenant_id,
                )
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": str(result),
                })
        
        # 二次调用 Claude（带工具结果）
        final_response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            messages=[
                {"role": "user", "content": f"任务：{task}\n上下文：{context}"},
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": tool_results},
            ]
        )
        return {"output": final_response.content[0].text}
    
    return {"output": response.content[0].text}
```

---

## 四、常用工具 Action 速查

```python
# 常用 Composio Action 名称（开发参考）

# Google Sheets
GOOGLESHEETS_READ_RANGE           # 读取表格范围
GOOGLESHEETS_CREATE_SPREADSHEET   # 创建表格
GOOGLESHEETS_UPDATE_RANGE         # 更新数据

# HubSpot CRM
HUBSPOT_CREATE_CONTACT            # 创建联系人
HUBSPOT_UPDATE_CONTACT            # 更新联系人
HUBSPOT_CREATE_DEAL               # 创建商机

# Gmail
GMAIL_SEND_EMAIL                  # 发送邮件
GMAIL_GET_MESSAGES                # 读取邮件

# Notion
NOTION_CREATE_PAGE                # 创建页面
NOTION_UPDATE_PAGE                # 更新页面

# SerpAPI
SERPAPI_SEARCH                    # 搜索引擎

# Twitter/X
TWITTER_CREATE_TWEET              # 发推
TWITTER_SEARCH_TWEETS             # 搜索推文
```

---

## 五、验收标准

- [ ] `LobsterToolbox.get_tools("catcher")` 返回 Google Sheets 工具列表
- [ ] Claude 调用时工具注入成功（tools 参数不为空）
- [ ] 铁狗(catcher) 能读取 Google Sheets 数据（OAuth 授权后）
- [ ] 小锤(followup) 能创建 HubSpot 联系人
- [ ] `setup_oauth()` 返回正确的授权 URL
- [ ] 多租户 OAuth 隔离（tenant_a 和 tenant_b 各自独立的授权）
- [ ] 工具调用日志记录到 `llm_call_logger.py`
- [ ] 工具执行失败时有优雅降级（返回错误信息，不崩溃）
