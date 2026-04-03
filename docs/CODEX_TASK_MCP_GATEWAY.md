# CODEX TASK: MCP Gateway — 龙虾接入 MCP 生态

**优先级：P1**  
**来源借鉴：Aurogen `core/tools/mcp.py` + `aurogen_web/src/pages/mcp-page.tsx`**  
**参考分析：`docs/AUROGEN_BORROWING_ANALYSIS.md` 第三节**

---

## 背景

MCP（Model Context Protocol）是 Anthropic 推动的 AI 工具标准协议，2026 年生态快速爆发。  
Aurogen 已原生支持 MCP Server 注册与调用，龙虾池目前缺失此能力。

接入 MCP 后：
- radar虾 → 调用 MCP-Search 获取最新竞品动态
- abacus虾 → 调用 MCP-Database 直接查询客户数据
- catcher虾 → 调用 MCP-CRM 写入 Salesforce/HubSpot
- 龙虾工具能力从"内置 adapter"扩展到"整个 MCP 生态"

---

## 任务目标

在 L2.5 支撑微服务集群增加 MCP Gateway，并为前端提供完整管理页面。

---

## 一、后端：新建 `dragon-senate-saas-v2/mcp_gateway.py`

### 功能要求

```python
# mcp_gateway.py
# MCP Gateway — 龙虾 MCP 工具调用中枢

# 核心类：MCPGateway
# 职责：
#   1. MCP Server 注册（stdio / SSE 两种传输模式）
#   2. 工具发现：列出指定 MCP Server 暴露的所有 tools
#   3. 工具调用：mcp_call(server_id, tool_name, args) → result
#   4. 调用记录：所有调用纳入 audit_logger 和 llm_call_logger
#   5. 健康检查：定期 ping MCP Server，自动标记 unavailable

# MCPServerConfig:
#   id: str                # 唯一 ID
#   name: str              # 显示名称
#   transport: "stdio" | "sse"
#   command: str | None    # stdio 模式：启动命令
#   url: str | None        # sse 模式：HTTP endpoint
#   env: dict              # 环境变量（key/value）
#   enabled: bool
#   created_at: datetime
#   last_ping: datetime | None
#   status: "healthy" | "unavailable" | "unknown"

# MCPToolSchema:
#   server_id: str
#   tool_name: str
#   description: str
#   input_schema: dict     # JSON Schema

# 主要方法：
#   register_server(config: MCPServerConfig) → None
#   unregister_server(server_id: str) → None
#   list_servers() → List[MCPServerConfig]
#   discover_tools(server_id: str) → List[MCPToolSchema]
#   call_tool(server_id: str, tool_name: str, args: dict, lobster_id: str) → dict
#   health_check(server_id: str) → bool

# 持久化：
#   MCP Server 配置写入 dragon-senate-saas-v2/config/mcp_servers.json
#   工具 schema 缓存，TTL 5分钟

# 注意：
#   - 调用前校验 lobster_id 是否有权限调用该 MCP Server（RBAC）
#   - 所有调用写入 audit_logger（operation: "mcp_tool_call"）
#   - 调用耗时、结果摘要写入 llm_call_logger（复用现有接口）
#   - 失败时返回结构化错误，不 raise 异常（保证龙虾任务不中断）
```

### 与 base_lobster.py 集成

在 `dragon-senate-saas-v2/lobsters/base_lobster.py` 增加：

```python
# 在 BaseLobster 类中增加：

async def mcp_call(self, server_id: str, tool_name: str, args: dict) -> dict:
    """
    调用 MCP 工具
    龙虾通过此方法接入第三方 MCP 能力
    
    示例：
        result = await self.mcp_call("mcp-search", "web_search", {"query": "竞品动态"})
    """
    from dragon-senate-saas-v2.mcp_gateway import MCPGateway
    gateway = MCPGateway.get_instance()
    return await gateway.call_tool(server_id, tool_name, args, lobster_id=self.lobster_id)
```

---

## 二、后端 API：新建路由（注册到 `dragon-senate-saas-v2/app.py`）

```
GET    /api/v1/mcp/servers          → 列出所有 MCP Server（含状态）
POST   /api/v1/mcp/servers          → 注册新 MCP Server
DELETE /api/v1/mcp/servers/{id}     → 注销 MCP Server
PUT    /api/v1/mcp/servers/{id}     → 更新配置（enable/disable）
GET    /api/v1/mcp/servers/{id}/tools → 发现工具列表
POST   /api/v1/mcp/servers/{id}/ping  → 手动 health check
POST   /api/v1/mcp/call             → 手动测试调用（仅 admin）
GET    /api/v1/mcp/call/history     → MCP 调用记录
```

响应格式统一使用现有项目约定（参考 `observability_api.py` 风格）。

---

## 三、后端：NestJS 代理层

在 `backend/src/ai-subservice/` 增加 MCP 相关路由代理，透传到 Python FastAPI：

```typescript
// backend/src/ai-subservice/mcp.controller.ts
// 代理 /api/v1/mcp/* 到 Python 服务
// 复用现有 ai-subservice 的认证中间件（operation audit + rate limit）
```

---

## 四、前端：新建 `/operations/mcp` 页面

### 页面结构

```
/operations/mcp
├── MCP Server 列表卡片
│   ├── 状态指示（healthy/unavailable/unknown）
│   ├── 传输类型标签（stdio / sse）
│   ├── 启用/禁用切换
│   └── 操作按钮（查看工具 / Ping / 删除）
├── 注册新 MCP Server 面板（右侧抽屉或 Modal）
│   ├── 名称、传输类型选择
│   ├── stdio：命令输入 + 环境变量 kv 编辑器
│   ├── sse：URL 输入
│   └── 保存按钮
├── 工具浏览视图（点击某个 Server 展开）
│   ├── 工具列表（name + description）
│   └── Input Schema 预览（JSON）
└── 调用记录表格
    ├── 时间 / 龙虾 / Server / 工具 / 耗时 / 状态
    └── 翻页 + 筛选
```

### TypeScript 类型文件

新建 `web/src/types/mcp-gateway.ts`：

```typescript
export interface MCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  url?: string;
  env: Record<string, string>;
  enabled: boolean;
  status: 'healthy' | 'unavailable' | 'unknown';
  created_at: string;
  last_ping?: string;
}

export interface MCPTool {
  server_id: string;
  tool_name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MCPCallRecord {
  id: string;
  lobster_id: string;
  server_id: string;
  tool_name: string;
  args_summary: string;
  result_summary: string;
  duration_ms: number;
  status: 'success' | 'error';
  created_at: string;
}
```

### 前端 API Endpoint

在 `web/src/services/endpoints/ai-subservice.ts` 增加：

```typescript
// MCP Gateway endpoints
export const mcpEndpoints = {
  listServers: () => `/api/v1/mcp/servers`,
  registerServer: () => `/api/v1/mcp/servers`,
  deleteServer: (id: string) => `/api/v1/mcp/servers/${id}`,
  updateServer: (id: string) => `/api/v1/mcp/servers/${id}`,
  discoverTools: (id: string) => `/api/v1/mcp/servers/${id}/tools`,
  pingServer: (id: string) => `/api/v1/mcp/servers/${id}/ping`,
  callHistory: () => `/api/v1/mcp/call/history`,
};
```

---

## 五、导航栏对齐

在 `web/src/app/` 导航配置中，将 `/operations/mcp` 加入 Operations 分组：

```
Operations 菜单
  ├── /operations/skills-pool   ✅ 已有
  ├── /operations/strategy      ✅ 已有
  ├── /operations/scheduler     ✅ 已有
  ├── /operations/workflows     ✅ 已有
  ├── /operations/memory        ✅ 已有
  ├── /operations/usecases      ✅ 已有
  ├── /operations/sessions      ✅ 已有
  ├── /operations/channels      ✅ 已有
  └── /operations/mcp           ← 新增（图标：plug / 插头）
```

---

## 六、PROJECT_CONTROL_CENTER.md 同步更新

完成后在 `PROJECT_CONTROL_CENTER.md` 中：

1. **第三节"当前成熟能力"** 增加：
   ```
   ✅ `mcp_gateway.py` MCP Server 注册/工具发现/调用中心
   ✅ `base_lobster.py` 增加 mcp_call() 方法
   ```

2. **第四节"已完成 API"** 增加：
   ```
   ✅ GET /api/v1/mcp/servers
   ✅ POST /api/v1/mcp/servers
   ✅ DELETE /api/v1/mcp/servers/{id}
   ✅ GET /api/v1/mcp/servers/{id}/tools
   ✅ POST /api/v1/mcp/servers/{id}/ping
   ✅ GET /api/v1/mcp/call/history
   ```

3. **第十节"前端对齐索引"** 增加：
   ```
   | MCP Gateway | GET/POST /api/v1/mcp/* | web/src/types/mcp-gateway.ts | /operations/mcp | ✅ |
   ```

4. **第七节"已落地借鉴清单"** 增加：
   ```
   | Aurogen | MCP Gateway — 龙虾接入 MCP 工具生态 | ✅ | mcp_gateway.py, /operations/mcp |
   ```

---

## 验收标准

- [ ] `mcp_gateway.py` 可注册 stdio 和 sse 两种 MCP Server
- [ ] `base_lobster.py` 有 `mcp_call()` 方法，radar/abacus/catcher 可直接调用
- [ ] 所有 MCP 调用写入 audit_logger
- [ ] 后端 API 6个端点全部通过 Swagger 测试
- [ ] 前端 `/operations/mcp` 页面可正常显示 Server 列表、工具列表、调用记录
- [ ] `PROJECT_CONTROL_CENTER.md` 已同步更新（不遗留旧的"待补"标注）
- [ ] `web/src/types/mcp-gateway.ts` 类型文件存在

---

*Codex Task | 来源：AUROGEN_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
