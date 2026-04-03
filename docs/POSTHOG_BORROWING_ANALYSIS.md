# PostHog 借鉴分析报告

**来源项目**：https://github.com/PostHog/posthog  
**Stars**：32,320 | **Forks**：2,451 | **语言**：Python + TypeScript  
**定位**：All-in-one Developer Platform — 产品分析/行为录制/特性标志/实验/调查/数据仓库/AI助手  
**分析日期**：2026-04-02

---

## 一、PostHog 整体架构速览

```
posthog/
├── posthog/                    ← Django 后端核心
│   ├── api/                    ← REST API（捕获/洞察/特性标志/实验/调查/告警）
│   ├── models/                 ← 数据模型（feature_flag/cohort/insight/survey/ai/hog_functions）
│   ├── feature_flags/          ← 特性标志引擎
│   ├── hogql/                  ← 自定义 SQL 查询语言（HogQL）
│   ├── hogql_queries/          ← HogQL 查询执行层
│   ├── tasks/                  ← Celery 后台任务
│   ├── temporal/               ← Temporal 工作流（批量导出等）
│   ├── cdp/                    ← Customer Data Platform（数据管道）
│   ├── llm/                    ← LLM 集成（AI 助手 Max）
│   └── warehouse/              ← 数据仓库
├── frontend/src/scenes/        ← 前端场景模块（React + Kea）
│   ├── agentic/                ← AI Agent 场景（Max AI助手）
│   ├── experiments/            ← A/B实验管理
│   ├── feature-flags/          ← 特性标志管理
│   ├── surveys/                ← 用户调查
│   ├── funnel/                 ← 漏斗分析
│   ├── insights/               ← 洞察分析
│   ├── hog-functions/          ← Hog 函数（边缘计算）
│   ├── alerts/                 ← 告警系统
│   ├── session-recordings/     ← 会话录制
│   ├── cohorts/                ← 用户分组
│   ├── data-warehouse/         ← 数据仓库 UI
│   └── marketing-analytics/    ← 营销分析（！直接对应我们的核心场景！）
├── ee/                         ← Enterprise Edition（付费功能）
├── products/                   ← 独立产品模块
└── rust/                       ← Rust 高性能组件（事件捕获服务器）
```

**关键亮点**：PostHog 内置 `frontend/src/scenes/marketing-analytics/` 和 `frontend/src/scenes/agentic/` 这两个模块与我们的业务直接高度重叠！

---

## 二、逐层对比分析

### 🌐 前端 SaaS 控制台

| PostHog 功能 | 我们现状 | 差距/价值 |
|------------|---------|---------|
| **A/B 实验系统**（`scenes/experiments/` — 实验创建/分组/统计显著性/结果可视化）| 无实验对比机制 | ✅ **P1高价值** — 龙虾 A/B 实验：同一任务多龙虾产出对比，统计哪只更好 |
| **用户调查**（`scenes/surveys/` — 内嵌调查弹窗，NPS/CSAT/开放题）| 无用户调查机制 | ✅ **P1高价值** — SaaS 用户调查（产品满意度/龙虾产出评价）|
| **告警系统**（`scenes/alerts/` — 指标超阈值自动告警，多渠道通知）| `CODEX_TASK_ALERT_ENGINE.md` 已落地 | ⭕ 已落地 |
| **营销分析面板**（`scenes/marketing-analytics/` — 渠道分析/归因/ROI）| 无营销归因分析 | ✅ **P1高价值** — 营销渠道 ROI 归因面板（哪个渠道带来最多高意向线索）|
| **漏斗分析**（`scenes/funnels/` — 多步骤转化漏斗，步骤之间的流失分析）| 无漏斗可视化 | ✅ **P1高价值** — 龙虾工作流漏斗（每步完成率/流失点可视化）|
| **会话录制**（`scenes/session-recordings/` — 用户操作回放，点击热图）| 无操作回放 | ✅ **P2价值** — 边缘操作录制（Playwright 操作序列可视化回放）|
| **Agentic AI 助手**（`scenes/agentic/` — Max AI，自然语言查询数据）| `api_lobster_realtime.py` 已有实时但无NL查询 | ✅ **P1高价值** — "问 Max" 式自然语言查询龙虾数据 |
| **Cohort 用户分组**（`scenes/cohorts/` — 按行为/属性划分用户群）| 无用户分群 | ✅ **P2价值** — 线索分群（按来源/评分/行业/意向阶段）|
| **Notebook**（`scenes/notebooks/` — 分析+文字混合的协作文档）| 无 Notebook | ✅ **P2价值** — 营销洞察 Notebook（分析图表+运营备注混合）|

### 🧠 云端大脑层（Commander）

| PostHog 功能 | 我们现状 | 差距/价值 |
|------------|---------|---------|
| **Feature Flags**（`feature_flags/` — 渐进式发布，按用户属性/百分比/Cohort 定向）| 无特性标志 | ✅ **P1高价值** — **龙虾特性开关**：A/B 灰度发布新龙虾技能/Prompt，按租户/用户百分比发布 |
| **HogQL 查询语言**（`hogql/` — 基于 ClickHouse 的自定义 SQL，支持自然语言转换）| 无查询语言 | ✅ **P2价值** — 龙虾数据自然语言查询 |
| **CDP（客户数据平台）**（`cdp/` — 统一用户 profile，跨渠道事件合并）| 无统一客户档案 | ✅ **P2价值** — 营销线索统一档案（多渠道事件合并到一个人）|
| **LLM 集成**（`posthog/llm/` — AI 助手 Max，对话式数据分析）| 龙虾是 LLM 执行，无对话式分析 | ✅ **P1高价值** — 对话式数据查询（问"本周 followup 最成功的线索来自哪里？"）|
| **数据仓库**（`warehouse/` — 连接外部数据源，SQL 联合查询）| 无数据仓库层 | ✅ **P2价值** — 连接外部 CRM/电商数据做联合分析 |

### 🦞 9个龙虾层

| PostHog 功能 | 对应龙虾 | 借鉴价值 |
|------------|---------|---------|
| **Feature Flag 灰度发布**（按百分比对 Cohort 开放）| 所有龙虾 | ✅ **P1高价值** — 新 Prompt/新技能灰度测试（先对5%租户开放）|
| **A/B 实验统计**（统计显著性，p值，置信区间）| strategist（谋士虾）| ✅ **P1高价值** — 龙虾策略 A/B 实验，自动判断哪个策略更优 |
| **用户调查触发**（按行为条件触发调查弹窗）| followup（追单虾）| ✅ **P1高价值** — 线索跟进后自动触发满意度调查 |
| **Hog Functions**（`models/hog_functions/` — 边缘自定义函数，事件触发执行）| dispatcher（调度虾）| ✅ **P2价值** — Hog 函数模式触发龙虾（事件驱动而非定时）|
| **Cohort 分组**（按属性/行为自动维护用户群）| catcher（捕手虾）、radar（信号虾）| ✅ **P2价值** — 线索自动分群（高意向群/流失风险群/待跟进群）|

### 🏗️ L2.5 支撑微服务集群

| PostHog 功能 | 我们现状 | 差距/价值 |
|------------|---------|---------|
| **Feature Flag API**（高性能标志评估，本地缓存，降级保护）| `dynamic_config.py` 只有配置，无用户级标志 | ✅ **P1高价值** — 用户级特性标志（每个租户/用户看到不同功能）|
| **事件捕获 API**（`api/capture.py` — Rust 高性能事件摄取，Kafka 异步）| `observability_api.py` 部分覆盖 | ✅ **P2价值** — 高性能事件摄取（用户操作→Kafka→ClickHouse）|
| **Celery 任务调度**（`tasks/` — 后台任务，定时报告，数据导出）| `task_queue.py` 已落地 | ⭕ 已落地 |
| **Temporal 工作流**（`temporal/` — 长时任务，批量导出，可重试）| `CODEX_TASK_YAML_WORKFLOW.md` 已落地 | ⭕ 已落地 |
| **多产品隔离**（`products/` — 不同产品模块数据库隔离，`product_db_router.py`）| `CODEX_TASK_TENANT_CONTEXT.md` 已落地 | ⭕ 已落地 |
| **采样控制**（`sampling.py` — 高流量下自动采样，保证系统稳定）| `quota_middleware.py` 有配额，无采样 | ✅ **P2价值** — 高流量采样（线索事件峰值时自动降频采样）|

### 🛰️ 云边调度层

| PostHog 功能 | 我们现状 | 差距/价值 |
|------------|---------|---------|
| **Rust 事件服务器**（高性能事件摄取，比 Python 快10x）| `wss_receiver.py` Python | ⭕ 我们场景量级不同，Python 足够 |
| **GeoIP 地理解析**（`geoip.py` — IP→城市/省份/国家，自动丰富事件属性）| 无地理信息 | ✅ **P2价值** — 边缘事件自动附加地理位置信息 |

### 🖥️ 边缘执行层

| PostHog 功能 | 我们现状 | 差距/价值 |
|------------|---------|---------|
| **Hog Functions 边缘执行**（`models/hog_functions/` — 用户自定义 JS 函数，事件触发执行）| `CODEX_TASK_LOBSTER_PIPELINE_MW.md` 已落地 | ⭕ 已落地（更全面）|
| **错误追踪**（Error Tracking — 自动捕获边缘异常，聚合报告）| 仅有日志，无错误聚合 | ✅ **P2价值** — 边缘错误自动聚合（同类错误合并，不刷日志）|

---

## 三、优先级汇总

### ⭕ 已落地

| 功能 | 已落地文件 |
|-----|---------|
| 告警系统 | `CODEX_TASK_ALERT_ENGINE.md` |
| 后台任务调度 | `task_queue.py` |
| 工作流（Temporal）| `CODEX_TASK_YAML_WORKFLOW.md` |
| 多租户隔离 | `CODEX_TASK_TENANT_CONTEXT.md` |
| Pipeline 中间件 | `CODEX_TASK_LOBSTER_PIPELINE_MW.md` |

### 🔴 P1（最高价值）

| # | 功能 | 来自 PostHog | 落地方向 |
|---|------|------------|---------|
| P1-1 | **龙虾 A/B 实验引擎** | `scenes/experiments/` + 统计显著性 | `dragon-senate-saas-v2/lobster_ab_experiment.py` |
| P1-2 | **特性标志（Feature Flags）** | `posthog/feature_flags/` | `dragon-senate-saas-v2/feature_flag_engine.py` |
| P1-3 | **营销渠道 ROI 归因面板** | `scenes/marketing-analytics/` | 前端 `/analytics/attribution` |
| P1-4 | **漏斗分析可视化** | `scenes/funnels/` | 前端 `/analytics/funnel` |
| P1-5 | **用户调查系统** | `scenes/surveys/` | `dragon-senate-saas-v2/survey_engine.py` |
| P1-6 | **对话式数据查询（Max 模式）** | `scenes/agentic/` + `posthog/llm/` | 前端 AI 助手 + 后端 NL→Query |

### 🟡 P2

| # | 功能 | 来自 PostHog | 落地方向 |
|---|------|------------|---------|
| P2-1 | **线索 Cohort 分组** | `scenes/cohorts/` | `dragon-senate-saas-v2/lead_cohort.py` |
| P2-2 | **营销 Notebook** | `scenes/notebooks/` | 前端 `/insights/notebooks` |
| P2-3 | **边缘操作回放** | `scenes/session-recordings/` | `edge-runtime/operation_recorder.py` |
| P2-4 | **高流量采样控制** | `posthog/sampling.py` | `dragon-senate-saas-v2/event_sampler.py` |
| P2-5 | **边缘错误聚合** | Error Tracking | `dragon-senate-saas-v2/error_aggregator.py` |
| P2-6 | **CDP 统一客户档案** | `posthog/cdp/` | `dragon-senate-saas-v2/lead_identity_graph.py` |

---

## 四、架构价值总结

```
PostHog（产品分析平台）        我们（营销增长 AI 操作系统）
────────────────────          ────────────────────────────
用户行为分析                    龙虾行为分析
A/B 测试产品特性                A/B 测试龙虾策略
Feature Flags 灰度发布          龙虾技能灰度发布
营销分析归因                    龙虾产出 ROI 归因
用户调查                        客户满意度调查
漏斗分析                        营销漏斗龙虾工作流分析
自然语言查询 Max               自然语言查询龙虾数据

最大借鉴价值：
  ✅ A/B 实验（科学评估哪只龙虾效果更好）
  ✅ Feature Flags（新功能/新Prompt灰度发布）
  ✅ 营销归因（渠道ROI，线索来源价值）
  ✅ 漏斗分析（工作流每步转化率）
  ✅ 调查系统（闭环用户反馈）
  ✅ Max AI（自然语言查数据）
```

---

*来源：https://github.com/PostHog/posthog（⭐32.3k）| 分析日期：2026-04-02*
