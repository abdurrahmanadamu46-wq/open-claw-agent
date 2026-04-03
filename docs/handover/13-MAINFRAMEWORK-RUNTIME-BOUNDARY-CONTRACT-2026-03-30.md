# Main Framework / Runtime Subproject Boundary Contract v0.1

Last Updated: 2026-03-30

## 1. Position

This document defines the collaboration boundary between:

1. `Main Framework Owner`
2. `Cognitive Governance & Runtime Orchestration Subproject Owner`

It exists to prevent:

- accidental overwrite of each other's work
- shadow ownership of the same module
- unclear integration expectations
- duplicate implementation of the same capability

This document is not a product roadmap.
It is a write-scope and contract-scope agreement.

## 2. Main Framework Owner

The main framework owner is responsible for:

- business main framework integration
- `Commander + 9 elders` mainline product wiring
- cloud-brain role system integration
- canonical registry / role cards / run contracts / artifact schemas
- `dragon-senate-saas-v2/app.py` public orchestration surface
- `dragon-senate-saas-v2/dragon_senate.py` main graph integration
- approval / artifact / pipeline-mode public API integration
- backend AI proxy integration
- frontend operator flows for:
  - strategy submission
  - artifact center
  - approval center
  - pipeline mode preview
- final integration judgment for how subprojects are consumed by the main product

The main framework owner is not claiming ownership of:

- scope-aware weighting internals
- shadow promotion internals
- limited-live executor internals
- rollout trend / drift alert internals
- the subproject owner's evaluation harness internals

## 3. Cognitive Governance & Runtime Orchestration Subproject Owner

The runtime subproject owner is responsible for:

- Commander decision and scheduling kernel internals
- decision tables
- formation rules
- weight publishing
- weight-aware dispatch
- scope-aware routing
- 9-lobster training and evaluation framework
- subproject templates
- role training pack skeletons
- offline evaluation
- shadow runner
- compare / gate / promotion
- Shadow -> Truth -> Promotion loop
- truth adapter
- result feedback ingestor
- weighted comparator
- role-specific weighting
- scope-specific promotion hints
- runtime gray release and limited live
- queue scheduler
- executor bridge
- worker adapter
- limited-live executor
- target consumer
- scope-aware rollout
- runtime observability and alerts
- scope rollout report
- scope rollout trend
- drift alerts
- inbox delivery
- dashboard feed
- webhook outbox / dispatch
- frontend scope alerts panel

The runtime subproject owner does not own:

- whole-business main integration
- final repo-wide structure arbitration
- release cadence for the total product
- commercial domain internals
- auth / tenant / billing / order core
- CRM final product model
- ICP / compliance mainline
- Aoto Cut production system internals
- video rendering production chain
- edge / desktop main system
- full-site UX / IA / design system final say

## 4. Non-Overlap Rule

The two owners must not rewrite each other's internals directly.

### 4.1 Main Framework Owner must not rewrite these runtime-owned areas without explicit coordination

- `/F:/openclaw-agent/src/agent/commander/**`
- `/F:/openclaw-agent/src/agent/runtime/**`
- `/F:/openclaw-agent/src/agent/shadow/**`
- `/F:/openclaw-agent/backend/src/autopilot/**`
- `/F:/openclaw-agent/web/src/app/operations/autopilot/alerts/**`
- runtime-governance-specific docs under `/F:/openclaw-agent/docs/architecture/LOBSTER_*`
- scope-aware routing / weighted comparator / rollout alert internals

### 4.2 Runtime Subproject Owner must not rewrite these main-framework-owned areas without explicit coordination

- `/F:/openclaw-agent/subprojects/cloud-brain-senate-core/**`
- `/F:/openclaw-agent/dragon-senate-saas-v2/dragon_senate.py`
- `/F:/openclaw-agent/dragon-senate-saas-v2/app.py`
- `/F:/openclaw-agent/dragon-senate-saas-v2/approval_gate.py`
- `/F:/openclaw-agent/dragon-senate-saas-v2/artifact_validator.py`
- `/F:/openclaw-agent/dragon-senate-saas-v2/cloud_brain_registry.py`
- `/F:/openclaw-agent/backend/src/ai-subservice/**`
- `/F:/openclaw-agent/web/src/services/endpoints/ai-subservice.ts`
- `/F:/openclaw-agent/web/src/app/operations/strategy/**`
- `/F:/openclaw-agent/web/src/app/operations/autopilot/modes/**`
- `/F:/openclaw-agent/web/src/app/operations/autopilot/artifacts/**`
- `/F:/openclaw-agent/web/src/app/operations/autopilot/approvals/**`

## 5. Allowed Shared Contract Surfaces

The two owners may collaborate through these explicit surfaces:

- `Commander decision bundle`
- `role / scope weight patch`
- `shadow compare / gate / promotion report`
- `rollout / trend / drift alert report`
- `limited-live envelope`
- `target dispatch / result contract`
- `scope-aware dashboard feed`
- `scope-aware websocket feed`
- `pipeline mode preview`
- `approval gate contract`
- `artifact contract`

In practice, this means:

- the runtime owner can produce signals, reports, weights, alerts, promotion hints
- the main framework owner integrates those outputs into the main app
- neither side should silently re-implement the other side's internal logic

## 6. Integration Request Rule

If the runtime subproject needs a change in main-framework-owned code:

1. do not patch the owned file directly
2. provide:
   - target file
   - contract change summary
   - reason
   - backward-compatibility note
3. hand the request to the main framework owner for integration

If the main framework needs a runtime capability:

1. do not rebuild runtime internals inside mainline files
2. request one of:
   - contract
   - report
   - feed
   - weight patch
   - rollout output

## 7. Conflict Rule

When both owners think a file must change:

- the owner of that file decides the implementation
- the non-owner provides requirements, not direct overwrite
- integration happens through a reviewed contract or handoff note

## 8. Operational Message To The Runtime Owner

You can send this directly:

> Your owner boundary is recognized as: `Commander decision kernel + 9-lobster training/eval + Shadow/Promotion + Scope-aware Runtime/Alerting`.
> You should not modify main-framework-owned files such as `dragon-senate-saas-v2/app.py`, `dragon-senate-saas-v2/dragon_senate.py`, `backend/src/ai-subservice/**`, `web/src/app/operations/strategy/**`, `web/src/app/operations/autopilot/modes/**`, `web/src/app/operations/autopilot/artifacts/**`, and `subprojects/cloud-brain-senate-core/**`.
> If you need main-framework changes, hand over a contract request instead of patching those files directly.

## 9. Operational Message From Me

What I want the runtime owner to know:

- I will not rewrite your runtime internals if they live inside your owned area.
- I do need stable outputs from you:
  - weights
  - rollout reports
  - drift alerts
  - shadow/promotion decisions
  - scope-aware runtime contracts
- If your subproject needs mainline integration, I want it through explicit contracts, not hidden rewrites.
- If my mainline changes break your contract, I will treat that as an integration bug and fix it at the integration boundary, not by absorbing your subproject into my ownership.

## 10. Current Main Judgment

The cleanest working relationship is:

- runtime owner owns `optimization / evaluation / rollout / alerting / scope-aware execution`
- main framework owner owns `product integration / public contracts / orchestration surface / operator flows`

That gives:

- clearer ownership
- fewer merge conflicts
- faster integration
- lower risk of “two people both think they own Commander”
