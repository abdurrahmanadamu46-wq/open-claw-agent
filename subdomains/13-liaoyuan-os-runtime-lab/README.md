# Liaoyuan OS Runtime Lab

Thread: `sd-13`

Existing source anchor:

- [liayouan_os/README.md](/F:/openclaw-agent/liayouan_os/README.md)

## 1. Boundary & Contract

Protocol:

- Dispatch: WebSocket
- Event middleware: Redis

Input example:

```json
{
  "schema_version": "runtime.execute.request.v1",
  "edge_id": "edge-001",
  "script": {
    "action": "click",
    "target": ".like-button"
  }
}
```

Output example:

```json
{
  "schema_version": "runtime.execute.result.v1",
  "status": "success",
  "edge_id": "edge-001",
  "execution_state": "completed",
  "telemetry": {
    "latency_ms": 820
  }
}
```

## 2. Core Responsibilities

- Simulate or execute cloud-edge runtime behavior
- Run WSS dispatch loop
- Collect and publish telemetry

## 3. Fallback & Mock

- If real browser/runtime is unavailable, fall back to simulation mode
- Parent system must mark `simulated=true` and avoid reward settlement

## 4. Independent Storage & Dependencies

- Dedicated Redis
- Dedicated runtime state store
- Optional vector store for runtime context

## 5. Evolution Path

- Simulator
- Real edge runtime
- Cross-platform execution kernel
