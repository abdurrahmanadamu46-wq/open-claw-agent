# Phase D Week 3 Execution Checklist

Status: in progress (2026-03-18 update)  
Scope: Work Package 5 (Frontend productionization + end-to-end integration hardening)

## Progress Snapshot (2026-03-18)

1. D5-01 ✅ Fleet read path switched to backend `/api/v1/fleet/nodes` in non-demo mode.
2. D5-02 ✅ Fleet control actions switched to backend `/api/v1/fleet/nodes/:id/offline` and `/api/v1/fleet/commands`.
3. D5-03 ✅ Error UX hardened on fleet/dashboard (visible error card + retry).
4. D5-04 ✅ Demo mode no longer implicit by missing API base; fail-fast enforced for staging/prod.
5. D5-05 ✅ Campaign backend contract aligned (`GET/POST/terminate`).
6. D5-06 ✅ Dashboard real API added (`GET /api/v1/dashboard/metrics`) + controlled fallback policy with telemetry.
7. D5-09 ✅ Added backend contract regression script `npm run test:contracts:week3`.
8. D5-07/D5-08/D5-10 ⏳ still open (staging live validation, browser E2E CI, bundle/perf baseline).

## Goals (Week 3)

1. Replace mock-first frontend paths with real backend APIs.
2. Keep demo mode as explicit fallback, not default runtime behavior.
3. Complete end-to-end regression for core business flows.

## Task Board (Jira-ready)

| ID | Title | Owner Role | Priority | Files / Modules | Deliverable | Acceptance Criteria |
|---|---|---|---|---|---|---|
| D5-01 | Replace fleet mock read path | Frontend Dev | P0 | `web/src/services/node.service.ts`, `web/src/app/fleet/page.tsx` | `getFleetNodes()` reads real `/api/v1/fleet/nodes` | Fleet page shows backend data in non-demo mode |
| D5-02 | Replace fleet control mock actions | Frontend Dev | P0 | `web/src/services/node.service.ts` | Real API calls for offline/command dispatch | Node actions update UI from backend response |
| D5-03 | Standardize API error UX | Frontend Dev | P0 | `web/src/services/api.ts`, fleet/campaign pages | Consistent toast + retry hints + auth redirect behavior | 4xx/5xx errors are visible and non-blocking for navigation |
| D5-04 | Demo mode gating hardening | Frontend Dev | P0 | `web/src/services/demo-mode.ts`, env docs | Explicit demo switch policy per environment | Production build cannot accidentally default to demo behavior |
| D5-05 | Campaign flow backend contract alignment | Frontend + Backend Dev | P0 | `web/src/services/endpoints/campaign.ts`, backend campaign APIs | Request/response contracts synchronized | Create/terminate/list campaign works end-to-end |
| D5-06 | Dashboard data source hardening | Frontend Dev | P1 | `web/src/services/endpoints/dashboard.ts`, dashboard pages | Prefer real API with controlled fallback policy | Fallback only on configured conditions; telemetry logs fallback reason |
| D5-07 | Integrations page live wiring validation | Frontend + Backend Dev | P1 | `web/src/services/endpoints/integrations.ts`, backend integrations module | Live GET/PATCH and webhook test path validated | Integrations save/read/test all pass in staging |
| D5-08 | E2E regression suite (core journeys) | QA + Frontend Dev | P0 | e2e scripts + CI | Automated regression for login, dashboard, fleet, campaign, missions | CI blocks merge on core flow break |
| D5-09 | API contract tests for frontend consumers | QA + Backend Dev | P1 | contract test layer | Stable API schema for frontend endpoints | Breaking API changes detected pre-merge |
| D5-10 | Frontend perf/bundle sanity pass | Frontend Dev | P2 | Next build stats, route-level optimization | Performance baseline and route hydration sanity | No critical route regression above agreed threshold |

## Integration Focus Areas

1. Fleet:
   - list nodes, node status, force offline, dispatch command.
2. Campaign:
   - list, create, terminate, status updates.
3. Dashboard:
   - metrics fetch, chart rendering, error fallback.
4. Integrations:
   - read tenant config, patch config, webhook test.

## Environment and Config Hardening

1. Define environment matrix:
   - `dev`, `staging`, `prod`.
2. Required frontend env keys:
   - `NEXT_PUBLIC_API_BASE_URL`
   - explicit `NEXT_PUBLIC_USE_MOCK` policy (disabled in staging/prod).
3. Add startup/runtime checks:
   - warn or fail fast on invalid API base URL in non-demo environments.

## Test Plan (Week 3)

### Automated

1. Frontend integration tests:
   - service layer request/response parsing and error handling.
2. E2E core journeys:
   - login -> dashboard -> fleet action -> campaign create -> mission flow.
3. Contract tests:
   - validate backend payload shape used by frontend hooks/pages.

### Manual

1. Non-demo staging smoke:
   - verify all major pages consume live data.
2. Failure simulation:
   - backend unavailable, auth expired, partial API errors.
3. Demo mode sanity:
   - explicit demo toggle works, and is isolated from staging/prod.

## Definition of Done (Week 3)

1. All P0 tasks complete and merged.
2. Core pages no longer rely on hardcoded mock data in non-demo mode.
3. E2E regression suite passes in CI.
4. Frontend env policy documented and validated in staging.
5. Cross-team sign-off from frontend, backend, and QA.

## Suggested Ticket Labels

- `phase-d`
- `week-3`
- `frontend`
- `integration`
- `e2e`
- `contract-test`
- `productionization`
