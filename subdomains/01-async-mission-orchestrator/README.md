# Async Mission Orchestrator

Thread: `sd-01`

Existing source anchors:

- [app.py](/F:/openclaw-agent/dragon-senate-saas-v2/app.py)

## 1. Boundary & Contract

Protocol:

- Submit: async REST
- Status: REST
- Push: Webhook or MQ event

Input example:

```json
{
  "schema_version": "mission.submit.v1",
  "trace_id": "trace_001",
  "request_id": "req_001",
  "tenant_id": "tenant_demo",
  "user_id": "admin",
  "task_description": "Build a strategy-only mission. No edge dispatch.",
  "industry_tag": "beauty",
  "response_mode": "lite",
  "constraints": {
    "allow_edge_dispatch": false,
    "budget_mode": "low_cost"
  }
}
```

Output example:

```json
{
  "schema_version": "mission.status.v1",
  "job_id": "job_001",
  "status": "running",
  "state": "running",
  "stage": "graph_execution",
  "progress": 0.45,
  "summary": "running senate graph",
  "request_id": null,
  "result": {},
  "error": null
}
```

## 2. Core Responsibilities

- Accept mission submissions
- Deduplicate, queue, run, retry, timeout
- Publish stage/progress/status
- Return lightweight and full result objects

## 3. Fallback & Mock

- If orchestration is unavailable, return `accepted + queued_local_only`
- If execution times out, return terminal `failed + timeout`
- Parent system must never block on mission completion

## 4. Independent Storage & Dependencies

- Dedicated task metadata store
- Dedicated queue transport
- Dedicated audit log

Recommended split:

- PostgreSQL for task state
- Redis Stream or RabbitMQ for queueing

## 5. Evolution Path

- In-process worker
- Dedicated queue worker
- Cost-aware scheduler
- Tenant isolation and priority lanes
