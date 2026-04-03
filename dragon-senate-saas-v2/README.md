# Dragon Senate SaaS v3.1 (Commercialization Kickoff)

> Positioning update: this service is the **AI subservice** under unified `web + backend` control plane.
> It is no longer a parallel product line.

This release focuses on **Milestone 1 (User System + JWT)** while preserving v3 capabilities:

- LangGraph 9-agent orchestration + HITL
- RAG-Anything runtime chain (LightRAG-style hybrid query)
- Qdrant Binary Quantization
- CLI-Anything style edge SKILL discovery
- AnythingLLM embed integration
- Telegram mobile control panel

And now includes **Milestone 2 foundations**:

- Billing stub (mock provider) + usage event ledger
- Subscription guard middleware for paid paths
- Usage reporting API + summary API
- Provider adapter layer (`mock/stripe/alipay/wechatpay`) with env-switchable checkout/webhook routing

Providerized billing endpoints:

- `GET /billing/providers/status`
- `POST /billing/checkout`
- `POST /billing/webhook`
- Backward compatibility retained:
  - `POST /billing/mock/checkout`
  - `POST /billing/mock/webhook`

And now includes **v3.2 Claw-inspired hardening**:

- ClawRouter-style smart route adapter (`clawrouter_gateway.py`)
- ClawWork-style economy ledger and budget guard (`clawwork_economy.py`)
- lossless memory event store for trace debugging (`lossless_memory.py`)
- edge command safety gate (deny patterns + optional allow regex)

And now includes **Research Radar (v3.3 P0)**:

- `research_signals` multi-tenant intelligence table (`source/rank_type/score/tags/url/summary`)
- Daily A/B/C ingestion model:
  - A_auto: OpenAlex + GitHub API
  - B_semi: Hugging Face Papers Trending + QbitAI archive
  - C_manual: manual ingestion endpoint
- Feishu digest push (`/research/digest/feishu`) with top executable signals

And now includes **Industry KB Pool (v3.8, tag-driven private knowledge routing)**:

- Tenant-scoped industry knowledge profiles (one tenant, many industry tags)
- Auto-ingest for competitor formula output into industry-specific KB
- Runtime industry context injection for `run-dragon-team` strategist
- Quality-closed ingest pipeline (v3.8.1):
  - dedupe hash gate (`tenant + industry + dedupe_hash`)
  - low-quality reject gate (threshold by env: `INDUSTRY_KB_MIN_QUALITY_SCORE`, `INDUSTRY_KB_MIN_CONTENT_LEN`, `INDUSTRY_KB_MIN_EFFECT_SCORE`)
  - rejected/duplicate samples in ingest response + audit trail
- Endpoints:
  - `POST /industry-kb/generate-profile`
  - `POST /industry-kb/bulk-seed`
  - `PUT /industry-kb/profile`
  - `GET /industry-kb/profiles`
  - `POST /industry-kb/ingest`
  - `POST /industry-kb/dissect-and-ingest`
  - `GET /industry-kb/search`
  - `GET /industry-kb/stats`
  - `GET /industry-kb/metrics/dashboard`
- `run-dragon-team` request now supports:
  - `industry_tag` (optional, auto-detect fallback)
  - `industry_kb_limit` (default 6)
- `run-dragon-team` response now includes:
  - `industry_tag`
  - `industry_kb_context`
  - `industry_kb_metrics` (`industry_kb_hit_rate`, `industry_kb_effect_delta`, etc.)
- Trace/replay visibility:
  - `GET /memory/trace/{trace_id}` now includes `industry_kb` hit details
  - `GET /memory/replay/{trace_id}` now includes `industry_kb` snapshot
  - `GET /kernel/report/{trace_id}` now includes `industry_kb` for postmortem

### Manual Industry Build-Up Flow (operator controlled)

Use this one endpoint to run the full chain with your own competitor accounts:

`POST /industry-kb/dissect-and-ingest`

What it does end-to-end:

1. Confirm industry tag (use input tag first, auto-detect fallback)
2. Trigger account dissect node chain (`competitor_analysis -> competitor_formula_analyzer`)
3. Extract:
   - viral formulas
   - startup playbooks
   - copy templates
4. Auto-ingest to tenant+industry KB (`kb_beauty`, `kb_hotel`, etc. by scope key)
5. Push a full Feishu report with `"已存入知识池"` summary

Example request:

```bash
curl -X POST "http://127.0.0.1:8000/industry-kb/dissect-and-ingest" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "industry_tag": "beauty",
    "competitor_accounts": [
      "https://example.com/beauty/account-a",
      "https://example.com/beauty/account-b"
    ],
    "report_to_feishu": true,
    "feishu_chat_id": "oc_xxx"
  }'
```

Operator CLI helper (recommended for manual early-stage build-up):

```bash
python scripts/run_industry_kb_seed.py \
  --base-url http://127.0.0.1:8000 \
  --username admin \
  --password change_me \
  --industry-tag beauty \
  --competitor https://example.com/beauty/account-a \
  --competitor https://example.com/beauty/account-b \
  --feishu-chat-id oc_xxx \
  --save-report ./tmp/industry_beauty_report.md
```

This helper will:
- login -> get JWT
- call `/industry-kb/dissect-and-ingest`
- print summary counters
- print/save the markdown report

### Batch Pipeline (Local API one-by-one with schema guard + retry)

Use this when you have a mother profile (for example your Chinese restaurant JSON) and want to auto-fill all 72 subindustries.

```bash
python scripts/run_industry_kb_batch_generate.py \
  --base-url http://127.0.0.1:8000 \
  --username admin \
  --password change_me \
  --base-profile-json ./data/industry_profiles/chinese_restaurant_master.json \
  --system-prompt-path C:/Users/Administrator/Downloads/lobster_system_prompt_v2.txt \
  --output-dir ./tmp/industry_kb_generated \
  --request-retries 3 \
  --resume
```

What it does:

1. Login and fetch `/industry-kb/taxonomy`
2. Loop subindustries one-by-one (stable, traceable)
3. Call `POST /industry-kb/generate-profile` for each tag
4. Enforce schema + retry in both API layer and client script layer (network + response validation)
5. Optionally seed generated profile into KB (`--no-seed` for JSON only)
6. Save every generated JSON and `_summary.json` locally
7. Persist `_state.json` for resume-safe reruns

默认已启用消费者视角严格模板（`prompts/industry_kb_consumer_prompt.txt`）：
- 固定数量校验：30/120/30/20/40/40/25
- 拒绝老板经营视角污染（如获客成本/坪效/投流）
- 合规词库采用保守口径（导流/私下交易/疗效/收益承诺高压拦截）

Implementation notes:
- `scripts/industry_kb_sdk.py`: reusable local API SDK (login / taxonomy / generate + schema validation helper)
- `scripts/run_industry_kb_batch_generate.py`: outer batch runner (serial loop + retry + resume + local JSON outputs)

Regenerate canonical 72-subindustry taxonomy file:

```bash
python scripts/generate_industry_subcategories.py
```

And now includes **Senate Kernel (v3.4 P0)**:

- constitutional_guardian + verification_gate (gray rollout capable)
- main graph now has explicit kernel chain nodes:
  - `constitutional_guardian`
  - `verification_gate`
  - `memory_governor`
- Memory Governor with `episode/policy/tenant` layers
- industry policy baselines + customer micro-tuning (beauty/hotel/restaurant/tcm/housekeeping)
- Digital Human / Vlog strategy tuning is policy-driven and now propagates to ComfyUI/LibTV render adapters and post-production actions
- verification gate emits `publish_allowed`, `reason_codes`, `confidence_band`
- `run-dragon-team` preflight kernel report (`kernel_report`) for auditability
- Kernel trace report endpoint: `GET /kernel/report/{trace_id}`
- Persistent kernel report recovery (service restart-safe) + list API:
  - `GET /kernel/report/{trace_id}` (returns `kernel_report_persisted` + `approval_journal`)
  - `GET /kernel/reports?user_id=...&limit=50`
- Tenant-level rollout strategy (DB policy table, supports ratio + time window):
  - `GET /kernel/rollout/policy`
  - `PUT /kernel/rollout/policy`
- Rollback replay endpoint:
  - `POST /kernel/report/{trace_id}/rollback` (`preflight|postgraph`, `dry_run=true|false`)

Kernel regression scripts:

- `python scripts/test_kernel_chain_inprocess.py`
- `python scripts/test_kernel_report_persistence_inprocess.py`
- `python scripts/test_kernel_rollout_and_rollback_inprocess.py`
- `python scripts/test_libtv_mock_inprocess.py`
- `python scripts/test_visualizer_dispatcher_libtv_slice.py`
- `python scripts/test_visualizer_dispatcher_comfyui_slice.py`
- `python scripts/test_visualizer_industry_workflow_inprocess.py`
- `python scripts/test_workflow_template_registry_inprocess.py`
- `python scripts/test_comfyui_capability_plan_inprocess.py`
- `python scripts/test_media_post_pipeline_inprocess.py`
- `python scripts/test_comfyui_pipeline_plan_endpoint_inprocess.py`
- `python scripts/test_senate_kernel_graph_nodes_inprocess.py`
- `python scripts/test_campaign_graph_publish_gate_inprocess.py`
- `python scripts/test_visualizer_policy_tuning_inprocess.py`
- `python scripts/test_billing_provider_adapter_inprocess.py`

And includes **pkgx deep integration** for edge zero-install distribution:

- edge runtime shebang switched to pkgx (`4MB standalone binary` style)
- SKILL manifest upgraded with pkgx shebang + command examples
- `dragon dev` one-command bootstrap for desktop + landing-page demos
- production shim auto-created (`dragon-edge ...`) without host pollution

And now includes **Video Factory 2.0 (v3.5, LibTV skill runtime)**:

- Visualizer upgraded from prompt-only mode to `LibTV session -> polling -> media URLs`
- Dispatcher packages generated media URLs directly into content jobs (`jobs[].media`)
- Integrations observability:
  - `GET /integrations/libtv/status`
  - `GET /integrations/libtv/session/{session_id}`
- Edge SKILL manifest now includes `libtv-render` (pkgx-native)

And now includes **Video Factory 2.1 (v3.6, Local ComfyUI first + LibTV fallback)**:

- Visualizer provider order is now:
  - `comfyui-local` (preferred when local GPU/runtime is available)
  - `libtv-skill` (cloud fallback)
  - `prompt-only` (final fallback, no render URLs)
- Integrations observability:
  - `GET /integrations/comfyui/status`
  - `GET /integrations/comfyui/capabilities`
  - `POST /integrations/comfyui/pipeline/plan`
  - `GET /integrations/comfyui/prompt/{prompt_id}`
  - `GET /integrations/comfyui/workflow-templates`
  - `GET /integrations/comfyui/workflow-templates/sources`
  - `GET /integrations/comfyui/workflow-templates/recommend?industry=hotel&limit=20`
  - `POST /integrations/comfyui/workflow-templates/import`
  - `POST /integrations/comfyui/workflow-templates/activate`
- Template import now supports **UI workflow -> API prompt graph auto-convert** (for many community JSON exports).
- Dispatcher now records both local/cloud render metadata:
  - `visual_delivery.comfyui_prompt_id`
  - `visual_delivery.libtv_session_id`

And now includes **Video Factory 2.2 (v3.7, Digital Human + Narration + Auto Post Pipeline)**:

- Capability matrix for high-value ComfyUI stacks (WanVideo/VibeVoice/PortraitMaster/ControlNet/LayerStyle/LLM Party/etc.).
- Generation plan now outputs digital-human and narration modes with readiness/fallback signals.
- Dispatcher now packages automatic post-production plan:
  - image retouch profile (portrait/product aware)
  - video timeline analysis (short-ad / story / vlog-long)
  - auto cut/subtitle/lip-sync refine suggestions
- New operator endpoint:
  - `POST /integrations/comfyui/pipeline/plan`
    - input: task_description + industry + media_urls
    - output: generation plan + post-production plan + capability snapshot

Recommended env:

```env
LIBTV_ENABLED=true
LIBTV_ACCESS_KEY=your_libtv_key
OPENAPI_IM_BASE=https://im.liblib.tv
LIBTV_TIMEOUT_SEC=30
LIBTV_POLL_INTERVAL_SEC=4
LIBTV_POLL_ROUNDS=8
LIBTV_CHANGE_PROJECT_EACH_RUN=false
LIBTV_MOCK_FORCE=false
```

ComfyUI local runtime env:

```env
COMFYUI_ENABLED=false
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_TIMEOUT_SEC=30
COMFYUI_POLL_INTERVAL_SEC=2
COMFYUI_POLL_ROUNDS=20
COMFYUI_WORKFLOW_PATH=
COMFYUI_WORKFLOW_JSON=
COMFYUI_NEGATIVE_PROMPT=low quality, bad anatomy, watermark, blurry, distorted, artifact
COMFYUI_SEED=42
COMFYUI_WIDTH=1024
COMFYUI_HEIGHT=576
COMFYUI_STEPS=25
COMFYUI_MOCK_FORCE=false
COMFYUI_WORKFLOW_PATH_HOTEL=
COMFYUI_WORKFLOW_PATH_RESTAURANT=
COMFYUI_WORKFLOW_PATH_TCM=
COMFYUI_WORKFLOW_PATH_HOUSEKEEPING=
COMFYUI_WORKFLOW_PATH_BEAUTY=
COMFYUI_WORKFLOW_PATH_EDUCATION=
COMFYUI_WORKFLOW_PATH_FITNESS=
COMFYUI_WORKFLOW_PATH_RETAIL=
COMFYUI_TEMPLATE_AUTO_CONVERT=true
COMFYUI_CONVERTER_USE_OBJECT_INFO=false
COMFYUI_CONVERTER_TIMEOUT_SEC=8
COMFYUI_CUSTOM_NODES_ROOT=
COMFYUI_ENABLE_WANVIDEO=false
COMFYUI_ENABLE_VIBEVOICE=false
COMFYUI_ENABLE_PORTRAIT_MASTER=false
COMFYUI_ENABLE_CONTROLNET_AUX=false
COMFYUI_ENABLE_LAYERSTYLE=false
COMFYUI_ENABLE_EASY_USE=false
COMFYUI_ENABLE_LLM_PARTY=false
COMFYUI_ENABLE_COPILOT=false
COMFYUI_ENABLE_CUSTOM_SCRIPTS=false
COMFYUI_ENABLE_AI_DOCK=false
```

Import a template from GitHub raw URL:

```bash
python scripts/import_comfy_template_from_github.py \
  --industry hotel \
  --name hotel-v1 \
  --raw-url https://raw.githubusercontent.com/<org>/<repo>/<ref>/workflows/hotel.api.json \
  --source-repo <org>/<repo> \
  --ref <ref> \
  --activate
```

Registry behavior:

1. Visualizer first checks registry active template by industry.
2. If registry has no active template, it falls back to env mapping (`COMFYUI_WORKFLOW_PATH_*`).
3. Render provider order remains `comfyui-local -> libtv-skill -> prompt-only`.
4. Use recommendation endpoint to discover official templates by industry before import.
5. If imported JSON is UI export format (`nodes/links`), registry auto-converts to API prompt graph.

Hybrid recommendation:

1. Use `COMFYUI_ENABLED=true` on machines with local GPUs (e.g. RTX 4070 Ti).
2. Keep `LIBTV_ENABLED=true` as fallback.
3. In production, monitor `/integrations/comfyui/status` and route unavailable nodes to LibTV automatically.

Quick cost baseline (for 15s ad video generation):

1. Local ComfyUI (4070 Ti): marginal API cost ~= 0 CNY/video (only power + depreciation).
2. Cloud LibTV fallback: pay-per-generation API cost (vendor dependent, higher but stable).
3. Hybrid mode (recommended): local first + cloud fallback usually cuts generation spend by ~60%-85% vs cloud-only.

## What Changed in v3.1

## 1) FastAPI Users + JWT (Milestone 1)

New auth module:

- `user_auth.py`

What is included:

- FastAPI Users SQLAlchemy store (`auth_users` table)
- JWT auth backend (`/auth/jwt/login`)
- User registration (`/auth/register`)
- User management router (`/users/*`)
- Bootstrap admin user on startup
- Compatibility login (`POST /auth/login`) now authenticates against auth DB first

Key env vars:

```env
JWT_SECRET=change_this_to_a_long_random_secret
JWT_EXPIRE_MINUTES=120
AUTH_DATABASE_URL=
AUTH_BOOTSTRAP_ADMIN_EMAIL=admin@liaoyuan.example.com
AUTH_BOOTSTRAP_ADMIN_PASSWORD=ChangeMe123!
AUTH_BOOTSTRAP_ADMIN_USERNAME=admin
AUTH_BOOTSTRAP_ADMIN_TENANT=tenant_demo
```

Milestone 1 smoke-test script:

- `scripts/test_m1_auth_jwt.py`

What it validates (end-to-end):

1. `POST /auth/register`
2. `POST /auth/login` (username/password custom login)
3. `GET /auth/me` (tenant + role claims)
4. `POST /auth/jwt/login` (FastAPI Users JWT login)
5. `GET /users/me` (FastAPI Users identity endpoint)

Run:

```bash
# If service runs by docker-compose root stack:
APP_BASE_URL=http://127.0.0.1:18000 python scripts/test_m1_auth_jwt.py

# If service runs standalone (uvicorn app:app --port 8000):
APP_BASE_URL=http://127.0.0.1:8000 python scripts/test_m1_auth_jwt.py
```

## 2) Per-user RAG Isolation

File:

- `qdrant_config.py`

Behavior:

- one user scope -> one collection (`viral_formulas__u_<user_scope>`)
- metadata scope tags retained for in-memory fallback
- all strategist/rag-ingest/feedback searches are scope-aware

Env:

```env
QDRANT_PER_USER_COLLECTION=true
QDRANT_COLLECTION_NAME=viral_formulas
QDRANT_ENABLE_BINARY_QUANTIZATION=true
```

## 3) RAG-Anything Runtime Scope Isolation

File:

- `multimodal_rag_adapter.py`

Behavior:

- runtime state and workdir are separated by `user_id` scope
- ingest/query APIs now accept `user_id`
- hybrid mode chain defaults to `hybrid,mix,local,naive`

## 4) AnythingLLM Workspace API (Multi-tenant)

Files:

- `anythingllm_embed.py`
- `app.py`

New endpoint:

- `POST /integrations/anythingllm/workspaces/ensure`

Embed endpoint now supports workspace auto-binding:

- `GET /integrations/anythingllm/embed/snippet?embed_id=...&auto_workspace=true`

Env:

```env
ANYTHINGLLM_BASE_URL=http://127.0.0.1:3002
ANYTHINGLLM_API_KEY=
ANYTHINGLLM_EMBED_SCRIPT_URL=https://cdn.jsdelivr.net/npm/@mintplex-labs/anythingllm-embed/dist/embed.js
ANYTHINGLLM_EMBED_API_BASE=http://127.0.0.1:3002
```

## 5) CLI-Anything Bootstrap on Edge

## 6) Billing Stub + Usage Reporting + Subscription Guard (Milestone 2)

New file:

- `billing.py`

New APIs:

- `GET /billing/subscription/me`
- `GET /billing/usage/summary`
- `POST /billing/usage/report`
- `POST /billing/mock/checkout`
- `POST /billing/mock/webhook` (requires `x-billing-secret`)

Behavior:

- every guarded runtime request is checked by middleware before execution
- default guarded paths:
  - `/run-dragon-team`
  - `/analyze_competitor_formula`
  - `/receive_dm_from_edge`
- successful runtime calls automatically append usage events (`runs/tokens/cost estimate`)

Env:

```env
BILLING_DATABASE_URL=
BILLING_DEFAULT_PLAN=free
BILLING_DEFAULT_CYCLE=month
BILLING_GUARD_ENABLED=true
BILLING_GUARDED_PATHS=/run-dragon-team,/analyze_competitor_formula,/receive_dm_from_edge
BILLING_MOCK_WEBHOOK_SECRET=billing-mock-secret
BILLING_EST_PRICE_PER_MTOK_CNY=0.45
```

Plan knobs:

```env
PLAN_FREE_TOKEN_LIMIT=300000
PLAN_FREE_RUN_LIMIT=120
PLAN_PRO_TOKEN_LIMIT=10000000
PLAN_PRO_RUN_LIMIT=3000
PLAN_PRO_PRICE_MONTH_CNY=499
PLAN_PRO_PRICE_YEAR_CNY=4990
PLAN_ENTERPRISE_TOKEN_LIMIT=100000000
PLAN_ENTERPRISE_RUN_LIMIT=50000
PLAN_ENTERPRISE_PRICE_MONTH_CNY=4999
PLAN_ENTERPRISE_PRICE_YEAR_CNY=49990
```

## 7) Smart Routing + Economy + Lossless Memory (v3.2)

New files:

- `clawrouter_gateway.py`
- `clawwork_economy.py`
- `lossless_memory.py`

New APIs:

- `GET /economy/status`
- `POST /economy/credit` (admin only)
- `GET /memory/events`
- `GET /memory/trace/{trace_id}`
- `GET /memory/replay/{trace_id}`

What changed:

- LLM route now supports external ClawRouter-compatible gateway (optional)
- Low-risk routine tasks are now hard-forced to `free` tier (local route)
- Cloud route can be budget-forced to local if wallet is insufficient
- Every key flow (`run/analyze/dm`) is appended to lossless memory for debugging
- `integrations/overview` now returns clawrouter/clawwork status

Env:

```env
CLAWROUTER_ENABLED=false
CLAWROUTER_BASE_URL=http://127.0.0.1:8402
CLAWROUTER_ROUTE_PATH=/v1/route
CLAWROUTER_API_KEY=
CLAWROUTER_TIMEOUT_SEC=2.5
CLAWROUTER_FREE_MODEL=
CLAWROUTER_LOW_RISK_TASK_TYPES=echo_reply,engagement_copy,radar_cleaning,strategist_clustering,intent_tagging,trend_scan,comment_hint,reply_draft,routine,llm_smoke,deepseek_smoke,health_check,status_query,trace_summary,metrics_snapshot,memory_hits
CLAWROUTER_ECO_TASK_TYPES=strategy_planning,content_generation,competitor_analysis,competitor_formula_analyzer,rag_ingest,dispatch_plan,dm_followup,general,dispatcher,hotspot_investigation,lead_scoring,trace_aggregate,replay_audit_summary,policy_bandit_update,persona_mask_apply,edge_skill_discovery,webhook_delivery
CLAWROUTER_PREMIUM_TASK_TYPES=sales_followup,followup_voice,multimodal_heavy,critical_conversion,long_script,human_approval_gate,compliance_review,legal_review,voice_call_realtime,cross_tenant_write,financial_settlement,risk_override

CLAWWORK_ECONOMY_ENABLED=false
CLAWWORK_DB_PATH=./data/clawwork_economy.sqlite

SENATE_KERNEL_ENABLED=true
SENATE_KERNEL_GREY_RATIO=100
SENATE_KERNEL_BLOCK_MODE=hitl
# SENATE_KERNEL_TENANT_ALLOWLIST=tenant_demo,tenant_enterprise
KERNEL_VERIFICATION_MIN_LOW=0.55
KERNEL_VERIFICATION_MIN_SOURCE=0.60
KERNEL_VERIFICATION_MIN_CENTER=0.85
MEMORY_GOVERNOR_DB_PATH=./data/memory_governor.sqlite
CLAWWORK_INITIAL_BALANCE_CNY=5.0
CLAWWORK_MIN_BALANCE_CNY=0.5
CLAWWORK_REWARD_PER_SUCCESS_CNY=0.03
CLAWWORK_LOCAL_COST_PER_MTOK_CNY=0.02

LOSSLESS_MEMORY_DB_PATH=./data/lossless_memory.sqlite
EDGE_COMMAND_DENY_PATTERNS=rm -rf, mkfs, shutdown, reboot, format , del /f /q, :(){
EDGE_COMMAND_ALLOW_REGEX=
```

## 7.1) LLM Factory Fallback + Multi-Cloud Vendor

Files:

- `llm_factory.py`
- `llm_router.py`

What changed:

- `llm_router` no longer hard-depends on `langchain_openai` at import time.
- Factory fallback chain:
  - ChatOpenAI (OpenAI-compatible)
  - ChatOllama (local fallback)
  - MockChatModel (for local E2E graph flow test)
- Cloud route vendor can switch at runtime:
  - DashScope
  - DeepSeek
  - Volcengine Ark

Env:

```env
CLOUD_LLM_VENDOR=deepseek
LLM_CLOUD_PROVIDER_ORDER=deepseek,dashscope,volcengine

DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_KEY=

VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VOLCENGINE_MODEL=
VOLCENGINE_API_KEY=

OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
LLM_MOCK_ENABLED=true
LLM_MOCK_FORCE=false
```

DeepSeek smoke check (admin):

```bash
# local fallback allowed
python scripts/test_llm_deepseek_smoke.py

# require cloud success (need DEEPSEEK_API_KEY configured)
DEEPSEEK_FORCE_CLOUD=true python scripts/test_llm_deepseek_smoke.py

# require specific backend prefix in metrics delta (default: chatopenai:deepseek)
DEEPSEEK_FORCE_CLOUD=true DEEPSEEK_EXPECT_BACKEND=chatopenai:deepseek python scripts/test_llm_deepseek_smoke.py
```

Run-dragon-team baseline (latency + backend route delta):

```bash
# stable local benchmark (default mock mode)
python scripts/test_run_dragon_team_baseline.py

# real model benchmark (requires reachable model services + credentials)
RUN_BASELINE_FORCE_REAL=true python scripts/test_run_dragon_team_baseline.py

# custom baseline prompt
RUN_BASELINE_TASK_DESCRIPTION="Generate a short launch plan for skincare campaign." python scripts/test_run_dragon_team_baseline.py
```

Timezone guard regression (naive/aware compare):

```bash
python scripts/test_mock_timezone.py
```

## 8) ClawTeam-style Dispatcher Queue (v3.2)

What changed:

- Dispatcher now writes jobs into a lightweight inbox queue (`clawteam_inbox.py`).
- Worker lifecycle is now real-time linked: `queued -> running -> completed/failed`.
- Dependency chain is enforced (`prepare -> render -> publish -> campaign.audit`).
- Tasks include `worker_id`, `attempt_count`, `started_at`, `finished_at`, `last_error`.
- Queue summary is reflected in `dispatch_plan` and queryable by API.

New API:

- `GET /clawteam/queue?trace_id=<trace>&user_id=<optional>`
- Optional filters: `status`, `lane`, `limit`
- `GET /clawteam/workers?trace_id=<trace>&user_id=<optional>`
- `POST /clawteam/worker/heartbeat`
- `POST /clawteam/worker/claim`
- `POST /clawteam/worker/ack`
- `POST /clawteam/requeue-stale`

Env:

```env
CLAWTEAM_DB_PATH=./data/clawteam_inbox.sqlite
```

## 8.0.1) Deterministic FollowUp Sub-Agent Spawning (v3.3)

What changed:

- FollowUp node now supports deterministic child spawning when lead volume crosses threshold.
- Spawn plan is deterministic by `trace_id + lead_ids` (same input => same child IDs/shards).
- Child runs execute with bounded concurrency and write execution records to SQLite.
- ClawTeam queue now receives `followup_call` lane tasks for spawned child calls.
- DM subflow FollowUp (`/receive_dm_from_edge`) uses the same deterministic spawning and persistence path.
- `run-dragon-team` response now exposes `followup_spawn` to support one-click trace drill-down in dashboard.
- Full run snapshot is queryable by API for replay/trace panels.

New API:

- `GET /followup/spawns/recent?user_id=<optional>&limit=<optional>`
- `GET /followup/spawns/{trace_id}?user_id=<optional>`

Env:

```env
FOLLOWUP_DETERMINISTIC_SPAWN_ENABLED=true
FOLLOWUP_SUBAGENT_THRESHOLD=6
FOLLOWUP_MAX_CHILDREN=10
FOLLOWUP_LEADS_PER_CHILD=2
FOLLOWUP_CHILD_CONCURRENCY=4
FOLLOWUP_SUBAGENT_DB_PATH=./data/followup_subagents.sqlite
```

Deterministic spawn regression test:

```bash
python scripts/test_followup_deterministic_spawn_inprocess.py
```

Expected:

- Main FollowUp and DM FollowUp both trigger deterministic child shards under threshold settings.
- Spawn runs and child rows are persisted to `followup_subagents.sqlite`.
- ClawTeam `followup_call` lane queue summary stays consistent with spawn summary.
- API endpoints `/followup/spawns/recent` and `/followup/spawns/{trace_id}` return the persisted rows.

## 8.1) Mobile Chat Gateway (Feishu + DingTalk + Telegram)

What changed:

- `/webhook/chat_gateway` now auto-detects channel payload and routes to Feishu / DingTalk / Telegram.
- Reply transport is unified (`send_chat_reply`) with async background tasks to keep webhook ACK fast.
- Feishu/DingTalk channel status is exposed in `/integrations/overview`.
- Optional signature verification + anti-replay lock added for Feishu/DingTalk webhooks.
- Added admin test endpoint: `POST /integrations/feishu/test`.
- Added command route: send **“生成酒店推广视频”** (or “生成xx推广视频”) to trigger:
  - industry template auto-activate/import
  - main graph generation execution
  - rendered preview links reply.

Env:

```env
FEISHU_ENABLED=false
FEISHU_REPLY_MODE=webhook
FEISHU_BOT_WEBHOOK=
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_VERIFY_SIGNATURE=false
FEISHU_SIGNING_SECRET=
FEISHU_VERIFICATION_TOKEN=

DINGTALK_ENABLED=false
DINGTALK_REPLY_MODE=webhook
DINGTALK_BOT_WEBHOOK=
DINGTALK_SESSION_WEBHOOK=
DINGTALK_VERIFY_SIGNATURE=false
DINGTALK_SIGNING_SECRET=
DINGTALK_VERIFICATION_TOKEN=
CHAT_WEBHOOK_REPLAY_WINDOW_SEC=300
```

Regression gate:

- Local: `python scripts/test_stage2_chain.py`
- CI: `.github/workflows/dragon-senate-v3-gate.yml` now blocks release if this chain fails.

### Feishu callback `url invalid` quick closure

If Feishu console rejects callback URL, run preflight before retrying subscription:

```bash
python scripts/preflight_feishu_callback.py \
  --public-url "https://api.your-domain.com/webhook/chat_gateway" \
  --local-base-url "http://127.0.0.1:18000" \
  --env-file ".env"
```

What this checks:

1. DNS resolution for callback host
2. Local challenge handshake (`/webhook/chat_gateway`)
3. Public `/healthz` reachability
4. Public challenge handshake response (`{"challenge":"..."}`)
5. `FEISHU_*` env consistency (`enabled/reply_mode/token/signing`)

Recommended Feishu subscription mode:

- Use **HTTP callback URL** mode (not long connection mode for current backend)
- Callback URL: `https://<public-domain>/webhook/chat_gateway`
- Ensure app is published and `im.message.receive_v1` is subscribed

## 9) OpenClaw-RL-inspired Online Bandit (v3.2)

What changed:

- Strategist reads bandit recommendation (`storyboard_count` + `tone`).
- Visualizer now also does template-arm selection (`workflow_template:<industry>`) for A/B routing.
- Feedback now updates a multi-objective reward:
  - `conversion_rate` (positive)
  - `replay_success_rate` (positive)
  - `complaint_rate` (negative penalty)
- No heavyweight retraining needed; policy adapts continuously by tenant/user.

New API:

- `GET /policy/bandit?user_id=<optional>`

Env:

```env
POLICY_BANDIT_ENABLED=true
POLICY_BANDIT_DB_PATH=./data/policy_bandit.sqlite
POLICY_BANDIT_EPSILON=0.18
POLICY_BANDIT_WEIGHT_CONVERSION=0.60
POLICY_BANDIT_WEIGHT_REPLAY_SUCCESS=0.30
POLICY_BANDIT_WEIGHT_COMPLAINT=0.10
```

File:

- `edge_agent.py`

What is added:

- optional bootstrap flag to clone CLI-Anything repo
- optional 7-phase command pipeline execution
- generated `SKILL.md` and skills JSON auto-wired back into register payload

CLI flags:

```bash
python edge_agent.py \
  --edge_id=edge-001 \
  --account_token=token-001 \
  --user_id=tenant_user_1 \
  --cli_anything_bootstrap \
  --cli_anything_repo_url=https://github.com/HKUDS/CLI-Anything.git \
  --cli_anything_dir=./cli-anything
```

## Quick Start

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Set environment:

```bash
cp .env.example .env
```

3. Start full stack:

```bash
docker compose up -d --build
```

## pkgx Zero-Install Workflow (Edge + Dev)

Files:

- `edge_agent.py` (pkgx shebang runtime)
- `SKILL.md` (pkgx skill examples)
- `dragon` (one-command dev + edge runner + shim installer)
- `deploy.sh` (auto install pkgx + create `dragon`/`dragon-edge` shims)

Use:

```bash
chmod +x ./dragon
./dragon dev
./dragon shim
dragon-edge --edge_id=edge-001 --account_token=token-001 --user_id=u1
```

Deploy with pkgx + shim auto setup:

```bash
PKGX_INSTALL=true DRAGON_DEV_BOOTSTRAP=true sudo bash deploy.sh
```

Why this matters:

- no global python/node/deno install required on edge host
- toolchain is cached in `~/.pkgx`, reusable across runs
- host PATH remains clean (example: running edge flow does not permanently install `deno`)

4. Verify health:

```bash
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/metrics
```

## Auth Smoke Test (Milestone 1)

1. Register user:

```bash
curl -X POST "http://127.0.0.1:8000/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"u1@example.com\",\"password\":\"Passw0rd!123\",\"username\":\"u1\",\"tenant_id\":\"tenant_u1\"}"
```

2. JWT login (FastAPI Users standard):

```bash
curl -X POST "http://127.0.0.1:8000/auth/jwt/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=u1@example.com&password=Passw0rd!123"
```

3. Call protected API with bearer token:

```bash
curl "http://127.0.0.1:8000/auth/me" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

## Billing Smoke Test (Milestone 2)

1. Read current subscription:

```bash
curl "http://127.0.0.1:8000/billing/subscription/me" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

2. Mock checkout to Pro:

```bash
curl -X POST "http://127.0.0.1:8000/billing/mock/checkout" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"plan_code\":\"pro\",\"cycle\":\"month\"}"
```

3. Trigger runtime call (auto usage report):

```bash
curl -X POST "http://127.0.0.1:8000/run-dragon-team" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"task_description\":\"Generate and dispatch short-video content package\",\"user_id\":\"u1\"}"
```

4. Query usage summary:

```bash
curl "http://127.0.0.1:8000/billing/usage/summary" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

5. Economy status:

```bash
curl "http://127.0.0.1:8000/economy/status" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

6. Lossless memory by user:

```bash
curl "http://127.0.0.1:8000/memory/events?limit=50" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

## Edge Client Rewards + OTP Relay (Client-side Closed Loop)

New endpoints:

- `POST /edge/heartbeat` (edge secret protected)
- `GET /rewards/wallet`
- `GET /rewards/claims`
- `POST /rewards/claim/free-pack`
- `POST /otp/request` (edge secret protected)
- `GET /otp/pending`
- `POST /otp/submit`
- `POST /otp/cancel`
- `POST /otp/consume` (edge secret protected)

Purpose:

1. Keep customer "养虾乐趣" with uptime-to-reward conversion.
2. Free tier can redeem partial runs/tokens from uptime.
3. Customer can always relay login OTP to edge node for Douyin/XHS account continuity.

In-process regression:

```bash
python scripts/test_edge_rewards_otp_inprocess.py
```

## Edge Resource Consent + Lease Audit (Compliance-first)

This release adds a strict resource-governor layer so edge IP/compute usage is **explicitly consented, auditable, and revocable**.

New endpoints:

- `GET /edge/consent/{edge_id}`
- `PUT /edge/consent/{edge_id}`
- `POST /edge/consent/{edge_id}/revoke`
- `POST /edge/lease/start` (edge secret protected)
- `POST /edge/lease/end` (edge secret protected)
- `GET /edge/lease/logs`
- `GET /edge/resource/summary`

Behavior:

1. Node registration writes consent snapshot (`consent_version`, `ip_share_enabled`, `compute_share_enabled`).
2. Lease start is denied automatically when consent is missing/disabled/revoked.
3. Every lease is logged with purpose and trace metadata for replay/postmortem.
4. User/admin can revoke consent anytime; subsequent lease requests are blocked.

Regression:

```bash
python scripts/test_edge_resource_governor_inprocess.py
```

## RAG-Anything + Formula Ingest Test

```bash
curl -X POST "http://127.0.0.1:8000/analyze_competitor_formula" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"target_account_url\":\"https://xhs.example.com/benchmark/abc\",\"user_id\":\"u1\"}"
```

Expected:

- `competitor_formulas` not empty
- `rag_ingested_count > 0`
- `rag_mode` is `raganything_runtime` (or fallback mode if package/key missing)

## AnythingLLM Workspace Ensure Test

```bash
curl -X POST "http://127.0.0.1:8000/integrations/anythingllm/workspaces/ensure" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"u1\",\"tenant_id\":\"tenant_u1\",\"workspace_name\":\"tenant_u1_workspace\"}"
```

Expected:

- `ok=true` if API key and endpoint are valid
- `workspace_slug` returned (or `missing_api_key` in local no-key mode)

## Telegram Bot

File:

- `telegram_bot.py`

Commands:

- `/memories`
- `/workspace [tenant_id] [workspace_name]`
- `/approve <approval_id>`
- `/reject <approval_id>`

New env for workspace command:

```env
TELEGRAM_BACKEND_BEARER=<admin_jwt_token>
```

## Desktop Packaging (Tauri)

Script:

- `desktop_package_tauri.ps1`

Example:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop_package_tauri.ps1 -AppName "LiaoyuanDesk" -WebUrl "http://127.0.0.1:3012"
```

Optional (run `dragon dev` before packaging):

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop_package_tauri.ps1 -AppName "LiaoyuanDesk" -WebUrl "http://127.0.0.1:3012" -BootstrapWithDragon
```

Optional first-run onboarding:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop_package_tauri.ps1 -AppName "LiaoyuanDesk" -WebUrl "http://127.0.0.1:3012" -FirstRunInit
```

## Installer / Update Chain

`dragon` command now supports:

- `dragon init` (run dev bootstrap + create shim + onboarding marker)
- `dragon update [stable]` (verify signed manifest + keyId + artifact SHA256)

Manifest file:

- `updates/stable.json` (default local manifest)
- Required fields: `keyId`, `signature_alg`, `signature`, `artifact.url`, `artifact.sha256`

Optional env:

```env
DRAGON_UPDATE_MANIFEST_URL=https://your-domain/releases/stable.json
DRAGON_UPDATE_REQUIRE_SIGNATURE=true
DRAGON_UPDATE_DEFAULT_KEY_ID=default
DRAGON_UPDATE_KEYS_JSON={"default":"-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----","k2026q1":"-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"}
DRAGON_UPDATE_APPLY_GIT_PULL=false
```

Local smoke with bundled manifest (`updates/stable.json`):

```bash
DRAGON_UPDATE_REQUIRE_SIGNATURE=true \
DRAGON_UPDATE_KEYS_JSON='{"dev-hmac":"hmac:dev-secret"}' \
./dragon update stable
```

## Checkpointer: Local vs Production

为了避免 `run-dragon-team` 在本地联调时因为 Postgres checkpointer 依赖而阻塞，建议按环境分层：

- **本地开发 / CI 轻量回归**
  - `ALLOW_INMEMORY_CHECKPOINTER=true`
  - 不强依赖 `langgraph.checkpoint.postgres`
  - 适合 in-process 与切片 E2E（快速验收主链状态流转）

- **生产 / 预发**
  - `ALLOW_INMEMORY_CHECKPOINTER=false`
  - 安装并启用 Postgres checkpointer（`langgraph.checkpoint.postgres`）
  - 持久化线程状态，保障重放/回滚/审计

建议环境变量示例：

```env
# local/ci
ALLOW_INMEMORY_CHECKPOINTER=true

# staging/prod
# ALLOW_INMEMORY_CHECKPOINTER=false
# DATABASE_URL=postgresql://...
```

若你在本地看到 checkpointer import 或 lifespan 相关报错，优先确认是否误用了生产配置。

## Monitoring

- Prometheus: [http://127.0.0.1:9090](http://127.0.0.1:9090)
- Grafana: [http://127.0.0.1:3001](http://127.0.0.1:3001)

## Notes for Mainland Deployment

- Prefer local Ollama for routine flows (`qwen3:8b/14b`)
- Route only complex tasks to cloud LLM
- Keep `QDRANT_PER_USER_COLLECTION=true` for tenant isolation
- Keep HITL enabled in production-sensitive conversion actions

## Commercial Selling Point (for launch materials)


- "4MB 二进制，一键养边缘龙虾"
- "零安装、零污染、版本锁定、缓存秒开"
- "客户机无需预装 Python/Node，停用后环境保持干净"

Web control panel:

- 首页已内置 `dragon dev` + `dragon-edge` 接入引导卡片，便于售前演示与客户交付。
Commercial playbook:

- `COMMERCIALIZATION_PKGX.md`
