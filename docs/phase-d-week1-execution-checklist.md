# Phase D Week 1 Execution Checklist

Status: draft for implementation kickoff  
Scope: Work Package 1 (Security/Auth) + Work Package 2 (Reliability/Idempotency)

## Goals (Week 1)

1. Remove unsafe defaults and enforce startup-time config validation.
2. Add tenant-safe auth boundaries for API and service-to-service calls.
3. Add idempotency and failure-handling baseline for queue-driven tasks.

## Task Board (Jira-ready)

| ID | Title | Owner Role | Priority | Files / Modules | Deliverable | Acceptance Criteria |
|---|---|---|---|---|---|---|
| D1-01 | Enforce required env vars (backend) | Backend Dev | P0 | `backend/src/main.ts`, `backend/src/app.module.ts` | Startup validator for required secrets and ports | App fails fast on missing required vars; no weak default secrets remain |
| D1-02 | Enforce required env vars (LLM gateway) | Backend Dev | P0 | `backend/src/llm/llm.service.ts` | Reject startup when LLM gateway base/token policy is invalid | `NEW_API_BASE_URL` format validated; token policy documented and enforced |
| D1-03 | Replace hardcoded activation codes | Backend Dev | P0 | `backend/src/gateway/lobster.gateway.ts`, integrations storage module | Activation code lookup via Redis/DB, with revoke/expiry | Hardcoded allowlist removed; revoked code disconnects active client |
| D1-04 | Protect internal agent endpoints | Backend Dev | P0 | `src/server/agent-dashboard-server.ts`, backend caller adapter | HMAC or mTLS validation for `/internal/*` | Unsigned call rejected with 401/403; signed call accepted |
| D1-05 | Tenant boundary guard coverage | Backend Dev | P1 | `backend/src/*controller.ts`, auth guards | Consistent tenant scope checks in API surface | Cross-tenant access tests fail as expected |
| D2-01 | Add task idempotency key policy | Backend Dev | P0 | `backend/src/autopilot/*`, `src/agent/node-manager.ts` | Idempotency strategy + implementation | Duplicate message does not duplicate side effects |
| D2-02 | BullMQ retry + DLQ baseline | Backend Dev | P0 | `backend/src/autopilot/workers/*.ts`, queue constants | Standard retry/backoff/dead-letter pattern | Failed jobs route to DLQ after max attempts |
| D2-03 | Redis failure handling policy | Backend Dev | P1 | Node manager + workers + integration services | Graceful degradation rules and error classes | Read-path degrade and write-path block behavior covered by tests |
| D2-04 | Task state persistence baseline | Backend Dev | P1 | queue workers + runtime state storage | Durable task states: queued/running/success/failed/canceled | Restart does not lose in-flight terminal state visibility |
| D2-05 | Ops runbook for DLQ replay | SRE/Ops | P1 | `docs/` runbook | Replay steps and safety checks | On-call can replay a failed task without code owner support |

## Implementation Notes

### Security/Auth (D1)

1. Add a central config validator in backend startup.
2. Remove permissive defaults:
   - `JWT_SECRET` must be required.
   - `NEW_API_BASE_URL` must be required in non-dev env.
3. Move activation code source to Redis/DB:
   - key schema example: `activation:code:{code}` with fields `status`, `tenantId`, `expiresAt`.
   - status values: `ACTIVE`, `REVOKED`, `EXPIRED`.
4. Add service auth for internal routes:
   - HMAC header set (example): `x-internal-signature`, `x-internal-timestamp`.
   - reject stale timestamp and invalid signature.

### Reliability/Idempotency (D2)

1. Define idempotency key:
   - `tenantId:campaignId:taskId:nodeId`.
2. Before executing side effects:
   - check key status in Redis.
   - if already `done`, skip execution.
3. Standardize BullMQ worker options:
   - bounded attempts.
   - exponential backoff.
   - dead-letter queue on terminal fail.
4. Persist task state transitions:
   - `queued -> running -> success|failed|canceled`.
   - store timestamps and error summary.

## Test Plan (Week 1)

### Automated

1. Config validation tests:
   - startup fails on missing required vars.
2. Auth tests:
   - invalid token, invalid tenant, invalid internal signature.
3. Idempotency tests:
   - replaying same job does not re-dispatch.
4. Queue failure tests:
   - max retries then DLQ.

### Manual

1. Revoke activation code while client is connected:
   - expected: connection is terminated and reconnect blocked.
2. Simulate Redis transient error:
   - expected: no silent success on write-critical paths.
3. Replay one DLQ job via runbook:
   - expected: single successful recovery without duplicate side effects.

## Definition of Done (Week 1)

1. All P0 tasks complete and merged.
2. New tests pass in CI.
3. No critical endpoint uses unsafe default secrets.
4. Internal endpoints reject unsigned traffic.
5. DLQ flow and replay runbook validated once in staging.

## Suggested Ticket Labels

- `phase-d`
- `security`
- `auth`
- `reliability`
- `idempotency`
- `bullmq`
- `redis`
- `week-1`

