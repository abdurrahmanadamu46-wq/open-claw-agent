# 10 Subproject Coordination Contract

Last Updated: 2026-03-30
Source Basis:

- `docs/SUBDOMAIN_ARCHITECTURE_FRAMEWORKS_2026-03-30.md`
- current mainline repo map and state
- user-provided external subproject responsibility reports
- observed subproject markers under `F:\openclaw-agent`

## 0. Position

This document is the **thread-oriented coordination edition** of the earlier sub-domain framework.

It does **not** replace the capability-level architecture frameworks.  
Instead:

- `SUBDOMAIN_ARCHITECTURE_FRAMEWORKS_2026-03-30.md` remains the capability reference
- this document becomes the **multi-thread collaboration contract**

## 1. Core Judgment

### Confirmed View

We should **not** keep splitting the system into ever smaller capability projects.

For the current stage, the better granularity is:

- one subproject per **thread-owned bounded context**
- not one subproject per individual capability

### Why

If we continue splitting by individual capability:

- coordination cost rises
- contracts multiply
- ownership becomes fuzzy
- duplicate work becomes more likely

So the right move is:

- **merge adjacent high-coupling capabilities**
- **keep hard external-dependency domains separate**
- **keep external subprojects external**

## 2. Final Recommended 10 Subprojects

## 2.1 `sp_control_plane_web`

- `owner_thread`: `thread_control_web`
- `responsibility_boundary`:
  - merchant console
  - operator console
  - commercial readiness cockpit
  - trace / patrol / audit views
  - mobile web fallback pages
- `forbidden_scope`:
  - no direct AI orchestration logic
  - no direct provider SDK coupling
  - no direct database truth ownership
- `main_repo_integration_contract`:
  - consumes backend REST only
  - never calls AI child service directly
- `handoff_package_type`:
  - `ui_command_request`
  - `ui_review_action`
  - `ui_dashboard_view`
- `conflict_avoidance_rule`:
  - owns `web/src/app/*`, `web/src/components/*`, `web/src/services/endpoints/*`
  - does not edit `dragon-senate-saas-v2` business logic
- `acceptance_signal`:
  - `web next build` passes
  - key operator flows visible with real data
- `done_definition`:
  - pages render from real backend contracts
  - no placeholder dependency on local mock for critical pages

## 2.2 `sp_control_plane_backend`

- `owner_thread`: `thread_control_backend`
- `responsibility_boundary`:
  - auth
  - RBAC
  - tenant registry
  - billing proxy
  - AI child-service proxy
  - subproject contract registration
- `forbidden_scope`:
  - no duplication of AI orchestration graph
  - no content production internals
- `main_repo_integration_contract`:
  - provides stable REST facade to web
  - mediates tenant/auth/billing scope for all child domains
- `handoff_package_type`:
  - `auth_context`
  - `tenant_context`
  - `billing_context`
  - `subproject_handoff_record`
- `conflict_avoidance_rule`:
  - owns `backend/src/**`
  - child domain owners should not add UI-only logic here
- `acceptance_signal`:
  - backend build passes
  - proxy regressions pass
- `done_definition`:
  - web can consume all critical data through backend only

## 2.3 `sp_dragon_brain_commander`

- `owner_thread`: `thread_brain_commander`
- `responsibility_boundary`:
  - 9 elders + Commander orchestration
  - commander profile and commander routing
  - TG command terminal logic
  - low-cost direct strategy path
- `forbidden_scope`:
  - no ownership of platform billing/auth/tenant core
  - no ownership of desktop release chain
- `main_repo_integration_contract`:
  - parent system gives async command ingress and status query
  - this subproject owns orchestration internals only
- `handoff_package_type`:
  - `strategy_run_result`
  - `senate_trace_bundle`
  - `commander_decision_bundle`
- `conflict_avoidance_rule`:
  - owns orchestration flow internals under `dragon-senate-saas-v2/dragon_senate.py`, commander-specific routing, TG command logic
  - parent thread should not rewrite commander internals
- `acceptance_signal`:
  - graph can run without recursion loops
  - async submit/status path completes successfully
- `done_definition`:
  - commander can operate through async path without depending on synchronous blocking route

## 2.4 `sp_kernel_governance_memory`

- `owner_thread`: `thread_kernel_governance`
- `responsibility_boundary`:
  - Senate Kernel
  - memory compiler
  - risk taxonomy
  - autonomy metrics
  - rollback presets
  - governance alerts
- `forbidden_scope`:
  - no ownership of content production
  - no ownership of TG UI logic
- `main_repo_integration_contract`:
  - consumes kernel reports / approval events / rollback events
  - outputs governance rollups, alerts, presets, folded memories
- `handoff_package_type`:
  - `kernel_report`
  - `risk_alert_bundle`
  - `memory_fold_bundle`
  - `rollback_preset_bundle`
- `conflict_avoidance_rule`:
  - owns `senate_kernel.py`, `memory_governor.py`, kernel metrics/alerts projection
  - orchestration thread should only consume outputs, not bypass governance state
- `acceptance_signal`:
  - in-process kernel regressions pass
  - trace UI shows risk family, autonomy, rollback preset
- `done_definition`:
  - governance outputs are queryable and auditable without reading raw trace internals

## 2.5 `sp_intelligence_compiler`

- `owner_thread`: `thread_intelligence_compiler`
- `responsibility_boundary`:
  - Research Radar Batch
  - Industry Compiler
  - industry starter kits
  - precompiled workflow hints
- `forbidden_scope`:
  - no direct content rendering
  - no direct CRM ownership
- `main_repo_integration_contract`:
  - parent sends industry/topic/goal context
  - child returns signals, profiles, starter tasks, workflow hints
- `handoff_package_type`:
  - `research_signal_bundle`
  - `industry_profile_bundle`
  - `starter_task_bundle`
  - `workflow_hint_bundle`
- `conflict_avoidance_rule`:
  - owns `research_radar_*`, `industry_starter_kit.py`, industry compile surfaces
  - content production threads should consume compiled outputs instead of rebuilding industry logic
- `acceptance_signal`:
  - radar digests and starter kits can be generated offline
- `done_definition`:
  - new industry cold start no longer depends on hand-written SOPs only

## 2.6 `sp_content_production_aoto_cut`

- `owner_thread`: `thread_aoto_cut`
- `responsibility_boundary`:
  - content production subdomain
  - topic/script/compliance/storyboard/material/media generation
- `forbidden_scope`:
  - no ownership of auth, tenant, billing, CRM core, global orchestration
- `main_repo_integration_contract`:
  - consumes standard input objects only
  - returns publish-ready packages only
- `handoff_package_type`:
  - `topic_candidates`
  - `script_asset`
  - `compliance_report`
  - `storyboard_package`
  - `material_bundle`
  - `media_bundle`
  - `archive_record`
  - `publish_ready_package`
- `conflict_avoidance_rule`:
  - main repo does not rebuild Aoto Cut internal object model or pages
- `acceptance_signal`:
  - package ingestion contract succeeds
- `done_definition`:
  - parent system can consume Aoto Cut outputs without internal coupling

## 2.7 `sp_template_recommender_seeder`

- `owner_thread`: `thread_template_recommender`
- `responsibility_boundary`:
  - template family recommendation
  - CLI/seeder alignment
  - anti-fit and prerequisite rules
- `forbidden_scope`:
  - no ownership of main workflow pages
  - no ownership of global schema governance
- `main_repo_integration_contract`:
  - parent sends condition signals and asset conditions
  - child returns ranked families and missing prerequisites
- `handoff_package_type`:
  - `template_recommendation_bundle`
  - `template_seed_status`
- `conflict_avoidance_rule`:
  - content production thread consumes template family outputs, does not rebuild recommendation engine
- `acceptance_signal`:
  - recommendation tests pass
- `done_definition`:
  - main brain can call recommender as a black-box scoring service

## 2.8 `sp_integration_adapter_hub`

- `owner_thread`: `thread_adapter_hub`
- `responsibility_boundary`:
  - Feishu / DingTalk / Telegram / AnythingLLM / LibTV / ComfyUI style adapters
  - outbound / inbound normalization
  - retry and outbox handling
- `forbidden_scope`:
  - no ownership of senate strategy
  - no ownership of billing core
- `main_repo_integration_contract`:
  - accepts normalized delivery events
  - returns normalized delivery receipts
- `handoff_package_type`:
  - `delivery_request`
  - `delivery_receipt`
  - `provider_callback_event`
- `conflict_avoidance_rule`:
  - feature teams call adapter contracts, not provider SDKs directly
- `acceptance_signal`:
  - adapter fallback paths exist and do not block main brain
- `done_definition`:
  - provider outages degrade to outbox/deferred instead of failing core chain

## 2.9 `sp_telephony_followup_voice`

- `owner_thread`: `thread_voice_followup`
- `responsibility_boundary`:
  - telephony provider
  - followup voice
  - transcript / disposition / callback normalization
- `forbidden_scope`:
  - no ownership of main task orchestration
  - no ownership of billing/auth
- `main_repo_integration_contract`:
  - receives lead package + call policy + script package
  - returns call result + transcript ref + CRM followup action
- `handoff_package_type`:
  - `voice_followup_request`
  - `voice_followup_result`
  - `voice_transcript_ref`
- `conflict_avoidance_rule`:
  - followup logic in main brain should stop at enqueueing and not embed provider-specific flow
- `acceptance_signal`:
  - canary call flow succeeds with provider or mock
- `done_definition`:
  - telephony failures degrade to manual followup without blocking main chain

## 2.10 `sp_edge_client_delivery`

- `owner_thread`: `thread_edge_client`
- `responsibility_boundary`:
  - edge runtime
  - desktop client
  - update chain
  - release manifest and ack chain
- `forbidden_scope`:
  - no ownership of cloud strategy generation
- `main_repo_integration_contract`:
  - receives signed release manifest and execution policies
  - returns device status and update ack events
- `handoff_package_type`:
  - `release_manifest`
  - `device_ack_event`
  - `edge_runtime_status`
- `conflict_avoidance_rule`:
  - strategy teams must treat edge/client as executor-only surface
- `acceptance_signal`:
  - client update chain and runtime integrity checks pass
- `done_definition`:
  - clients can update, acknowledge, and execute without holding strategy brain

## 3. Merge vs Split Judgment

### We should merge these capability-level ideas into thread-level subprojects

1. `Research Radar Batch + Industry Compiler`
   - merge into `sp_intelligence_compiler`
   - reason: both are offline intelligence compilation domains

2. `Memory Compiler + Governance Analytics`
   - merge into `sp_kernel_governance_memory`
   - reason: same evidence base, same operator audience, same async nature

3. `Integration Adapter Hub + Mobile Approval Loop`
   - keep mobile approval loop as a capability inside `sp_integration_adapter_hub`
   - not worth splitting into its own thread at current stage

4. `Edge Runtime + Desktop Delivery Chain`
   - merge into `sp_edge_client_delivery`
   - reason: same executor-side lifecycle and release chain concerns

### We should keep these separate

1. `Aoto Cut`
   - because its owned domain is already wide and clearly externalized

2. `Commander / TG`
   - because orchestration and terminal logic already belong to another thread

3. `Telephony / Followup Voice`
   - because provider dependency, compliance risk, and runtime profile are distinct

4. `Template Recommender / Seeder`
   - because it already has separate ownership and execution logic

### Conclusion

Splitting is **not mandatory** for every capability.  
At this stage, **thread-owned bounded contexts** are the correct granularity, not ultra-fine capability fragments.

So:

- yes, we should **redo the coordination layer**
- no, we should **not rewrite the capability architecture**
- yes, several of the earlier capability candidates should be **fused**

## 4. Recommended Next Artifacts

1. Keep `SUBDOMAIN_ARCHITECTURE_FRAMEWORKS_2026-03-30.md` as capability reference
2. Promote this document into the new multi-thread collaboration authority
3. Add machine-readable registry:
   - `docs/subproject-registry-2026-03-30.json`

