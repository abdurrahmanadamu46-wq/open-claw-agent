# CODEX TASK: MCP 工具权限白名单（ToolPermissionPolicy）

**优先级：P1**  
**来源：TOOLHIVE_BORROWING_ANALYSIS.md P1-#1（ToolHive Tool Permission Policy）**

---

## 背景

我们的龙虾通过 MCP Gateway 调用外部工具，目前缺少工具级权限控制：inkwriter 理论上不应该调用 `execute_shell`，catcher 不应该触碰付款相关工具，任何龙虾都不应该无限制地调用高成本工具。借鉴 ToolHive 的工具权限策略，为每个龙虾角色定义 `ToolPermissionPolicy`，在 MCP Gateway 拦截层强制执行。

---

## 一、核心数据结构

```python
# dragon-senate-saas-v2/mcp_tool_policy.py

from dataclasses import dataclass, field
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class ToolCallLimit:
    """单个工具的调用频率限制"""
    max_calls_per_minute: int = 60       # 每分钟最大调用次数
    max_calls_per_session: int = 200     # 每个龙虾 session 最大调用次数
    max_cost_per_call: float = 0.10      # 单次调用最大成本（美元）


@dataclass
class ToolPermissionPolicy:
    """
    龙虾工具权限策略
    
    控制：某个龙虾角色可以调用哪些工具，以及调用频率
    """
    lobster_name: str
    allowed_tools: list[str]             # 工具白名单（支持通配符 "search_*"）
    denied_tools: list[str] = field(default_factory=list)  # 工具黑名单（优先于白名单）
    limits: dict[str, ToolCallLimit] = field(default_factory=dict)  # 工具级频率限制
    allow_unknown_tools: bool = False    # 是否允许调用白名单之外的工具


# ── 预置的龙虾工具策略 ──────────────────────────────────────────

LOBSTER_TOOL_POLICIES: dict[str, ToolPermissionPolicy] = {

    "commander": ToolPermissionPolicy(
        lobster_name="commander",
        allowed_tools=["*"],             # 指挥官：允许所有工具
        denied_tools=["execute_shell"],  # 但不允许直接执行 shell
        allow_unknown_tools=True,
    ),

    "strategist": ToolPermissionPolicy(
        lobster_name="strategist",
        allowed_tools=["web_search", "web_reader", "news_search", "market_data_*"],
        allow_unknown_tools=False,
    ),

    "inkwriter": ToolPermissionPolicy(
        lobster_name="inkwriter",
        allowed_tools=["web_search", "web_reader", "image_search", "grammar_check"],
        denied_tools=["execute_shell", "file_write", "db_*", "payment_*"],
        allow_unknown_tools=False,
    ),

    "visualizer": ToolPermissionPolicy(
        lobster_name="visualizer",
        allowed_tools=["image_generate", "image_edit", "chart_render", "web_search"],
        allow_unknown_tools=False,
    ),

    "catcher": ToolPermissionPolicy(
        lobster_name="catcher",
        allowed_tools=["web_scraper", "browser_*", "file_read", "api_fetch"],
        denied_tools=["payment_*", "db_write", "execute_shell"],
        limits={
            "web_scraper": ToolCallLimit(max_calls_per_minute=20),
            "browser_*": ToolCallLimit(max_calls_per_minute=10),
        },
        allow_unknown_tools=False,
    ),

    "dispatcher": ToolPermissionPolicy(
        lobster_name="dispatcher",
        allowed_tools=["send_message", "send_email", "send_sms", "webhook_call"],
        limits={
            "send_message": ToolCallLimit(max_calls_per_minute=30),
            "send_email": ToolCallLimit(max_calls_per_minute=10),
            "send_sms": ToolCallLimit(max_calls_per_minute=5),
        },
        allow_unknown_tools=False,
    ),

    "abacus": ToolPermissionPolicy(
        lobster_name="abacus",
        allowed_tools=["calculator", "db_query", "spreadsheet_*", "data_analysis_*"],
        denied_tools=["db_write", "db_delete", "payment_*"],
        allow_unknown_tools=False,
    ),

    "radar": ToolPermissionPolicy(
        lobster_name="radar",
        allowed_tools=["web_search", "news_search", "social_monitor", "trend_analysis"],
        allow_unknown_tools=False,
    ),

    "echoer": ToolPermissionPolicy(
        lobster_name="echoer",
        allowed_tools=["send_message", "voice_synthesize", "translation"],
        limits={
            "send_message": ToolCallLimit(max_calls_per_minute=60),
        },
        allow_unknown_tools=False,
    ),

    "followup": ToolPermissionPolicy(
        lobster_name="followup",
        allowed_tools=["send_message", "send_email", "calendar_*", "crm_*"],
        limits={
            "send_email": ToolCallLimit(max_calls_per_minute=5, max_calls_per_session=20),
        },
        allow_unknown_tools=False,
    ),
}
```

---

## 二、MCP Gateway 拦截层

```python
# dragon-senate-saas-v2/mcp_tool_policy.py（续）

import fnmatch
import time
from collections import defaultdict


class ToolPolicyEnforcer:
    """
    在 MCP Gateway 中间层强制执行工具权限策略
    
    使用方式（在 MCP Gateway 的工具调用处理函数中）：
      enforcer = ToolPolicyEnforcer()
      
      @app.post("/mcp/tools/call")
      async def call_tool(request: ToolCallRequest, ctx = Depends(get_lobster_context)):
          allowed, reason = enforcer.check(
              lobster_name=ctx.lobster_name,
              tool_name=request.tool_name,
              session_id=ctx.session_id,
          )
          if not allowed:
              raise HTTPException(403, detail=reason)
          # 继续执行工具调用...
    """

    def __init__(self):
        self._call_counts: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    def check(
        self,
        lobster_name: str,
        tool_name: str,
        session_id: str = "",
    ) -> tuple[bool, str]:
        """
        检查工具调用是否允许
        
        Returns:
            (allowed: bool, reason: str)
        """
        policy = LOBSTER_TOOL_POLICIES.get(lobster_name)
        if policy is None:
            # 未知龙虾默认拒绝（最小权限原则）
            logger.warning(f"[ToolPolicy] 未知龙虾 {lobster_name} 尝试调用 {tool_name}")
            return False, f"未注册的龙虾角色: {lobster_name}"

        # 1. 检查黑名单（优先）
        for denied in policy.denied_tools:
            if fnmatch.fnmatch(tool_name, denied):
                logger.warning(f"[ToolPolicy] DENY {lobster_name} → {tool_name} (黑名单)")
                return False, f"工具 {tool_name} 在 {lobster_name} 的禁用列表中"

        # 2. 检查白名单
        allowed_by_policy = False
        for allowed in policy.allowed_tools:
            if allowed == "*" or fnmatch.fnmatch(tool_name, allowed):
                allowed_by_policy = True
                break

        if not allowed_by_policy and not policy.allow_unknown_tools:
            logger.warning(f"[ToolPolicy] DENY {lobster_name} → {tool_name} (不在白名单)")
            return False, f"工具 {tool_name} 不在 {lobster_name} 的允许列表中"

        # 3. 检查频率限制
        limit = self._find_limit(policy, tool_name)
        if limit:
            now = time.time()
            key = f"{lobster_name}:{tool_name}"

            # 清理1分钟前的记录
            self._call_counts[key]["minute"] = [
                t for t in self._call_counts[key]["minute"] if now - t < 60
            ]

            if len(self._call_counts[key]["minute"]) >= limit.max_calls_per_minute:
                return False, f"工具 {tool_name} 调用频率超限 ({limit.max_calls_per_minute}/分钟)"

            self._call_counts[key]["minute"].append(now)

        logger.debug(f"[ToolPolicy] ALLOW {lobster_name} → {tool_name}")
        return True, ""

    def _find_limit(self, policy: ToolPermissionPolicy, tool_name: str) -> Optional[ToolCallLimit]:
        """查找适用的频率限制（支持通配符匹配）"""
        for pattern, limit in policy.limits.items():
            if fnmatch.fnmatch(tool_name, pattern):
                return limit
        return None


# 全局单例（MCP Gateway 启动时初始化）
tool_policy_enforcer = ToolPolicyEnforcer()
```

---

## 三、FastAPI 集成点

```python
# dragon-senate-saas-v2/app.py 或 mcp gateway 路由文件

from .mcp_tool_policy import tool_policy_enforcer

@router.post("/mcp/tools/call")
async def mcp_tool_call(
    request: ToolCallRequest,
    ctx = Depends(get_lobster_context),
):
    allowed, reason = tool_policy_enforcer.check(
        lobster_name=ctx.lobster_name,
        tool_name=request.tool_name,
        session_id=ctx.session_id,
    )
    if not allowed:
        # 同时写入审计日志
        await audit_logger.log(
            event_type="tool_call_denied",
            lobster_name=ctx.lobster_name,
            tool_name=request.tool_name,
            reason=reason,
            tenant_id=ctx.tenant_id,
        )
        raise HTTPException(status_code=403, detail=reason)

    # 执行工具调用...
```

---

## 验收标准

- [ ] `LOBSTER_TOOL_POLICIES`：9个龙虾的工具策略全部定义
- [ ] 黑名单优先于白名单
- [ ] 通配符支持（`fnmatch`，如 `"browser_*"`）
- [ ] `ToolPolicyEnforcer.check()`：返回 `(bool, reason_str)`
- [ ] 频率限制：滑动窗口（1分钟内计数）
- [ ] 未知龙虾默认拒绝（最小权限原则）
- [ ] 拒绝时写入 `audit_logger`（`event_type="tool_call_denied"`）
- [ ] 集成到 MCP Gateway 工具调用路由（`/mcp/tools/call` 前置检查）
- [ ] 策略可通过 `dynamic_config.py` 热更新（不重启服务）

---

*Codex Task | 来源：TOOLHIVE_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
