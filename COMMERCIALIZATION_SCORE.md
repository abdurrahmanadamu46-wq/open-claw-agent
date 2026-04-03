# COMMERCIALIZATION_SCORE

Last Updated: 2026-03-26 (Asia/Shanghai)

## Weighted Model

- P0 Commercial base and charging loop: 30%
- Research Radar: 15%
- Senate Kernel: 20%
- Dragon Pool Runtime: 15%
- ClawDeckX/ClawPanel/SAW/CampaignGraph: 10%
- ClawX/clawInstaller/poco-claw: 10%

## Current Score (evidence-based)

- P0: 20 / 30
  - Done: auth/jwt, tenant guard, usage ledger, providerized checkout/webhook adapter, RBAC + approval + rollback APIs.
  - Missing: real merchant cutover, reconciliation/compensation jobs, full self-service lifecycle closure.
- P1: 11 / 15
  - Done: research_signals schema + fetch/rank/list/manual/digest pipeline.
  - Missing: source health telemetry, scheduler SLO, digest retry fallback.
- P2: 16 / 20
  - Done: guardian + verification gate + memory governor + rollback + deterministic followup spawn.
  - Missing: wider regression matrix + tenant strategy UX closure.
- P3: 10 / 15
  - Done: signed update baseline, keyId/sha chain, edge execution boundary.
  - Missing: runtime hardening and installer canary automation.
- P4: 4 / 10
  - Done: simulation/campaign graph backend primitives.
  - Missing: unified visual command cockpit and publish threshold UX.
- P5: 8 / 10
  - Done: desktop-client baseline + packaging scaffolding + handover docs for onboarding.
  - Missing: production-grade installer E2E and release signing governance.

## Total

Current commercialization completion: **69 / 100**

## Exit Criteria to Reach 80+

1. Payment provider cutover + reconciliation + compensation closure.
2. Feishu public callback + signed event flow closure.
3. Telephony provider canary with quality and complaint guardrails.
4. Self-service lifecycle docs/tests complete (register/login/reset/subscription/billing/use).
