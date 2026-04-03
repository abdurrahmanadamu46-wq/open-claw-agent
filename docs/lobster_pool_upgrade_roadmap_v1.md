# Lobster Pool Upgrade Roadmap v1

Last Updated: 2026-03-29
Input Basis:

- `docs/research_scan_20260329.md`
- current production trunk: `web + backend + dragon-senate-saas-v2 + edge-runtime`

## 0. Objective

Turn the recent research scan into a practical upgrade program for Lobster Pool, while preserving the product core:

- smarter
- more stable
- lower cost
- higher moat
- more "Lobster Pool", less generic agent platform

## 1. Design Rules

1. Keep cloud-brain / edge-executor boundary.
2. Prefer planning upgrades before adding more agents.
3. Prefer compressed role memory over larger raw memory.
4. Prefer API-first execution lanes over browser-first execution.
5. Treat governance as a planning concern, not only an execution concern.
6. Every new capability must improve at least two of:
   `quality`, `stability`, `cost`, `moat`.

## 2. P0

Goal:

- raise intelligence and stability without heavy infra expansion

### P0-1. ToolTree-lite Planner

Research origin:

- ToolTree
- LiTS

Why now:

- current orchestration is graph-first and heuristic-first
- Lobster Pool needs better tool ordering, route pruning, and channel selection

Primary modules:

- `dragon-senate-saas-v2/campaign_graph.py`
- `dragon-senate-saas-v2/dragon_senate.py`
- `dragon-senate-saas-v2/llm_router.py`
- `dragon-senate-saas-v2/policy_bandit.py`

Implementation slices:

1. Add a `planner_state` object into dispatcher planning.
2. Introduce candidate expansion for:
   `model route`, `channel route`, `retrieval route`, `followup route`.
3. Run bounded search with:
   `depth <= 3`, `branch <= 4`, `time budget <= 300ms`.
4. Score nodes with:
   expected quality, expected cost, expected risk, expected replay success.
5. Persist selected branch and rejected branches into trace artifacts.

Acceptance:

- lower failed multi-tool runs
- lower average cost per successful workflow
- visible branch reasoning in trace/replay

### P0-2. Role-Aligned Memory and Memory Folding

Research origin:

- MEM1
- Intrinsic Memory Agents
- ReasoningBank
- DeepAgent

Why now:

- current memory is tenant/policy/episode aware
- next moat is role-aware distilled memory

Primary modules:

- `dragon-senate-saas-v2/memory_governor.py`
- `dragon-senate-saas-v2/senate_kernel.py`
- `dragon-senate-saas-v2/dragon_senate.py`

Implementation slices:

1. Add memory classes:
   `role_memory`, `campaign_memory`, `failure_memory`, `winning_playbook_memory`.
2. Add post-run folding:
   convert long trace into short reasoning cards.
3. Store success and failure summaries separately.
4. Add retrieval budget per role:
   strategist, dispatcher, visualizer, followup.
5. Add decay and promotion rules:
   temporary observations vs stable playbooks.

Acceptance:

- lower prompt/context token volume
- more consistent strategy outputs across repeated tenant tasks
- easier replay explanation

### P0-3. Autonomy Metrics for HITL

Research origin:

- security-aware planning and autonomy evaluation work from ICLR 2026

Why now:

- Lobster Pool already has HITL and Kernel reports
- but approval burden is not yet first-class optimization data

Primary modules:

- `dragon-senate-saas-v2/senate_kernel.py`
- `dragon-senate-saas-v2/memory_governor.py`
- `dragon-senate-saas-v2/app.py`
- `web/src/app/operations/autopilot/trace/page.tsx`

Implementation slices:

1. Track:
   `auto-pass`, `auto-block`, `review-required`, `approval-latency`, `approval-overhead`.
2. Add tenant/workflow/channel rollups.
3. Add a Kernel dashboard section for autonomy trend.
4. Feed this back into rollout policy tuning.

Acceptance:

- fewer unnecessary approvals
- clearer governance ROI
- rollout policy becomes data-driven

## 3. P1

Goal:

- deepen moat and expand cross-industry cloning ability

### P1-1. TrinityGuard-style Risk Taxonomy

Research origin:

- TrinityGuard

Primary modules:

- `dragon-senate-saas-v2/senate_kernel.py`
- `dragon-senate-saas-v2/memory_governor.py`
- `dragon-senate-saas-v2/app.py`
- `web/src/app/operations/log-audit/page.tsx`

Implementation slices:

1. Add risk families:
   `single_agent`, `inter_agent`, `system_emergent`.
2. Label all trace/report records with risk family.
3. Add monitor rules by family.
4. Add replay and rollback presets by risk family.

Acceptance:

- stronger audit story
- easier enterprise review
- better alert precision

### P1-2. Synthetic Industry Task Generation

Research origin:

- AutoPlay
- AgentGym-RL

Primary modules:

- `dragon-senate-saas-v2/industry_kb_pool.py`
- `dragon-senate-saas-v2/industry_taxonomy.py`
- `dragon-senate-saas-v2/workflow_template_registry.py`
- `dragon-senate-saas-v2/dragon_senate.py`

Implementation slices:

1. Add explorer pass for new industry:
   channels, assets, regulations, objections, touchpoints.
2. Generate executable candidate tasks.
3. Run verifier pass:
   feasibility, observability, governance fit.
4. Save accepted tasks into industry starter kits.

Acceptance:

- faster new-industry onboarding
- less manual SOP authoring
- stronger knowledge moat

### P1-3. Mobile Approval Loop

Research origin:

- Pushary-like notification pattern

Primary modules:

- `dragon-senate-saas-v2/feishu_channel.py`
- `dragon-senate-saas-v2/dingtalk_channel.py`
- `dragon-senate-saas-v2/app.py`
- `web/src/app/client-mobile`

Implementation slices:

1. Push approval-needed event to Feishu/DingTalk.
2. Add one-tap approve/reject actions.
3. Add push on retry exhaustion and task completion.
4. Add audit link back to trace page.

Acceptance:

- lower approval latency
- better operator responsiveness
- stronger Lobster Pool identity

## 4. P2

Goal:

- strengthen media quality feedback and self-improvement loops

### P2-1. Visual-ERM Upgrade

Research origin:

- visual reward model direction
- performance-aware media planning signals

Primary modules:

- `dragon-senate-saas-v2/campaign_graph.py`
- `dragon-senate-saas-v2/comfyui_capability_matrix.py`
- `dragon-senate-saas-v2/media_post_pipeline.py`
- `dragon-senate-saas-v2/dragon_senate.py`

Implementation slices:

1. Replace simple `visual_erm` estimate with decomposed score:
   hook, clarity, compliance, conversion fit, brand fit.
2. Feed visual score into planner branch scoring.
3. Save media score reasons into replay.

Acceptance:

- better media planning quality
- better explainability for publish/no-publish

### P2-2. Replay Dataset and Trajectory Evaluator

Research origin:

- AgentGym-RL
- ReasoningBank

Primary modules:

- `dragon-senate-saas-v2/lossless_memory.py`
- `dragon-senate-saas-v2/memory_governor.py`
- `dragon-senate-saas-v2/policy_bandit.py`

Implementation slices:

1. Export replayable trajectories.
2. Add evaluator over:
   cost, stability, conversion proxy, complaint proxy.
3. Promote high-quality trajectories into playbooks.

Acceptance:

- stronger self-improving loop
- better offline tuning without risking production

## 5. Module-by-Module Task List

### CampaignGraph

- add search-aware branch scoring
- make `visual_erm`, cost, replay success first-class planning signals
- expose rejected branch reasons

### Senate Kernel

- add governance-aware planning
- add risk family taxonomy
- add autonomy metrics

### Memory Governor

- add role memory and folded reasoning cards
- separate success and failure playbooks
- support role-specific retrieval budgets

### Dispatcher

- add ToolTree-lite route selection
- add route cost/risk scoring
- persist branch decisions for audit

### Visualizer

- add decomposed visual reward scoring
- connect score back into planner
- store media quality evidence in trace

## 6. What Not To Do

- do not turn Lobster Pool into a general-purpose agent SDK
- do not move strategy logic onto edge
- do not make browser execution the default lane
- do not add large-model test-time scaling everywhere
- do not create shared memory without tenant and role isolation

## 7. Suggested Execution Order

1. P0-1 ToolTree-lite Planner
2. P0-2 Role-Aligned Memory
3. P0-3 Autonomy Metrics
4. P1-1 TrinityGuard-style Risk Taxonomy
5. P1-2 Synthetic Industry Task Generation
6. P1-3 Mobile Approval Loop
7. P2-1 Visual-ERM Upgrade
8. P2-2 Replay Dataset and Trajectory Evaluator

