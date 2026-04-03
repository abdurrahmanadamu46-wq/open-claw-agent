# DECISIONS

Last Updated: 2026-03-26

## D-001 Single Control Plane
- Decision: `web + backend` is the only external control surface.
- Consequence: AI service remains downstream and cannot be called directly by frontend.

## D-002 High-Risk HITL Default
- Decision: high-risk operations require HITL approval by default.
- Consequence: approval journal and replay evidence are mandatory.

## D-003 Edge Is Executor-Only
- Decision: edge runtime never owns strategy logic.
- Consequence: strategy/version governance stays in Senate Kernel.

## D-004 Mainland-First Runtime
- Decision: defaults target CN mainland deployability (cn-shanghai-first).
- Consequence: local Ollama/DeepSeek-first routing and localized infra assumptions.

## D-005 Payment Adapter Strategy
- Decision: use provider adapter abstraction for payment cutover.
- Consequence: credentials/signatures are env-controlled; business flow stays stable.

## D-006 Research Radar Scheduled Runner
- Decision: provide standalone radar runner for cron/systemd/CI scheduling.
- Consequence: ingestion can run as operational job, not only API-triggered.

## D-007 Industry KB Pool
- Decision: knowledge retrieval is tenant+industry scoped.
- Consequence: strategist context injection is deterministic and isolated.

## D-008 Industry KB Quality Gate
- Decision: ingest must pass quality and dedupe gates before persistence.
- Consequence: low-quality/duplicate knowledge is rejected with reason codes.

## D-009 Manual Industry Build-Up Entry
- Decision: add operator-controlled dissect-and-ingest entry for early industry build-up.
- Consequence: onboarding can bootstrap knowledge pools deterministically.

## D-010 Deterministic FollowUp Sub-Agent Spawning
- Decision: follow-up fan-out uses deterministic shard planning and persisted child runs.
- Consequence: high-volume follow-up becomes replayable and auditable.

## D-011 Handover Docs as Source of Truth
- Decision: `docs/handover/*` is maintained as first-class onboarding truth for Codex/Claude Code.
- Consequence: every milestone update must sync Start Here + Open Items + Manifest.

## D-012 No Fake Data in Operator UI
- Decision: operator-facing pages must use live API data or explicit empty-state; no long-term mock metrics.
- Consequence: any placeholder display must be temporary and tracked in `SKIP_TEMP.md`.
