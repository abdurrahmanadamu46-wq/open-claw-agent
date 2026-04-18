# AI 前端补位交付范围清单

Date: 2026-04-17

## 结论

AI 前端补位建议只打包 owned 页面、owned 局部组件、QA smoke、交接文档和辅助承接页。

当前工作区里存在主入口、侧边栏、Header、群协作 contract / 类型相关变更，这些不应默认归入 AI 前端补位交付包，需要对应 owner 单独确认。

## 建议纳入 AI 前端补位交付包

### 群协作区

- `web/src/app/collab/page.tsx`
- `web/src/app/collab/reports/page.tsx`
- `web/src/app/collab/approvals/page.tsx`
- `web/src/components/collab/CollabMetricCard.tsx`
- `web/src/components/collab/CollabRecordCard.tsx`

交付说明：

- 三页统一消费 `group-collab` contract。
- 有加载态、空状态、错误态。
- 有联调责任提示。

### 主管能力树

- `web/src/app/lobsters/[id]/capabilities/page.tsx`
- `web/src/components/lobster/SupervisorCapabilityTree.tsx`
- `web/src/lib/lobster-capability-tree.ts`

交付说明：

- 页面能表达“主管 -> 细化岗位”。
- 支持从主管详情页进入能力树页。
- 有加载态、空状态、错误态。

### 辅助承接页

- `web/src/app/operations/tenant-cockpit/page.tsx`
- `web/src/app/operations/control-panel/page.tsx`
- `web/src/app/operations/frontend-gaps/page.tsx`

交付说明：

- `tenant-cockpit` 只保留为 schema 详情页 / 治理辅助页。
- `control-panel` 只保留为后台资源 CRUD 控制面。
- `frontend-gaps` 作为 QA / 联调口径清单页。

### 直接相关局部组件

- `web/src/components/operations/IntegrationHelpCard.tsx`

交付说明：

- 给 collab 三页和能力树页提供统一联调责任提示。
- 明确数据模型、读接口、blocker 分别找谁。

### 测试与交接

- `web/e2e/ai-frontend-owned-surfaces.spec.ts`
- `web/e2e/run-owned-surfaces-smoke.cjs`
- `web/package.json`
- `web/docs/AI_FRONTEND_FILL_HANDOFF_2026-04-17.md`
- `web/docs/AI_FRONTEND_FILL_DELIVERY_SCOPE_2026-04-17.md`

交付说明：

- 新增 `npm run test:e2e:owned`。
- 覆盖 `/collab`、`/collab/reports`、`/collab/approvals`、`/lobsters/strategist/capabilities`、`/operations/frontend-gaps`。

## 需要其他 owner 确认，不建议直接归入 AI 前端补位包

### 前端工程师 owning 的主入口和主壳层

- `web/src/app/page.tsx`
- `web/src/components/layout/AppSidebar.tsx`
- `web/src/components/layouts/Header.tsx`

原因：

- 链路 A 主入口 `/` 已由前端工程师明确拥有。
- AI 前端补位不再和 `/` 抢语义。
- 如果这些文件要合并，需要前端工程师确认。

### AI 群协作集成工程师 / 后端 owning 的 contract 和类型

- `web/src/services/endpoints/group-collab.ts`
- `web/src/types/integrations.ts`

原因：

- 群协作对象模型和接口契约不由 AI 前端补位定义。
- AI 前端补位只消费既有 contract。
- 如果这些文件要合并，需要 AI群协作集成工程师和后端工程师确认。

### 非 owned build-unblock 修复

- `web/src/app/operations/memory/page.tsx`
- `web/src/app/operations/channels/xiaohongshu/page.tsx`

原因：

- 这两个文件不是 AI 前端补位目标页面。
- 但它们曾阻塞完整 `npm run build`。
- 本轮做的是最小 build-unblock 修复。
- 如果最终交付包要求严格只含 owned 页面，可单独让对应 owner 认领这两个修复。

## 已通过验证

## 一键范围报告

Command:

```powershell
npm run scope:ai-frontend-fill
```

用途：

- 打印 AI 前端补位建议交付包。
- 打印需要其他 owner 确认的文件。
- 打印非 owned build-unblock 修复。
- 附带建议验证命令。

### Owned surfaces smoke

Command:

```powershell
npm run test:e2e:owned
```

Result:

```text
5 passed
```

### Full production build

Command:

```powershell
npm run build
```

Result:

```text
BUILD_EXIT=0
```

## 建议合并策略

1. AI 前端补位交付包优先合入 owned 页面和直接相关局部组件。
2. `page.tsx`、`AppSidebar.tsx`、`Header.tsx` 由前端工程师确认后再合。
3. `group-collab.ts`、`integrations.ts` 由 AI群协作集成工程师和后端工程师确认后再合。
4. `memory/page.tsx`、`xiaohongshu/page.tsx` 的 build-unblock 修复可以由对应 owner 认领，或作为构建修复单独合入。
5. QA 验收起点统一为 `/`，不要从 `tenant-cockpit` 或 `control-panel` 开始链路 A。
