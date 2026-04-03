# PROJECT_STATE

Last Updated: 2026-03-26 (Asia/Shanghai)
Owner Mode: Codex-CEO continuous delivery

## 当前系统真相（Single Source of Truth）

- Unified control plane: `web + backend`
- AI child service: `dragon-senate-saas-v2`
- Edge runtime: `edge-runtime` (executor-only)
- Data stack: PostgreSQL + Redis + Qdrant + Ollama (Docker-first)

## 当前已落地能力

- Auth/JWT + tenant-aware API access
- Billing base (plans, usage ledger, subscription guard, provider adapter)
- Senate Kernel modules (guardian / verification / memory governor / rollback report)
- Research Radar pipeline (ingest/rank/store/digest)
- Industry KB pool (tenant+industry scoped ingest/search/context injection)
- Deterministic FollowUp sub-agent spawning + persistence + query APIs
- Handover documentation pack (`docs/handover`) 全量更新

## 当前分层完成度

- P0 Commercial base: PARTIAL+
- P1 Research Radar: PARTIAL+
- P2 Senate Kernel: PARTIAL+
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

1. Real payment cutover (签名/幂等/对账/补偿)。
2. Feishu 公网回调 challenge + signature 闭环。
3. 外呼 provider canary 切真。
4. 前端“展示态”彻底清理为真实联动。
