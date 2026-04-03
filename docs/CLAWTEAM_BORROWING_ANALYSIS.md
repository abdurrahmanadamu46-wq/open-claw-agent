# ClawTeam-OpenClaw 借鉴分析报告
> 来源：https://github.com/win4r/ClawTeam-OpenClaw.git
> 分析时间：2026-04-01
> 分析维度：前端Dashboard / 云端大脑 / 9个龙虾多Agent协作 / 支撑微服务 / 云边调度 / 边缘层 / 整体SaaS

---

## 一、ClawTeam 项目总体架构解析

ClawTeam 是一个**多 Claude Agent 本地协作框架**，当前处于 v0.2 阶段（单机文件系统驱动），ROADMAP 规划到 v0.6 多用户/多云。

```
ClawTeam 架构（当前）：
┌─────────────────────────────────────────────┐
│  CLI / Board UI (stdlib HTTP)               │  ← 前端/控制面
├─────────────────────────────────────────────┤
│  TeamManager  │  LifecycleManager           │  ← 云端大脑
│  TaskStore    │  MailboxManager             │  ← 任务/消息总线
├─────────────────────────────────────────────┤
│  Transport Layer (File→P2P ZMQ→Redis路线)   │  ← 云边调度层
│  SpawnBackend (subprocess/tmux/cli)        │
├─────────────────────────────────────────────┤
│  Agent Process 1..N (Claude)               │  ← 边缘执行层
│  spawn/registry.py（CircuitBreaker）        │
├─────────────────────────────────────────────┤
│  SessionStore │ CostTracker │ PlanApproval  │  ← 支撑微服务
└─────────────────────────────────────────────┘
```

---

## 二、逐层借鉴分析

### 2.1 前端 Dashboard（board/server.py）

#### ClawTeam 怎么做：
- 纯 stdlib HTTP Server（BaseHTTPRequestHandler），无框架依赖
- `board/collector.py` 聚合团队状态（任务/消息/成本/成员）
- `board/renderer.py` 渲染 HTML 模板
- board/static/ 存放静态文件
- **内置 HTTPS Proxy**：安全代理 api.github.com / raw.githubusercontent.com，阻止内网 IP 请求

#### 我们现状：
- 已有 `agent-dashboard-server.ts`（TypeScript/Node）
- 已有 `observability_api.py`（FastAPI 20+ 路由）
- 已有 `api_governance_routes.py`

#### 借鉴建议：
| # | 借鉴点 | 价值 | 我们是否已有 |
|---|--------|------|------------|
| F1 | **内置安全 HTTPS Proxy**（防 SSRF，阻止内网 IP） | ⭐⭐⭐ 安全必需 | ❌ 缺失 |
| F2 | Board Collector 模式：聚合所有状态到单一端点 `/api/board` | ⭐⭐ | 部分有（observability_api） |
| F3 | 静态文件嵌入（stdlib 无需 nginx） | ⭐ | 已有 FastAPI StaticFiles |

**结论：F1（安全HTTPS Proxy/SSRF防护）值得借鉴落地。**

---

### 2.2 云端大脑（TeamManager + TaskStore）

#### ClawTeam 怎么做：
- `TeamManager`：Leader/Member 二级角色，`create_team/add_member/remove_member`
- `TaskItem`：任务有 `blocks`/`blocked_by`（DAG 依赖图）、4级优先级（low/medium/high/urgent）
- `BaseTaskStore` 抽象接口：`create/get/update/list_tasks/lock/unlock`
- `TaskLockError`：任务锁（防止多 Agent 并发抢任务）
- **PlanApprovalWorkflow**：Agent 提交执行计划 → Leader 审批 → 通过后才执行

#### 我们现状：
- 已有 `commander_graph_builder.py`（LangGraph 工作流）
- 已有 `lobster_pool_manager.py`（龙虾池管理）
- 已有 `approval_gate.py`（审批门控）
- 已有工作流 14 步执行引擎
- **缺失：任务 DAG 依赖图（blocks/blocked_by）**
- **缺失：任务锁防止多龙虾抢同一任务**

#### 借鉴建议：
| # | 借鉴点 | 价值 | 我们是否已有 |
|---|--------|------|------------|
| B1 | **TaskDAG（blocks/blocked_by）** 龙虾任务依赖编排 | ⭐⭐⭐ | ❌ 缺失 |
| B2 | **TaskLock** 防止多龙虾并发抢同一任务 | ⭐⭐⭐ | ❌ 缺失 |
| B3 | **PlanApproval 工作流**（Agent提计划→Leader审批） | ⭐⭐⭐ | 部分（approval_gate 更简单） |
| B4 | TaskPriority 4级优先级（low/medium/high/urgent） | ⭐⭐ | ❌ 缺失（我们只有 1-10数字） |
| B5 | Leader/Member 角色模型（对应我们的 Coordinator/龙虾） | ⭐⭐ | 有但不够正式 |

**结论：B1+B2 是我们多龙虾协作的核心缺失，必须落地。**

---

### 2.3 9个龙虾 Multi-Agent 协作（MailboxManager + MessageType）

#### ClawTeam 怎么做：
- `MailboxManager`：基于文件/P2P ZMQ 的龙虾间消息收发
- 12种结构化 `MessageType`：message / join_request / join_approved / plan_approval_request / plan_approved / shutdown_request / shutdown_approved / idle / broadcast 等
- **Broadcast 消息**：Leader 向所有 Member 广播（我们缺失）
- `TaskWaiter`：Leader 阻塞等待，每轮：① 收消息 ② 检测死亡 Agent 恢复任务 ③ 检查完成率 → 全部完成或超时退出
- **Dead Agent 自动恢复**：检测到龙虾死亡时，将其 `in_progress` 任务改回 `pending` 重新分配

#### 我们现状：
- 已有 `lobster_event_bus.py`（事件总线）
- 已有 `bridge_protocol.py`（云边桥接协议）
- 已有 `api_lobster_realtime.py`（WebSocket 实时通信）
- **缺失：龙虾间直接消息通信（目前只有云→龙虾单向）**
- **缺失：Dead Agent 自动恢复机制**
- **缺失：Broadcast 广播消息**

#### 借鉴建议：
| # | 借鉴点 | 价值 | 我们是否已有 |
|---|--------|------|------------|
| M1 | **龙虾间 Mailbox 通信**（Lobster→Lobster 直接消息） | ⭐⭐⭐ | ❌ 缺失 |
| M2 | **Dead Agent 自动恢复**（任务重分配） | ⭐⭐⭐ | ❌ 缺失 |
| M3 | **Broadcast 广播**（Coordinator→所有龙虾） | ⭐⭐ | ❌ 缺失 |
| M4 | **TaskWaiter 等待器**（带超时+进度回调的等待循环） | ⭐⭐ | ❌ 缺失 |
| M5 | 12种结构化 MessageType（比我们的事件类型更完整） | ⭐⭐ | 部分有 |

**结论：M1+M2+M4 是龙虾多Agent配合的基础，必须落地。**

---

### 2.4 支撑微服务集群（CircuitBreaker + CostTracker + SessionStore）

#### ClawTeam 怎么做：

**CircuitBreaker（spawn/registry.py）：**
- `AgentHealth`：healthy / degraded / open 三态
- 连续失败 N 次 → open（熔断）→ 冷却期后 half-open → 再试
- `quality_score`：成功率加权分数，指导任务路由
- `is_accepting_tasks` 属性：熔断期拒绝任务

**CostTracker（team/costs.py）：**
- `CostEvent`：每次 LLM 调用记录 agent/model/input_tokens/output_tokens/cost_cents/task_id
- `CostSummary`：团队级聚合（total_cost/by_agent）
- 原子写+文件锁

**SessionStore（spawn/sessions.py）：**
- 每个 Agent 的会话状态持久化（agent_name/team_name/session_id/last_task_id）
- Agent 重启后可从上次任务继续（resume）

#### 我们现状：
- 已有 `llm_call_logger.py`（成本追踪，更完整）✅ 略过
- 已有 `provider_registry.py`（Failover）
- **缺失：龙虾级 Circuit Breaker（健康三态+熔断+质量分）**
- **缺失：龙虾 Session 持久化（重启后恢复上下文）**

#### 借鉴建议：
| # | 借鉴点 | 价值 | 我们是否已有 |
|---|--------|------|------------|
| S1 | **龙虾 CircuitBreaker**（三态健康+连续失败熔断） | ⭐⭐⭐ | ❌ 缺失 |
| S2 | **龙虾 SessionStore**（任务中断后 resume） | ⭐⭐ | ❌ 缺失 |
| S3 | quality_score 权重路由（高分龙虾优先分配任务） | ⭐⭐ | ❌ 缺失 |
| S4 | CostTracker by_agent 分龙虾成本 | ⭐ | 已有（llm_call_logger by_lobster）✅ 略过 |

**结论：S1（CircuitBreaker）是核心，S2（Session resume）重要。**

---

### 2.5 云边调度层（Transport 抽象 + P2P ZMQ）

#### ClawTeam 怎么做：
- `Transport` 抽象接口：`send/receive/peek/peek_count/broadcast`
- `FileTransport`（当前默认）→ `P2PTransport`（ZMQ PUSH/PULL）→ `RedisTransport`（规划中）
- **P2PTransport 核心设计**：
  - PULL socket 绑定随机端口，PUSH socket 连接对端
  - 对端发现：`peers/{agent}.json`（心跳更新，5秒租约）
  - **离线 Fallback**：对端不可达时降级到 FileTransport
  - 心跳线程：每秒注册存活

#### 我们现状：
- 已有 `bridge_protocol.py`（云边 WSS 协议）
- 已有 `edge_heartbeat.py`（边缘心跳）
- 已有 `wss_receiver.py`（WebSocket 接收）
- **我们的方案：云→边 WebSocket，更适合跨网/NAT穿透**
- **ClawTeam P2P ZMQ：适合同局域网，延迟更低**

#### 借鉴建议：
| # | 借鉴点 | 价值 | 我们是否已有 |
|---|--------|------|------------|
| E1 | **离线 Fallback 降级**（P2P不通→自动降级文件/WebSocket） | ⭐⭐⭐ | ❌ 缺失 |
| E2 | **Transport 抽象接口**（可插拔通信层） | ⭐⭐ | 我们是 WSS，已有协议层 |
| E3 | ZMQ PUSH/PULL 低延迟同机多进程通信 | ⭐ | 我们用 WSS，跨网更适合 |
| E4 | Peer 发现心跳（5秒租约自动失效） | ⭐⭐ | 有 edge_heartbeat，机制类似 |

**结论：E1（离线降级Fallback）是我们边缘层需要补充的，其余我们已有更好方案。**

---

### 2.6 边缘执行层（SpawnBackend + 龙虾生命周期）

#### ClawTeam 怎么做：
- `SpawnBackend` 抽象：`spawn(command)/list_running()`
- `subprocess_backend.py`：直接 subprocess 启动 Agent
- `tmux_backend.py`：通过 tmux 窗口管理 Agent（可附加查看输出）
- **LifecycleManager**：优雅关机协议（request/approve/reject/idle），三次握手
- **Snapshot（team/snapshot.py）**：团队状态快照（可导出/恢复整个团队状态）

#### 我们现状：
- 已有 `marionette_executor.py`（边缘任务执行）
- 已有 `context_navigator.py`（浏览器上下文）
- 已有 `edge_heartbeat.py`
- **缺失：优雅关机三次握手协议**
- **缺失：团队状态快照（Snapshot/导出恢复）**

#### 借鉴建议：
| # | 借鉴点 | 价值 | 我们是否已有 |
|---|--------|------|------------|
| L1 | **优雅关机三次握手**（request→approve/reject→cleanup） | ⭐⭐ | ❌ 缺失 |
| L2 | **团队快照**（Snapshot 导出恢复整个工作流状态） | ⭐⭐ | 部分（workflow_event_log） |
| L3 | tmux 后台窗口管理（可随时 attach 查看龙虾输出） | ⭐ | 边缘侧可选 |

---

### 2.7 SaaS 系统整体借鉴

| # | 借鉴点 | 价值 | 我们是否已有 |
|---|--------|------|------------|
| T1 | **SSRF 防护**（Proxy 阻止内网IP/localhost访问） | ⭐⭐⭐ | ❌ 缺失 |
| T2 | **Plan Approval 工作流**（Agent自主规划→主管审批） | ⭐⭐⭐ | 部分 |
| T3 | **atomic_write + file_lock**（原子写防数据损坏） | ⭐⭐ | 部分有 |
| T4 | ROADMAP Phase 规划（File→ZMQ→Redis→多用户渐进演进） | ⭐⭐ | 参考 |

---

## 三、优先级汇总与落地计划

### P0（最高价值，直接影响多龙虾协作）

| 优先级 | 任务ID | 功能 | 落地文件 |
|--------|--------|------|---------|
| P0-1 | B1+B2 | **TaskDAG依赖图 + TaskLock**（龙虾任务依赖编排+防抢任务） | `dragon-senate-saas-v2/lobster_task_dag.py` |
| P0-2 | M1+M2 | **龙虾间 Mailbox + Dead Agent 自动恢复** | `dragon-senate-saas-v2/lobster_mailbox.py` |
| P0-3 | S1 | **龙虾 CircuitBreaker**（三态健康+熔断+quality_score路由） | `dragon-senate-saas-v2/lobster_circuit_breaker.py` |

### P1（重要，完善协作体系）

| 优先级 | 任务ID | 功能 | 落地文件 |
|--------|--------|------|---------|
| P1-4 | M4 | **TaskWaiter 等待器**（带超时+Dead Agent恢复的等待循环） | `dragon-senate-saas-v2/lobster_task_waiter.py` |
| P1-5 | S2 | **龙虾 SessionStore**（断点续跑） | `dragon-senate-saas-v2/lobster_session.py` |
| P1-6 | E1 | **通信离线降级Fallback**（WSS断线→本地文件缓存） | `dragon-senate-saas-v2/transport_fallback.py` |
| P1-7 | T1 | **SSRF 防护中间件** | `dragon-senate-saas-v2/ssrf_guard.py` |

### P2（下一迭代）

| 任务ID | 功能 |
|--------|------|
| B3 | 完整 PlanApproval 工作流（含 Markdown 计划文件+审批历史） |
| L1 | 优雅关机三次握手 |
| L2 | 团队状态 Snapshot（JSON导出）|
| M3 | Broadcast 广播消息 |
| S3 | quality_score 权重任务路由 |

---

## 四、我们明显更好的部分（直接略过）

| 维度 | ClawTeam | 我们 | 结论 |
|------|---------|------|------|
| LLM 成本追踪 | CostEvent（基础） | llm_call_logger（13模型+Trace树+Dashboard） | ✅ 我们更好 |
| 传输层 | File/ZMQ（局域网） | WSS（跨网/NAT穿透/移动网络） | ✅ 我们更好 |
| 龙虾技能体系 | 无（通用 Claude Agent） | 9种专业技能龙虾+14步工作流 | ✅ 我们更好 |
| SaaS 多租户 | 无（单用户本地） | 完整 RBAC+配额+API Key | ✅ 我们更好 |
| 可观测性 | board collector（基础） | Langfuse全链路Trace+EvalRunner | ✅ 我们更好 |
| Prompt 管理 | 无 | prompt_registry 版本管理 | ✅ 我们更好 |
| 边缘计算 | 无（本地subprocess） | edge-runtime 完整云边调度 | ✅ 我们更好 |

---

## 五、关键代码结构参考

### CircuitBreaker 三态转换逻辑（来自 spawn/registry.py）
```python
# healthy → degraded（连续失败 ≥ 2）→ open（连续失败 ≥ threshold）
# open → half-open（冷却后允许一次试探）→ healthy（成功）/ open（再失败）
class HealthState(str, Enum):
    healthy  = "healthy"   # 正常接单
    degraded = "degraded"  # 质量分下降，仍接单但优先级降低
    open     = "open"      # 熔断，拒绝新任务
```

### Mailbox 12种消息类型（来自 team/models.py）
```python
class MessageType(str, Enum):
    message                = "message"           # 普通消息
    join_request           = "join_request"      # 申请加入团队
    join_approved          = "join_approved"     # 批准加入
    plan_approval_request  = "plan_approval_request"  # 提交执行计划
    plan_approved          = "plan_approved"     # 计划批准
    shutdown_request       = "shutdown_request"  # 请求关闭
    shutdown_approved      = "shutdown_approved" # 批准关闭
    idle                   = "idle"              # 龙虾空闲上报
    broadcast              = "broadcast"         # 广播所有成员
```

### TaskDAG 依赖（来自 team/models.py TaskItem）
```python
class TaskItem(BaseModel):
    blocks: list[str] = []      # 本任务完成后才能开始的任务
    blocked_by: list[str] = []  # 依赖的前置任务列表
    # 只有 blocked_by 全部 completed，本任务才能 pending→in_progress
```

---

*分析人：Cline AI | 报告时间：2026-04-01*
