# OpenClaw Agent 项目交接报告
**交接时间**：2026-04-02  
**交接对象**：下一任项目负责人  
**项目仓库**：`f:/openclaw-agent`（当前部署在此电脑上）  
**远程仓库**：https://github.com/abdurrahmanadamu46-wq/open-claw-agent.git

---

## 一、你接手的是什么

一句话：**一个面向中文社交媒体市场的 AI 自动营销 SaaS 平台**。

产品定位是"一人公司的 AI 战队"——系统的核心是 **10 只龙虾**（不是通用 Agent，是有人格、有名字、有专属技能的具体实体），它们组成"龙虾元老院"（Dragon Senate），协作完成从信号发现、策略制定、内容创作、分发执行到线索跟进的完整闭环。

**当前状态**：10 只龙虾和整个 SaaS 系统**目前就部署在这台电脑上**（`f:/openclaw-agent`），之后会迁移到云端服务器。

**商业模型**：SaaS 按席位/功能分级订阅，目标客群是中小内容团队、MCN 机构、跨境电商运营。

---

## 二、系统架构速览（5分钟读懂）

```
┌─────────────────────────────────────────────────────────┐
│                    SaaS 前端（用户侧）                    │
│      dragon_dashboard.html  +  Next.js 控制台             │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────────────┐
│          龙虾元老院（Dragon Senate SaaS v2）              │
│          ⚠️ 当前跑在本机，计划迁移到云端                    │
│                                                         │
│  ┌──────────┐  ┌──────────────────────────────────────┐ │
│  │ 大脑     │  │  10 只龙虾（每只有独立人格/技能/工件）   │ │
│  │ LangGraph│  │                                      │ │
│  │ 编排图   │  │  #0 commander 元老院总脑（编排仲裁）   │ │
│  │          │  │  #1 radar     触须虾（信号发现）       │ │
│  └──────────┘  │  #2 strategist 脑虫虾（策略规划）     │ │
│                │  #3 inkwriter  吐墨虾（文案创作）      │ │
│                │  #4 visualizer 幻影虾（视觉创作）      │ │
│                │  #5 dispatcher 点兵虾（分发调度）      │ │
│                │  #6 echoer     回声虾（互动回复）      │ │
│                │  #7 catcher    铁网虾（线索捕获）      │ │
│                │  #8 abacus     金算虾（效果归因）      │ │
│                │  #9 followup   回访虾（跟进成交）      │ │
│                └──────────────────────────────────────┘ │
│                                                         │
│  支撑组件：task_queue / lobster_mailbox / lobster_dag /   │
│  circuit_breaker / quota_middleware / llm_call_logger / │
│  artifact_store / observability_api / saas_billing / ...│
└──────────────────────┬──────────────────────────────────┘
                       │ WSS 长连接（bridge_protocol.py）
┌──────────────────────▼──────────────────────────────────┐
│               边缘执行层（用户的设备）                     │
│                                                         │
│  wss_receiver.py → context_navigator.py                │
│        → marionette_executor.py（Playwright 浏览器自动化） │
│        → edge_heartbeat.py（心跳上报）                    │
└─────────────────────────────────────────────────────────┘
```

**关键理解**：
- 龙虾元老院是"大脑+策略"层，边缘是"执行手"
- 两端通过 WebSocket 长连接通讯
- 龙虾不直接操控浏览器，只生成指令包和内容工件
- 边缘不做业务判断，只执行 dispatcher 下发的 ExecutionPlan

---

## 三、10 只龙虾是谁（权威定义）

> **⚠️ 龙虾不是 Agent！** 龙虾是有人格、有名字、有专属技能树和战斗日志的具体实体。每只龙虾有独立的知识库、训练计划、技能注册表。权威定义文件：`docs/LOBSTER_ROSTER_CANONICAL.md`。

| # | canonical_id | 中文名 | 主职责 | 核心工件 | Python 文件 |
|---|-------------|--------|--------|---------|------------|
| 0 | **commander** | 元老院总脑 | 编排所有龙虾、仲裁冲突、异常处理、复盘 | `MissionPlan` | `commander_router.py` + `commander_graph_builder.py` |
| 1 | **radar** | 触须虾 | 信号发现（热点、竞品、舆情） | `SignalBrief` | `lobsters/radar.py` |
| 2 | **strategist** | 脑虫虾 | 策略规划（排期、预算、实验） | `StrategyRoute` | `lobsters/strategist.py` |
| 3 | **inkwriter** | 吐墨虾 | 文案创作（小红书/抖音/快手）、合规改写 | `CopyPack` | `lobsters/inkwriter.py` |
| 4 | **visualizer** | 幻影虾 | 视觉创作（分镜、封面、字幕） | `StoryboardPack` | `lobsters/visualizer.py` |
| 5 | **dispatcher** | 点兵虾 | 分发调度（账号×内容×时间窗映射） | `ExecutionPlan` | `lobsters/dispatcher.py` |
| 6 | **echoer** | 回声虾 | 互动承接（评论回复、私信） | `EngagementReplyPack` | `lobsters/echoer.py` |
| 7 | **catcher** | 铁网虾 | 线索捕获（评分、CRM 入库、去重） | `LeadAssessment` | `lobsters/catcher.py` |
| 8 | **abacus** | 金算虾 | 效果归因（ROI、转化漏斗、反馈回写） | `ValueScoreCard` | `lobsters/abacus.py` |
| 9 | **followup** | 回访虾 | 多触点跟进（唤醒、成交回写） | `FollowUpActionPlan` | `lobsters/followup.py` |

### 龙虾协作流水线

```
用户意图 → commander 拆任务
  → radar 扫信号 → strategist 定策略
  → inkwriter 写文案 → visualizer 出视觉
  → dispatcher 排计划 → 边缘节点执行
  → echoer 回互动 → catcher 抓线索
  → abacus 算归因 → followup 跟成交
  → commander 总复盘
```

### 每只龙虾的知识库位置（在本机）

```
f:/openclaw-agent/docs/lobster-kb/
├── commander/     → study_plan.json, training_plan.json
├── radar/         → skills.json, battle_log.json, study_plan.json, training_plan.json
├── strategist/    → skills.json, battle_log.json, study_plan.json, training_plan.json
├── inkwriter/     → skills.json, battle_log.json, study_plan.json, training_plan.json
├── visualizer/    → skills.json, battle_log.json, training_plan.json
├── dispatcher/    → skills.json, battle_log.json
├── echoer/        → skills.json, battle_log.json, study_plan.json, training_plan.json
├── catcher/       → skills.json, battle_log.json, study_plan.json, training_plan.json
├── abacus/        → skills.json, battle_log.json, study_plan.json, training_plan.json
└── followup/      → skills.json, battle_log.json, study_plan.json, training_plan.json
```

每只龙虾还有人格档案（`docs/lobster-kb/[name]-[人格]-kb.md`），比如：
- `commander-chen-kb.md`（陈指挥）
- `radar-lintao-kb.md`（林涛）
- `strategist-susi-kb.md`（苏思）
- `inkwriter-moxiaoya-kb.md`（木小芽）
- `visualizer-shadow-kb.md`（影子）
- `dispatcher-laojian-kb.md`（老健）
- `echoer-asheng-kb.md`（阿声）
- `catcher-tiegou-kb.md`（铁狗）
- `abacus-suanwuyice-kb.md`（算无遗策）
- `followup-xiaochui-kb.md`（小催）

---

## 四、当前部署状态

### ⚠️ 重要：一切都在这台电脑上

| 组件 | 当前位置 | 计划迁移到 |
|------|---------|-----------|
| 10 只龙虾 + 大脑 | `f:/openclaw-agent/dragon-senate-saas-v2/` | 云端服务器（Docker） |
| 龙虾知识库 | `f:/openclaw-agent/docs/lobster-kb/` | 云端持久化存储 |
| 边缘执行层 | `f:/openclaw-agent/edge-runtime/` | 客户设备 |
| SaaS 前端 | `f:/openclaw-agent/dragon-senate-saas-v2/dragon_dashboard.html` | Vercel / 云端 |
| 所有 CODEX 文档 | `f:/openclaw-agent/docs/` | 跟仓库走 |

---

## 五、关键文件地图（必看）

### 5.1 项目总控

| 文件 | 作用 |
|------|------|
| `PROJECT_CONTROL_CENTER.md` | **最重要的文件**，项目全貌一览 |
| `SYSTEM_ARCHITECTURE_OVERVIEW.md` | 系统架构深度说明（v4.3） |
| `docs/LOBSTER_ROSTER_CANONICAL.md` | **10只龙虾权威编制表**（任何龙虾相关信息以此为准） |
| `docs/LOBSTER_CONSTITUTION.md` | 龙虾宪法（soul 修改规则） |
| `AGENTS.md` | AI 协作规范 |
| `docs/CODEX_MASTER_INDEX_2026-04-01.md` | 所有 Codex 任务的总索引 |

### 5.2 龙虾核心代码

| 文件 | 说明 |
|------|------|
| `dragon-senate-saas-v2/lobster_runner.py` | **核心**：龙虾调度执行引擎 |
| `dragon-senate-saas-v2/commander_graph_builder.py` | LangGraph 图构建（commander 的编排流） |
| `dragon-senate-saas-v2/lobster_mailbox.py` | 龙虾间消息传递（Mailbox 模式） |
| `dragon-senate-saas-v2/lobster_task_dag.py` | 龙虾任务 DAG 依赖管理 |
| `dragon-senate-saas-v2/lobster_circuit_breaker.py` | 龙虾熔断器（异常保护） |
| `dragon-senate-saas-v2/lobster_session.py` | 龙虾会话管理 |
| `dragon-senate-saas-v2/lobster_clone_manager.py` | 龙虾克隆管理（多租户复制） |
| `dragon-senate-saas-v2/lobster_evolution_engine.py` | 龙虾进化引擎（经验积累） |
| `dragon-senate-saas-v2/lobster_voice_style.py` | 龙虾语音风格 |
| `dragon-senate-saas-v2/lobster_im_channel.py` | 龙虾 IM 通道 |

### 5.3 SaaS 支撑

| 文件 | 说明 |
|------|------|
| `dragon-senate-saas-v2/app.py` | FastAPI 应用入口 |
| `dragon-senate-saas-v2/bridge_protocol.py` | 云边 WSS 通讯协议 |
| `dragon-senate-saas-v2/provider_registry.py` | LLM Provider 注册表 |
| `dragon-senate-saas-v2/saas_billing.py` | 计费系统 |
| `dragon-senate-saas-v2/rbac_permission.py` | 角色权限控制 |
| `dragon-senate-saas-v2/tenant_audit_log.py` | 多租户审计日志 |
| `dragon-senate-saas-v2/llm_call_logger.py` | LLM 调用日志 |
| `dragon-senate-saas-v2/quota_middleware.py` | 配额限制 |

### 5.4 边缘执行层

| 文件 | 说明 |
|------|------|
| `edge-runtime/wss_receiver.py` | WSS 消息接收 |
| `edge-runtime/context_navigator.py` | 页面上下文导航 |
| `edge-runtime/marionette_executor.py` | Playwright 浏览器自动化执行 |
| `edge-runtime/edge_heartbeat.py` | 心跳上报 |

---

## 六、文档体系（Docs 目录）

`docs/` 下有 **200+ 个文件**，分三类：

### 类型 A：借鉴分析报告（`*_BORROWING_ANALYSIS.md`）
对 50+ 外部开源项目的逐层分析。已分析清单见 `BORROWING_GAP_ANALYSIS_2026-04-01.md`。

### 类型 B：Codex 任务卡（`CODEX_TASK_*.md`）
每张卡是一个待实现功能的完整规格（含背景/代码示例/验收标准），相当于"施工图"。

### 类型 C：龙虾专属文档
- `LOBSTER_ROSTER_CANONICAL.md` — 权威编制表
- `LOBSTER_CONSTITUTION.md` — 龙虾宪法
- `LOBSTER_GROWTH_HANDBOOK.md` — 龙虾成长手册
- `lobster-kb/LOBSTER_KB_CONSTITUTION.md` — 知识库宪法
- `lobster-kb/DEVIL_TRAINING_CONSTITUTION.md` — 魔鬼训练宪法
- `lobster-kb/SKILL_SCHEMA_V3.json` — 技能 Schema 定义

---

## 七、当前进度和积压任务

### 已落地

**龙虾体系**：
- ✅ 10 只龙虾完整编制（人格/KB/skills/battle_log/训练计划）
- ✅ LangGraph Commander 编排图
- ✅ 龙虾 Mailbox 通讯 + DAG 依赖
- ✅ 龙虾熔断器 + 会话管理 + 进化引擎
- ✅ 龙虾克隆管理（多租户）

**SaaS 层**：
- ✅ 多租户 RBAC + 审计 + 计费
- ✅ 多 Provider 注册表 + 可观测性
- ✅ 工作流 YAML 引擎 + SSRF 防护

**边缘层**：
- ✅ WSS 双向通讯 + Playwright 执行 + 心跳

### P1 待实现（有完整 Codex Task）

| 任务卡 | 描述 | 工期 |
|--------|------|------|
| `CODEX_TASK_GOLUTRA_BRIDGE_PIPELINE.md` | 边缘消息 5 层管道 | 1天 |
| `CODEX_TASK_GOLUTRA_EDGE_OUTBOX.md` | 边缘消息发件箱 | 1天 |
| `CODEX_TASK_LANGGRAPH_BRAIN.md` | LangGraph 大脑升级 | 2天 |
| `CODEX_TASK_EDGE_LITE_LOBSTER_CORE.md` | 边缘轻量龙虾 | 3天 |
| `CODEX_TASK_SEAT_SUBSCRIPTION_BILLING.md` | 席位订阅计费 | 2天 |

---

## 八、研发工作流

### 如何新增功能
1. 先写借鉴分析（如有外部参考）：`docs/XXX_BORROWING_ANALYSIS.md`
2. 再写 Codex Task：`docs/CODEX_TASK_XXX.md`
3. 实现代码
4. 更新 `PROJECT_CONTROL_CENTER.md`

### AI 协作规范
- 每次会话开始让 AI 先读 `PROJECT_CONTROL_CENTER.md`
- 龙虾相关改动必须对齐 `LOBSTER_ROSTER_CANONICAL.md`
- **禁止**把龙虾叫"Agent"——它们有名字，用名字或 canonical_id 称呼

### 龙虾知识库维护
- 每次龙虾完成新任务 → 记录到 `battle_log.json`
- 每次学会新技能 → 注册到 `skills.json`
- 龙虾 soul 修改需经 `LOBSTER_CONSTITUTION.md` 审查

---

## 九、技术栈速查

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.12 + FastAPI + asyncio |
| AI 框架 | LangGraph + LangChain |
| 任务队列 | BullMQ（Redis） |
| 数据库 | PostgreSQL + Redis |
| 向量库 | Qdrant |
| 边缘执行 | Python + Playwright（Camoufox） |
| 云边通讯 | WebSocket（bridge_protocol） |
| 前端 | Next.js + ShadCN UI + TanStack Table |
| 容器化 | Docker + docker-compose |
| 监控 | OpenObserve + LangFuse |

---

## 十、红线（不得违反）

### 🔴 龙虾红线
- **龙虾不是 Agent**，禁止在任何文档/代码/注释中把龙虾泛化为"Agent"
- 龙虾有自己的名字（陈指挥/林涛/苏思/木小芽/影子/老健/阿声/铁狗/算无遗策/小催），用名字或 canonical_id 称呼
- 龙虾 soul 不得随意修改（需经 LOBSTER_CONSTITUTION.md 审查）
- 龙虾的禁止行为列表在 `LOBSTER_ROSTER_CANONICAL.md` 第三节，每只龙虾都有明确的"禁止行为"

### 🔴 安全红线
- 平台账号信息（Cookie/密码）只能在边缘本地，不得上传
- 边缘节点 HMAC 密钥必须独立
- 不得绕过 `quota_middleware.py`

### 🔴 架构红线
- 边缘侧不引入 LLM 调用，边缘只执行不决策
- 任何新功能必须有 Codex Task 才能实现

---


---

*交接人：前任 AI 工程协作体 | 日期：2026-04-02 23:08 CST*  
*核心原则：龙虾是龙虾，不是 Agent。先读 LOBSTER_ROSTER_CANONICAL.md，再碰代码。*
