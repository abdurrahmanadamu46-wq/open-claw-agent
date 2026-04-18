# OpenClaw 前端提交前文件分组清单

> 日期：2026-04-17
> 用途：提交或交接前，区分哪些文件属于本轮前端交付包，哪些是生成物或其他团队改动，不应混入同一个提交

## 1. 当前结论

本轮前端交付已经完成，可以进入“提交前分组 / 归档 / 交接”阶段。

提交原则：

- 只提交前端交付相关源码、脚本和文档
- 不提交构建产物
- 不提交测试输出目录
- 不回滚其他团队或其他层的改动
- 不把 backend dist、dragon 数据库、pycache、`.next` 目录混进前端交付提交

## 2. 建议提交的前端交付文件

### 2.1 前端页面与组件

这些属于前端交付入口和收尾表达层：

```text
web/src/app/page.tsx
web/src/app/operations/delivery-hub/page.tsx
web/src/app/operations/project-closeout/page.tsx
web/src/app/operations/learning-loop-report/page.tsx
web/src/components/operations/DeliveryHubSummaryButton.tsx
web/src/components/operations/FrontendCloseoutVerificationSection.tsx
```

### 2.2 前端证据读取与验证脚本

这些属于一键收尾与证据链：

```text
web/src/lib/delivery-evidence.ts
web/src/lib/release-gate-client.ts
web/src/app/api/release-gate/latest/route.ts
web/scripts/verify-frontend-closeout.cjs
web/scripts/capture-critical-demo-screens.cjs
web/scripts/scan-operations-surface-quality.cjs
web/package.json
```

### 2.3 交付文档

这些属于本轮前端交付包：

```text
docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md
docs/OPENCLAW_FRONTEND_FINAL_DELIVERY_PACKAGE_2026-04-17.md
docs/OPENCLAW_FRONTEND_FINAL_AUDIT_2026-04-17.md
docs/OPENCLAW_FRONTEND_CLOSEOUT_SIGNOFF_2026-04-17.md
docs/OPENCLAW_CUSTOMER_DELIVERY_BRIEF_2026-04-17.md
docs/OPENCLAW_CUSTOMER_DELIVERY_DECK_2026-04-17.md
docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md
docs/OPENCLAW_PROJECT_FINAL_STATUS_2026-04-17.md
docs/OPENCLAW_FINAL_DOCUMENT_INDEX_2026-04-17.md
```

如果只想提交最小前端交付包，可以优先提交：

```text
docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md
docs/OPENCLAW_FRONTEND_FINAL_DELIVERY_PACKAGE_2026-04-17.md
docs/OPENCLAW_FRONTEND_FINAL_AUDIT_2026-04-17.md
web/src/app/operations/delivery-hub/page.tsx
web/scripts/verify-frontend-closeout.cjs
web/scripts/capture-critical-demo-screens.cjs
web/scripts/scan-operations-surface-quality.cjs
web/src/lib/delivery-evidence.ts
```

## 3. 不建议提交的生成物

这些属于本地生成物或大体积产物，不应进入前端交付提交：

```text
web/.next/
web/.next-*
web/.next-closeout-*
web/.ms-playwright/
web/.playwright-browsers/
web/test-results/
web/playwright-report/
backend/dist/
dragon-senate-saas-v2/__pycache__/
dragon-senate-saas-v2/data/*.sqlite
*.pyc
*.log
```

说明：

- `web/test-results/*` 是证据产物，可在最终回复里给路径，但不建议作为源码提交。
- `web/.next-closeout-*` 是一键前端收尾的临时 build 目录，应保留在本地或清理，不入库。
- `backend/dist/*` 是后端编译产物，不应混进前端交付提交。

## 4. 不要碰的其他团队改动

当前工作树里存在大量非前端交付范围改动，包括：

- `backend/src/**`
- `backend/dist/**`
- `dragon-senate-saas-v2/**`
- `edge-runtime/**`
- `packages/lobsters/**`
- `services/**`
- `memory/**`

这些可能来自后端、边缘、知识层、skills、角色协议或其他任务。除非明确收到指令，不要在前端提交里回滚、整理或混入这些文件。

## 5. 当前必须保留的验证命令

提交前建议至少跑：

```bash
cd web && npx.cmd tsc --noEmit -p tsconfig.json
cd web && npm run verify:closeout:frontend
```

当前一键前端收尾会覆盖：

- TypeScript
- 独立 build
- 57 个关键页面截图
- 51 个 operations 页面覆盖扫描

## 6. 当前最新可引用证据

以最新复跑结果为准。当前可引用样本：

```text
web/test-results/frontend-closeout-2026-04-17T08-51-48-680Z
web/test-results/frontend-critical-screens-2026-04-17T08-52-27-732Z
web/test-results/operations-surface-scan-2026-04-17T08-54-05-578Z
```

这些路径适合写进交付说明或最终回复，但不建议作为源码提交。

## 7. `tsconfig.json` 说明

`web/tsconfig.json` 当前在 git 中仍显示历史差异，主要是：

- BOM 差异
- `.next-codex-build/types/**/*.ts` include 差异

一键前端收尾命令已经会恢复运行过程中临时加入的 `.next-closeout-*` include，避免继续污染工作树。

如果要清理 `tsconfig.json` 的历史差异，需要单独决定是否保留 `.next-codex-build/types/**/*.ts`；不要在前端交付提交里随手回滚。

## 8. 建议提交策略

建议拆成两个提交：

1. 前端交付入口与验证链
   - delivery hub
   - closeout 脚本
   - evidence 读取
   - release gate 最新摘要
2. 前端交付文档与客户材料
   - final delivery package
   - final audit
   - customer brief
   - customer deck
   - final document index

如果必须压成一个提交，提交标题建议：

```text
frontend: finalize delivery hub and closeout evidence package
```

## 9. 最终交接建议

交接时先发：

```text
docs/OPENCLAW_FRONTEND_FINAL_DELIVERY_PACKAGE_2026-04-17.md
docs/OPENCLAW_FRONTEND_FINAL_AUDIT_2026-04-17.md
```

再发：

```text
/operations/delivery-hub
cd web && npm run verify:closeout:frontend
```

最后补充：

```text
docs/OPENCLAW_CUSTOMER_DELIVERY_BRIEF_2026-04-17.md
docs/OPENCLAW_CUSTOMER_DELIVERY_DECK_2026-04-17.md
```
