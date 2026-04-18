# OpenClaw Web Frontend Map

更新时间：2026-04-13

本文把 `web/` 前端拆成两张图：

1. 页面地图：按业务域、导航层级、用户路径整理所有主要页面。
2. 组件复用地图：按共享壳子、主线叙事、数据展示、工作流、舰队管理、基础 UI 整理复用关系。

扫描范围：

- `web/src/app`
- `web/src/components`
- `web/src/hooks`
- `web/src/services`
- `web/src/contexts`

当前量级快照：

- 页面文件 `page.tsx`：103 个
- 路由文件 `page/layout/route`：111 个
- 组件文件：78 个
- 服务文件：33 个
- Hook 文件：14 个
- TS/TSX 文件：324 个
- `use client` 文件：192 个

---

## 一、页面地图

### 1. 总入口和全局壳子

- `/`
  首页主线指挥页。不是传统 dashboard，而是把首启、策略、任务、线索、复盘串成一条运营主线。
- 全局壳子
  由 `AppShell -> AppSidebar -> Header` 组成，公共搜索、语言切换、主线阶段导航都挂在这一层。
- 公开页面例外
  `/login`、`/register`、`/forgot-password`、`/reset-password`、`/landing`、`/pricing`、`/faq`、`/legal/*` 不走控制台壳子。

### 2. 用户主线页面

这是当前最像“产品主路径”的页面族，也是首页和 Header 都在强调的一组。

- `/onboard`
  首启流程，确定行业、目标、执行边界。
- `/operations/strategy`
  主策略工作台，连接行业选择、强度管理、异步任务、Preview。
- `/campaigns`
  任务池，强调今日应推进任务，而不是纯表格管理。
- `/operations/leads`
  线索池，实际渲染 `LeadsWorkspace`。
- `/operations/autopilot/trace`
  复盘与 Trace，主线最后一步。
- `/settings/billing`
  商业化与主线闭环后的变现侧。

### 3. 运营控制台 Operations 域

`operations/` 是当前控制台主战场，共 41 个页面。

#### 3.1 自动驾驶与执行治理

- `/operations/autopilot`
- `/operations/autopilot/alerts`
- `/operations/autopilot/approvals`
- `/operations/autopilot/artifacts`
- `/operations/autopilot/modes`
- `/operations/autopilot/trace`
- `/operations/log-audit`
- `/operations/edge-audit`
- `/operations/escalations`

定位：

- 面向自动化执行链路的状态、审批、告警、证据、模板、回放与审计。
- `autopilot/page.tsx` 是一个高密度控制台页，偏“运维面板”风格。

#### 3.2 策略、提示词、知识与 AI 资产

- `/operations/strategy`
- `/operations/strategy/industry`
- `/operations/prompts`
- `/operations/knowledge-base`
- `/operations/memory`
- `/operations/skills-pool`
- `/operations/lobster-config`
- `/operations/mcp`
- `/operations/usecases`
- `/operations/usecases/[id]`

定位：

- AI 资产和策略中枢。
- 跟 `ai-brain/*` 有功能邻近，存在双入口迹象。

#### 3.3 工作流与编排

- `/operations/workflows`
- `/operations/workflows/templates`
- `/operations/workflows/[id]/edit`
- `/operations/workflows/[id]/executions`
- `/operations/workflows/[id]/triggers`
- `/operations/workflow-board`
- `/operations/orchestrator`
- `/operations/scheduler`
- `/operations/calendar`

定位：

- 工作流定义、执行、生命周期、Webhook 触发、看板可视化。
- 这组页面最直接对应 OpenClaw 的编排层和流程治理。

#### 3.4 执行网络、渠道与监控

- `/operations/monitor`
- `/operations/sessions`
- `/operations/channels`
- `/operations/channels/feishu`
- `/operations/control-panel`
- `/operations/alerts`
- `/operations/traces`
- `/operations/patrol`

定位：

- 偏“控制平面”的状态看板、会话隔离、渠道管理、巡检与监控。

#### 3.5 数据、增长、实验

- `/operations/cost`
- `/operations/experiments`
- `/operations/feature-flags`
- `/operations/kanban`
- `/operations/leads`

定位：

- 兼顾增长分析、策略实验、成本观测和流程推进。

### 4. Fleet 执行网络域

- `/fleet`
- `/fleet/fingerprints`
- `/fleet/phone-pool`
- `/fleet/proxies`
- `/fleet/status`
- `/devices`
- `/nodes`

定位：

- 面向边缘节点、设备、账号环境、指令下发、终端和状态健康。
- `/fleet` 是一个明显的运营级设备网络页面，不只是列表页。

### 5. Campaign / CRM / Client 域

- `/campaigns`
- `/campaigns/new`
- `/crm/leads`
- `/crm/graph`
- `/client-center`
- `/client-mobile`
- `/leads`

定位：

- 任务、线索、客户关系和客户工作台。
- `/operations/leads` 与 `/leads`、`/crm/leads` 有领域重叠，需要后续梳理谁是主入口。

### 6. Dashboard / Lobster / AI Brain 域

#### 6.1 Dashboard

- `/dashboard`
- `/dashboard/lobster-pool`
- `/dashboard/lobster-pool/[id]`
- `/dashboard/lobster-pool/scorer`
- `/dashboard/lobster-skills`
- `/dashboard/lobster-skills/[lobsterId]`
- `/dashboard/settings/integrations`

定位：

- 偏历史 dashboard 风格的子系统，和首页主线指挥页并存。

#### 6.2 Lobster

- `/lobsters`
- `/lobsters/[id]`
- `/lobsters/runs`
- `/agents/cabinet`

定位：

- 龙虾实体、技能、运行记录、岗位展示。

#### 6.3 AI Brain

- `/ai-brain/content`
- `/ai-brain/prompt-lab`
- `/ai-brain/radar`
- `/ai-brain/studio`

定位：

- “AI 中台”式入口。
- 与 `operations/prompts`、`operations/strategy`、`operations/knowledge-base` 有平行关系。

### 7. Analytics / Settings / Partner / Public 域

#### 7.1 Analytics

- `/analytics/attribution`
- `/analytics/funnel`

#### 7.2 Settings

- `/settings/activities`
- `/settings/audit`
- `/settings/billing`
- `/settings/commercial-readiness`
- `/settings/integrations`
- `/settings/model-providers`
- `/settings/permissions`
- `/settings/policies`
- `/settings/team`
- `/settings/tenants`
- `/settings/white-label`
- `/settings/widget`

#### 7.3 Partner / Commercial

- `/partner/portal`
- `/reseller`
- `/vip`

#### 7.4 Public / Marketing / Legal

- `/landing`
- `/pricing`
- `/faq`
- `/help`
- `/login`
- `/register`
- `/forgot-password`
- `/reset-password`
- `/legal/privacy`
- `/legal/terms`
- `/legal/icp-ready`

### 8. 页面结构观察

- 当前前端同时存在三种页面气质：
  - 主线叙事页：首页、策略、任务、线索、Trace。
  - 高密度控制台页：Autopilot、Workflows、Fleet、Control Panel。
  - 外部商业页面：Landing、Pricing、Login。
- `operations/*` 已经像真正的“运营总控”，但 `dashboard/*`、`ai-brain/*`、`lobsters/*` 仍然保留了较多历史分区。
- 路由别名已经开始收敛旧入口到新入口，见 `next.config.js` 中的 redirects。

---

## 二、组件复用地图

### 1. 全局壳子层

#### 1.1 AppShell

- 组件：`components/layouts/AppShell.tsx`
- 作用：
  - 区分公开页面与控制台页面
  - 装配 Sidebar、Header、Main 区域
- 复用范围：
  - 所有控制台页面共享

#### 1.2 AppSidebar

- 组件：`components/layout/AppSidebar.tsx`
- 作用：
  - 管理总导航、移动端底部导航、分组折叠状态
  - 定义 5 组一级导航：operations、ai、fleet、data、settings
- 复用范围：
  - 全控制台共享

#### 1.3 Header

- 组件：`components/layouts/Header.tsx`
- 作用：
  - 主线阶段导航
  - 商业化、帮助、账单、告警快捷入口
  - 挂载 `GlobalSearch`
- 复用范围：
  - 全控制台共享

#### 1.4 GlobalSearch / LocaleSwitcher

- `GlobalSearch`
  - 被 Header 统一挂载
  - 做跨实体搜索，不由页面自己管理
- `LocaleSwitcher`
  - 也是 Header 内全局复用

这一层的含义：

- 页面层几乎不需要自己做顶部导航。
- 全局信息架构已经被封进 Shell，属于复用最强的一层。

### 2. 主线叙事层

#### 2.1 MainlineStageHeader

- 组件：`components/business/MainlineStageHeader.tsx`
- 当前复用页面：13 个
  - `/campaigns`
  - `/crm/leads`
  - `/onboard`
  - `/operations/autopilot/alerts`
  - `/operations/autopilot/approvals`
  - `/operations/autopilot/trace`
  - `/operations/log-audit`
  - `/operations/strategy`
  - `/operations/strategy/industry`
  - `/partner/portal`
  - `/settings/billing`
  - `/settings/commercial-readiness`
  - `/settings/model-providers`

含义：

- 这是目前最重要的“产品语义组件”之一。
- 它把页面从“功能页”提升成“主线中的某一步”。
- 后续如果继续统一产品语言，这个组件是最好的放大器。

#### 2.2 LeadsWorkspace

- 组件：`components/business/LeadsWorkspace.tsx`
- 当前由 `/operations/leads` 直接复用
- 特点：
  - 页面本身只是一层 route 包装
  - 线索汇总、详情弹层、解密动作都收在同一个业务组件里

含义：

- 这是“整页级业务组件”的典型。
- 如果后续 CRM 线索页和 operations 线索页要统一，优先围绕它抽象。

### 3. 列表与实体页层

#### 3.1 DataTable

- 组件：`components/data-table/DataTable.tsx`
- 当前复用页面：4 个
  - `/lobsters/runs`
  - `/operations/channels`
  - `/operations/workflows`
  - `/settings/audit`

特点：

- 已封装分页、排序、筛选、选择、批量操作、展开行。
- 但大量页面仍然手写原生 table，没有完全收口到 DataTable。

#### 3.2 EntityListPage

- 组件：`components/layout/EntityListPage.tsx`
- 当前复用：4 处
- 典型页面：
  - `/campaigns`

特点：

- 更偏“列表页骨架”，而不是数据表本身。
- 可以跟 DataTable 组合，但目前很多页面只复用了壳子，没有复用表格。

#### 3.3 状态徽标与上下文菜单

- `CampaignStatusBadge`
- `LobsterStatusBadge`
- `LifecycleBadge`
- `EdgeNodeContextMenu`
- `LobsterContextMenu`
- `WorkflowContextMenu`

特点：

- 这些是实体型组件，解决的是一致性展示和行级操作。
- 已经形成“实体对象 -> Badge / ContextMenu”的复用雏形。

### 4. 工作流与治理层

#### 4.1 WorkflowBoard

- 组件：`components/workflow/WorkflowBoard.tsx`
- 当前直接复用页面：1 个
  - `/operations/workflow-board`

#### 4.2 工作流家族组件

- `WorkflowBoard`
- `StepCard`
- `ApprovalPanel`
- `WorkflowHeader`
- `LobsterRoster`

特点：

- 这一组已经是一个子设计系统。
- 虽然当前页面复用范围不大，但内部结构明确，适合继续扩张到 workflow 详情、执行态、审批态页面。

#### 4.3 DangerActionGuard / ConcurrencyStatusBar

- `DangerActionGuard`
  - 用于危险动作确认，当前在 workflows 等治理型页面较集中
- `ConcurrencyStatusBar`
  - 当前主要在 workflows 页面使用

含义：

- 治理型页面已经开始有独立的交互模式，而不只是基础 Button + Dialog。

### 5. 图表与指标层

#### 5.1 共享图表组件

- `ExecutionTrendChart`
  - 当前复用页面：2 个
  - `/`
  - `/dashboard/lobster-pool`
- `ChartAnnotations`
  - 2 处
- `ChannelPieChart`
  - 1 处
- `LobsterBarChart`
  - 1 处
- `LobsterRadarChart`
  - 1 处
- `QualityScoreChart`
  - 1 处

#### 5.2 Lobster 指标图家族

- `CostChart`
  - 2 处
- `TokenUsageChart`
  - 2 处
- `DimensionRadar`
  - 1 处
- `StatusCard`
  - 4 处

特点：

- 图表组件已经开始模块化，但复用面仍偏分散。
- 首页和 dashboard 子系统的图表语言还没有完全统一成一套指标框架。

### 6. Fleet / Edge 子域组件

- `AddNodeModal`
- `EdgeTerminalPanel`
- `EdgeNodeContextMenu`

当前直接复用看起来还比较集中，多数在 `/fleet` 页面内自用。

含义：

- Fleet 域目前更像“单页富应用”。
- 组件已经拆开，但复用大多发生在同一业务子域内部，而不是跨域。

### 7. 基础 UI 层

这一层是最广泛但也最松散的复用层。

- `Button`
  - 当前至少 18 个页面或组件直接引入
- `Card`
  - 当前至少 17 个页面或组件直接引入
- `Dialog`
  - 9 处
- `Form`
  - 7 处
- `Input`
  - 6 处
- `Textarea`
  - 3 处
- `Switch`
  - 3 处
- `Slider`
  - 2 处
- `Progress`
  - 2 处
- `Skeleton`
  - 5 处

观察：

- 基础 UI 存在，但页面层仍然大量直接写 Tailwind 结构。
- 这意味着设计系统“有基础，但约束不够强”。

### 8. 数据和上下文层

#### 8.1 Providers

- `QueryClientProvider`
- `TenantProvider`
- `AlertCenterProvider`
- `CampaignStoreProvider`
- 分析埋点和全局 Toast 运行时

#### 8.2 API 与服务

- `services/api.ts`
  - 唯一 Axios 客户端
  - JWT、错误映射、全局 Toast、preview mock adapter
- `services/endpoints/*`
  - 按业务域拆分

#### 8.3 Hook 层

- query hooks
  - `useCampaigns`
  - `useDashboardMetrics`
  - `useLeads`
- domain hooks
  - `useWorkflowExecutionStream`
  - `useScopeAlertFeed`
  - `useScopeRolloutTrend`
  - `useMQTT`

含义：

- 当前架构是“页面直接调 hooks / endpoints”的客户端驱动模式。
- 组件复用不仅发生在 UI 层，也发生在服务与上下文层。

---

## 三、复用强弱判断

### 1. 复用最强

- `AppShell`
- `AppSidebar`
- `Header`
- `GlobalSearch`
- `LocaleSwitcher`
- `Button`
- `Card`
- `TenantContext`
- `services/api.ts`

这层决定的是整站统一体验和工程底座。

### 2. 复用中等，但产品价值高

- `MainlineStageHeader`
- `DataTable`
- `EntityListPage`
- `DangerActionGuard`
- `ExecutionTrendChart`
- `StatusCard`

这层最值得继续投资，因为它们已经开始影响多个业务域，但还没完全统一。

### 3. 复用较弱，但有明确子域价值

- `WorkflowBoard` 及工作流家族
- Fleet 子域组件
- Lobster 图表与详情组件
- Knowledge / Prompt / AI Studio 相关页面内组件

这层适合按子系统继续打磨，而不是一开始就强行全局抽象。

---

## 四、当前前端结构判断

### 1. 已经形成的结构

- 一个全局控制台壳子
- 一条越来越明确的主线叙事页面族
- 几个高密度控制台子域：Autopilot、Workflow、Fleet
- 一套初步可用的 UI 和表格基础设施

### 2. 仍然并存的结构

- 主线控制台
- 历史 dashboard 子系统
- AI Brain 子系统
- Lobster 子系统
- 外部商业页面

这说明项目已经从“多块功能并行试探”走到了“开始收敛主入口”的阶段，但还没有完全完成信息架构收口。

### 3. 目前最适合继续统一的点

- 用 `MainlineStageHeader` 继续统一主线页面语言
- 把更多列表页从手写 table 收口到 `DataTable`
- 把 Autopilot、Workflow、Fleet 的页面级模式沉淀成可复用的“控制台页模板”
- 梳理 `dashboard/*`、`ai-brain/*`、`operations/*` 三套入口之间的主从关系

### 4. 当前风险点

- 页面很多，但不少仍是单页定制实现，维护成本会持续上升
- i18n 接了壳子层，但页面文本还没有统一抽离
- 仓库里已有明显乱码文本，说明编码一致性需要单独治理
- E2E 选择器和页面实现已经出现轻微漂移迹象

---

## 五、建议的后续拆法

如果继续往下做，最推荐按下面三步推进：

1. 先画“主线页面体系图”
   - 首页、首启、策略、任务、线索、Trace、商业化之间的跳转和责任边界。
2. 再画“控制台模板图”
   - 主线页模板
   - 数据表页模板
   - 高密度控制台页模板
   - 详情页模板
3. 最后做“组件收口清单”
   - 哪些手写 table 迁到 DataTable
   - 哪些页面引入 MainlineStageHeader
   - 哪些子域适合抽共用 Panel、MetricCard、FilterBar
