# Liaoyuan OS Research-Driven Upgrade Spec (Week 3 -> Week 4)

## 1. Goal
This spec turns recent cs.AI paper directions into implementable modules for Liaoyuan OS.

Primary outcome:
- Better multi-agent memory continuity.
- Policy-controlled agent collaboration.
- Runtime trust and safety verification.
- Threat intelligence scoring for edge execution.
- Explainable scoring and counterfactual diagnostics.
- Frontend page to backend API closure map.

## 2. Research -> Module Mapping

| Paper direction | Module in this project | Integration point |
|---|---|---|
| AutoAgent (adaptive cognition + elastic memory) | `behavior` + `memory` + `tenant-profiles/rag-brain` | `POST /behavior/path`, memory retrieval, formula library replay |
| Policy-Parameterized multi-agent dialogue | `behavior-bias-policy` + prompt policy tensor | `POST /behavior/bias-policy`, agent route policy |
| Context Engineering for multi-agent architecture | Context Envelope Composer | Controller -> queue -> worker context propagation |
| Real-time trust verification | Trust verifier (pre/post execution) | Before dispatch + after worker ack |
| Cyber Threat Intelligence for AI systems | Threat intelligence scorer | Edge telemetry + anti-cheat + task risk routing |
| Counterfactual XAI metrics | Explainability layer | Lead score explain + behavior route explain |

## 3. Target Architecture Additions

### 3.1 Context Envelope (new shared contract)
All core chains should consume one context envelope object.

```ts
export interface ContextEnvelope {
  traceId: string;
  tenantId: string;
  campaignId?: string;
  taskId?: string;
  nodeId?: string;
  sourceQueue?: string;
  timeWindow?: { from?: string; to?: string };
  policyTensor: {
    strategyVersion: string;
    riskTolerance: number; // 0..1
    conversionAggressiveness: number; // 0..1
    memoryWeight: number; // 0..1
    trustThreshold: number; // 0..1
  };
  ragBindings: {
    brainProfileId?: string;
    corpusIds: string[];
    formulaIds: string[];
  };
  personaBinding?: {
    edgeMaskId?: string;
    roleArchetype?: string;
  };
}
```

### 3.2 Competitive Formula Closed Loop (already wired)
Current implementation path:
- Frontend radar page: analyze competitor sample.
- Backend analyze endpoint: convert sample -> formula.
- Formula upsert to `rag_brain_profiles.formulaLibrary`.
- Optional corpus upsert and auto-bind to strategist/inkwriter/visualizer/dispatcher.

Current APIs:
- `GET /api/v1/tenant/rag-brain-profiles/competitive-intel`
- `POST /api/v1/tenant/rag-brain-profiles/competitive-intel/analyze`

## 4. Implementable Algorithms (with pseudocode)

### 4.1 Adaptive Memory Orchestration

Intent:
- Keep behavior and content generation consistent with long-term evidence.

Pseudocode:

```pseudo
function buildAdaptiveMemoryContext(input):
  memories = retrieve_memory(node_id=input.nodeId, task=input.task, top_k=K)
  weights = decay_by_time_and_reward(memories)
  bias = aggregate_action_bias(memories, weights)
  formula_hits = retrieve_formula_library(tenant=input.tenantId, tags=input.tags)
  context = {
    memory_hits: len(memories),
    action_bias: normalize(bias),
    reusable_formulas: topN(formula_hits, 5)
  }
  return context
```

### 4.2 Policy-Parameterized Multi-Agent Dialogue

Intent:
- Make agent collaboration stable and controllable across tenant/template.

Pseudocode:

```pseudo
function routeByPolicyTensor(contextEnvelope, taskType):
  p = contextEnvelope.policyTensor
  if taskType == "content_generation":
    return {
      strategist_depth: lerp(1, 3, p.memoryWeight),
      inkwriter_style_entropy: lerp(0.2, 0.8, p.conversionAggressiveness),
      visualizer_variants: if p.riskTolerance < 0.4 then 1 else 3
    }
  if taskType == "lead_conversion":
    return {
      catcher_threshold: lerp(0.85, 0.55, p.conversionAggressiveness),
      followup_delay_minutes: lerp(30, 5, p.conversionAggressiveness)
    }
```

### 4.3 Context Engineering Composer

Intent:
- Unified context for controller -> queue -> worker -> DLQ.

Pseudocode:

```pseudo
function composeContextEnvelope(request, tenantConfig):
  envelope.traceId = request.traceId or generate_trace_id()
  envelope.tenantId = request.tenantId
  envelope.policyTensor = resolve_policy_tensor(tenantConfig, request.templateId)
  envelope.ragBindings = resolve_rag_bindings(tenantConfig, request.tags)
  envelope.personaBinding = resolve_edge_persona(request.nodeId)
  return envelope
```

### 4.4 Real-Time Trust Verification

Intent:
- Verify if an agent action is safe and credible before execution.

Pseudocode:

```pseudo
function trustPrecheck(action, envelope, telemetry):
  score = 1.0
  score -= risk_from_action_type(action.type)
  score -= risk_from_node_health(telemetry.nodeHealth)
  score -= risk_from_abnormal_frequency(telemetry.actionRate)
  score -= risk_from_policy_violation(action, envelope.policyTensor)

  if score < envelope.policyTensor.trustThreshold:
    return {allow: false, reason: "trust_below_threshold", score: score}
  return {allow: true, score: score}
```

### 4.5 Threat Intelligence Scoring

Intent:
- Turn anti-cheat and CTI signals into actionable routing decisions.

Pseudocode:

```pseudo
function computeThreatScore(telemetry):
  indicators = [
    vm_fingerprint_match(telemetry),
    mac_entropy_low(telemetry),
    cpu_temp_curve_flat(telemetry),
    mouse_curve_non_human(telemetry),
    ip_reputation_bad(telemetry.ip)
  ]
  weighted = dot(indicators, [0.25,0.15,0.2,0.2,0.2])
  return clamp(weighted, 0, 1)

function applyThreatPolicy(threatScore):
  if threatScore >= 0.8: return "isolate"
  if threatScore >= 0.5: return "limited_mode"
  return "normal"
```

### 4.6 Counterfactual Explainability

Intent:
- Explain why a lead/session got current score and what minimum change flips outcome.

Pseudocode:

```pseudo
function counterfactualExplain(featureVector, model):
  y = model.predict(featureVector)
  if y == "hot":
    target = "warm"
  else:
    target = "hot"

  candidates = generate_minimal_perturbations(featureVector)
  valid = filter(candidates, c -> model.predict(c) == target)
  best = argmin(valid, distance(c, featureVector))

  return {
    original_label: y,
    target_label: target,
    minimal_changes: diff(featureVector, best)
  }
```

## 5. Module Interface Spec (backend contracts)

### 5.1 Competitive Intel Ingestion

`POST /api/v1/tenant/rag-brain-profiles/competitive-intel/analyze`

Request:
```json
{
  "source": {"platform": "douyin", "accountName": "competitorA", "postUrl": "https://..."},
  "classification": {"industry": "beauty", "scenario": "viral_breakdown"},
  "sample": {"title": "...", "hook": "...", "transcript": "...", "metrics": {"likes": 12000}},
  "upsertAsCorpus": true,
  "targetAgents": ["strategist", "inkwriter", "visualizer", "dispatcher"]
}
```

Response:
```json
{
  "code": 0,
  "data": {
    "inserted": true,
    "corpusId": "competitive_formula:formula_20260319_abc123",
    "formula": {"id": "formula_20260319_abc123", "category": "comparison"},
    "profileUpdatedAt": "2026-03-19T09:00:00.000Z"
  }
}
```

### 5.2 Formula Library Query

`GET /api/v1/tenant/rag-brain-profiles/competitive-intel?category=&platform=&tag=&limit=`

Response:
```json
{
  "code": 0,
  "data": [
    {
      "id": "formula_x",
      "category": "how_to",
      "title": "...",
      "hook": "...",
      "source": {"platform": "xiaohongshu"},
      "confidence": 0.83,
      "extractedAt": "2026-03-19T08:58:00.000Z"
    }
  ]
}
```

## 6. Event Schema Standard (cross-service)

Keep this JSON log schema as required fields:
- `traceId`
- `tenantId`
- `campaignId`
- `nodeId`
- `taskId`
- `eventType`

Recommended extra:
- `sourceQueue`
- `stage`
- `policyVersion`
- `trustScore`
- `threatScore`
- `memory_hits`
- `blended_bias`

## 7. Frontend -> Backend Closure Map

### 7.1 Already connected
- `/operations/autopilot` -> `/autopilot/status`, `/autopilot/trigger-probe`, `/autopilot/reset-circuit`, `/autopilot/metrics/dashboard`
- `/operations/autopilot/alerts` -> `/autopilot/alerts/evaluate`
- `/operations/autopilot/trace` -> `/autopilot/trace/:traceId`
- `/dashboard/settings/integrations` -> `/api/v1/tenant/integrations` (+ webhook/adapter test)
- `/ai-brain/radar` -> `/api/v1/tenant/rag-brain-profiles/competitive-intel*`
- `/fleet` -> `/api/v1/fleet/nodes`, `/api/v1/fleet/nodes/:nodeId/offline`, `/api/v1/fleet/commands`

### 7.2 Gap list to close next
- `/operations/log-audit`: currently mock list, should read unified log search endpoint.
- `/ai-brain/content`: currently local template/assets mock, should bind template + asset APIs.
- `/settings/team`, `/settings/tenants`, `/settings/audit`: UI exists, backend admin endpoints not fully wired.
- `/operations/calendar`, `/operations/patrol`, `/operations/orchestrator`: page-level mock needs live API wiring.

## 8. Next Implementation Sprint (directly executable)

1. Build `GET /autopilot/logs/search` with time window + severity + module + node + trace filter.
2. Bind `/operations/log-audit` to that endpoint and remove page-side hardcoded logs.
3. Add `template-library` and `asset-library` backend modules, then wire `/ai-brain/content`.
4. Add trust and threat score fields into dispatcher preflight and structured logs.
5. Add `counterfactual` endpoint for lead scoring and show explanation in leads page.

## 9. Acceptance Criteria

- Competitive formula ingestion available end-to-end from UI.
- Formula records are queryable by category/platform/tag.
- Every main operational page has a backend API contract or explicit gap owner.
- Trace ID can reconstruct controller -> queue -> worker -> DLQ path.
- Security checks can block high-risk actions before execution.
