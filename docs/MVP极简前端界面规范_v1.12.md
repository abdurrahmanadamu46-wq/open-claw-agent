# ClawCommerce MVP 极简前端界面规范 v1.12

> 为小军减负：砍掉一半花哨，先保 P0 大动脉与 P1 线索可见

---

## 原则

- UI 丑一点没关系，**数据流必须跑通**。
- 图表能省则省，先上「数字 + 简单列表」，再迭代可视化。

---

## 1. 数据大盘（极简版）

**保留**：
- 今日线索数、较昨日增长率（两个数字即可）
- 运行中任务数、节点健康率（两个数字）
- 近 7 天线索趋势：**一条简单柱状条或数字列表**即可，不必 Echarts 多配置。

**砍掉**：
- 多维度图表、下钻、实时刷新动画。后续再加。

---

## 2. 运营任务（核心）

**必须**：
- **创建任务**：一个极简表单（行业模板下拉、对标链接列表 1–20 条、content_strategy 用 TEMPLATE_DYNAMIC_RULES 映射），提交调 `POST /api/v1/campaigns`。成功即跳转列表或 Toast。
- **任务列表**：表格展示 campaign_id、模板、状态、日限、线索数、创建时间；状态用 Badge；**终止**按钮调 `POST /api/v1/campaigns/:id/terminate`。

**可延后**：
- 向导多步、进度条、高级筛选。先单页表单 + 列表即可。

---

## 3. 线索管理（核心）

**必须**：
- 列表：lead_id、campaign_id、联系方式（脱敏）、意向分、平台、抓取时间、webhook 状态。
- 意向分筛选（如 ≥80）由后端接口参数完成，前端只传 `intent_score_min`。
- **解锁查看**：点击某条调 `GET /api/v1/leads/:id/reveal`，弹窗或行内展示明文联系方式；审计由后端记录。

**可延后**：
- 导出 Excel、批量打标签、高级筛选。MVP 先列表 + 解锁。

---

## 4. 技术执行建议（小军）

- **类型与校验**：`shared/contracts.ts` 的 ICampaignConfig、TEMPLATE_DYNAMIC_RULES 用 Zod 包一层，前端 react-hook-form 复用，与后端校验同构。
- **请求层**：不手写 fetch/axios 类型；用小明 Swagger 生成 TypeScript 类型与 API Client（如 openapi-typescript-codegen），再封装 React Query hooks。
- **组件**：Shadcn UI 只加 table、form、select、button 等必要组件，不堆砌复杂组件。

---

## 5. 优先级对应

| 优先级 | 内容 |
|--------|------|
| P0     | 创建任务表单 → 后端 API → Agent 执行（Checklist 1+2） |
| P1     | 线索回传 → 后端落库 → 前端线索列表/大盘可见（Checklist 3+4） |
| P2     | 终止任务 + Agent 释放节点（Checklist 5） |
| 后迭代 | 大盘图表美化、向导多步、导出与批量操作 |
