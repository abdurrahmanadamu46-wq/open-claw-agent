# Frontend Health Check 2026-04-13

参考文档：

- [FRONTEND_PAGE_COMPONENT_MAP.md](./FRONTEND_PAGE_COMPONENT_MAP.md)
- [FRONTEND_MAINLINE_TEMPLATE_BLUEPRINT.md](./FRONTEND_MAINLINE_TEMPLATE_BLUEPRINT.md)

本次体检维度：

- UI：页面结构是否清晰、是否形成统一模板、是否便于继续升级视觉系统
- 可维护性：页面是否过大、是否重复造局部组件、是否已经形成稳定抽象
- 一致性：导航、文案、列表、交互和测试契约是否统一

---

## 一、健康度快照

### UI

- 评分：`7/10`
- 结论：
  - 主线叙事已经成形
  - 控制台气质也很明确
  - 但模板化程度还不够，很多页面仍然是“高质量手工页”

### 可维护性

- 评分：`5/10`
- 结论：
  - 服务层和全局壳子是清楚的
  - 页面层重复明显
  - 大文件偏多，后续改动成本会持续上升

### 一致性

- 评分：`5/10`
- 结论：
  - Shell、主线导航、主题色已经统一
  - 但列表页、局部卡片、语言风格、测试契约仍然不统一

---

## 二、优先级结论

## P0

### 1. E2E 契约已经和页面实现发生漂移

证据：

- `e2e/live-release-regression.spec.ts:57`
  - 断言 `dashboard-root`
- `e2e/live-release-regression.spec.ts:60`
  - 依赖 `campaign-new-target-urls`
- `e2e/live-release-regression.spec.ts:116`
  - 点击 `lead-reveal-button`

但当前实现里：

- 首页根节点 [src/app/page.tsx](/F:/openclaw-agent/web/src/app/page.tsx#L131) 没有 `dashboard-root`
- 创建任务页 [src/app/campaigns/new/page.tsx](/F:/openclaw-agent/web/src/app/campaigns/new/page.tsx#L326) 只有 `campaign-new-submit`，没有 `campaign-new-target-urls`
- 线索详情页 [src/components/business/LeadsWorkspace.tsx](/F:/openclaw-agent/web/src/components/business/LeadsWorkspace.tsx#L221) 有“解密联系方式”按钮，但没有 `lead-reveal-button`

影响：

- Release E2E 很容易误报失败
- 前端改动已经无法被现有回归用例稳定覆盖
- 后续重构会进一步放大风险

建议动作：

- 先恢复关键 testid，或者同步更新 E2E
- 把“活跃回归路径”的 test contract 视为前端公共接口

### 2. 主线页面已经有稳定结构，但还停留在页面内手工拼装

证据：

- 任务页 [src/app/campaigns/page.tsx](/F:/openclaw-agent/web/src/app/campaigns/page.tsx#L38) 使用 `MainlineStageHeader`，并在同文件重复定义：
  - `SummaryCard` [src/app/campaigns/page.tsx](/F:/openclaw-agent/web/src/app/campaigns/page.tsx#L194)
  - `DecisionCard` [src/app/campaigns/page.tsx](/F:/openclaw-agent/web/src/app/campaigns/page.tsx#L219)
  - `InfoPanel` [src/app/campaigns/page.tsx](/F:/openclaw-agent/web/src/app/campaigns/page.tsx#L229)
- 线索工作台同样重复定义：
  - `SummaryCard` [src/components/business/LeadsWorkspace.tsx](/F:/openclaw-agent/web/src/components/business/LeadsWorkspace.tsx#L246)
  - `DecisionCard` [src/components/business/LeadsWorkspace.tsx](/F:/openclaw-agent/web/src/components/business/LeadsWorkspace.tsx#L271)
  - `InfoPanel` [src/components/business/LeadsWorkspace.tsx](/F:/openclaw-agent/web/src/components/business/LeadsWorkspace.tsx#L281)
- Trace 页也继续局部定义 `SummaryCard` [src/app/operations/autopilot/trace/page.tsx](/F:/openclaw-agent/web/src/app/operations/autopilot/trace/page.tsx#L459)

影响：

- 主线页面看起来统一，但实现层没有统一
- 后续改版需要在多个页面同时改同一套卡片结构
- 视觉升级和埋点升级都很难一次到位

建议动作：

- 先抽：
  - `MetricCard`
  - `DecisionCard`
  - `InfoPanel`
  - `MainlineWorkspacePage`
- 第一批改造页：
  - `/campaigns`
  - `/operations/leads`
  - `/operations/strategy`
  - `/operations/autopilot/trace`

## P1

### 3. 列表页模式只完成了一半，DataTable 没有真正成为默认方案

好的样本：

- 渠道页 [src/app/operations/channels/page.tsx](/F:/openclaw-agent/web/src/app/operations/channels/page.tsx#L112) 已经形成
  - `EntityListPage`
  - `ChannelPieChart`
  - `DataTable`
- 审计页 [src/app/settings/audit/page.tsx](/F:/openclaw-agent/web/src/app/settings/audit/page.tsx#L119) 已经形成
  - `EntityListPage`
  - `DataTable`
  - `ConfigDiffPanel`

仍然手写 table 的页面还有 16 个，典型包括：

- 任务页 [src/app/campaigns/page.tsx](/F:/openclaw-agent/web/src/app/campaigns/page.tsx#L135)
- 团队页 [src/app/settings/team/page.tsx](/F:/openclaw-agent/web/src/app/settings/team/page.tsx#L133)
- MCP 页 [src/app/operations/mcp/page.tsx](/F:/openclaw-agent/web/src/app/operations/mcp/page.tsx)
- Calendar、Control Panel、Reseller、Devices 等

影响：

- 分页、排序、批量选择、空状态、行展开交互都不一致
- 列表页后续很难统一主题和行为
- 测试选择器和表格结构也更容易漂移

建议动作：

- 先抽 `EntityTablePage`
- 第一批迁移：
  - `/campaigns`
  - `/settings/team`
  - `/operations/mcp`
  - `/operations/calendar`
  - `/reseller`

### 4. 设置页和管理页的语言与视觉语法不一致

最典型的例子是团队页：

- 标题直接写英文 [src/app/settings/team/page.tsx](/F:/openclaw-agent/web/src/app/settings/team/page.tsx#L47)
- 描述是英文 [src/app/settings/team/page.tsx](/F:/openclaw-agent/web/src/app/settings/team/page.tsx#L49)
- “Configured members” 也是英文 [src/app/settings/team/page.tsx](/F:/openclaw-agent/web/src/app/settings/team/page.tsx#L124)
- 同时用了大量 inline style，而不是当前控制台常见的主题化 Tailwind 模式

对比之下：

- `AppSidebar` 已经走 `next-intl` [src/components/layout/AppSidebar.tsx](/F:/openclaw-agent/web/src/components/layout/AppSidebar.tsx#L7)
- `layout.tsx` 的 metadata 也已经中文化 [src/app/layout.tsx](/F:/openclaw-agent/web/src/app/layout.tsx#L8)

影响：

- 用户会感到产品语言切换突兀
- 后续国际化工作会越来越碎片化
- 视觉系统收口时，设置类页面会成为例外岛

建议动作：

- 把 Settings 域做一轮“语义统一”
- 第一批页：
  - `/settings/team`
  - `/settings/tenants`
  - `/settings/permissions`
  - `/settings/policies`

### 5. 多个核心页面已经大到不适合继续在单文件里演进

当前体积：

- `src/app/operations/autopilot/page.tsx`：613 行
- `src/app/operations/autopilot/trace/page.tsx`：514 行
- `src/app/settings/billing/page.tsx`：511 行
- `src/app/operations/workflows/page.tsx`：457 行
- `src/app/fleet/page.tsx`：408 行

其中：

- `autopilot/page.tsx` 内部函数计数约 17 个
- `trace/page.tsx` 内部函数计数约 17 个

影响：

- 页面级改动非常容易引发局部回归
- 组件抽象被页面文件体积压制
- 审查、测试、多人协作都会越来越吃力

建议动作：

- 不要先重写视觉，先拆页面模块
- 建议拆成：
  - `sections/`
  - `panels/`
  - `hooks/`
  - `types.ts`

优先拆解顺序：

- `/operations/autopilot`
- `/operations/autopilot/trace`
- `/settings/billing`

## P2

### 6. Runtime 和 Console 子系统已经有明显模板，但还没有上升成模板组件

证据：

- Lobster Pool 页同时组合：
  - `ExecutionTrendChart`
  - `LobsterBarChart`
  - `TokenUsageChart`
  - `CostChart`
  - 本地 `OverviewCard`
  - [src/app/dashboard/lobster-pool/page.tsx](/F:/openclaw-agent/web/src/app/dashboard/lobster-pool/page.tsx#L146)
  - [src/app/dashboard/lobster-pool/page.tsx](/F:/openclaw-agent/web/src/app/dashboard/lobster-pool/page.tsx#L219)
- Fleet、Autopilot、Control Panel 也都在重复“指标条 + 操作面板 + 表格/日志”的结构

影响：

- 这些页面各自都能工作，但后面每次升级都要单独调结构
- 很难形成统一的“控制台页”气质

建议动作：

- 第二阶段再抽：
  - `OperationsConsolePage`
  - `RuntimeDashboardPage`
  - `SectionCard`
  - `ConsoleMetricStrip`

### 7. 目录命名还保留历史分叉，增加了认知成本

证据：

- `components/layout/`
- `components/layouts/`
- 两个目录下都存在 `Sidebar.tsx`

当前使用关系：

- `AppShell` 使用的是 [src/components/layout/AppSidebar.tsx](/F:/openclaw-agent/web/src/components/layout/AppSidebar.tsx)
- `src/components/layouts/Sidebar.tsx` 只是对 `layout/Sidebar` 的再导出

影响：

- 新人容易搞不清楚哪个目录是当前标准
- 后续抽模板时会继续增加目录层级噪音

建议动作：

- 在模板收口前先统一命名约定
- 选一个目录作为页面级布局标准

---

## 三、推荐排期

### 第一阶段：两周内完成

- 修复 E2E 契约漂移
- 抽 `MetricCard / DecisionCard / InfoPanel`
- 抽 `MainlineWorkspacePage`
- 把 `/campaigns` 和 `/operations/leads` 收成首批模板页

### 第二阶段：两到三周

- 抽 `EntityTablePage`
- 迁移 `/campaigns`、`/settings/team`、`/operations/mcp`、`/operations/calendar`、`/reseller`
- 统一 Settings 域的语言和视觉语法

### 第三阶段：三周以上

- 拆 `autopilot / trace / billing / fleet`
- 抽 `OperationsConsolePage`
- 抽 `RuntimeDashboardPage`
- 处理 `layout` / `layouts` 命名收口

---

## 四、最后建议

这次前端体检的结论不是“UI 要重画”，而是：

- 先把模板收口
- 再把列表统一
- 最后再做控制台页面框架化

如果只选一个最值钱的切入点，那就是：

- 先把 `/campaigns` 做成第一张标准主线模板页

因为它正好同时踩中了：

- 主线叙事
- 列表管理
- 局部卡片重复
- 测试契约

改好这一页，后面复制到 `/operations/leads` 和 `/operations/strategy` 的收益会最大。
