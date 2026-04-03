# Research Scan 2026-03-29

Window scanned: 2026-03-15 to 2026-03-29 (Asia/Shanghai)

Goal: find recent research, products, and engineering patterns that can strengthen Lobster Pool while preserving the project core:

- smarter
- more stable
- lower cost
- deeper moat
- more distinctive Lobster Pool character

## Top signals

### 1. Tool planning is moving from greedy routing to search-based planning

- ToolTree (arXiv 2026-03-13): tool planning with dual-feedback MCTS and bidirectional pruning
- LiTS (arXiv 2026-02-28, still highly relevant): modular tree search framework with reusable Policy / Transition / RewardModel components

Why it matters:

- Lobster Pool already has agent orchestration and workflow graphs, but tool and channel selection is still mostly workflow-first and heuristic-first.
- A lightweight search layer can improve tool ordering, reduce dead-end branches, and make long multi-tool tasks less brittle.

### 2. Memory is shifting from raw logs to distilled reasoning memory

- MEM1 (ICLR 2026): synergizes memory and reasoning for long-horizon agents with strong memory-efficiency gains
- Intrinsic Memory Agents (OpenReview / ICLR 2026): role-aligned agent-specific memory
- ReasoningBank (OpenReview / GitHub): stores distilled reasoning from both successes and failures, plus memory-aware test-time scaling
- DeepAgent: autonomous memory folding with episodic / working / tool memory

Why it matters:

- Lobster Pool already has Senate Kernel memory governance and tenant / policy / episode memory.
- The next moat is not "more memory", but "better compressed memory per role, per tenant, per task family".

### 3. Multi-agent governance is becoming system-level, not prompt-level

- TrinityGuard (arXiv 2026-03-16): three-tier risk taxonomy for multi-agent systems, evaluation plus runtime monitoring
- ICLR 2026 "Optimizing Agent Planning for Security and Autonomy": security-aware planning plus autonomy metrics under HITL constraints
- Anthropic recent event and webinar focus on responsible agents, subagents, hooks, and MCP-connected internal tools

Why it matters:

- This is directly aligned with Lobster Pool's Senate Kernel and HITL-default stance.
- The opportunity is to upgrade from "guardrails around execution" to "governance-aware planning before execution".

### 4. Data and task generation are becoming a competitive advantage

- ICLR 2026 "Scaling Synthetic Task Generation for Agents via Exploration" (AutoPlay): explorer agent discovers environment affordances first, then generates executable tasks
- AgentGym-RL: broad environment set and trajectory replay UI for long-horizon RL

Why it matters:

- Lobster Pool needs continuous domain expansion across industries and channels.
- Synthetic but verifiable task generation can bootstrap new industries much faster than manual SOP writing.

### 5. Browser agents are converging on MCP + token-thrifty DOM access + strict guardrails

- AutoDOM (Reddit / GitHub, 2026-03): token-efficient DOM state and localhost-only security model
- Reddit discussions in March 2026 repeatedly highlight the same pain points: DOM size, selector brittleness, login reuse, anti-bot instability
- Skyvern and related launches continue to show appetite for browser workflow automation, but the practical advice remains: prefer API lanes when possible, and gate high-risk browser actions

Why it matters:

- This strongly validates Lobster Pool's current cloud-brain / edge-executor split.
- It also suggests we should avoid treating browser control as the default execution substrate for every workflow.

## Highest-value integration ideas

### A. Add a "ToolTree-lite" search layer above Dispatcher

Use:

- candidate tool / channel expansion
- small search budget
- dual feedback: pre-execution estimate + post-execution quality update

Targets:

- channel selection
- content generation provider selection
- outreach sequence planning
- RAG retrieval path selection

Expected gains:

- smarter planning
- lower failure rate in long tool chains
- lower cost through pruning

Best insertion point:

- CampaignGraph
- dispatcher planning
- model / tool router

### B. Upgrade Memory Governor into role-aligned memory

Split memory into:

- tenant memory
- role memory
- campaign memory
- failure memory
- winning playbook memory

Add:

- "memory folding" after long traces
- success/failure distilled reasoning cards
- per-role retrieval budget

Expected gains:

- better consistency
- lower token cost
- stronger moat via tenant-specific growth intelligence

### C. Add TrinityGuard-style runtime risk taxonomy

Model risk across:

- single-agent risks
- inter-agent communication risks
- system/emergent risks

Add:

- risk labels on traces
- runtime monitor agents
- alert categories by risk family
- red-team scenario packs per workflow

Expected gains:

- more stable
- stronger enterprise trust
- better auditability

### D. Introduce autonomy metrics into HITL

Track:

- actions that could run without approval
- actions blocked by policy
- actions escalated due to low confidence
- approval burden per tenant / workflow / channel

Expected gains:

- more measurable governance
- less wasted manual approval
- clearer optimization target for Senate Kernel

### E. Build synthetic industry task generation

For every new industry:

- explorer agent maps channels, assets, objections, regulations
- task generator produces executable SOP candidates
- verifier checks feasibility and observability
- accepted tasks become tenant/industry starter kits

Expected gains:

- lower onboarding cost
- faster industry cloning
- more distinctive "Lobster Pool knowledge factory"

## Product and UX ideas worth stealing

### 1. Mobile approval / notification loop

Inspired by:

- Pushary

Use in Lobster Pool:

- mobile push when a lobster needs approval
- push on task completion, blockage, or retry exhaustion
- one-tap yes/no approval for high-risk actions

This fits:

- Feishu / DingTalk control surface
- Lobster Pool's human-in-the-loop identity

### 2. Private memory layer for operator + tenant context

Inspired by:

- Maximem

Use in Lobster Pool:

- operator memory
- customer memory
- campaign context memory
- objection and close-rate memory

But keep it scoped:

- tenant isolation first
- memory class by sensitivity
- retrieval by role and workflow

### 3. More agent-ready internal data, less browser scraping

Repeated signal from Reddit:

- browser agents break easily
- large DOM snapshots burn tokens
- stable systems route to APIs when possible

Use in Lobster Pool:

- prefer API adapters for CRM / content / lead systems
- use browser only at true edge touchpoints
- preserve browser traces as fallback, not primary system of record

## What to build next

### P0

- ToolTree-lite planner for dispatcher and model/tool routing
- role-aligned memory and memory folding
- autonomy metrics for HITL and kernel reports

### P1

- TrinityGuard-style multi-agent risk taxonomy
- synthetic task generation for industry onboarding
- mobile approval push loop

### P2

- visual reward / performance-aware media planning for Visualizer
- replay dataset and trajectory evaluator for self-improving workflows

## Things to reject

- fully decentralized orchestration as the default architecture
- browser-first execution for everything
- expensive test-time scaling everywhere
- memory without tenant / role isolation
- "general agent platform" positioning that erodes Lobster Pool identity

## Best-fit external references

- ToolTree: https://arxiv.org/abs/2603.12740
- LiTS: https://arxiv.org/abs/2603.00631
- MEM1: https://openreview.net/forum?id=jJ6F1sDn9i
- Intrinsic Memory Agents: https://openreview.net/forum?id=UbSUxAK3BI
- ReasoningBank: https://openreview.net/forum?id=jL7fwchScm
- AgentGym-RL: https://openreview.net/forum?id=DhMb1ugWTL
- TrinityGuard: https://arxiv.org/abs/2603.15408
- ICLR 2026 security-aware planning poster: https://iclr.cc/virtual/2026/poster/10008186
- ICLR 2026 PerfGuard poster: https://iclr.cc/virtual/2026/poster/10006962
- ICLR 2026 AutoPlay poster: https://iclr.cc/virtual/2026/poster/10007463
- OpenAI stateful runtime context: https://openai.com/index/introducing-the-stateful-runtime-environment-for-agents-in-amazon-bedrock/
- OpenAI agent guide: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- Anthropic responsible agents event: https://www.anthropic.com/events/agentic-ai-in-action
- Anthropic advanced subagents webinar: https://www.anthropic.com/webinars/claude-code-advanced-patterns
- Product Hunt Pushary: https://www.producthunt.com/products/pushary
- Product Hunt Skyvern: https://www.producthunt.com/products/skyvern?launch=skyvern-2-0
- Future Tools Maximem: https://futuretools.io/tools/maximem-rdjf27
- Reddit browser agent practice thread: https://www.reddit.com/r/AI_Agents/comments/1rus2ab/curious_how_people_are_using_llmdriven_browser/
- Reddit best browser agent thread: https://www.reddit.com/r/AI_Agents/comments/1s2crma/best_web_browser_agent_in_2026/
- Reddit agent-ready web thread: https://www.reddit.com/r/mcp/comments/1rv338m/im_convinced_the_agentic_web_is_coming_but_most/

