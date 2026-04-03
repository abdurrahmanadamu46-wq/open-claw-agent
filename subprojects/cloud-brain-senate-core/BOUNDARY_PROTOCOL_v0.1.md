# Cloud Brain Boundary Protocol v0.1

Reference:

- [Main Framework / Runtime Boundary Contract](/F:/openclaw-agent/docs/handover/13-MAINFRAMEWORK-RUNTIME-BOUNDARY-CONTRACT-2026-03-30.md)

## My owned boundary

This subproject owns:

- cloud-brain mainline integration
- `Commander + 9 elders` role system
- canonical registry
- role cards
- run contracts
- artifact contracts
- main graph integration
- approval / artifact / pipeline-mode public integration
- strategy submission and operator-facing brain flows

## I do not own

- runtime weighting internals
- shadow promotion internals
- scope rollout internals
- drift alert internals
- limited-live executor internals

## Non-edit rule

I should not rewrite runtime-owned internals directly.

The runtime owner should not rewrite:

- `/F:/openclaw-agent/subprojects/cloud-brain-senate-core/**`
- `/F:/openclaw-agent/dragon-senate-saas-v2/app.py`
- `/F:/openclaw-agent/dragon-senate-saas-v2/dragon_senate.py`
- `/F:/openclaw-agent/backend/src/ai-subservice/**`
- `/F:/openclaw-agent/web/src/app/operations/strategy/**`
- `/F:/openclaw-agent/web/src/app/operations/autopilot/modes/**`
- `/F:/openclaw-agent/web/src/app/operations/autopilot/artifacts/**`
- `/F:/openclaw-agent/web/src/app/operations/autopilot/approvals/**`

## If they need something from me

They should provide:

1. target integration surface
2. contract change summary
3. why it is needed
4. compatibility expectations

## If I need something from them

I should ask for:

- report
- feed
- weight patch
- rollout output
- scope-aware contract

not rewrite their internals inside my mainline files.
