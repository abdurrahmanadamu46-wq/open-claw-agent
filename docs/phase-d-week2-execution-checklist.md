# Phase D Week 2 Execution Checklist

Status: draft for implementation kickoff  
Scope: Work Package 3 (Observability + Alerting)

## Goals (Week 2)

1. Build end-to-end tracing across `web -> backend -> queue/worker -> agent -> node`.
2. Standardize structured logging and correlation fields.
3. Set up actionable SLI dashboards and alert routing.

## Task Board (Jira-ready)

| ID | Title | Owner Role | Priority | Files / Modules | Deliverable | Acceptance Criteria |
|---|---|---|---|---|---|---|
| D3-01 | Add trace context standard | Backend Dev | P0 | `backend/src/main.ts`, middleware/interceptor layer | Request trace context with `traceId/spanId` propagation | Every API request has traceId in logs and response headers |
| D3-02 | Instrument HTTP endpoints | Backend Dev | P0 | `backend/src/*controller.ts`, service layer | OTel spans for critical REST endpoints | 95%+ API paths visible in tracing backend |
| D3-03 | Instrument Socket.IO gateways | Backend Dev | P0 | `backend/src/gateway/agent-cc.gateway.ts`, `backend/src/gateway/fleet-websocket.gateway.ts`, `backend/src/gateway/lobster.gateway.ts` | Connection/event spans + correlation fields | WS connect, dispatch, progress, complete events traceable |
| D3-04 | Instrument BullMQ pipeline | Backend Dev | P0 | `backend/src/autopilot/workers/*.ts`, coordinator service | Queue enqueue/dequeue/process/fail spans | A single job can be traced across all worker stages |
| D3-05 | Instrument agent runtime | Runtime Dev | P0 | `src/server/agent-dashboard-server.ts`, `src/agent/node-manager.ts` | Trace/log for internal execute/terminate/update flow | Internal API calls and node state transitions have correlation IDs |
| D3-06 | Structured log schema rollout | Backend Dev | P0 | backend + agent logger wrappers | Unified JSON log schema | Logs include `traceId tenantId campaignId nodeId taskId eventType` |
| D3-07 | Sensitive data redaction | Backend Dev | P1 | logger/middleware layer | Redaction for token/api key/phone/payload secrets | No secret leakage in sampled production-like logs |
| D3-08 | SLI dashboard build | SRE/Ops | P0 | Monitoring stack config | Dashboard for core SLI/SLO views | Dashboard covers API success, queue lag, node online, task completion |
| D3-09 | Alert rules and paging routes | SRE/Ops | P0 | Alertmanager/notification config | P1/P2/P3 rules with escalation | Alert fires correctly in synthetic tests and reaches on-call |
| D3-10 | Observability smoke test script | QA/Backend Dev | P1 | `scripts/` + CI job | Scripted trace/log/alert verification | CI nightly run catches tracing breaks |

## Core SLI Definitions

1. API success rate:
   - numerator: non-5xx responses
   - denominator: all API responses
2. Task dispatch latency:
   - from backend dispatch request accepted to node ACK
3. Task completion rate:
   - successful completions / total started tasks
4. Queue health:
   - queue depth, processing lag, retry rate, DLQ growth
5. Node availability:
   - online nodes / total registered nodes

## Implementation Notes

### Tracing

1. Use a single trace propagation format (W3C Trace Context).
2. Propagate correlation headers into:
   - backend REST handlers
   - Socket.IO event metadata
   - BullMQ job data/options
   - internal HTTP calls to agent runtime
3. Ensure worker-created child spans link back to originating request/job trace.

### Logging

1. Emit JSON logs only in non-local environments.
2. Required fields:
   - `timestamp`, `level`, `service`, `traceId`, `tenantId`, `campaignId`, `nodeId`, `taskId`, `message`
3. Redaction rules:
   - auth token, API key, signature headers, phone full number, raw credential payload.

### Alerting

1. P1:
   - API success rate below threshold for sustained window.
   - queue consumers stalled.
2. P2:
   - retry spikes, node offline ratio spike.
3. P3:
   - rising latency trend, non-critical integration failures.

## Test Plan (Week 2)

### Automated

1. Trace propagation tests:
   - `HTTP -> worker` correlation assertion.
   - `HTTP -> internal agent API` correlation assertion.
2. Log schema tests:
   - enforce required fields.
   - assert redaction for known sensitive keys.
3. Synthetic alert tests:
   - trigger known thresholds and validate route.

### Manual

1. Run one end-to-end campaign and inspect trace graph:
   - expected: contiguous flow across backend, queue, agent, node events.
2. Drop one worker process intentionally:
   - expected: queue lag alert and pager notification.
3. Inject invalid token payload:
   - expected: sanitized logs with no secret value exposure.

## Definition of Done (Week 2)

1. All P0 tasks complete and merged.
2. Dashboards published and shared with on-call team.
3. Alert routing verified by synthetic test.
4. End-to-end trace for at least one full task run is visible.
5. Log redaction validation passed in staging.

## Suggested Ticket Labels

- `phase-d`
- `week-2`
- `observability`
- `tracing`
- `logging`
- `alerting`
- `slo`

