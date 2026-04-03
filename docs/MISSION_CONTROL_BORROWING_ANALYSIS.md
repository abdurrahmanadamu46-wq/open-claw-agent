# OpenClaw Mission Control 借鉴分析报告

> 生成时间: 2026-03-31
> 参考源: github.com/abhi1693/openclaw-mission-control (MIT License)
> 目标: 识别可复用架构模式、对照我们的 dragon-senate-saas-v2 和 edge-runtime

---

## 一、Mission Control 项目全景

### 1.1 定位
Mission Control 是 OpenClaw 的**中央运维与治理平台**，提供：
- 工作编排 (Organization → Board Group → Board → Task)
- Agent 生命周期管理 (provision → online → updating → offline)
- 审批治理 (Approval flow with confidence/rubric scores)
- Gateway 管理 (分布式执行环境连接)
- 活动可见性 (Activity timeline)
- API-first 模型 (REST + WebSocket 双通道)

### 1.2 技术栈
| 层 | 技术 | 我们的对应 |
|---|---|---|
| 后端 | FastAPI + SQLModel + Alembic + PostgreSQL | dragon-senate-saas-v2 (FastAPI) |
| 前端 | Next.js + TypeScript + TailwindCSS | 我们暂无独立前端 |
| 数据库 | PostgreSQL (SQLModel ORM) | 我们用 Redis + 内存 |
| 队列 | RQ (Redis Queue) | 我们暂无任务队列 |
| 部署 | Docker Compose | 我们有 docker-compose.yml |
| 认证 | Local token / Clerk JWT | 我们暂无 |

### 1.3 核心数据模型
```
Organization (租户)
  └── Board Group (分组)
       └── Board (看板/工作空间)
            ├── Task (任务，含状态流转)
            ├── Agent (自治执行者)
            ├── Approval (审批请求)
            ├── Board Memory (上下文记忆)
            └── Board Webhook (外部集成)
  └── Gateway (网关连接)
```

---

## 二、核心架构模式分析

### 2.1 Agent 生命周期管理 (★★★★★ 最高价值)

**Mission Control 的做法：**
```python
class AgentLifecycleOrchestrator:
    # 使用数据库行级锁 (SELECT ... FOR UPDATE) 保证并发安全
    # 状态流转: provisioning → online → updating → offline
    # 每次变更递增 lifecycle_generation 版本号
    # 心跳检测 + checkin_deadline + wake 机制
    # 失败时记录 last_provision_error，不崩溃
```

**对我们的启发：**
- 我们的 `LobsterPoolManager` 管理龙虾生命周期，但缺少：
  - ✅ 版本号 (lifecycle_generation) → 防止过期操作
  - ✅ 行级锁 → 我们是内存操作，可用 asyncio.Lock
  - ❌ 心跳/deadline 检测 → 我们需要添加
  - ❌ 错误记录 → 我们的 lobster 失败后缺少持久化错误日志

**建议动作：**
1. 给 `BaseLobster` 添加 `lifecycle_generation` 字段
2. 给 `LobsterPoolManager` 添加心跳超时检测
3. 给 `LobsterRunner` 添加 `last_error` 持久化

### 2.2 Gateway RPC 协议 (★★★★☆ 高价值)

**Mission Control 的做法：**
- `gateway_rpc.py` 定义标准化 RPC 协议 (PROTOCOL_VERSION, METHODS, EVENTS)
- `gateway_resolver.py` 从 Board→Gateway 解析连接信息
- `gateway_dispatch.py` 统一调度到远端 Gateway
- `session_service.py` 管理 Gateway 会话生命周期

**对我们的启发：**
- 我们的 `wss_receiver.py` (Edge Runtime) 只是 WebSocket 接收器
- Mission Control 的 Gateway 模式更完整：
  - 连接解析 → 指令分发 → 会话管理 → 错误恢复
- 我们可以借鉴其 **协议版本化** 和 **方法/事件注册** 机制

**建议动作：**
1. 给 `wss_receiver.py` 添加协议版本号
2. 定义标准化的 command/event 注册表
3. 参考 `session_service.py` 添加会话状态跟踪

### 2.3 审批治理模型 (★★★★☆ 高价值)

**Mission Control 的做法：**
```python
class Approval:
    action_type: str        # 触发审批的操作类型
    confidence: float       # AI 置信度
    rubric_scores: dict     # 评分维度
    status: "pending|approved|rejected"
    # Board 级配置:
    #   require_approval_for_done
    #   require_review_before_done
    #   block_status_changes_with_pending_approval
```

**对我们的启发：**
- 我们的 `audit_logger.py` 只做日志记录，**不做审批拦截**
- Mission Control 的模式更先进：审批是 first-class 实体，带置信度评分
- 对 SaaS 产品化极其重要：客户需要"AI 做事前人工确认"

**建议动作：**
1. 在 `dragon-senate-saas-v2` 中添加 `Approval` 模型
2. 在 `LobsterRunner` 的关键操作前插入审批检查点
3. 参考其 `confidence + rubric_scores` 设计评分机制

### 2.4 多租户 + 组织模型 (★★★☆☆ 中等价值)

**Mission Control 的做法：**
- `TenantScoped` 基类为所有模型添加租户隔离
- Organization → Member → Invite 完整的组织管理
- Board 级别的 `max_agents` 限制

**对我们的启发：**
- 我们目前是单租户设计
- 如果要 SaaS 化，这套多租户基础设施是必需的
- 但现阶段优先级较低，可以后期再加

### 2.5 Board Memory (上下文记忆) (★★★★☆ 高价值)

**Mission Control 模型中有：**
- `board_memory.py` - Board 级别的持久化记忆
- `board_group_memory.py` - 跨 Board 的共享记忆
- `board_onboarding.py` - Agent 加入时的上下文注入

**对我们的启发：**
- 我们的 `memory_consolidator.py` 做内存合并
- Mission Control 的记忆模型是**分层的** (Board 级 + Group 级)
- 对照我们的语义搜索 Codex 任务，这个模式很有参考价值

**建议动作：**
1. 参考其分层记忆设计，扩展 `memory_consolidator.py`
2. 添加 "onboarding context" 机制给新创建的 Lobster

### 2.6 前端架构 (★★★☆☆ 参考价值)

**Mission Control 的做法：**
- Next.js App Router
- `orval` 自动生成 API 客户端 (从 OpenAPI schema)
- Cypress E2E 测试 + Vitest 单元测试
- TailwindCSS 样式

**对我们的启发：**
- 我们的 `docs/FRONTEND_CODEX_HANDOFF.md` 已规划前端
- 可以直接参考其前端目录结构和工具链选型
- `orval` API 客户端自动生成是很好的实践

---

## 三、对照映射表

| Mission Control 概念 | 我们的对应 | 差距 | 优先级 |
|---|---|---|---|
| Organization | - (单租户) | 缺失，SaaS化需要 | P2 |
| Board Group | - | 缺失 | P3 |
| Board | DragonSenate (会话) | 部分对应 | P1 |
| Task | Lobster 任务 | 结构不同 | P1 |
| Agent | Lobster (龙虾) | 核心对应 | P0 |
| Approval | audit_logger (仅日志) | 需升级为审批 | P1 |
| Gateway | wss_receiver | 需要协议化 | P1 |
| Board Memory | memory_consolidator | 需要分层 | P2 |
| Activity Log | audit_logger | 基本对应 | P2 |
| Agent Lifecycle | LobsterPoolManager | 需加强 | P0 |
| Skills Marketplace | provider_registry | 概念类似 | P2 |
| Souls Directory | - | 缺失 | P3 |

---

## 四、可直接提取的代码模式

### 4.1 立即可用 (不需大改)

1. **协议版本化** - 给 WSS 通信加 `PROTOCOL_VERSION`
2. **Agent Token 认证** - `mint_agent_token()` + `agent_token_hash` 模式
3. **心跳 + Deadline** - `checkin_deadline_at` + `last_seen_at` 模式
4. **错误持久化** - `last_provision_error` 字段

### 4.2 中期可借鉴 (需要适配)

1. **审批流** - Approval 模型 + Board 级审批策略
2. **生命周期编排器** - `AgentLifecycleOrchestrator` 的状态机模式
3. **Gateway 解析器** - 从配置解析到连接的标准化流程
4. **队列化生命周期调和** - `enqueue_lifecycle_reconcile` 异步调和

### 4.3 长期参考 (架构级)

1. **多租户隔离** - `TenantScoped` 基类模式
2. **前端自动化** - `orval` API 客户端生成
3. **分层记忆** - Board Memory + Board Group Memory

---

## 五、推荐的 Codex 任务

### CODEX-MC-01: Agent 心跳与生命周期增强
```
目标: 给 LobsterPoolManager 添加 Mission Control 级别的生命周期管理
范围: edge-runtime/ + dragon-senate-saas-v2/
关键文件:
  - 参考: _ref_mission_control/backend/app/services/openclaw/lifecycle_orchestrator.py
  - 修改: dragon-senate-saas-v2/lobster_pool_manager.py
  - 修改: dragon-senate-saas-v2/lobsters/base_lobster.py
具体任务:
  1. BaseLobster 添加 lifecycle_generation, last_seen_at, checkin_deadline_at
  2. LobsterPoolManager 添加心跳检测循环
  3. LobsterRunner 添加 last_error 记录
算力等级: 中
```

### CODEX-MC-02: WSS 协议标准化
```
目标: 给 wss_receiver.py 添加协议版本化和命令注册表
范围: edge-runtime/
关键文件:
  - 参考: _ref_mission_control/backend/app/services/openclaw/gateway_rpc.py
  - 修改: edge-runtime/wss_receiver.py
具体任务:
  1. 定义 PROTOCOL_VERSION 和 SUPPORTED_METHODS/EVENTS
  2. 添加协议协商握手
  3. 命令分发使用注册表模式替代硬编码
算力等级: 低
```

### CODEX-MC-03: 审批流集成
```
目标: 在关键操作前添加审批检查点
范围: dragon-senate-saas-v2/
关键文件:
  - 参考: _ref_mission_control/backend/app/models/approvals.py
  - 新建: dragon-senate-saas-v2/approval_manager.py
具体任务:
  1. 创建 Approval 数据模型
  2. 在 LobsterRunner 的 execute_task 中添加审批检查
  3. 添加审批 API 端点
算力等级: 中
```

---

## 六、信息分类

### ✅ 已确认事实
- Mission Control 使用 FastAPI + SQLModel + PostgreSQL + Next.js 技术栈
- Agent 生命周期有完整的状态机 (provisioning → online → updating → offline)
- 审批是 first-class 实体，带置信度评分
- Gateway 有标准化 RPC 协议
- MIT 开源协议，可自由借鉴

### 🔶 合理推测
- 其 Gateway 模式应该可以适配我们的 WSS 通信层
- 其审批模式可以增强我们的 SaaS 商业化价值
- 其前端架构可以作为我们 FRONTEND_CODEX_HANDOFF 的参考

### ❓ 待确认信息
- Mission Control 的 WebSocket 协议具体格式 (需要进一步看 gateway_rpc.py)
- 其 Board Memory 的具体存储格式和查询方式
- 是否有 SDK 或客户端库可以直接集成

---

## 七、交接摘要

**本文档总结了对 openclaw-mission-control 项目的深度分析。**

核心发现：
1. Mission Control 是一个**成熟的 Agent 运维平台**，架构设计值得借鉴
2. **最高价值借鉴点**：Agent 生命周期管理、审批治理、Gateway 协议化
3. **三个 Codex 任务已定义**：心跳增强(MC-01)、协议标准化(MC-02)、审批流(MC-03)
4. 与我们的系统对照，**核心差距在生命周期管理和审批流**，不在功能覆盖面

临时目录 `_ref_mission_control/` 可在分析完成后删除以节省磁盘空间。
