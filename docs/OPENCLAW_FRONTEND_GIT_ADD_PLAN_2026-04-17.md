# OpenClaw 前端建议 Git Add 清单

> 日期：2026-04-17
> 用途：给提交前执行人一份可复制的 staging 计划。本文只提供建议命令，不代表已经执行 `git add`。

## 1. 总原则

这次提交建议只包含前端交付与前端收尾相关文件。

不要混入：

- `backend/dist/**`
- `dragon-senate-saas-v2/**`
- `edge-runtime/**`
- `packages/lobsters/**`
- `web/.next/**`
- `web/.next-*`
- `web/test-results/**`
- `dragon-senate-saas-v2/__pycache__/**`
- `*.sqlite`
- `*.pyc`

## 2. 建议拆分为两个提交

### 提交 1：前端交付入口与验证链

建议提交内容：

```bash
git add .gitignore
git add web/package.json
git add web/src/app/page.tsx
git add web/src/app/api/release-gate/latest/route.ts
git add web/src/app/operations/delivery-hub/page.tsx
git add web/src/app/operations/project-closeout/page.tsx
git add web/src/app/operations/learning-loop-report/page.tsx
git add web/src/components/operations/DeliveryHubSummaryButton.tsx
git add web/src/components/operations/FrontendCloseoutVerificationSection.tsx
git add web/src/lib/delivery-evidence.ts
git add web/src/lib/release-gate-client.ts
git add web/scripts/verify-frontend-closeout.cjs
git add web/scripts/capture-critical-demo-screens.cjs
git add web/scripts/scan-operations-surface-quality.cjs
```

建议提交信息：

```text
frontend: finalize delivery hub and closeout evidence flow
```

### 提交 2：前端交付文档与客户材料

建议提交内容：

```bash
git add docs/OPENCLAW_FRONTEND_DELIVERY_INDEX_2026-04-17.md
git add docs/OPENCLAW_FRONTEND_FINAL_DELIVERY_PACKAGE_2026-04-17.md
git add docs/OPENCLAW_FRONTEND_FINAL_AUDIT_2026-04-17.md
git add docs/OPENCLAW_FRONTEND_PRECOMMIT_GROUPING_2026-04-17.md
git add docs/OPENCLAW_FRONTEND_CLOSEOUT_SIGNOFF_2026-04-17.md
git add docs/OPENCLAW_CUSTOMER_DELIVERY_BRIEF_2026-04-17.md
git add docs/OPENCLAW_CUSTOMER_DELIVERY_DECK_2026-04-17.md
git add docs/OPENCLAW_PROJECT_FINAL_CLOSEOUT_2026-04-17.md
git add docs/OPENCLAW_PROJECT_FINAL_STATUS_2026-04-17.md
git add docs/OPENCLAW_FINAL_DOCUMENT_INDEX_2026-04-17.md
```

建议提交信息：

```text
docs: add frontend final delivery package and customer handoff
```

## 3. 可选文件

这些文件当前在前端交付链里有价值，但是否提交取决于是否希望把更大范围的最终收口文档也一起纳入本次提交：

```bash
git add docs/OPENCLAW_FINAL_GO_NO_GO_DECISION_2026-04-17.md
git add docs/OPENCLAW_FINAL_COMMAND_ACTION_CHECKLIST_2026-04-17.md
git add docs/OPENCLAW_EXECUTIVE_BRIEF_2026-04-17.md
git add docs/OPENCLAW_A02_A04_FINAL_GATE_TRACKER_2026-04-17.md
git add docs/OPENCLAW_LEARNING_LOOP_FINAL_HANDOFF_2026-04-17.md
```

如果当前目标只是“前端交付包”，这些可以后置或由项目总控统一提交。

## 4. 不建议加入的文件

明确不要在这次前端交付提交里执行：

```bash
git add web/test-results
git add web/.next
git add web/.next-closeout-*
git add web/.ms-playwright
git add backend/dist
git add dragon-senate-saas-v2/__pycache__
git add dragon-senate-saas-v2/data
```

## 5. `web/tsconfig.json` 注意事项

`web/tsconfig.json` 当前仍显示历史差异，主要是：

- BOM 差异
- `.next-codex-build/types/**/*.ts` include 差异

如果这次要严格控制提交范围，建议先单独确认是否要提交这个文件。

建议：

- 如果团队需要保留 `.next-codex-build/types/**/*.ts`，可以提交。
- 如果不确定，不要和前端交付主提交混在一起。

## 6. 提交前必须复跑

提交前至少执行：

```bash
cd web && npx.cmd tsc --noEmit -p tsconfig.json
cd web && npm run verify:closeout:frontend
```

本轮最近一次结果：

```text
frontend-closeout: web/test-results/frontend-closeout-2026-04-17T08-51-48-680Z
frontend-critical: web/test-results/frontend-critical-screens-2026-04-17T08-52-27-732Z
operations-scan: web/test-results/operations-surface-scan-2026-04-17T08-54-05-578Z
```

## 7. 最终提醒

当前工作树里存在大量其他团队改动。不要为了“清爽”执行：

```bash
git reset --hard
git checkout -- .
```

也不要把这些其他团队改动混进前端交付提交。
