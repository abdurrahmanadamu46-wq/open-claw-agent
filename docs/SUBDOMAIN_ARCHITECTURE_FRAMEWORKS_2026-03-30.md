# Sub-domain Architecture Frameworks

Last Updated: 2026-03-30

## 0. Core Principle

This document standardizes sub-domain decomposition under one global architecture principle:

`contract-driven, black-box evolution`

### Global Rules

1. The main brain and each sub-domain must not share database tables or in-memory state.
2. All collaboration happens only through:
   - strict REST / gRPC contracts
   - webhooks
   - MQ events such as Kafka / RabbitMQ / Redis Stream
3. JSON structures are the contract. Internal implementations are local to each sub-domain.
4. If a sub-domain can return the correct contract on time, its internal stack can evolve independently.
5. Every sub-domain must support:
   - `contract_version`
   - `tenant_id`
   - `request_id`
   - `trace_id`
   - `warnings`
   - `fallback_used`

### Standard Envelope

#### Request envelope
```json
{
  "contract_version": "subdomain.v1",
  "tenant_id": "tenant_demo",
  "request_id": "req_20260330_001",
  "trace_id": "trace_abc123",
  "trigger_source": "web|tg|cron|worker",
  "body": {}
}
```

#### Response envelope
```json
{
  "ok": true,
  "status": "accepted|completed|degraded|failed",
  "contract_version": "subdomain.v1",
  "tenant_id": "tenant_demo",
  "request_id": "req_20260330_001",
  "trace_id": "trace_abc123",
  "data": {},
  "warnings": [],
  "fallback_used": false
}
```

## 1. Research Radar Batch

### 1.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "research-radar.v1",
  "tenant_id": "tenant_demo",
  "request_id": "rr_001",
  "trace_id": "trace_rr_001",
  "trigger_source": "cron",
  "body": {
    "industry_tag": "food_chinese_restaurant",
    "topics": ["同城引流", "门店转化", "短视频获客"],
    "competitor_handles": ["openalex", "github_projects"],
    "source_policy": {
      "providers": ["openalex", "github_projects", "huggingface_papers"],
      "max_fetch": 50
    },
    "budget": {
      "time_budget_sec": 120,
      "cloud_token_budget": 20000
    }
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "research-radar.v1",
  "tenant_id": "tenant_demo",
  "request_id": "rr_001",
  "trace_id": "trace_rr_001",
  "data": {
    "signals": [
      {
        "signal_id": "sig_001",
        "title": "本地商家 AI 获客新模式",
        "source": "openalex",
        "score": 0.83,
        "actionability": 0.76,
        "tags": ["agent", "growth"],
        "summary": "…",
        "recommended_action": "进入策略雷达评审"
      }
    ],
    "digest": {
      "top_summary": "今日最值得试验的 3 个方向…",
      "fired_watchpoints": ["低成本多智能体调度"]
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- async MQ submit
- REST status/query
- recommended:
  - `research.radar.submit`
  - `research.radar.completed`
  - `GET /research-radar/jobs/{job_id}`

### 1.2 Core Responsibilities
- source crawling
- dedupe
- credibility scoring
- actionability scoring
- digest generation
- research signal persistence

### 1.3 Fallback & Mock Strategy
- if unavailable, main brain reads last successful snapshot
- if no snapshot exists:
```json
{
  "signals": [],
  "digest": {
    "top_summary": "radar unavailable"
  }
}
```
- execution chain must continue with `fallback_used=true`

### 1.4 Independent Storage & Dependencies
- dedicated signal DB
- Redis fetch cache and idempotency lock
- external providers: OpenAlex, GitHub API, HF papers

### 1.5 Evolution Path
- rule-based ranking -> lightweight reranker
- cloud summarization -> local summarization model
- single-tenant fetch -> shared reusable research pool

## 2. Industry Compiler

### 2.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "industry-compiler.v1",
  "tenant_id": "tenant_demo",
  "request_id": "ic_001",
  "trace_id": "trace_ic_001",
  "trigger_source": "web",
  "body": {
    "industry_tag": "food_chinese_restaurant",
    "customer_segment": "local_store_owner",
    "campaign_goal": "acquire_local_leads",
    "approval_policy": {
      "high_risk_mode": "hitl_default"
    }
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "industry-compiler.v1",
  "tenant_id": "tenant_demo",
  "request_id": "ic_001",
  "trace_id": "trace_ic_001",
  "data": {
    "industry_profile": {
      "industry_tag": "food_chinese_restaurant",
      "pain_points": ["到店少", "复购低"],
      "risk_behaviors": ["违规导流", "夸大承诺"]
    },
    "starter_tasks": [
      {
        "task_key": "food:douyin:short_video_lead_capture",
        "channel": "douyin",
        "touchpoint": "short_video_lead_capture",
        "governance_mode": "hitl_default"
      }
    ],
    "workflow_hints": {
      "preferred_channels": ["douyin", "wechat"],
      "approval_bias": "strict"
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- async MQ compile
- REST artifact query
- recommended:
  - `industry.compile.submit`
  - `industry.compile.completed`
  - `GET /industry-compiler/artifacts/{industry_tag}`

### 2.2 Core Responsibilities
- industry tag normalization
- profile compilation
- starter task generation
- workflow hint generation
- risk phrase / objection / solution packaging

### 2.3 Fallback & Mock Strategy
- return static taxonomy seed
- return conservative starter tasks
- mark `industry_profile_source=seed_only`
- do not block main execution

### 2.4 Independent Storage & Dependencies
- dedicated industry compile DB
- template registry
- optional vector store for industry corpora

### 2.5 Evolution Path
- static seed -> explorer-assisted enrichment
- manual industry packs -> auto-generated starter kits
- cloud compile -> local lightweight compiler

## 3. Memory Compiler

### 3.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "memory-compiler.v1",
  "tenant_id": "tenant_demo",
  "request_id": "mc_001",
  "trace_id": "trace_mc_001",
  "trigger_source": "event_bus",
  "body": {
    "trace_bundle": {
      "task_description": "生成商家增长策略",
      "strategy_summary": "阶段式投放 + HITL 审批",
      "guardian": { "decision": "allow" },
      "verification": { "accepted": true },
      "confidence": { "center": 0.91 }
    },
    "outcome": "success"
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "memory-compiler.v1",
  "tenant_id": "tenant_demo",
  "request_id": "mc_001",
  "trace_id": "trace_mc_001",
  "data": {
    "role_memory_cards": [
      {
        "role_name": "strategist",
        "memory_key": "strategist:trace_mc_001",
        "summary": "Use tenant KB + staged release"
      }
    ],
    "campaign_memory_card": {
      "campaign_key": "trace_mc_001",
      "outcome": "success"
    },
    "playbook_promotions": [
      {
        "scope": "winning_playbook",
        "playbook_key": "restaurant:strategist:high"
      }
    ]
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- pure async event-driven
- recommended:
  - `memory.compile.requested`
  - `memory.compile.completed`

### 3.2 Core Responsibilities
- long-trace folding
- role memory card generation
- campaign memory generation
- success/failure playbook promotion
- dedupe / decay / promotion management

### 3.3 Fallback & Mock Strategy
- keep raw trace if compiler is down
- return empty memory package
- allow later compensation rebuild

### 3.4 Independent Storage & Dependencies
- dedicated relational DB for cards/playbooks
- optional vector DB for memory retrieval
- optional Redis queue for folding jobs

### 3.5 Evolution Path
- rules folding -> LLM folding
- per-run cards -> cross-tenant playbook abstraction
- cloud summarizer -> local summarizer

## 4. Governance Analytics

### 4.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "governance-analytics.v1",
  "tenant_id": "tenant_demo",
  "request_id": "ga_001",
  "trace_id": "trace_ga_001",
  "trigger_source": "event_bus",
  "body": {
    "kernel_report": {
      "risk_level": "P1",
      "risk_taxonomy": {
        "primary_family": "single_agent"
      },
      "autonomy": {
        "route": "review_required",
        "approval_required": true
      }
    },
    "approval_events": [],
    "rollback_events": []
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "governance-analytics.v1",
  "tenant_id": "tenant_demo",
  "request_id": "ga_001",
  "trace_id": "trace_ga_001",
  "data": {
    "autonomy_rollup": {
      "auto_pass_count": 8,
      "review_required_count": 3,
      "average_approval_latency_sec": 92.5
    },
    "risk_alerts": [
      {
        "rule_key": "single_agent.review_required_ratio",
        "severity": "P2",
        "state": "fired"
      }
    ],
    "rollback_preset": {
      "recommended_stage": "preflight",
      "rollback_mode": "pause_template_and_reapprove"
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- async event aggregation
- REST dashboard/query
- recommended:
  - `governance.kernel.reported`
  - `GET /governance/alerts`
  - `GET /governance/dashboard`

### 4.2 Core Responsibilities
- autonomy metrics aggregation
- risk family aggregation
- alert calculation
- rollback preset recommendation
- governance digest generation

### 4.3 Fallback & Mock Strategy
- return last successful aggregate snapshot
- if absent, return empty dashboard
- never block main execution

### 4.4 Independent Storage & Dependencies
- dedicated analytics DB
- Redis cache for dashboards
- optional time-series store

### 4.5 Evolution Path
- fixed thresholds -> adaptive thresholds
- static alerts -> anomaly detection
- fixed rollback preset -> learned preset selection

## 5. Telephony / Followup Voice

### 5.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "telephony-followup.v1",
  "tenant_id": "tenant_demo",
  "request_id": "tf_001",
  "trace_id": "trace_tf_001",
  "trigger_source": "event_bus",
  "body": {
    "lead_package": {
      "lead_id": "lead_001",
      "phone": "13800138000",
      "intent_score": 92
    },
    "call_policy": {
      "provider": "mock|vendor_x",
      "max_attempts": 3,
      "hitl_required": true
    },
    "script_package": {
      "opening": "您好，这边是…",
      "objection_handling": ["预算", "时效"]
    }
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "telephony-followup.v1",
  "tenant_id": "tenant_demo",
  "request_id": "tf_001",
  "trace_id": "trace_tf_001",
  "data": {
    "call_result": {
      "lead_id": "lead_001",
      "disposition": "answered|no_answer|rejected",
      "duration_sec": 42
    },
    "transcript_ref": "s3://.../call_001.json",
    "crm_update": {
      "next_action": "human_followup"
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- async MQ + vendor webhook callback
- recommended:
  - `followup.voice.enqueue`
  - `followup.voice.completed`

### 5.2 Core Responsibilities
- outbound call orchestration
- ASR/TTS orchestration
- call disposition normalization
- CRM feedback

### 5.3 Fallback & Mock Strategy
- degrade to `manual_followup_required` when provider is down
- main brain only receives a manual task
- do not block main execution chain

### 5.4 Independent Storage & Dependencies
- dedicated call task DB
- transcript object storage
- provider callback cache and retry queue

### 5.5 Evolution Path
- single provider -> routed multi-provider
- cloud ASR/TTS -> local ASR/TTS
- rule disposition -> lightweight disposition classifier

## 6. Integration Adapter Hub

### 6.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "adapter-hub.v1",
  "tenant_id": "tenant_demo",
  "request_id": "iah_001",
  "trace_id": "trace_iah_001",
  "trigger_source": "event_bus",
  "body": {
    "adapter": "feishu",
    "direction": "outbound",
    "event_type": "approval_requested",
    "payload": {
      "chat_id": "oc_xxx",
      "text": "审批请求..."
    },
    "delivery_policy": {
      "retry_max": 3,
      "timeout_ms": 5000
    }
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "adapter-hub.v1",
  "tenant_id": "tenant_demo",
  "request_id": "iah_001",
  "trace_id": "trace_iah_001",
  "data": {
    "delivery_id": "del_001",
    "normalized_receipt": {
      "provider": "feishu",
      "state": "sent",
      "provider_message_id": "msg_xxx"
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- event-driven outbound/inbound
- webhook for inbound callbacks

### 6.2 Core Responsibilities
- third-party adapter execution
- signature verification
- retry and idempotency
- inbound event normalization

### 6.3 Fallback & Mock Strategy
- write to durable outbox / DLQ when provider fails
- return `delivery_deferred`
- never block main brain success/failure judgment

### 6.4 Independent Storage & Dependencies
- delivery log
- retry queue
- provider credential/config store

### 6.5 Evolution Path
- text webhook -> interactive cards
- fixed adapters -> adapter marketplace
- direct cloud calls -> local relay / sandbox replay

## 7. Desktop Delivery Chain

### 7.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "desktop-delivery.v1",
  "tenant_id": "platform",
  "request_id": "dd_001",
  "trace_id": "trace_dd_001",
  "trigger_source": "release_pipeline",
  "body": {
    "release_id": "desktop_1.2.3",
    "channel": "stable",
    "target_segment": {
      "platform": "windows",
      "cohort": "canary"
    },
    "policy": {
      "require_signature": true,
      "max_error_rate": 0.05
    },
    "artifacts": [
      {
        "name": "lobster-desktop.exe",
        "sha256": "..."
      }
    ]
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "desktop-delivery.v1",
  "tenant_id": "platform",
  "request_id": "dd_001",
  "trace_id": "trace_dd_001",
  "data": {
    "manifest_url": "https://.../stable.json",
    "signature_id": "sig_001",
    "rollout_plan": {
      "cohort": "canary",
      "percent": 10
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- REST for manifest/query
- async events for device ack

### 7.2 Core Responsibilities
- signature update chain
- gradual rollout
- device ack collection
- rollback freeze

### 7.3 Fallback & Mock Strategy
- freeze current stable on signature or manifest failure
- return `deny_update`
- never block main business chain

### 7.4 Independent Storage & Dependencies
- artifact store
- manifest registry
- device ack store

### 7.5 Evolution Path
- manual manifest -> auto-signed manifest
- full update -> delta update
- fixed cohort -> smart rollout

## 8. Aoto Cut Content Production Subdomain

### 8.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "aoto-cut.v1",
  "tenant_id": "tenant_demo",
  "request_id": "ac_001",
  "trace_id": "trace_ac_001",
  "trigger_source": "event_bus",
  "body": {
    "tenant_context": {},
    "industry_profile": {},
    "customer_profile": {},
    "campaign_goal": {},
    "approval_policy": {},
    "execution_policy": {}
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "aoto-cut.v1",
  "tenant_id": "tenant_demo",
  "request_id": "ac_001",
  "trace_id": "trace_ac_001",
  "data": {
    "package_type": "publish_ready_package",
    "payload": {
      "topic_candidates": [],
      "script_asset": {},
      "compliance_report": {},
      "storyboard_package": {},
      "material_bundle": {},
      "media_bundle": {},
      "archive_record": {},
      "publish_ready_package": {}
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- async handoff package flow
- current main-repo prep:
  - `GET /api/v1/subprojects/aoto-cut/contract`
  - `GET /api/v1/subprojects/aoto-cut/packages`
  - `POST /api/v1/subprojects/aoto-cut/packages`

### 8.2 Core Responsibilities
- content production full chain
- template extraction
- material bundling
- script and compliance
- storyboard and media generation

### 8.3 Fallback & Mock Strategy
- main brain reads historical `publish_ready_package`
- if absent, return `manual_content_required`
- never block tenant/auth/billing/governance backbone

### 8.4 Independent Storage & Dependencies
- its own production DB
- its own material store
- its own media object storage

### 8.5 Evolution Path
- cloud media generation -> local ComfyUI / digital human
- static templates -> evolving template family system
- single pipeline -> multi-media mixed production engine

## 9. Commander / TG Command Subdomain

### 9.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "commander.v1",
  "tenant_id": "tenant_demo",
  "request_id": "cmd_001",
  "trace_id": "trace_cmd_001",
  "trigger_source": "tg",
  "body": {
    "task_description": "请生成策略并走异步提交",
    "user_id": "admin",
    "industry_tag": "food_chinese_restaurant",
    "competitor_handles": ["openalex"],
    "edge_targets": []
  }
}
```

#### Output Schema
**Accepted**
```json
{
  "ok": true,
  "status": "accepted",
  "contract_version": "commander.v1",
  "tenant_id": "tenant_demo",
  "request_id": "cmd_001",
  "trace_id": "trace_cmd_001",
  "data": {
    "job_id": "rdj_xxx",
    "status_url": "/run-dragon-team-async/rdj_xxx"
  },
  "warnings": [],
  "fallback_used": false
}
```

**Completed**
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "commander.v1",
  "tenant_id": "tenant_demo",
  "request_id": "cmd_001",
  "trace_id": "trace_cmd_001",
  "data": {
    "job_id": "rdj_xxx",
    "result": {
      "status": "success",
      "request_id": "req_xxx"
    }
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- synchronous submit + status polling
- current main-repo prep:
  - `POST /run-dragon-team-async`
  - `GET /run-dragon-team-async/{job_id}`
  - backend proxy equivalents

### 9.2 Core Responsibilities
- Commander orchestration
- branch pruning
- TG command interpretation
- command terminal flow control

### 9.3 Fallback & Mock Strategy
- mark job as `queued_external_unavailable`
- or downgrade to main-repo lite command route
- never fallback to long blocking synchronous command path

### 9.4 Independent Storage & Dependencies
- command session store
- TG conversation state
- terminal delivery state

### 9.5 Evolution Path
- polling -> event push
- single jobs -> battle-room sessions
- fixed branch pruning -> dynamic strategy agent

## 10. Template Recommender / CLI Seeder Subdomain

### 10.1 Boundary & Contract

#### Input Schema
```json
{
  "contract_version": "template-recommender.v1",
  "tenant_id": "tenant_demo",
  "request_id": "tr_001",
  "trace_id": "trace_tr_001",
  "trigger_source": "content_pipeline",
  "body": {
    "template_assets": {
      "industry_tag": "beauty_salon",
      "asset_tags": ["avatar", "storyboard", "local_video"]
    },
    "condition_signals": {
      "has_avatar": true,
      "has_local_video": false,
      "locked_script": false
    }
  }
}
```

#### Output Schema
```json
{
  "ok": true,
  "status": "completed",
  "contract_version": "template-recommender.v1",
  "tenant_id": "tenant_demo",
  "request_id": "tr_001",
  "trace_id": "trace_tr_001",
  "data": {
    "recommendations": [
      {
        "family_id": "family_beauty_fast",
        "score": 0.82,
        "directly_callable": false,
        "missing_prerequisites": ["local_video"]
      }
    ],
    "warnings": ["family registry load degraded"]
  },
  "warnings": [],
  "fallback_used": false
}
```

#### Communication Protocol
- recommend: sync API
- seeding / compile: async MQ

### 10.2 Core Responsibilities
- family rule execution
- anti-fit evaluation
- prerequisite evaluation
- CLI / seeder parameter alignment

### 10.3 Fallback & Mock Strategy
- return conservative default family when registry fails
- force `directly_callable=false`
- surface explicit warnings
- do not auto-call risky family when prerequisites are missing

### 10.4 Independent Storage & Dependencies
- family registry store
- seed cache
- crawler / seeder cache

### 10.5 Evolution Path
- rule recommend -> embedding + rerank
- CLI seeder -> full template compiler
- cloud asset checks -> local lightweight asset analyzer

## 11. Delivery Notes

This document is intentionally contract-first. Each sub-domain may evolve internally, but must preserve:

1. contract versioning discipline
2. stable input/output object structure
3. explicit fallback path
4. no shared mutable state with the main brain
