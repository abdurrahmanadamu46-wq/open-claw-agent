# SuperHarbor Command Cabin

Thread: `sd-12`

Existing source anchor:

- [superharbor/README.md](/F:/openclaw-agent/superharbor/README.md)

## 1. Boundary & Contract

Protocol:

- Read model APIs: REST
- Live data: WebSocket optional

Input example:

```json
{
  "schema_version": "cabin.readmodel.request.v1",
  "tenant_id": "tenant_demo",
  "page": "dashboard"
}
```

Output example:

```json
{
  "schema_version": "cabin.readmodel.result.v1",
  "status": "success",
  "dashboard": {
    "online_nodes": 12,
    "today_tasks": 233
  }
}
```

## 2. Core Responsibilities

- Build ToB cockpit views
- Compose read models for dashboard, campaigns, tasks, leads
- Keep UI concerns out of main mission runtime

## 3. Fallback & Mock

- If live backend is unavailable, return mock read models
- Main execution chain must not depend on this UI layer

## 4. Independent Storage & Dependencies

- No required dedicated DB initially
- Optional cache for read model snapshots

## 5. Evolution Path

- Mock MVP
- Live dashboard
- Multi-tenant command cabin
