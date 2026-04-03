# Policy Router

Thread: `sd-07`

Existing source anchor:

- [services/policy-router-service/README.md](/F:/openclaw-agent/services/policy-router-service/README.md)

## 1. Boundary & Contract

Protocol:

- Read route context: REST
- Feedback update: REST or MQ

Input example:

```json
{
  "schema_version": "policy.route.request.v1",
  "tenant_id": "tenant_demo",
  "agent_id": "strategist",
  "task_type": "strategy_planning",
  "feedback": {
    "conversion_rate": 0.32,
    "complaint_rate": 0.01
  }
}
```

Output example:

```json
{
  "schema_version": "policy.route.result.v1",
  "status": "success",
  "policy_tensor": {
    "aggressive": 0.4,
    "safety": 0.8,
    "human_like": 0.7
  },
  "prompt_context": {
    "tone": "conservative_conversion"
  }
}
```

## 2. Core Responsibilities

- Maintain global policy tensor
- Absorb feedback events
- Generate prompt-context overlays for agents

## 3. Fallback & Mock

- If unavailable, return default conservative tensor
- Main system continues with static strategy defaults

## 4. Independent Storage & Dependencies

- Dedicated Redis or SQLite
- Optional versioned policy DB

## 5. Evolution Path

- Static tensor
- Bandit-based routing
- Lightweight local policy model
