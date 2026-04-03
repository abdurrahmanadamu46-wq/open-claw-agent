# CTI Engine

Thread: `sd-08`

Existing source anchor:

- [services/cti-engine-service/README.md](/F:/openclaw-agent/services/cti-engine-service/README.md)

## 1. Boundary & Contract

Protocol:

- Telemetry submit: MQ or stream
- Threat analysis: REST

Input example:

```json
{
  "schema_version": "cti.analyze.request.v1",
  "tenant_id": "tenant_demo",
  "events": [
    {
      "node_id": "edge-001",
      "ip": "1.2.3.4",
      "task_rate": 320,
      "success_rate": 0.995
    }
  ]
}
```

Output example:

```json
{
  "schema_version": "cti.analyze.result.v1",
  "status": "success",
  "alerts": [
    {
      "node_id": "edge-001",
      "threat_level": "critical",
      "action": "TRIGGER_HONEYPOT_PROTOCOL"
    }
  ]
}
```

## 2. Core Responsibilities

- Detect sybil clusters and machine-room behavior
- Score threats
- Mark honeypot targets
- Publish suggested control actions

## 3. Fallback & Mock

- If unavailable, parent system marks risk as unknown
- Reward settlement must fail safe, not auto-grant

## 4. Independent Storage & Dependencies

- Dedicated telemetry store
- Dedicated threat cache
- Optional timeseries DB

## 5. Evolution Path

- Rules + DBSCAN
- Online anomaly models
- Cross-tenant intelligence graph
