# SYSTEM_ARCHITECTURE_OVERVIEW

> Version: v6.0  
> Last Updated: 2026-04-04 新增角色闭环详解、10角色能力与连接图、闭环验证说明（Asia/Shanghai）
> This file is the architecture truth source. Project execution status lives in [PROJECT_CONTROL_CENTER.md](/F:/openclaw-agent/PROJECT_CONTROL_CENTER.md).
>
> **状态图例**: ✅ 已合并到 `main@0633224` · 🔵 工作区已完成，待合并到主线

---

## 零、角色闭环总览（最重要的一章）

### 10 个角色的完整能力与任务

| # | 角色 | canonical_id | 核心能力 | 输入 | 输出工件 | 下游接收者 |
|---|------|-------------|---------|------|---------|----------|
| 0 | 元老院总脑 | `commander` | 编排/仲裁/异常接管/结果合并 | 用户目标/异常上报 | `MissionPlan` | 所有角色（下发任务） |
| 1 | 触须虾 | `radar` | 热点监测/竞品追踪/舆情预警/用户画像 | 定时触发/Commander 指令 | `SignalBrief` | `strategist` |
| 2 | 脑虫虾 | `strategist` | 目标拆解/渠道配置/A/B实验/撤退条件 | `SignalBrief` + 任务目标 | `StrategyRoute` | `inkwriter` / `visualizer` |
| 3 | 吐墨虾 | `inkwriter` | 多平台文案/合规检测/CTA设计/SEO标签 | `StrategyRoute` | `CopyPack` | `visualizer` / `dispatcher` |
| 4 | 幻影虾 | `visualizer` | 分镜设计/AI图片视频/素材管理/证据密度 | `CopyPack` | `StoryboardPack` | `dispatcher` |
| 5 | 点兵虾 | `dispatcher` | 云端排期调度/执行验证/异常止损；实际发布由 Edge 客户端用本地 IP 执行 | `CopyPack` + `StoryboardPack` | `ExecutionPlan` | `echoer` / `catcher` |
| 6 | 回声虾 | `echoer` | 评论承接/私信回复/情绪降温/品牌声音 | 已发布内容通知（事件总线） | `EngagementReplyPack` | `catcher` / `followup` |
| 7 | 铁网虾 | `catcher` | 线索评分/跨平台去重/风险过滤/CRM入库 | 高意向互动（来自`echoer`） | `LeadAssessment` | `followup` / `abacus` |
| 8 | 回访虾 | `followup` | 多触点跟进/沉默唤醒/节奏管理/成交记录 | `LeadAssessment`（高潜线索） | `FollowUpActionPlan` | `abacus` |
| 9 | 金算虾 | `abacus` | ROI归因/渠道复盘/口径治理/进化反馈 | 成交数据 + 渠道数据 | `ValueScoreCard` | `strategist` / `radar`（**闭环**） |

### 闭环验证：9 条连接全部存在

```
[1] radar      ──SignalBrief──────────────▶ strategist    ✅ research_radar_store.py → growth_strategy_engine.py
[2] strategist ──StrategyRoute────────────▶ inkwriter     ✅ AGENTS.md 前置角色定义 + workflow_engine.py step路由
[3] inkwriter  ──CopyPack─────────────────▶ visualizer    ✅ AGENTS.md 后继角色 + lobster_post_task_processor.py
[4] visualizer ──StoryboardPack───────────▶ dispatcher    ✅ AGENTS.md 后继角色 + media_post_pipeline.py
[5] dispatcher ──ExecutionPlan(发布通知)──▶ echoer        ✅ edge_outbox.py → lobster_event_bus.py 事件总线
[6] echoer     ──高意向互动(lead_intent)──▶ catcher       ✅ AGENTS.md ROUTING状态机 + clawteam_inbox.py
[7] catcher    ──LeadAssessment(高潜)────▶ followup       ✅ lead_conversion_fsm.py + followup_subagent_store.py
[8] followup   ──成交数据回写─────────────▶ abacus        ✅ AGENTS.md 后继角色 + lobster_metrics_history.py
[9] abacus     ──ValueScoreCard反馈───────▶ strategist    ✅ ROI连续2轮低于预期 → 自动触发strategist修订
    abacus     ──信号重定向───────────────▶ radar         ✅ 复盘结论回传 research_radar_store.py
```

**闭环成立**：从 `radar` 出发，经过 9 个角色，数据最终回流到 `strategist` 和 `radar`，形成完整的"感知-策略-创作-执行-互动-线索-成交-复盘-进化"闭环。

### 当前 3 个未完全接通的断点（需修复）

| 断点 | 位置 | 影响 | 修复方式 |
|------|------|------|---------|
| **BattleLog 未自动写入** | `lobster_post_task_processor.py` → `lobster_evolution_engine.py` 未调用 | 龙虾不进化，quality_score 无法积累 | 在 `process()` 结尾调用 `get_evolution_engine().record_battle()` |
| **quality_score 未传入 evolution** | `lobster_runner.py` 第 1158 行算出 score 但未回写 | 进化引擎拿不到评分数据 | 在 score 计算后调用 `engine.update_quality_score()` |
| **workflow_engine quality_score=None** | `workflow_engine.py` 第 2127 行 | Judge 评分未触发 | 连接 `llm_quality_judge.py` 的 `judge()` 方法 |

---

```text
Layer 0  Control Plane
  web/                         Next.js operations console / lobster entity page / global search
  backend/src/                 NestJS API gateway / ai-subservice proxy / auth / security middleware
    common/                    operation audit / RSA decrypt / rate limit
    terminal/                  edge terminal gateway / browser session registry
  superharbor/                 CRM and customer workspace

Layer 1  Cloud AI Brain
  dragon-senate-saas-v2/
    commander_router.py        lineup / routing / policy branch
    lobster_runner.py          unified lobster execution engine
    workflow_engine.py         deterministic workflow engine (YAML + run state + replay + error compensation)
    workflow_realtime.py       execution event hub / SSE stream
    workflow_idempotency.py    idempotency key reserve / duplicate detection
    tenant_concurrency.py      tenant workflow / step concurrency control
    event_subjects.py          NATS-style hierarchical event subject naming
    event_bus_metrics.py       event subject traffic aggregation / prefix hot spots
    vector_snapshot_manager.py qdrant collection snapshot backup / retention
    edge_device_twin.py        desired vs actual edge twin reconciliation
    workflow_webhook.py        workflow webhook registry / auth / public trigger URLs
    official_workflow_templates.py official workflow template gallery / clone from template
    workflow_admin.py          workflow YAML read / update helper
    workflow_loader.py         YAML metadata loader / hot reload helper
    conversation_compactor_v2.py layered compaction with fresh tail
    api_lobster_realtime.py    SSE realtime notifications / step summaries
    lobster_memory_tools.py   KB grep / describe / semantic expand helpers
    lobsters/lobster_security.py redline / yellowline / injection defense
    lobster_skill_registry.py  skills / prompts / effectiveness seeds
    prompt_asset_loader.py     design-time prompt assets
    prompt_registry.py         prompt versions / diff / A/B outcomes
    experiment_registry.py     multi-version evaluation registry / compare
    rag_testset_generator.py   enterprise memory -> rag eval dataset
    smart_routing.py           4-tier model selection by complexity
    failover_provider.py       cloud provider failover wrapper
    query_expander.py          commander pre-dispatch intent expansion
    context_engine.py          LobeHub-style context selection / token budgeting
    customer_mind_map.py       STORM-style customer knowledge map / unexplored dimensions
    module_registry.py         Manus-style capability module registry
    lifecycle_manager.py       lobster / workflow / channel lifecycle governance
    search_api.py              global cross-entity search
    lobster_config_center.py   lobster aggregated config / runtime overrides
    connector_credential_store.py encrypted connector credentials by tenant
    auth_mfa.py                admin TOTP MFA setup / verify / login guard
    auth_oidc.py               OIDC discovery / JWKS / RS256 token issue / introspect
    auth_scim.py               SCIM service provider metadata / user-group provisioning / mappedRoles
    auth_federation.py         external OIDC IdP trust config / token exchange / discover-start / authorize-callback / subject binding
    file_loader.py             PDF / Word / Excel / text loader and business card extraction
    content_citation.py        lobster output source citation processor
    lobster_cost_api.py        per-lobster token / cost / trend analytics
    artifact_classifier.py     lobster output -> renderable artifact blocks
    lobster_feedback_collector.py human ratings / revised outputs / golden dataset
    lobster_pipeline_middleware.py request / response middleware plugins for LLM chain
    lobster_post_task_processor.py background auto-tag / summarize / memory writeback
    knowledge_base_manager.py  lobster-bound knowledge base docs / chunks / search
    lobster_rule_engine.py     event -> rule match -> action dispatch
    policy_engine.py           OPA-style declarative policy evaluation
    decision_logger.py         structured policy decision logs / deny tracebacks
    policy_bundle_manager.py   versioned policy bundle snapshot / publish state
    lobster_auto_responder.py  built-in action handlers for rule engine
    attribution_engine.py      marketing attribution rollups and touchpoint credits
    funnel_analyzer.py         workflow conversion funnel aggregation
    survey_engine.py           triggered surveys / NPS / CSAT responses
    nl_query_engine.py         natural-language analytics query planner and summarizer
    activity_stream.py         Fleet-style structured activity log + webhook fan-out
    job_registry.py            Fleet-style class-based background job registry
    lead_conversion_fsm.py     lead conversion funnel state machine
    lobster_failure_reason.py  precise failure reason classification and remediation hint
    alert_engine.py            alert rules / state machine / notification dispatch
    langfuse_tracer.py         workflow trace / lobster span / generation bridge
    hallucination_metric.py    context-grounded hallucination scoring
    answer_relevance_metric.py answer focus / query alignment scoring
    retrieval_quality_metric.py retrieval precision / recall scoring
    online_eval_sampler.py     sampled production evaluation writer
    edge_node_group.py         edge node grouping / asset tree hierarchy
    lobster_trigger_rules.py   when/if/then rule engine for lobster wakeups
    lobster_metrics_history.py daily lobster metrics snapshots
    intake_form.py             public intake form / review queue
    lobster_doc_store.py       markdown docs / versions for lobster outputs
    chart_annotation.py        observability chart annotations
    observability_api.py       traces / annotations / dashboard / scores
    log_enrich_pipeline.py     structured log normalization / derived fields
    log_query_api.py           safe SQL log query facade
    edge_telemetry_store.py    edge telemetry ingestion and persistence
    session_manager.py         shared / per-peer / isolated sessions
    token_budget.py            fresh-context / history token trimming
    autonomy_policy.py         L0-L3 autonomy governance
    skill_loader.py            on-demand skill subset + gotchas
    memory_compressor.py       L0 -> L1 -> L2 compression
    memory_extractor.py        mem0-style fact extraction / conflict-aware merge
    memory_conflict_resolver.py ADD/UPDATE/NONE decision engine for extracted memories
    graph_namespace.py         tenant / lead graph namespace isolation
    temporal_knowledge_graph.py graphiti-style temporal entity-edge graph
    escalation_manager.py      retry exhaustion -> human review
    intent_predictor.py        proactive next-intent prediction
    restore_event.py           restore completion reporting
    heartbeat_engine.py        commander heartbeat + active patrol checks
    mcp_gateway.py             MCP server registry / discovery / tool calls
    mcp_tool_policy.py         lobster tool whitelist / denylist / rate control
    mcp_tool_monitor.py        MCP tool telemetry / failure / heatmap monitor
    tool_marketplace.py        tool catalog / tenant subscription / marketplace
    mobile_pairing.py          mobile pair codes / device registry / push outbox

Layer 1.5  Supporting Services
  services/policy-router-service/        strategy routing service
  services/lobster-memory/               vector memory service / hybrid memory retrieval
  services/trust-verification-service/   trust and verification
  services/cti-engine-service/           CTI / anomaly detection
  services/xai-scorer-service/           scoring / explanation
  MCP ecosystem via gateway             stdio / sse / edge tool federation

Layer 2  Cloud-Edge Dispatch
  cron_scheduler.py            cron/every/once scheduling core
  task_scheduler.py            unified Layer 2 facade
  task_state_machine.py        CREATED -> DONE / FAILED transitions
  rhythm_controller.py         throttle / window / concurrency control

Layer 3  Edge Runtime
  edge-runtime/
    client_main.py
    wss_receiver.py            Socket.IO fleet client
    edge_meta_cache.py         offline metadata cache / pending task persistence
    edge_scheduler.py          offline-capable background scheduler
    jobs/                      heartbeat / memory-sync / log-cleanup / task-check
    security_audit.py          daily and on-demand edge security audit
    edge_mcp_server.py         local edge tools exposed over fleet websocket
    edge_auth.py               hmac auth headers / websocket auth payloads
    edge_guardian.py           edge module guardian / restart supervisor
    widget_server.py           embedded website chat widget / visitor session bridge
    edge_telemetry.py          optional OTLP / OTel span bridge
    protocol_adapter.py        optional HTTP webhook / MQTT adapters
    backup_manager.py          backup / restore / migration core
    scripts/                   backup.sh / restore.sh wrappers
    terminal_bridge.py         safe debug commands + log follow
    telemetry_buffer.py        batched edge telemetry buffer with offline retry
```

## 二、关键主链

### 1. 人工 / 前端触发链

```text
web -> backend ai-subservice -> dragon-senate-saas-v2/app.py
    -> query_expander.py (optional intent expansion)
    -> Commander route
    -> lobster_rule_engine.py (event-based fast path when available)
    -> LobsterRunner
    -> SkillLoader + LobsterConfigCenter overrides + PromptAssetLoader + SessionManager
    -> lobster_pipeline_middleware.py
    -> Provider / tools / audit / reward
    -> lobster_post_task_processor.py
    -> artifacts / delivery / feedback
```

### 1.1 执行步骤摘要链

```text
LobsterRunner on_step
  -> api_lobster_realtime.publish_step_event()
  -> /api/lobster/steps (SSE)
  -> action_summary / why / result_preview
  -> frontend execution timeline card
```

### 1.1 Query Expansion 链

```text
POST /api/v1/query-expander/expand
  -> query_expander.py
  -> llm_router.py (flash-tier best effort)
  -> heuristic fallback
  -> expanded subtasks / intent_summary
  -> run_dragon_team payload.query_expansion + expanded task_description
```

### 2. 控制面安全入口链

```text
web
  -> GET /api/v1/crypto/public-key
  -> encrypt password / api_key / secret
  -> backend RsaDecryptMiddleware
  -> RateLimitGuard
  -> OperationAuditInterceptor
  -> controller / ai-subservice / runtime
```

### 2.1 MFA 认证链

```text
/auth/login
  -> username/password
  -> auth_mfa.py (enabled check)
  -> admin TOTP verify
  -> issue JWT access_token

/api/v1/auth/mfa/*
  -> setup / enable / disable / verify
  -> tenant_audit_log.py AUTH_MFA_* events
```

### 2.2 OIDC 最小兼容链

```text
/.well-known/openid-configuration
  -> auth_oidc.py discovery document

/oauth2/jwks
  -> auth_oidc.py RSA public key set

/oauth2/token (password grant only)
  -> existing username/password auth
  -> auth_mfa.py (when enabled)
  -> auth_oidc.py issue RS256 access_token + id_token
  -> tenant_audit_log.py AUTH_LOGIN / AUTH_LOGIN_FAILED

/oauth2/userinfo + /oauth2/introspect
  -> auth_oidc.py verify RS256 token
  -> tenant_id / roles / preferred_username claims
```

### 2.3 SCIM 最小兼容链

```text
/scim/v2/ServiceProviderConfig + /Schemas + /ResourceTypes
  -> auth_scim.py provider metadata

/scim/v2/Users
  -> auth_scim.py list / create
  -> existing auth_users store
  -> tenant-scoped provisioning

/scim/v2/Users/{id}
  -> auth_scim.py get / replace / patch / delete
  -> tenant_audit_log.py USER_CREATE / USER_UPDATE / USER_DELETE

/scim/v2/Groups + /scim/v2/Groups/{id}
  -> auth_scim.py sqlite-backed group store
  -> tenant-scoped membership sync
  -> mappedRoles -> effective user claims / OIDC roles / RBAC inputs
  -> ResourceTypes / Schemas now expose Group resource
```

### 2.4 SSO Federation 最小链

```text
/api/v1/auth/sso/providers
  -> auth_federation.py provider config store
  -> issuer / audience / JWKS / claim mapping

/auth/sso/exchange
  -> verify external OIDC token
  -> bind external subject to local user
  -> auto-provision or sync local user
  -> issue local Dragon Senate access_token

/auth/sso/providers/{provider_id}/authorize -> /auth/sso/callback
  -> state / PKCE / nonce
  -> redirect to external IdP authorization endpoint
  -> exchange authorization code at token endpoint
  -> redirect back with local Dragon Senate access_token fragment

/api/v1/auth/sso/discover + /auth/sso/start + /api/v1/auth/sso/providers/{id}/test
  -> email-domain based IdP discovery
  -> provider health/readiness probe
  -> public start entry for login page orchestration
```

### 3. 定时调度链

```text
POST /api/scheduler/tasks
  -> cron_scheduler.py / task_scheduler.py
  -> task_state_machine.py
  -> rhythm_controller.py
  -> LobsterRunner
  -> SessionManager (shared or isolated)
```

### 4. 确定性工作流链

```text
POST /api/workflow/run
  -> workflow_engine.py
  -> workflows/*.yaml
  -> workflow_runs / workflow_steps / workflow_stories (SQLite)
  -> LobsterRunner (fresh_context = true)
  -> expects validation / retry / replay / idempotency / error compensation
  -> pause or done
```

### 5. 智能模型路由链

```text
LobsterRunner
  -> llm_router.py
  -> smart_routing.py
  -> failover_provider.py
  -> provider_registry.py / llm_factory.py
  -> provider-aware model override
```

### 6. 会话隔离链

```text
channel / scheduler / runner
  -> SessionManager
  -> shared | per-peer | isolated
  -> message history persistence (isolated 除外)
```

### 7. 知识压缩链

```text
L0 raw conversation
  -> memory_compressor.py
  -> L1 structured report
  -> batch promote
  -> L2 reusable wisdom

session history
  -> conversation_compactor_v2.py
  -> leaf summaries + session summary
  -> fresh tail protection
```

### 8.1 实验评测链

```text
LobsterRunner success path
  -> online_eval_sampler.py
  -> llm_quality_judge.py
  -> hallucination_metric.py + task_completion judge
  -> experiment_registry.py
  -> /api/v1/experiments + compare UI

Prompt version inspection
  -> prompt_registry.py
  -> /api/v1/prompts/{name}/versions
  -> /api/v1/prompts/{name}/diff
  -> /operations/experiments
```

### 8.2 RAG 评测链

```text
enterprise memory / profile
  -> rag_testset_generator.py
  -> dataset_store.py
  -> /api/v1/rag/testsets/generate

experiment run
  -> experiment_registry.py
  -> retrieval_quality_metric.py
  -> answer_relevance_metric.py
  -> llm_quality_judge.py
  -> /api/v1/experiments/{id}/run
  -> experiments compare / score trend
```

### 8. Retry / Escalate 链

```text
LobsterRunner
  -> expects validation
  -> retry with prompt suffix
  -> escalation_manager.py
  -> notification_center.py
  -> human review API
```

### 8.1 Content Citation 链

```text
lobster output with [REF:signal_id]
  -> content_citation.py
  -> research_radar_store / file-backed lobster memory
  -> footnotes + structured citations[]
  -> POST /api/v1/lobsters/{id}/execute response
  -> lobster_doc_store.py persisted markdown
```

### 8.2 Human Feedback 链

```text
/lobsters/[id]
  -> POST /api/v1/feedbacks
  -> lobster_feedback_collector.py
  -> revised_output -> dataset_store.py
  -> /api/v1/lobsters/{id}/quality-stats
  -> quality trend / top tags / golden samples
```

### 8.3 Product Analytics 链

```text
run_dragon_team success
  -> _record_posthog_analytics_run()
  -> attribution_engine.py touchpoints + conversion_value
  -> funnel_analyzer.py stage flags
  -> /api/v1/analytics/attribution
  -> /api/v1/analytics/funnel
  -> /analytics/attribution + /analytics/funnel
```

### 8.4 Survey / NL Query 链

```text
/api/v1/surveys*
  -> survey_engine.py
  -> NPS / CSAT / open feedback storage

/api/v1/analytics/nl-query
  -> nl_query_engine.py
  -> attribution / funnel / survey / lobster pool metrics
  -> natural language answer + metadata
```

### 8.3 Structured Log Query 链

```text
llm_call_logger.py
  -> log_enrich_pipeline.py
  -> llm_call_logs

mcp_gateway.py / workflow_event_log.py
  -> structured event tables

/api/v1/logs/query
  -> log_query_api.py
  -> safe SELECT validation + tenant/time injection
  -> dragon_dashboard.html log query card
```

### 9. 边缘调试与调度链

```text
browser xterm panel
  -> backend terminal gateway
  -> fleet websocket gateway
  -> edge terminal bridge / edge scheduler
  -> safe commands / scheduler status / backup restore
```

### 9.1 Embed Widget 链

```text
customer website
  -> /api/v1/widget/script/{widget_id}
  -> edge-runtime/widget_server.py loader + visitor session
  -> _widget_reply_handler -> echoer lobster
  -> high-intent detection
  -> catcher_intake task_queue enqueue
```

### 9.2 Knowledge Base 链

```text
/operations/knowledge-base
  -> /api/v1/knowledge-bases*
  -> knowledge_base_manager.py
  -> doc chunking + lobster binding
  -> LobsterRunner _load_bound_knowledge_context()
  -> bound snippets injected into effective system prompt
```

### 9.3 Edge Guardian / Auth 链

```text
edge-runtime/client_main.py
  -> edge_guardian.py
  -> wss_receiver / event_watcher / telemetry_buffer / protocol_hub supervised
  -> edge_auth.py signed websocket auth + signed HTTP headers
  -> backend fleet-websocket.gateway.ts verifies HMAC handshake
  -> app.py /edge/* verifies signed headers (legacy x-edge-secret still accepted)
```

### 9.4 Mobile Pair / Push 链

```text
web / mobile bootstrap
  -> /api/mobile/pair/code
  -> mobile scans QR / enters accessCode
  -> /api/mobile/pair
  -> JWT clientToken + mobile edge node registration
  -> edge_auth.py HMAC bootstrap for mobile edge node
  -> /api/notify/push
  -> mobile_push_outbox / later Expo Push integration
```

### 10. 主动心跳与意图链

```text
active heartbeat loop
  -> edge registry / outbox checks
  -> warning notification

run_dragon_team success
  -> intent_predictor.py
  -> followup memory
  -> suggested intents API
```

### 11. 边缘安全巡检链

```text
manual trigger or daily interval
  -> edge-runtime/security_audit.py
  -> baseline check / DLP scan / sync freshness / SOP integrity
  -> security_audit_report
  -> backend security-audit repository
  -> fleet terminal panel
```

### 12. MCP 工具生态接入链

```text
operations/mcp
  -> backend ai-subservice mcp.controller.ts
  -> /api/v1/mcp/*
  -> mcp_gateway.py
  -> mcp_tool_policy.py + tool_marketplace.py
  -> mcp_tool_monitor.py
  -> stdio / sse / edge MCP server
  -> tool discovery / tool call / audit / history / policy / marketplace / monitor
```

### 12.1 Edge Local MCP 链

```text
edge-runtime/edge_mcp_server.py
  -> register local tools with @edge_tool
  -> wss_receiver.py emits tool_manifest on connect
  -> backend fleet-websocket.gateway.ts caches manifests
  -> cloud dispatch sends mcp_tool_call over existing fleet channel
  -> edge returns mcp_tool_result
```

### 12.2 Edge Asset Tree / Trigger Rules 链

```text
fleet nodes
  -> edge_node_group.py
  -> group tree / node map / recursive node resolution
  -> backend ai-subservice openremote.controller.ts
  -> /fleet group tree card

llm_call_logs
  -> lobster_trigger_rules.py
  -> MetricCollector(task_fail_count / error_rate / daily_task_count)
  -> invoke_lobster / send_alert
```

### 12.3 Edge Protocol Adapter / Metrics History 链

```text
external webhook or MQTT
  -> edge-runtime/protocol_adapter.py
  -> client_main.py protocol hub
  -> external_trigger event / optional marionette packet execution

llm_call_logs
  -> lobster_metrics_history.py
  -> daily snapshot / on-demand backfill
  -> /api/v1/metrics/lobster/{name}/history
```

### 12.4 Intake / Kanban / Docs 链

```text
public intake page
  -> /intake/{tenant_slug}
  -> intake_form.py
  -> intake review queue
  -> accept -> task_queue.py enqueue(catcher)

task_queue.py
  -> /api/v1/tasks/kanban
  -> dragon_dashboard.html kanban board

lobster execution output
  -> lobster_doc_store.py auto_save_from_task
  -> /api/v1/docs
  -> /api/v1/lobsters/{id}/docs prefers latest doc-store version
```

### 16. 边缘离线缓存与 Device Twin 链

```text
edge-runtime/wss_receiver.py
  -> edge_meta_cache.py cache config / skill registry / pending tasks
  -> offline continues with cached metadata
  -> reconnect flushes cached task results

edge heartbeat
  -> /edge/heartbeat
  -> edge_device_twin.py update actual state
  -> desired vs actual diff
  -> sync_payload returned to edge
  -> edge applies config/skill/runtime param updates
```

### 13. 工作流 Webhook 触发链

```text
external system
  -> GET/POST /webhook/workflows/{webhook_id}
  -> workflow_webhook.py (method + auth + response_mode)
  -> workflow_engine.start_run(trigger_type="webhook")
  -> workflow run history / optional wait_for_completion response
```

### 14. 工作流回放与模板链

```text
operations/workflows/templates
  -> official_workflow_templates.py
  -> clone workflow YAML with source_template_id

operations/workflows/{id}/executions
  -> workflow_engine.py
  -> run snapshots / replay from source_execution_id
  -> skip succeeded steps before replay_from_step_id
```

### 15. 工作流实时流与并发治理链

```text
workflow_engine.py
  -> workflow_realtime.py publish step / execution events
  -> /api/v1/workflows/executions/{id}/stream
  -> backend ai-subservice proxy stream
  -> operations/workflows/[id]/executions live monitor

workflow trigger
  -> workflow_idempotency.py reserve key
  -> tenant_concurrency.py queue depth / workflow_per_minute / slot acquire
  -> queued or running
```

### 17. Event Bus Subject Traffic 链

```text
webhook_event_bus.py emit(subject)
  -> event_bus_metrics.py record
  -> /api/observability/event-bus/subjects
  -> /api/observability/event-bus/prefix-summary
  -> operations/monitor subject traffic panels
```

### 18. Hybrid Memory Search 与 Vector Snapshot 链

```text
operations/memory
  -> /api/v1/memory/hybrid-search
  -> lobster-memory service
  -> dense semantic recall + sparse BM25 scoring + RRF fusion

scheduled or manual backup
  -> vector_snapshot_manager.py
  -> Qdrant snapshots API
  -> local backup archive + retention
  -> /api/v1/vector-backup/history
```

## 三、运行时治理组件

| 组件 | 位置 | 作用 | 状态 |
| --- | --- | --- | --- |
| Commander Router | `commander_router.py` | 阵容、策略、强度、仲裁 | ✅ |
| LobsterRunner | `lobster_runner.py` | 龙虾执行主循环 | ✅ |
| WorkflowEngine | `workflow_engine.py` | YAML 工作流、run/step/story 持久化、retry/escalate、execution replay | ✅ |
| WorkflowRealtimeHub | `workflow_realtime.py` | 工作流执行事件总线与 SSE | ✅ |
| WorkflowIdempotency | `workflow_idempotency.py` | 幂等键保留、重复触发去重与结果复用 | ✅ |
| TenantConcurrency | `tenant_concurrency.py` | 租户工作流/步骤并发限制与队列深度控制 | ✅ |
| EventBusMetrics | `event_bus_metrics.py` | Event Bus subject 流量统计与前缀聚合 | ✅ |
| VectorSnapshotManager | `vector_snapshot_manager.py` | 向量集合快照备份与历史保留 | ✅ |
| EdgeDeviceTwin | `edge_device_twin.py` | 边缘节点 desired vs actual 状态对齐 | ✅ |
| WorkflowWebhookStore | `workflow_webhook.py` | 工作流 Webhook 注册、认证、公开触发 | ✅ |
| WorkflowTemplateGallery | `official_workflow_templates.py` | 官方模板目录与一键克隆 | ✅ |
| FailoverProvider | `failover_provider.py` | 多 provider 故障转移 | 🔵 |
| QueryExpander | `query_expander.py` | Commander 入口意图扩展与子查询拆解 | ✅ |
| ContextEngine | `context_engine.py` | 按相关性与 token 预算精选上下文 | 🔵 |
| CustomerMindMap | `customer_mind_map.py` | 客户知识地图、未探索维度与问题生成 | 🔵 |
| LobsterCostAPI | `lobster_cost_api.py` | 龙虾维度 token / cost / trend 分析 | ✅ |
| LobsterRealtimeAPI | `api_lobster_realtime.py` | SSE 实时通知与步骤摘要事件 | ✅ |
| ModuleRegistry | `module_registry.py` | 能力模块注册、角色可用模块与成本估算 | ✅ |
| ArtifactClassifier | `artifact_classifier.py` | Markdown / code / mermaid / csv / html / svg 结构化识别 | ✅ |
| EscalationManager | `escalation_manager.py` | 失败升级与人工处理 | ✅ |
| LifecycleManager | `lifecycle_manager.py` | 龙虾 / 工作流 / 渠道生命周期治理与状态联动 | ✅ |
| SearchAPI | `search_api.py` | Cmd/Ctrl+K 全局跨实体搜索 | ✅ |
| LobsterConfigCenter | `lobster_config_center.py` | 角色卡 / 技能 / 工具 / 自主级别聚合配置中心 | ✅ |
| ConnectorCredentialStore | `connector_credential_store.py` | 外部连接器凭证加密存储与过期判断 | ✅ |
| ContentCitationProcessor | `content_citation.py` | 龙虾输出中的来源引用解析与脚注化 | ✅ |
| LobsterFeedbackCollector | `lobster_feedback_collector.py` | 人工评分、标签、修订版与 golden dataset 写入 | ✅ |
| LobsterPipelineMiddleware | `lobster_pipeline_middleware.py` | LLM 请求 / 响应链路可插拔中间件 | ✅ |
| LobsterPostTaskProcessor | `lobster_post_task_processor.py` | 自动标签、摘要、归档与记忆回写 | ✅ |
| KnowledgeBaseManager | `knowledge_base_manager.py` | 知识库元数据、文档分块、绑定与检索 | ✅ |
| FileLoader | `file_loader.py` | 多格式文件解析与名片信息抽取 | ✅ |
| LobsterRuleEngine | `lobster_rule_engine.py` | 事件规则匹配、优先级排序、动作触发 | ✅ |
| PolicyEngine | `policy_engine.py` | OPA-style 策略评估、规则 CRUD、policy_path 决策 | ✅ |
| DecisionLogger | `decision_logger.py` | 策略命中/拒绝决策日志与统计 | ✅ |
| PolicyBundleManager | `policy_bundle_manager.py` | 策略 bundle 发布、当前版本与校验和管理 | ✅ |
| LobsterAutoResponder | `lobster_auto_responder.py` | dispatch / alert / webhook 内置动作处理器 | ✅ |
| AttributionEngine | `attribution_engine.py` | 触点归因、渠道/龙虾 credit 聚合 | ✅ |
| FunnelAnalyzer | `funnel_analyzer.py` | 工作流阶段转化率与流失分析 | ✅ |
| SurveyEngine | `survey_engine.py` | NPS / CSAT / 开放题调查触发与结果汇总 | ✅ |
| NLQueryEngine | `nl_query_engine.py` | 自然语言转分析查询计划与摘要回答 | ✅ |
| ActivityStream | `activity_stream.py` | 结构化活动流、Webhook 推送与时间线查询 | ✅ |
| JobRegistry | `job_registry.py` + `task_queue.py` | Fleet 风格 Job 注册与后台执行 | ✅ |
| LeadConversionFSM | `lead_conversion_fsm.py` | 线索漏斗状态机、状态流转与历史记录 | ✅ |
| LobsterFailureReason | `lobster_failure_reason.py` | 失败原因分类、建议动作与审计补充 | ✅ |
| AlertEngine | `alert_engine.py` | 质量 / 错误率 / 边缘离线告警 | ✅ |
| LangfuseTracer | `langfuse_tracer.py` | 复用现有 observability store 实现 workflow trace / lobster span | 🔵 |
| ExperimentRegistry | `experiment_registry.py` | 多版本评测记录、样本明细与实验对比 | ✅ |
| HallucinationMetric | `hallucination_metric.py` | 基于上下文的幻觉打分 | ✅ |
| RagTestsetGenerator | `rag_testset_generator.py` | 企业记忆转 RAG 测试集 | ✅ |
| RetrievalQualityMetric | `retrieval_quality_metric.py` | Context Precision / Recall 评测 | ✅ |
| AnswerRelevanceMetric | `answer_relevance_metric.py` | 输出切题度评测 | ✅ |
| OnlineEvalSampler | `online_eval_sampler.py` | 生产流量采样评测并写入实验表 | ✅ |
| LogEnrichPipeline | `log_enrich_pipeline.py` | 统一日志字段与派生字段 enrich | ✅ |
| LogQueryAPI | `log_query_api.py` | 安全 SQL 查询结构化日志 | ✅ |
| EdgeNodeGroup | `edge_node_group.py` | 边缘节点树形分组与节点映射 | ✅ |
| LobsterTriggerRules | `lobster_trigger_rules.py` | 条件触发规则与自动唤醒 | ✅ |
| LobsterMetricsHistory | `lobster_metrics_history.py` | 龙虾日级历史指标快照 | ✅ |
| IntakeForm | `intake_form.py` | 公开需求收集表单与审核队列 | ✅ |
| LobsterDocStore | `lobster_doc_store.py` | 龙虾 Markdown 文档与版本历史 | ✅ |
| MCPToolPolicy | `mcp_tool_policy.py` | 龙虾工具权限、黑白名单与频率限制 | ✅ |
| MCPToolMonitor | `mcp_tool_monitor.py` | 工具调用热力、失败率与最近调用监控 | ✅ |
| ToolMarketplace | `tool_marketplace.py` | 工具目录、租户订阅与市场管理 | 🔵 |
| ChartAnnotations | `chart_annotation.py` + `annotation_sync.py` | 审计事件联动图表标注 | ✅ |
| EdgeTelemetryStore | `edge_telemetry_store.py` | 边缘批量遥测入库 | ✅ |
| SkillLoader | `skill_loader.py` | 技能按需加载与 gotchas 注入 | ✅ |
| AutonomyPolicy | `autonomy_policy.py` | L0-L3 自主决策治理 | ✅ |
| SessionManager | `session_manager.py` | shared / per-peer / isolated 会话治理 | ✅ |
| TaskScheduler | `task_scheduler.py` | Layer 2 统一调度外观 | ✅ |
| MemoryCompressor | `memory_compressor.py` | L0-L1-L2 压缩 | ✅ |
| MemoryExtractor | `memory_extractor.py` | 对话事实提取、冲突检测后写入企业记忆 | ✅ |
| TemporalKnowledgeGraph | `temporal_knowledge_graph.py` + `graph_namespace.py` | 时序实体关系图谱与租户命名空间隔离 | ✅ |
| TokenBudget | `token_budget.py` | fresh-context / token trimming | ✅ |
| ConversationCompactorV2 | `conversation_compactor_v2.py` | 分层摘要压缩与 fresh tail 保护 | ✅ |
| LobsterMemoryTools | `lobster_memory_tools.py` | 龙虾知识库检索工具集 | ✅ |
| SkillsBackfillRunner | `scripts/skills_backfill_runner.py` | 历史 battle log -> skills_v3 回填 | 🔵 |
| ActiveHeartbeatChecker | `heartbeat_engine.py` | 主动巡检与告警 | ✅ |
| IntentPredictor | `intent_predictor.py` | 下次意图预测与缓存 | ✅ |
| RestoreEvent | `restore_event.py` | 还原完成事件与报告 | ✅ |
| MCPGateway | `mcp_gateway.py` | MCP Server 注册、发现、调用与健康检查 | ✅ |
| PromptDiffAPI | `prompt_registry.py` + `app.py` | Prompt 版本列表与结构化 diff | ✅ |
| EdgeSecurityAudit | `edge-runtime/security_audit.py` | 边缘安全巡检与报告 | ✅ |
| EdgeAuth | `edge-runtime/edge_auth.py` | 边缘 HMAC 头与 WSS 握手签名 | ✅ |
| EdgeGuardian | `edge-runtime/edge_guardian.py` | 边缘模块级守护、重启与状态汇总 | ✅ |
| EdgeMcpServer | `edge-runtime/edge_mcp_server.py` + `edge-runtime/wss_receiver.py` | 边缘本地工具通过 Fleet WSS 对外提供 | ✅ |
| WidgetServer | `edge-runtime/widget_server.py` | 官网嵌入式聊天、访客会话与留资桥接 | ✅ |
| EdgeTelemetry | `edge-runtime/edge_telemetry.py` + `marionette_executor.py` | 边缘执行 Span 上报与 OTel 降级 | ✅ |
| EdgeProtocolAdapter | `edge-runtime/protocol_adapter.py` + `client_main.py` | HTTP webhook / MQTT 转边缘事件 | ✅ |

## 四、数据与状态存储

| 数据域 | 位置 | 介质 |
| --- | --- | --- |
| Workflow runs / steps / stories | `workflow_engine.py` | SQLite |
| Workflow idempotency records | `workflow_idempotency.py` | SQLite |
| Tenant concurrency counters | `tenant_concurrency.py` | SQLite |
| Edge desired / actual twin | `edge_device_twin.py` | SQLite |
| Workflow webhook registry | `workflow_webhook.py` | SQLite |
| Workflow template usage | `official_workflow_templates.py` | SQLite |
| Scheduled tasks / run log | `cron_scheduler.py` | SQLite |
| Step rewards / RL trace | `lobster_pool_manager.py` | SQLite |
| Workflow traces / spans / generations | `llm_call_logger.py` | SQLite |
| Alert rules / alert events | `alert_engine.py` | SQLite |
| Structured activity stream | `activity_stream.py` | SQLite |
| Edge telemetry batches / run results | `edge_telemetry_store.py` | SQLite |
| Policy rules / bundles / decisions | `policy_engine.py` + `policy_bundle_manager.py` + `decision_logger.py` | SQLite + JSON export |
| Enterprise memories / temporal graph | `enterprise_memory.py` + `temporal_knowledge_graph.py` | JSON + SQLite |
| Session history | `session_manager.py` | JSON files |
| Compressed memory | `memory_compressor.py` | JSON files |
| Edge backup / restore manifest | `edge-runtime/backup_manager.py` | tar.gz + JSON |
| Edge audit reports | `edge-runtime/security_audit.py` + backend repository | txt + Redis |

## 五、当前落地结论

- Layer 1 已形成统一执行主链：`Commander -> Workflow/Runner -> LLM/Tools -> Audit`
- Layer 1 已补齐 OPA-style 策略治理面：`PolicyEngine -> DecisionLogger -> PolicyBundleManager`
- Layer 1 已补齐 mem0 + graphiti 基础能力：`MemoryExtractor -> EnterpriseMemory -> TemporalKnowledgeGraph`
- 可观测性已形成第二主链：`Trace -> Annotation -> Alert -> Edge Telemetry`
- Layer 2 已实现：调度、状态机、节奏控制都已在仓库内
- Workflow Engine 已升级为生产链路：支持外部 Webhook 触发、执行回放、错误补偿工作流、模板克隆、实时执行流、幂等键与租户并发治理
- 平台事件总线已补齐 NATS 风格 subject 命名，可按 `task.>` / `edge.>` / `tenant.{id}.>` 分层订阅
- Layer 3 已补齐 KubeEdge 风格能力：边缘元数据离线缓存与 Device Twin 自动对齐
- 控制面已补齐 Backstage 风格治理能力：实体 lifecycle、全局搜索、龙虾 EntityPage
- Layer 3 已形成：终端、离线调度、安全巡检、备份恢复四条边缘自治链
- **⚠️ 工作区 vs 主线差距（2026-04-03 gap 分析）**：31 个模块已在工作区完成实现，但尚未合并到 `main@0633224`。涉及 FailoverProvider、FeatureFlags、ToolMarketplace、LangfuseTracer、ContextEngine、HybridMemorySearch 等核心 P1 能力，详见 [PROJECT_CONTROL_CENTER.md §三·五](/F:/openclaw-agent/PROJECT_CONTROL_CENTER.md) 完整清单。
- 仍待补齐的重缺口主要在：Prompt 全量标准化、技能效力校准器、边缘生命周期、实时执行监控室、私有技能注册表网关

## 六、权威对齐文件

1. [PROJECT_CONTROL_CENTER.md](/F:/openclaw-agent/PROJECT_CONTROL_CENTER.md)  
   看当前状态、API、前端页面和风险
2. [SYSTEM_ARCHITECTURE_OVERVIEW.md](/F:/openclaw-agent/docs/SYSTEM_ARCHITECTURE_OVERVIEW.md)  
   看分层、主链、运行时治理组件和数据流
