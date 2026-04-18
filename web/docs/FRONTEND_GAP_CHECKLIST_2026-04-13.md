# Frontend Gap Checklist

Date: 2026-04-13

## Goal

Close the operator console surface into a version that is:

- readable for demos
- navigable through the six product zones
- clear about what is already wired
- explicit about what is still placeholder or integration-state

## Already Wired

- Home control deck consumes homepage metrics and commercial readiness.
- Home, header, onboard, tenant settings, and platform industries now share one live-first industry taxonomy display path with explicit fallback labeling.
- `fetchLobsters()` now normalizes supervisor runtime summary fields before pages consume them.
- `fetchLobsterEntity()` now normalizes supervisor detail fields before detail pages consume them.
- `fetchAiSkillsPoolOverview()` now merges `profiles` and `agent_profiles` into one stable frontend profile row before pages consume it.
- `fetchCommercialReadiness()` now normalizes deploy, payment, notifications, feishu, and compliance domains before pages consume them.
- Client center and mobile approval surfaces now consume normalized commercial readiness domain status.
- Knowledge overview now exposes a shared frontend vocabulary for platform generic, platform industry, tenant private, role activation, and experience memory layers.
- Tenant knowledge base, Prompt/RAG, and memory detail pages now consume the same shared knowledge-layer vocabulary.
- Collab surfaces consume notification outbox.
- Collab readiness can read Feishu callback readiness.
- Supervisor capability pages consume skills-pool overview.
- Tenant knowledge base surfaces consume knowledge-base APIs.

## Missing Interfaces

1. Group confirmation queue API
   - Affected page: `/collab/approvals`
   - Current fallback: commercial readiness blockers
   - Needed fields: `id`, `source`, `status`, `owner`, `assignee`, `requested_at`, `due_at`, `evidence`

2. Group report delivery receipt API
   - Affected page: `/collab/reports`
   - Current fallback: notification outbox only
   - Needed fields: `ack_at`, `ack_by`, `thread_id`, `decision`, `last_error`

3. Platform industry catalog summary API
   - Affected page: `/knowledge/platform-industries`
   - Current state: the page is now live taxonomy-first with explicit fallback labeling, but still assembles directory summary and coverage data on the frontend
   - Needed output: platform catalog summary, starter-kit coverage, industry knowledge stats

## Field / Contract Drift

0. Legacy lobster-pool scorer is now live-first and still needs explicit source labeling
   - Affected page: `/dashboard/lobster-pool/scorer`
   - Current state: pool overview and detail are now live-only; the scorer now prefers the live backend endpoint and only uses local simulation in explicit mock environments
   - Why it matters: score demos can still be mistaken for fully live routing intelligence unless the source mode stays visible

1. Capability tree is now aggregated, but stage semantics are still frontend-owned
   - Current page: `/lobsters/capability-tree`
   - Current state: one backend capability graph endpoint now supplies agent and collab summary data, and stage semantics are now centralized in one shared frontend semantic layer
   - Remaining drift: stage labels, edge semantics, and artifact naming still have not moved into a backend self-describing contract

2. `fetchCommercialReadiness()` raw payload still hides domain detail in generic objects
   - frontend service layer already normalizes `deploy`, `payment`, `notifications`, `feishu`, `compliance`
   - backend raw payload is still not fully self-typed for broader contract reuse

3. Knowledge-area raw API naming is not unified yet
   - frontend product vocabulary is now centralized in the knowledge overview
   - raw contracts can still expose `knowledge base`, `industry KB`, `RAG pack`, `memory`
   - backend API naming still needs gradual alignment

## Placeholder / Composed Surfaces

0. `/dashboard/lobster-pool/scorer`
   - State: live-first / mock-only dev
   - Notes: scorer output now prefers the real backend endpoint, but source labeling must remain visible in mock environments

1. `/collab/approvals`
   - State: fallback
   - Notes: shows blockers, not a true confirmation queue

2. `/collab/reports`
   - State: partial integration
   - Notes: shows sent records, not real thread status or read receipts

3. `/knowledge/platform-industries`
   - State: live taxonomy-first / explicit fallback
   - Notes: taxonomy now prefers the live backend contract and shows fallback status explicitly, but platform catalog summary is still assembled on the frontend

4. `/lobsters/capability-tree`
   - State: aggregated
   - Notes: page now uses a single capability-graph endpoint, but presentation semantics still rely on frontend-local role metadata

## Recommended Next Order

1. Add collab confirmation queue and report receipt APIs.
2. Continue moving capability graph stage and edge semantics into backend contracts.
3. Add platform industry catalog summary APIs.
4. Type commercial readiness domain payloads.
