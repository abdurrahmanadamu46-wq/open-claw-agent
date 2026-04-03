# Lobster Pool Research to Code Map v1

Last Updated: 2026-03-29
Input Basis:

- `docs/research_scan_20260329.md`
- current code modules in `dragon-senate-saas-v2`

## 1. Mapping Rules

This document maps external research and product signals to Lobster Pool modules using four questions:

1. What problem does the external work solve
2. Which Lobster Pool module already touches that problem
3. Where is the cleanest insertion point
4. What is the first bounded implementation slice

## 2. Core Mapping Table

### ToolTree / LiTS

Problem:

- search-based tool planning
- route pruning
- bounded planning under multi-tool uncertainty

Current Lobster Pool fit:

- `campaign_graph.py`
- `dragon_senate.py` strategist -> visualizer -> dispatcher chain
- `llm_router.py`

Primary insertion points:

- `simulate_campaign_graph(...)` in `campaign_graph.py`
- `dispatcher(...)` in `dragon_senate.py`

First slice:

- add a small planner object before final dispatch plan selection
- score branches by cost, risk, replay success, and quality

Expected effect:

- smarter planning
- lower chain failure
- lower cost

### MEM1 / Intrinsic Memory Agents / ReasoningBank / DeepAgent

Problem:

- long-horizon agent memory
- role-specific memory
- compressed reasoning memory

Current Lobster Pool fit:

- `build_memory_context(...)` in `senate_kernel.py`
- `append_episode_event(...)` in `memory_governor.py`
- `memory_snapshot(...)` in `memory_governor.py`

Primary insertion points:

- `memory_governor.py`
- `persist_kernel_memory(...)` in `senate_kernel.py`
- post-run hooks in `dragon_senate.py`

First slice:

- add role memory and folded reasoning summaries
- store failure and winning playbooks separately

Expected effect:

- stronger consistency
- lower prompt cost
- deeper moat

### TrinityGuard

Problem:

- multi-agent system risk taxonomy
- runtime monitoring and safeguards

Current Lobster Pool fit:

- `constitutional_guardian(...)` in `senate_kernel.py`
- `verification_gate(...)` in `senate_kernel.py`
- `kernel_metrics_dashboard(...)` in `memory_governor.py`

Primary insertion points:

- `senate_kernel.py`
- `memory_governor.py`
- `/kernel/metrics/dashboard` in `app.py`

First slice:

- classify risk into single-agent, inter-agent, system-emergent
- add risk family labels into reports, traces, alerts

Expected effect:

- more stable
- stronger enterprise trust
- stronger moat

### Security-aware planning / autonomy evaluation

Problem:

- measure how much autonomy is safe and useful

Current Lobster Pool fit:

- HITL flow
- kernel reports
- rollout policy

Primary insertion points:

- `verification_gate(...)`
- `persist_kernel_memory(...)`
- kernel metrics endpoints in `app.py`

First slice:

- track auto-pass, auto-block, review-needed, approval-latency

Expected effect:

- less approval waste
- more measurable governance

### AutoPlay / AgentGym-RL

Problem:

- discover new tasks
- generate useful trajectories
- create reusable environments and evaluation loops

Current Lobster Pool fit:

- `industry_kb_pool.py`
- `industry_taxonomy.py`
- `workflow_template_registry.py`
- `campaign_graph.py`

Primary insertion points:

- industry onboarding and template generation
- replay / simulation loops

First slice:

- add explorer-generated candidate tasks for a new industry
- verify and accept only executable tasks

Expected effect:

- lower onboarding cost
- faster industry cloning
- stronger moat

### Visual reward / performance-aware media planning

Problem:

- better quality control for media generation
- reward-aligned planning

Current Lobster Pool fit:

- `visualizer(...)` in `dragon_senate.py`
- `simulate_campaign_graph(...)` in `campaign_graph.py`
- `build_comfyui_generation_plan(...)`
- `build_post_production_plan(...)`

Primary insertion points:

- `visualizer(...)`
- `campaign_graph.py`

First slice:

- decompose visual quality into sub-scores
- feed those scores back into campaign simulation and planner branch choice

Expected effect:

- smarter media planning
- stronger publish quality gate

### Pushary-style mobile approval UX

Problem:

- approval friction
- delayed response to blocked tasks

Current Lobster Pool fit:

- Feishu / DingTalk channels
- mobile control surface

Primary insertion points:

- `feishu_channel.py`
- `dingtalk_channel.py`
- `app.py` approval and event endpoints

First slice:

- push approval request with one-tap approve/reject
- push retry exhaustion and completion notices

Expected effect:

- faster operator response
- stronger Lobster Pool identity

### Maximem-style private memory

Problem:

- user/tenant memory as product asset

Current Lobster Pool fit:

- tenant and policy memory already exist

Primary insertion points:

- `memory_governor.py`
- tenant profile and customer followup logic

First slice:

- create scoped customer/tenant memory classes for objections, close cues, preferred offers

Expected effect:

- higher personalization
- stronger moat

### Browser-agent lessons from Reddit / agent web discussions

Problem:

- browser cost, fragility, and anti-bot instability

Current Lobster Pool fit:

- edge executor
- browser-driven touchpoint execution

Primary insertion points:

- route selection before execution
- integration layer

First slice:

- force API-first lane when available
- keep browser execution only for true UI touchpoints

Expected effect:

- lower cost
- more stability

## 3. Module Focus

### CampaignGraph

Current role:

- lightweight pre-dispatch simulator
- computes risk, conversion, complaint, replay success, and visual score

Upgrade direction:

- become the planner scoring surface for ToolTree-lite
- accept multiple candidate branches instead of single heuristic path

### Senate Kernel

Current role:

- constitutional review
- verification gate
- confidence estimation

Upgrade direction:

- add planning-aware governance
- add autonomy and risk-family metrics

### Memory Governor

Current role:

- episode memory
- policy memory
- tenant memory
- kernel metrics

Upgrade direction:

- add role memory
- add folded reasoning cards
- add success/failure playbook stores

### Dispatcher

Current role:

- turns content package and visual outputs into execution jobs

Upgrade direction:

- branch planner
- route scoring
- route evidence persistence

### Visualizer

Current role:

- chooses render stack and generation plan

Upgrade direction:

- richer visual reward decomposition
- tighter coupling to campaign simulation and planner scoring

## 4. Best Immediate Fits

Highest fit:

- ToolTree / LiTS -> Dispatcher + CampaignGraph
- MEM1 / ReasoningBank -> Memory Governor + Senate Kernel
- TrinityGuard -> Senate Kernel + Metrics

Medium fit:

- AutoPlay / AgentGym-RL -> Industry onboarding
- Pushary / Maximem -> Mobile loop and tenant memory productization

Lower fit, or later fit:

- heavy world-model work
- broad embodied-agent research with weak workflow relevance
- generic browser-agent stacks that weaken Lobster Pool identity

## 5. Distinctive Lobster Pool Interpretation

The goal is not to copy frontier agent systems directly.

The Lobster Pool version should remain:

- governance-first
- tenant-memory-first
- cloud-brain / edge-executor
- growth-workflow-native
- China-local-business ready

That is the moat.

