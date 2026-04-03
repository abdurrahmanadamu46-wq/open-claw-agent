# SYSTEM ARCHITECTURE OVERVIEW
> 龙虾池（LobsterPit）系统架构（10只龙虾权威版）
> 版本：v4.3（含完整10龙虾编制 + 边缘轻量龙虾架构 + 全量借鉴落地 + PUAClaw 最终对标）
> 最后更新：2026-04-02（边缘轻量龙虾架构定稿）

---

## 一、整体架构全景

```
╔══════════════════════════════════════════════════════════════════════╗
║                    ☁️  云端层（Cloud Layer）                          ║
║                                                                      ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │  L1  总司令部 SaaS 主控台                                     │    ║
║  │  Next.js 前端 + NestJS 后端 + Redis + BullMQ                 │    ║
║  │  职责：调度、存储、展示、收费、用户管理                          │    ║
║  └─────────────────────┬───────────────────────────────────────┘    ║
║                        │ 任务下发（BullMQ）                           ║
║  ┌─────────────────────▼───────────────────────────────────────┐    ║
║  │  L2  龙虾池 — 10只 AI 龙虾                                   │    ║
║  │                                                               │    ║
║  │  🦞 Commander  🦞 Radar      🦞 Strategist  🦞 Inkwriter    │    ║
║  │  🦞 Visualizer 🦞 Dispatcher 🦞 Echoer      🦞 Catcher      │    ║
║  │  🦞 Abacus     🦞 Followup                                   │    ║
║  │                                                               │    ║
║  │  ┌─────────────────────────────────────────────────────┐     │    ║
║  │  │  🧠 记忆层（memU 借鉴）                               │     │    ║
║  │  │  LobsterMemory | ExperienceExtractor | WorkflowEngine│     │    ║
║  │  │  BrainMemoryService（组合根）                          │     │    ║
║  │  │  后端：InMemory / SQLite / Postgres（可插拔）          │     │    ║
║  │  └─────────────────────────────────────────────────────┘     │    ║
║  └─────────────────────┬───────────────────────────────────────┘    ║
║                        │                                             ║
║  ┌─────────────────────▼───────────────────────────────────────┐    ║
║  │  L2.5  支撑微服务集群                                         │    ║
║  │  ProviderRegistry（LLM路由）| AuditLogger | ChannelAdapters  │    ║
║  │  OpenIM（即时通讯）| ApprovalFlow（人工审批）                   │    ║
║  └─────────────────────┬───────────────────────────────────────┘    ║
║                        │ WebSocket 长连接                             ║
╚════════════════════════╪═════════════════════════════════════════════╝
                         │
         ════════════════╪════════════════
                  云边通讯桥梁
         WebSocket + BullMQ + 心跳协议
         ════════════════╪════════════════
                         │
╔════════════════════════╪═════════════════════════════════════════════╗
║                    🖥️  边缘层（Edge Layer）                           ║
║                        │                                             ║
║  ┌─────────────────────▼───────────────────────────────────────┐    ║
║  │  L3  边缘执行层（edge-runtime）                               │    ║
║  │  WSSReceiver → ContextNavigator → MarionetteExecutor        │    ║
║  │  EdgeScheduler（边缘离线自治调度）                             │    ║
║  │  BackupManager（备份/还原）                                    │    ║
║  │                                                               │    ║
║  │  Playwright（无头浏览器）→ 小红书/抖音/快手/B站                │    ║
║  └────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 二、10只龙虾编制（权威）

> 详细定义见：`docs/LOBSTER_ROSTER_CANONICAL.md`

| # | canonical_id | 中文名 | 主职责 | 核心工件 |
|---|-------------|--------|--------|---------|
| 0 | **commander** | 元老院总脑 | 编排、仲裁、异常处理、复盘 | MissionPlan |
| 1 | **radar** | 触须虾 | 信号发现、热点、竞品、舆情 | SignalBrief |
| 2 | **strategist** | 脑虫虾 | 策略规划、排期、预算、实验 | StrategyRoute |
| 3 | **inkwriter** | 吐墨虾 | 文案、话术、合规改写 | CopyPack |
| 4 | **visualizer** | 幻影虾 | 分镜、图片、视频、字幕 | StoryboardPack |
| 5 | **dispatcher** | 点兵虾 | 分发、调度、发布时间窗 | ExecutionPlan |
| 6 | **echoer** | 回声虾 | 评论、私信、互动承接 | EngagementReplyPack |
| 7 | **catcher** | 铁网虾 | 线索评分、CRM 入库、去重 | LeadAssessment |
| 8 | **abacus** | 金算虾 | 归因、ROI、报告、反馈回写 | ValueScoreCard |
| 9 | **followup** | 回访虾 | 多触点跟进、唤醒、成交回写 | FollowUpActionPlan |

### 协作拓扑

```
用户/SaaS前端
    ↓
commander（元老院总脑）
    ├─→ radar       → SignalBrief
    ├─→ strategist  → StrategyRoute
    ├─→ inkwriter   → CopyPack
    ├─→ visualizer  → StoryboardPack
    ├─→ dispatcher  → ExecutionPlan → [边缘执行层]
    ├─→ echoer      → EngagementReplyPack
    ├─→ catcher     → LeadAssessment
    ├─→ abacus      → ValueScoreCard
    └─→ followup    → FollowUpActionPlan
```

---

## 三、各层详细说明

### L1：总司令部（SaaS 主控台）

**技术栈**：Next.js 14 + NestJS + PostgreSQL + Redis + BullMQ

**职责**：
- 客户充值、套餐管理
- API 密钥配置
- 任务下发与监控大盘（`/operations/` 系列页面）
- 数据报表与线索追踪

**已完成控制面页面**：
```
/operations/skills-pool    → 技能市场
/operations/strategy       → 策略强度
/operations/scheduler      → 定时调度
/operations/memory         → 记忆管理
/operations/usecases       → 用例市场
/operations/sessions       → 会话隔离
/operations/channels       → 渠道账号
/fleet                     → 边缘节点 + xterm 调试终端
```

**⚠️ 边界铁律**：不直接执行浏览器操作，不调用大模型

---

### L2：龙虾池（10只 AI 龙虾）

**技术栈**：Python + FastAPI + LangGraph + LLM（通过 ProviderRegistry 路由）

**核心文件**：
```
dragon-senate-saas-v2/
├── dragon_senate.py              ← 主 LangGraph 图（DragonState）
├── commander_router.py           ← Commander 路由逻辑
├── commander_graph_builder.py    ← Commander 图构建
├── lobster_runner.py             ← 统一执行引擎
├── lobster_skill_registry.py     ← 技能注册表
├── lobster_pool_manager.py       ← 龙虾池管理
├── session_manager.py            ← 会话隔离
├── memory_compressor.py          ← 记忆三层压缩
├── autonomy_policy.py            ← 自主决策策略
├── usecase_registry.py           ← 用例模板注册
└── lobsters/                     ← 10只龙虾实现
    ├── base_lobster.py           ← 统一基类
    ├── commander.py（路由层）
    ├── radar.py
    ├── strategist.py
    ├── inkwriter.py
    ├── visualizer.py
    ├── dispatcher.py
    ├── echoer.py
    ├── catcher.py
    ├── abacus.py
    └── followup.py
```

**任务执行工作流**：
```
用户请求 → commander 分解
  ↓
load_memory（检索相关记忆）
  ↓
build_context（构建增强上下文）
  ↓
execute_task（龙虾执行业务）
  ↓
extract_experience（提炼经验）
  ↓
save_experience（写入记忆供下次使用）
```

#### 🆕 STORM 知识研究机制（借鉴 Stanford STORM，v4.1 新增）

```
customer_mind_map.py          ← 客户知识地图（7维度知识树）
radar_concurrent_search.py    ← 雷达并发多路搜索（串行→并发，3x 提速）
lobster_inject_context_api.py ← 运营插话 API（实时注入，龙虾动态调整）
```

**客户 Mind Map 7 维度**：
```
每个线索 = 一棵知识树
├── basic_info     基本信息（公司/行业/规模）
├── pain_points    痛点需求（最大痛点/为何现在）
├── budget         预算情况（年度预算/审批人）
├── decision_process 决策流程（决策人/时间线）
├── competitor     竞品情况（是否用竞品/迁移门槛）
├── timeline       时机窗口（触发事件/期望上线）
└── risk           风险信号（抵触/内部阻力/流失概率）
每个节点 = { known_facts: [], unexplored_questions: [] }
```

**苏思（Strategist）4视角分析（借鉴 STORM 多视角 QA）**：
```
视角1 销售机会：漏斗阶段 / 购买信号 / 痛点评分
视角2 竞品威胁：竞品情况 / 我们的优势 / 迁移成本
视角3 时机窗口：触发事件 / 决策时间线 / 窗口关闭风险
视角4 风险信号：抵触信号 / 决策链阻力 / 流失概率
```

**运营插话 API**：
```
POST /api/lobster/inject-context
{ "content": "客户刚说他们下季度有30万预算" }
→ 解析内容 → 更新客户 Mind Map → mailbox 通知相关龙虾 → 审计日志记录
```

**⚠️ 边界铁律**：只做思考与规划，不直接操作浏览器

---

### L2.5：支撑微服务集群

#### ProviderRegistry（LLM 路由）
```python
profiles:
  default:     # 通用推理（GPT-4 / Claude-3.5）
  embedding:   # 向量化专用
  fast:        # 快速响应
  custom:      # 可自定义
```

#### LLM 可观测性层（借鉴 Langfuse + OpenObserve）
```
llm_call_logger.py        ← LLM 调用全量日志（token/cost/latency/status）
llm_quality_judge.py      ← LLM 输出质量自动评判
dataset_store.py          ← 微调数据集管理
observability_api.py      ← 可观测性查询 API
batch_export.py           ← 批量数据导出
```

#### AuditLogger（审计日志）
- 记录所有 LLM 调用（token 用量、耗时、成本）
- 操作审计中间件（借鉴 1Panel）
- `tenant_audit_log.py` 标准审计事件类型 + 保留策略

#### Feature Flag 系统（借鉴 Unleash）
```
feature_flags.py                    ← 热开关 + 灰度发布 + 本地缓存
prompt_registry.py                  ← Prompt A/B 实验（Variants）
edge-runtime/feature_flag_proxy.py  ← 边缘 Flag 本地代理（断网自愈）
```

#### SaaS 计费与增长层（已落地）
```
saas_pricing_model.py      ← SaaS 定价模型（按量/套餐/企业）
saas_billing.py            ← 计费系统
quota_middleware.py        ← 租户配额中间件
growth_strategy_engine.py  ← 增长策略引擎
enterprise_onboarding.py   ← 企业入驻流程
regional_agent_system.py   ← 区域代理商系统
```

#### 安全层（借鉴 SlowMist + 1Panel）
- RSA 传输加密（`rsa-crypto.ts`）
- IP 限流
- 操作审计
- `ssrf_guard.py` SSRF 防护
- `lobsters/lobster_security.py` 龙虾安全红线

---

### 云边通讯桥梁

**消息类型**：

| 消息 | 方向 | 内容 |
|------|------|------|
| `node_ping` | 边缘→云端 | 心跳（每30s） |
| `execute_task` | 云端→边缘 | SOP 任务包（ExecutionPlan） |
| `task_progress` | 边缘→云端 | 执行进度 |
| `task_completed` | 边缘→云端 | 完成结果 |
| `memory_sync` | 边缘↔云端 | 记忆增量同步 |
| `scheduler_status` | 边缘→云端 | 边缘 Cron 状态 |
| `backup_trigger` | 云端→边缘 | 触发边缘备份 |

---

### L3：边缘执行层（edge-runtime）— 轻量龙虾架构

> 🔴 **核心架构设定（v4.3 定稿，必须遵守）**：
> 边缘层运行"**轻量龙虾（Edge Lite Lobster）**"，它是一个纯执行代理，没有 LLM，只负责：
> 1. **接收**云端龙虾生成的"内容发布包" → **发布**到客户的平台账号（小红书/抖音/微信等）
> 2. **监控**客户账号的评论、私信、数据 → **打包上报**给云端龙虾做 LLM 分析
>
> 详见：`docs/EDGE_LITE_LOBSTER_ARCHITECTURE.md`（权威规范）

**技术栈**：Python + WebSocket Client + Camoufox（反检测浏览器）

#### 轻量龙虾数据流

```
云端龙虾（有LLM，做策略/创作/分析）
    │
    │ ① 下发"内容发布包"（ContentPublishPacket）
    │   包含：平台/账号ID/文案/图片OSS链接/动作类型
    ▼
边缘轻量龙虾（无LLM，只执行）
    │
    ├─ ② 用 Camoufox 发布内容到客户账号
    ├─ ③ 定时采集：评论 / 私信 / 粉丝数 / 互动数据
    │
    │ ④ 上报"监控数据包"（MonitorDataPacket）
    │   包含：原始数据，不含分析结果
    ▼
云端龙虾（LLM分析 → 生成下一步回复/跟进指令）
    │
    └─ 循环：生成回复包 → 下发边缘 → 边缘发布回复
```

#### 边缘轻量龙虾核心模块

```
edge-runtime/
├── edge_lite_lobster.py   # 轻量龙虾主类（Publisher + Collector）
├── account_vault.py       # 🔐 账号凭证本地保险箱（加密，永不上传云端）
├── publish_executor.py    # 发布执行：post/reply/dm（调用Camoufox）
├── monitor_collector.py   # 采集：评论/私信/账号数据
├── offline_queue.py       # 断网缓存：WSS断开时本地保存包
├── packet_handler.py      # 包解析/验证/路由
├── wss_receiver.py        # WSS客户端（已有，升级双向收发）
└── marionette_executor.py # Camoufox 浏览器执行器（已有）
```

#### 安全铁律

| 原则 | 说明 |
|------|------|
| **账号凭证不出边缘** | 客户 Cookie/Token 只存 `account_vault.py`（本地加密），永不上传云端 |
| **边缘不做 LLM 决策** | 轻量龙虾无 LLM，只执行云端指令，不判断内容 |
| **云端只传内容** | 云端只发文案/图片（OSS链接），不发账号凭证 |
| **双向加密** | WSS + TLS + HMAC 签名验证每个数据包 |
| **离线容错** | 断网时包缓存到本地 SQLite，恢复连接后自动重发 |

#### 云边消息类型（更新版）

| 消息类型 | 方向 | 内容 |
|---------|------|------|
| `node_ping` | 边缘→云端 | 心跳（每30s） |
| `publish_packet` | 云端→边缘 | **内容发布包**（post/reply/dm指令+内容） |
| `publish_result` | 边缘→云端 | 发布执行结果（成功/失败/重试中） |
| `monitor_data` | 边缘→云端 | **监控数据包**（评论/私信/账号统计原始数据） |
| `scheduler_status` | 边缘→云端 | 边缘定时任务状态 |
| `account_sync` | 云端→边缘 | 账号列表同步（不含凭证） |
| `memory_sync` | 边缘↔云端 | 记忆增量同步 |
| `backup_trigger` | 云端→边缘 | 触发边缘备份 |

#### 云端接收边缘数据的路由规则

```python
# dragon-senate-saas-v2/edge_data_processor.py
监控数据路由：
  "comments"    → 阿声(echoer)   → 情感分析 + 生成回复策略 → 打包下发边缘执行
  "dm_messages" → 小锤(followup) → 需求分析 + 生成跟进方案 → 打包下发边缘执行
  "post_stats"  → 算无遗策(abacus) → 数据报告 + 优化建议
  "fans_change" → 林涛(radar)    → 受众变化分析
```

**⚠️ 边界铁律**：
- 不调用大模型（LLM 在云端）
- 不做内容决策（内容由云端龙虾生成，边缘只发布）
- 账号凭证永远在边缘，永不上传

---

## 四、技术选型总结

| 组件 | 技术 | 理由 |
|------|------|------|
| SaaS 前端 | Next.js 14 + TypeScript | SSR、类型安全 |
| SaaS 后端 | NestJS + TypeScript | 模块化、WebSocket 支持好 |
| 任务队列 | BullMQ + Redis | 高性能、重试机制 |
| 龙虾框架 | Python + FastAPI + LangGraph | AI 生态丰富 |
| LLM 调用 | ProviderRegistry（多 Provider） | 成本优化、容错 |
| 图像生成 | ComfyUI Adapter | 本地化部署 |
| 记忆存储（云端） | PostgreSQL | 稳定、ACID |
| 记忆存储（边缘） | SQLite | 轻量、离线可用 |
| 边缘执行 | Python + Playwright | 浏览器自动化成熟 |
| 即时通讯 | OpenIM | 开源、私有化部署 |
| 容器化 | Docker Compose | 一键部署 |
| 安全传输 | RSA + AES | 端到端加密 |

---

## 五、当前架构演进状态

```
v4.0（已完成）                 v4.1（进行中/STORM新增）        v5.0（规划中）
─────────────────────────     ─────────────────────────     ─────────────────────────
10只龙虾完整运行               🆕 客户 Mind Map（7维度）       + 主动意图推送
完整记忆层（三层压缩）          🆕 苏思4视角分析               + 多模态记忆
完整控制面（16+个页面）         🆕 运营插话 API                + 知识图谱
边缘 Cron 离线调度             🆕 雷达并发多路搜索             + RL 持续优化
RSA 安全传输 + SSRF 防护       + 技能效力自动校准              + 龙虾技能插件市场
备份/还原 + 安全审计            + 执行监控室                   + OSS+Pro 双版本
Feature Flag 热开关系统        + 私有技能注册表               + 边缘条件触发规则
LLM 可观测性全量日志            + Prompt 全量标准化             + 龙虾历史时序指标
SaaS 计费 + 区域代理商          + Agent OS SOUL/AGENTS 深化     + 边缘多协议适配
Webhook 事件总线               + 任务看板（Kanban）            + 边缘节点分组管理
龙虾 KB（10只龙虾知识库）       + 日志 Enrich 管道             + 向量记忆混合检索
```

**v4.1 STORM 借鉴详细说明**：
- `customer_mind_map.py`：每个线索维护7维度知识树，已知 + 待探索，解决龙虾重复问同一问题的核心痛点
- `radar_concurrent_search.py`：asyncio 并发执行多路搜索，串行 10s → 并发 2s，3x 提速
- `lobster_inject_context_api.py`：运营随时注入信息，更新 Mind Map，mailbox 通知龙虾，审计日志留档
- `strategist-susi-kb.md` 升级：苏思从单视角 → 销售/竞品/时机/风险 4视角全面分析

---

## 六、相关文档链接

| 文档 | 路径 | 说明 |
|------|------|------|
| 项目总控台 | `PROJECT_CONTROL_CENTER.md` | 当前状态、风险、前端对齐 |
| 龙虾权威编制 | `docs/LOBSTER_ROSTER_CANONICAL.md` | 10只龙虾定义（唯一权威） |
| 原始架构蓝图 | `ARCHITECTURE.md` | 三层基础架构（必守铁律） |
| STORM 借鉴分析 | `docs/STORM_BORROWING_ANALYSIS.md` | 完整分析（架构解析+7层对比+3大发现）|
| STORM P1 任务 | `docs/CODEX_TASK_STORM_P1.md` | 4个P1任务（含完整 Python 代码）|
| STORM 索引 | `docs/STORM_CODEX_INDEX.md` | 总览索引（3大发现 + P1/P2 任务清单）|
| **Manifest 借鉴分析** | `docs/MANIFEST_BORROWING_ANALYSIS.md` | **智能LLM路由+预算通知+API Key加密（7层对比+3大洞察）**|
| **Manifest P1 任务** | `docs/CODEX_TASK_MANIFEST_P1.md` | **4个P1任务（smart_router/budget_alert/api_key_vault/cost_api）**|
| **Manifest 索引** | `docs/MANIFEST_CODEX_INDEX.md` | **总览索引（10只龙虾路由Tier默认配置）**|
| **🔴 边缘轻量龙虾架构** | `docs/EDGE_LITE_LOBSTER_ARCHITECTURE.md` | **权威定稿：轻量龙虾 = 纯执行代理（发布+采集+上报）**|
| **轻量龙虾核心 Task** | `docs/CODEX_TASK_EDGE_LITE_LOBSTER_CORE.md` | **P0：EdgeLiteLobster + AccountVault + MonitorCollector 完整实现**|
| PUAClaw 借鉴分析 | `docs/PUACLAW_BORROWING_ANALYSIS.md` | PUAClaw 对标分析（5层对比+3大发现）|

---

*版本：v4.3 | 最后更新：2026-04-02（边缘轻量龙虾架构定稿）| 维护者：龙虾池团队*
