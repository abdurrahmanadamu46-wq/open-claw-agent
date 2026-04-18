# PR 标题

```text
frontend: finalize delivery hub and closeout evidence package
```

# PR 正文

## Summary

This PR finalizes the OpenClaw frontend delivery closeout package.

It adds the delivery hub, frontend closeout evidence flow, release-gate summary endpoint, customer-facing delivery materials, and final frontend handoff / audit documentation.

## What Changed

- Added `/operations/delivery-hub` as the final delivery navigation surface.
- Added release gate latest summary API: `/api/release-gate/latest`.
- Added frontend closeout verification command:

```bash
cd web && npm run verify:closeout:frontend
```

- Added critical screenshot evidence script for production-style page coverage.
- Added operations surface scan script for `operations` page coverage tracking.
- Added delivery / closeout docs for QA, project control, customer brief, customer deck, final audit, and precommit grouping.
- Surfaced latest frontend closeout status in:
  - `/`
  - `/operations/delivery-hub`
  - `/operations/project-closeout`
  - `/operations/learning-loop-report`

## Validation

Validated on a clean review worktree:

```bash
cd web && npx.cmd tsc --noEmit -p tsconfig.json
cd web && npm run verify:closeout:frontend
```

Latest clean-worktree evidence:

```text
F:/openclaw-agent-pr-review/web/test-results/frontend-closeout-2026-04-18T04-41-51-883Z
F:/openclaw-agent-pr-review/web/test-results/frontend-critical-screens-2026-04-18T04-42-31-600Z
F:/openclaw-agent-pr-review/web/test-results/operations-surface-scan-2026-04-18T04-43-59-657Z
```

Latest result:

- Frontend closeout: pass
- Critical screenshots: 57/57 passed
- Operations scan: 51/51 covered
- High-priority static issues: 0

## Review Focus

Please focus review on:

- Delivery hub and closeout evidence flow.
- Accuracy of frontend closeout status shown in operator console pages.
- Whether the docs are clear enough for QA / project control / customer-facing handoff.
- Whether the PR scope should be split further before merge.

## Explicit Non-Scope

This PR does not intentionally change:

- Cloud brain runtime behavior.
- Edge runtime execution behavior.
- Lobster role protocols.
- Video composition location.
- Workflow state persistence rules.
- Tenant-private knowledge boundaries.

It also does not include generated artifacts such as:

- `web/test-results/**`
- `web/.next/**`
- `web/.next-closeout-*`
- `backend/dist/**`
- `dragon-senate-saas-v2/data/**`
- `__pycache__/**`

## Remaining Notes

- `web/tsconfig.json` may still appear dirty in local worktrees because Next can temporarily add generated closeout type paths during build. The closeout script restores temporary `.next-closeout-*` entries after running.
- Customer-level external release should still respect A-02 / real-environment QA signoff rules.
- This PR is intended as a reviewable frontend delivery closeout package, not as a direct production go-live approval.

