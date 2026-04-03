# PROJECT_STATE

Last Updated: 2026-03-29 (Asia/Shanghai)
Owner Mode: Codex-CEO continuous delivery

## 当前系统真相（Single Source of Truth）

- Unified control plane: `web + backend`
- AI child service: `dragon-senate-saas-v2`
- Edge runtime: `edge-runtime` (executor-only)
- Data stack: PostgreSQL + Redis + Qdrant + Ollama (Docker-first)

## 当前已落地能力

- Auth/JWT + tenant-aware API access
- Tenant registry moved into backend Redis-backed source of truth; frontend tenant context now syncs from backend instead of browser-local storage
- CampaignGraph now includes ToolTree-lite branch planning with selected/rejected route traces
- Memory Governor and Senate Kernel now persist role memory, campaign memory, and folded success/failure playbooks
- Kernel metrics dashboard now exposes autonomy metrics and risk-family aggregation
- Trace center and log audit now surface kernel risk family and autonomy route context
- Risk taxonomy now includes family-specific monitor rules and rollback presets in kernel reports and Trace UI
- Kernel risk alerts endpoint and alert page section now exist for TrinityGuard-style operator monitoring
- Industry starter kit generation now exists for new-industry cold start and is visible from onboarding
- Mobile approval loop now exists across HITL push fanout (Telegram/Feishu/DingTalk when configured), backend approval APIs, and the mobile web approval page
- Mobile approval pages now include trace jump links, and client-center is no longer a static mock page
- Backend HITL proxy regression added for pending/decide flow
- Aoto Cut integration prep completed: contract module, handoff package ingestion, and boundary doc added without duplicating content-production implementation
- Commander/TG integration prep completed: async submit/status contract added so TG and commander can avoid synchronous `/run-dragon-team`
- Async `run-dragon-team` main path is now available in both AI child service and backend proxy as the recommended command ingress
- Strategy center now exposes async commander submit/status UI instead of depending on synchronous long-running calls
- Billing base (plans, usage ledger, subscription guard, provider adapter)
- Billing commercialization skeleton: orders, webhook event ledger, compensation tasks, reconciliation run
- Self-service commercial actions: trial activation and sandbox checkout path
- Senate Kernel modules (guardian / verification / memory governor / rollback report)
- Research Radar pipeline (ingest/rank/store/digest)
- Industry KB pool (tenant+industry scoped ingest/search/context injection)
- Deterministic FollowUp sub-agent spawning + persistence + query APIs
- Lead persistence moved to Redis-backed storage + E2E seed support
- Read-only billing/team settings views wired to live backend data
- Public auth lifecycle wired through unified backend: register / login / forgot-password / reset-password
- Registration now auto-ensures tenant registry records for newly created tenants
- Public marketing and legal pages added: landing / pricing / FAQ / privacy / terms / ICP readiness
- Public pricing page now supports self-service trial activation and sandbox checkout
- Commercial readiness page added to aggregate payment / notification / Feishu / compliance state
- Commercial readiness cockpit now exposes structured score, blocker list, notification test, and outbox visibility
- Dashboard and onboarding now surface launch-readiness status and route operators into the commercial cockpit
- Notification outbox and test-send flow exposed through unified control plane
- ICP launch profile validator added for offline filing material completeness
- Notification center added with file / SMTP / sms-mock modes and status endpoint
- Feishu callback readiness/status endpoints added for public callback cutover
- Payment, notification, and Feishu cutover runbooks added with scriptable preflight checks
- Patrol page rewritten into a clean production-ready control surface and wired to commercial readiness context
- Mainland-first deployment profile added at `deploy/env/cn-shanghai.env.example`
- Mainland-first defaults now also exist in the main `dragon-senate-saas-v2/.env.example`
- Web prebuild now clears stale `.next` artifacts for stable production builds
- Web production build warnings reduced to zero on current route set
- UTF-8 scan script + non-blocking CI step
- ICP/compliance material pack generator
- User cache cleanup script added at `scripts/system/cleanup-user-caches.ps1`; safe cache cleanup executed while intentionally skipping recently used local Ollama models
- Large development assets now migrate to `F:` with junction preservation; `.ollama` and `ms-playwright` were moved off `C:` and workspace backup was synced to `F:\openclaw-agent\workspace`
- Research Radar source health + retry/SLO summary
- Handover documentation pack (`docs/handover`) 全量更新
- Unified sub-domain architecture framework exported to `docs/SUBDOMAIN_ARCHITECTURE_FRAMEWORKS_2026-03-30.md`
- Thread-oriented coordination contract exported to `docs/TEN_SUBPROJECT_COORDINATION_CONTRACT_2026-03-30.md`
- Machine-readable subproject registry exported to `docs/subproject-registry-2026-03-30.json`

## 当前分层完成度

- P0 Commercial base: PARTIAL+
- P1 Research Radar: PARTIAL+
- P2 Senate Kernel: PARTIAL+++
- P3 Dragon Pool Runtime: PARTIAL
- P4 Visual command cabin: PARTIAL
- P5 Desktop + installer + sandbox: PARTIAL

## 红线（持续生效）

1. High-risk actions default to HITL.
2. Edge nodes execute only; no strategy brain on edge.
3. Key actions must be auditable, replayable, rollbackable.
4. Unverified free/unlimited external providers are sandbox-only.
5. New model/plugin rollout requires sandbox + canary.

## 交接要点

- 接手入口：`docs/handover/00-START-HERE.md`
- 运维排障：`docs/handover/06-OPS-RUNBOOK.md`
- 交接清单：`docs/handover/07-HANDOVER-CHECKLIST.md`

## 当前最紧急收口

1. Real payment cutover (Stripe/Alipay/WeChat Pay merchant credentials, certificates, production settlement verification).
2. Feishu public callback challenge + signature closure; code readiness is done, public domain and app subscription config are still external blockers.
3. Real SMTP / SMS provider cutover; file/sandbox modes are done, production credentials are still missing.
4. Telephony provider canary cutover.
5. ICP offline legal entity / domain / authorization materials fill-in and final filing drill; validator currently reports unresolved placeholders as expected and now provides exact missing field count.
