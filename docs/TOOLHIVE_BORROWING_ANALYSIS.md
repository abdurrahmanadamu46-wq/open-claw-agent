# ToolHive 借鉴分析报告
## https://github.com/stacklok/toolhive.git

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、ToolHive 项目定性

```
ToolHive（Go，Stacklok 出品，MCP 工具编排平台）：
  定位：为 AI Agent 提供安全、可管理的 MCP 工具运行时
  核心能力：
    MCP Server 容器化隔离运行（Docker/Podman）
    工具权限白名单（允许哪些工具、哪些参数）
    工具调用审计日志（谁在什么时间调用了什么工具）
    工具注册中心（Registry，类 Docker Hub 的工具市场）
    工具健康检查 + 自动重启
    网络隔离（每个 MCP Server 只能访问特定端点）
    OIDC/OAuth 认证集成
    CLI + REST API 双模式管理
    多租户工具命名空间隔离
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_MCP_GATEWAY.md 已落地（Aurogen 分析中生成）：
  ✅ MCP 网关基础（工具路由）

CODEX_TASK_RESOURCE_RBAC.md 已落地（Keycloak 分析中生成）：
  ✅ 资源级 RBAC（角色权限控制）

CODEX_TASK_AUDIT_EVENT_TYPES.md 已落地（Keycloak 分析中生成）：
  ✅ 审计事件类型体系

dragon-senate-saas-v2/ssrf_guard.py 已存在：
  ✅ SSRF 防护（限制出站请求）

CODEX_TASK_SLOWMIST_EDGE_AUDIT.md 已落地：
  ✅ 边缘执行审计

CODEX_TASK_DOCKER_ONE_CLICK_DEPLOY.md 已落地：
  ✅ Docker 部署
```

---

## 三、ToolHive 对我们的真实价值

### 核心判断

ToolHive 的核心价值在于**工具安全隔离**：每个 MCP Server 在独立容器中运行，有权限白名单，有调用审计。我们的 `CODEX_TASK_MCP_GATEWAY.md` 已落地了 MCP 网关的路由层，但缺少**工具级安全策略**（哪个龙虾能调用哪些工具、工具参数白名单、工具调用实时监控）。精准差距4个。

---

### 3.1 龙虾层 — MCP 工具权限白名单（Tool Permission Policy）

**ToolHive 工具权限：**
```go
// ToolHive 的工具权限策略（简化示意）
type ToolPermission struct {
    ToolName   string   // 工具名
    AllowedOps []string // 允许的操作：["read", "write"]
    ParamConstraints map[string]string // 参数约束
    MaxCallsPerMin   int              // 调用频率限制
}
```

**对我们的价值：**
```
我们的龙虾通过 MCP Gateway 调用工具，目前缺少工具级权限控制：
  问题：inkwriter 不应该调用 "execute_shell" 工具
        catcher 不应该调用付款相关工具
        任何龙虾都不应该无限制地调用高成本工具

借鉴 ToolHive：
  为每个龙虾角色定义 ToolPermissionPolicy：
    commander: 允许所有工具（指挥官）
    inkwriter: 只允许写作/搜索相关工具
    catcher: 只允许数据抓取工具
    abacus: 只允许计算/查询工具
  
  在 MCP Gateway 拦截层检查调用者身份 + 工具权限
  
  实现位置：dragon-senate-saas-v2/mcp_tool_policy.py
  工程量：1天
```

**优先级：P1**（安全关键，防止龙虾越权调用工具）

---

### 3.2 支撑微服务 — 工具调用实时监控面板（Tool Call Dashboard）

**ToolHive 工具监控：**
```
ToolHive 提供实时工具调用监控：
  - 每个工具被调用次数/分钟
  - 哪个 Agent 调用了哪个工具
  - 工具调用延迟分布
  - 工具调用失败率
  - 工具参数样本（便于调试）
```

**对我们的价值：**
```
我们的 llm_call_logger.py 记录了 LLM 调用，但没有专门的工具调用监控：
  无法回答："这周龙虾调用了多少次 web_search 工具？"
  无法回答："哪个龙虾的工具调用失败率最高？"
  无法回答："最慢的工具是哪个？"

借鉴 ToolHive：
  在 MCP Gateway 中间件记录每次工具调用：
    {lobster_name, tool_name, params_hash, latency_ms, success, tenant_id}
  
  在 dragon_dashboard.html 增加"工具调用"面板：
    - 工具调用排行（Top 10 最频繁工具）
    - 各龙虾工具使用热力图
    - 工具调用失败率趋势图
  
  实现位置：dragon-senate-saas-v2/mcp_tool_monitor.py
  复用：observability_api.py + dragon_dashboard.html
  工程量：1天
```

**优先级：P1**（运维可视化，工具成本分析的前提）

---

### 3.3 云边调度层 — 边缘 MCP 工具隔离运行

**ToolHive 边缘工具运行：**
```
ToolHive 支持在边缘节点运行 MCP Server：
  - MCP Server 以容器方式运行在边缘
  - 云端只看到工具代理接口，不直接接触边缘数据
  - 工具运行结果通过加密通道回传
  - 支持工具离线缓存（边缘网络不稳定时）
```

**对我们的价值：**
```
我们的边缘层（edge-runtime）目前只有任务执行能力：
  marionette_executor.py：执行浏览器自动化任务
  但没有"边缘工具"的概念——边缘节点无法向龙虾提供本地工具

借鉴 ToolHive：
  在边缘节点注册"本地工具"（edge-local MCP tools）：
    edge_file_reader: 读取本地文件（不用上传到云端）
    edge_browser_tool: 本地浏览器截图/交互
    edge_db_query: 本地数据库查询
  
  这些工具通过 WSS 通道反向代理给云端龙虾调用
  龙虾不感知工具在边缘，接口与云端工具一致
  
  实现位置：edge-runtime/edge_mcp_server.py
  工程量：2天（新概念，需要协议设计）
```

**优先级：P2**（边缘工具化升级，价值高但工程量大）

---

### 3.4 SaaS 系统 — 工具市场（Tool Registry / Marketplace）

**ToolHive Tool Registry：**
```
ToolHive 提供工具市场（类 Docker Hub）：
  - 工具发布：开发者可以发布自己的 MCP Server
  - 工具搜索：按类别/功能搜索工具
  - 工具版本管理：工具有版本号，支持锁定版本
  - 一键安装：自动下载并运行工具容器
  - 工具评分：社区评分和使用统计
```

**对我们的价值：**
```
我们的 provider_registry.py 只管理 LLM 提供商，没有工具市场：
  现在龙虾要用新工具，需要手动配置 MCP Gateway
  
  借鉴 ToolHive 工具市场：
    SaaS 管理台增加"工具市场"页面（前端）
    运营可以在市场中上架新工具（含图标、描述、使用示例）
    租户可以在工具市场中"订阅"工具（按租户启用/禁用）
    龙虾的 ToolPermissionPolicy 与工具市场联动
  
  实现位置：
    后端：dragon-senate-saas-v2/tool_marketplace.py
    前端：工具市场页面（shadcn 卡片布局）
  工程量：2天
```

**优先级：P2**（SaaS 商业化价值，支持工具订阅变现）

---

## 四、对比总结

| 维度 | ToolHive | 我们 | 胜负 | 行动 |
|-----|----------|------|------|------|
| **工具权限白名单** | ✅ 完整 | 无（只有 SSRF 防护）| ToolHive 胜 | **P1** |
| **工具调用监控面板** | ✅ | 无专项 | ToolHive 胜 | **P1** |
| **边缘 MCP 工具** | ✅ | 无 | ToolHive 胜 | **P2** |
| **工具市场** | ✅ | 无 | ToolHive 胜 | **P2** |
| MCP 路由/网关 | ✅ | ✅ 已落地 | 平 | — |
| RBAC 权限 | ✅ | ✅ 已落地 | 平 | — |
| 龙虾角色体系 | ❌ | ✅ | 我们胜 | — |
| 多租户记忆 | ❌ | ✅ | 我们胜 | — |

---

## 五、借鉴清单

### P1（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **MCP 工具权限白名单**（按龙虾角色限定可用工具）| 1天 |
| 2 | **工具调用实时监控面板**（Top 工具 + 龙虾热力图）| 1天 |

### P2（2个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 3 | **边缘 MCP 工具**（边缘本地工具反向代理给云端龙虾）| 2天 |
| 4 | **工具市场**（运营上架 + 租户订阅）| 2天 |

---

*分析基于 ToolHive main 分支（2026-04-02）*
