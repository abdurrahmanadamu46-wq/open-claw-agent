# MANIFEST 借鉴分析报告
> 来源：https://github.com/mnfst/manifest
> 分析日期：2026-04-02
> 定位：**OpenClaw 专属智能 LLM 路由器** —— 按请求难度自动选最便宜模型，节省最多 70% 成本

---

## 一、Manifest 项目概览

### 1.1 核心定位
Manifest 是专门为 OpenClaw 生态设计的**智能模型路由层**，坐落在 Agent 和 LLM Provider 之间：

```
用户 Agent（龙虾）
       ↓
  [Manifest 路由层]
  ┌────────────────────────────────────────┐
  │  请求评分（Quality Score）             │
  │  → 简单问题 → 快速廉价模型（GPT-4o-mini）│
  │  → 复杂问题 → 强力模型（Claude/GPT-4o）│
  │  → 失败自动 Fallback 到下一个 Provider │
  │  → 预算限额 → 触发通知/阻断           │
  └────────────────────────────────────────┘
       ↓
  LLM Providers（OpenAI / Anthropic / Ollama / ...）
```

### 1.2 技术栈
- **后端**：NestJS（TypeScript）+ TypeORM + PostgreSQL/SQLite
- **前端**：React（独立 SPA，内嵌同一服务）
- **实时推送**：SSE（Server-Sent Events）
- **监控**：OTLP（OpenTelemetry Protocol）
- **部署**：Docker / Docker Compose / 本地插件模式

### 1.3 核心模块清单（870个文件）

```
packages/backend/src/
├── routing/            ← 🌟 核心：智能路由引擎
│   ├── routing-core/   ← 路由决策（模型选择 + 质量评分）
│   ├── proxy/          ← LLM 请求代理（透明转发）
│   ├── resolve/        ← 模型解析（别名→实体）
│   ├── oauth/          ← OAuth Provider 接入
│   └── custom-provider/← 自定义 Provider 注册
├── analytics/          ← 🌟 数据分析面板
│   ├── controllers/    ← API：agent/cost/token/overview/timeseries
│   └── services/       ← 聚合/时序/趋势计算
├── notifications/      ← 🌟 预算通知系统
│   ├── notification-rules.service   ← 规则定义
│   ├── notification-cron.service    ← 定时检查
│   ├── notification-email.service   ← 邮件发送
│   └── limit-check.service          ← 限额检查
├── model-prices/       ← 模型定价缓存（实时更新）
├── model-discovery/    ← 模型自动发现（Ollama 同步）
├── otlp/               ← OpenTelemetry 遥测接入
├── sse/                ← SSE 实时事件推送
├── auth/               ← Session + API Key 双模式认证
├── common/
│   ├── interceptors/   ← agent-cache / user-cache 缓存拦截
│   ├── utils/cost-calculator.ts  ← 精确 Token 成本计算
│   ├── utils/provider-inference.ts ← Provider 自动推断
│   └── utils/ttl-cache.ts        ← TTL 内存缓存
├── database/           ← TypeORM + 完整 Migration 历史
└── github/             ← GitHub 集成（stars/版本检查）
```

---

## 二、逐层对比分析

### 2.1 前端层（L1 SaaS 控制台）

| Manifest 特性 | 我们现状 | 差距/借鉴价值 |
|---|---|---|
| **每个 Agent 独立成本分析面板** | 我们有总体 LLM 日志，无 per-agent 成本视图 | 🔴 高价值：10只龙虾各自成本一目了然 |
| **Token 时序趋势图（带环比）** | 无 | 🔴 高价值：看出哪只龙虾成本异常暴涨 |
| **预算限额配置 UI** | 无（仅 quota_middleware 后端检查） | 🟡 中价值：前端可视化设置预算上限 |
| **SSE 实时消费推送** | 无 | 🟡 中价值：成本超限实时浏览器提醒 |
| **模型发现 + 一键切换** | ProviderRegistry 支持，无前端 UI | 🟡 中价值：运营无需改代码切换 Provider |
| **Copilot API 兼容层** | 无 | 🟢 低价值：对外提供 API 兼容接口 |

**关键发现**：Manifest 的分析面板按 **Agent 维度** 做拆分，我们10只龙虾正好对应10个 Agent，可以精确看到每只龙虾每天/每周消耗了多少 token、花了多少钱、哪次调用最贵。

### 2.2 云端大脑（ProviderRegistry / LLM 路由）

| Manifest 特性 | 我们现状 | 差距/借鉴价值 |
|---|---|---|
| **请求质量评分（Quality Score）** | 无 —— 我们的 ProviderRegistry 按 profile 分类（default/fast/embedding） | 🔴 **最高价值**：按难度动态选模型，70% 成本节省 |
| **自动 Fallback 链** | 有基础 Fallback（provider_registry.py），但无链式优先级 | 🔴 高价值：Provider A → B → C 按序兜底 |
| **每个龙虾独立路由策略（Per-Agent Routing）** | 无 —— 所有龙虾共用同一 profile 配置 | 🔴 高价值：radar 用 fast，strategist 用 strong |
| **模型价格实时缓存** | 我们手动配置 cost，无自动更新 | 🟡 中价值：价格表自动同步 |
| **Tier 路由（分级别）** | 无 | 🟡 中价值：Premium/Standard/Economy 三档 |
| **OAuth Provider 接入** | 无 | 🟢 低价值：接入 GitHub Copilot 等 OAuth 模型 |

**最重要发现**：Manifest 的 `addQualityScore` migration（`1771800000000-AddQualityScore.ts`）证明它会给**每次 LLM 请求**打质量分，然后根据分数路由。简单任务（写口号）score 低 → 廉价模型；复杂任务（多步策略分析）score 高 → 强力模型。这对我们10只龙虾**极其适合**：
- followup 的简单回访话术 → score 低 → fast 模型
- strategist 的竞品分析 → score 高 → strong 模型

### 2.3 9只龙虾（AI Agent 层）

| Manifest 特性 | 我们现状 | 借鉴点 |
|---|---|---|
| **每龙虾独立成本预算** | 无 | 给每只龙虾设月预算上限（如 abacus 月预算 $50） |
| **Agent 生命周期追踪** | 有 session，无跨 session 连续追踪 | agent-lifecycle.service 追踪首次/末次活跃时间 |
| **请求路由嵌入龙虾执行流** | 无 | 龙虾调用 LLM 时自动走质量评分路由 |

### 2.4 支撑微服务集群（L2.5）

| Manifest 特性 | 我们现状 | 差距/借鉴价值 |
|---|---|---|
| **LimitCheckService（限额守门员）** | 有 quota_middleware.py，但粒度到租户级 | 🔴 高价值：精细到 Agent+模型+时间窗口的限额 |
| **NotificationCronService（定时检查）** | 无 LLM 成本预警通知 | 🔴 高价值：每小时检查一次预算消耗，超 80% 发邮件 |
| **TenantCacheService（租户级缓存）** | 有基础缓存，无多层 TTL | 🟡 中价值：agent-level + user-level 双层缓存拦截器 |
| **IngestEventBus（摄取事件总线）** | 有 webhook_event_bus.py，无 OTLP 接入 | 🟡 中价值：统一把 LLM 调用事件推到 OTLP |
| **TTL 内存缓存工具** | 无标准 TTL 缓存 | 🟢 低价值：简单可借的 ttl-cache.ts 实现 |
| **cost-calculator（精确成本计算）** | 有 llm_call_logger，成本计算不精确 | 🟡 中价值：区分 subscription/按量，处理未知模型 |

### 2.5 云边调度层

| Manifest 特性 | 我们现状 | 差距/借鉴价值 |
|---|---|---|
| **SSE 实时事件推送** | 我们用 WebSocket（更重），无 SSE | 🟡 中价值：SSE 更轻量，适合单向推送预算告警到前端 |
| **OTLP 遥测集成** | 有 Langfuse 可观测性，无标准 OTLP | 🟡 中价值：OTLP 是 OpenTelemetry 标准，与 Grafana/Jaeger 直接对接 |
| **Local Mode（本地模式）** | 我们有 edge-runtime，无轻量本地模式 | 🟢 低价值：单机部署时无需云端认证 |

### 2.6 边缘层（Edge Runtime）

| Manifest 特性 | 我们现状 | 差距/借鉴价值 |
|---|---|---|
| **Ollama 本地模型同步** | 无 —— 边缘节点无法调用本地 LLM | 🟡 中价值：边缘节点可配置本地 Ollama，降低成本 |
| **Provider 自动推断** | 无 | 🟡 中价值：根据模型名自动推断 Provider 类型 |
| **边缘成本独立核算** | 无 | 🟢 低价值：边缘节点的 LLM 消耗单独计费 |

### 2.7 整体 SaaS 系统

| Manifest 特性 | 我们现状 | 差距/借鉴价值 |
|---|---|---|
| **API Key 哈希存储** | 我们的 API Key 明文存储 | 🔴 高价值：bcrypt 哈希，安全迁移（`1771500000000-HashApiKeys.ts`）|
| **API Key 加密（AES）** | 无 | 🔴 高价值：存储层 AES 加密（`1771900000000-EncryptApiKeys.ts`）|
| **Multi-Provider Per-Agent 路由表** | 无 | 🔴 高价值：每龙虾可配独立 Provider 优先级 |
| **完整 Migration 历史（15+ 迁移）** | 我们无规范 DB 迁移，每次手动建表 | 🟡 中价值：TypeORM Migration 规范化 DB 演进 |
| **SPA Fallback 过滤器** | 无 | 🟢 低价值：前端路由 404 自动回退 index.html |

---

## 三、核心发现（3大洞察）

### 🔴 洞察1：按请求难度路由 = 最大成本杠杆

**Manifest 思路**：每次 LLM 请求到来时，先给请求打质量分（complexity score），再按分数选模型：
- score < 0.3 → economy 模型（fast, $0.0001/1K）
- score 0.3-0.7 → standard 模型（GPT-4o-mini, $0.00015/1K）
- score > 0.7 → premium 模型（Claude-3.5-Sonnet, $0.003/1K）

**我们的机会**：10只龙虾的任务复杂度差异极大：
- followup 的话术生成：简单 → economy
- radar 的信号扫描：中等 → standard
- strategist 的4视角分析：复杂 → premium

预估节省：30-50% LLM 成本。

### 🔴 洞察2：预算通知系统 = 运营安全网

**Manifest 思路**：`NotificationCronService` 每小时检查所有用户的消耗，超过阈值（如 80%）发邮件预警，超过 100% 触发 `LimitCheckService` 阻断请求。

**我们的机会**：现在 10 只龙虾跑起来，没有任何预算控制，单个客户可能因一个 bug 产生几百美元的意外消耗。这是商业化的致命风险。

### 🔴 洞察3：API Key 安全升级 = 商业化必备

**Manifest 思路**：API Key 经过两次安全强化：先 bcrypt 哈希（无法逆向），后 AES 加密（可解密展示前几位）。

**我们的机会**：我们准备商业化，客户的 LLM API Key（OpenAI/Anthropic）如果明文存储，一旦数据库泄露将造成客户严重损失，这是法律风险。

---

## 四、已落地 / 跳过清单

| Manifest 特性 | 判断 | 原因 |
|---|---|---|
| LLM 调用日志 | ✅ 已落地（llm_call_logger.py） | 我们的更完整，含质量评判 |
| Provider 多路由 | ✅ 已落地（provider_registry.py） | 我们已有 profile 路由 |
| 租户配额中间件 | ✅ 已落地（quota_middleware.py） | 有基础，但粒度不够精细 |
| SSR/静态文件服务 | ⏭️ 跳过 | 我们用 Next.js 独立前端 |
| GitHub 集成模块 | ⏭️ 跳过 | 与我们场景无关 |
| Copilot 兼容 API | ⏭️ 跳过 | 不是当前优先级 |

---

## 五、P1 任务清单（优先落地）

| 编号 | 任务 | 目标文件 | 预估工时 |
|---|---|---|---|
| M-P1-1 | LLM 请求质量评分路由器 | `dragon-senate-saas-v2/smart_router.py` | 4h |
| M-P1-2 | 龙虾预算通知系统 | `dragon-senate-saas-v2/lobster_budget_alert.py` | 3h |
| M-P1-3 | API Key AES 加密升级 | `dragon-senate-saas-v2/api_key_vault.py` | 2h |
| M-P1-4 | 龙虾维度成本分析 API | `dragon-senate-saas-v2/lobster_cost_api.py` | 3h |

---

*生成时间：2026-04-02 | 分析员：龙虾池研发团队*
