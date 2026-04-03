# Trust Verification

Thread: `sd-09`

Existing source anchor:

- [services/trust-verification-service/README.md](/F:/openclaw-agent/services/trust-verification-service/README.md)

## 1. Boundary & Contract

Protocol:

- Pre-execution check: REST
- Post-execution audit: REST

Input example:

```json
{
  "schema_version": "trust.verify.request.v1",
  "tenant_id": "tenant_demo",
  "phase": "pre_execution",
  "behavior_plan": {
    "action_type": "publish",
    "trajectory_variance": 0.03
  }
}
```

Output example:

```json
{
  "schema_version": "trust.verify.result.v1",
  "status": "success",
  "is_safe": false,
  "action_taken": "REVIEW_REQUIRED",
  "reason_codes": ["low_variance", "webdriver_risk"]
}
```

## 2. Core Responsibilities

- Validate execution realism before action
- Audit telemetry after action
- Recommend allow, review, or block

## 3. Fallback & Mock

- High-risk actions default to review if service is unavailable
- Low-risk tasks continue with `risk_unknown`

## 4. Independent Storage & Dependencies

- Dedicated audit log
- Dedicated rule or model registry

## 5. Evolution Path

- Rule engine
- Lightweight behavior classifier
- Device trust scoring
