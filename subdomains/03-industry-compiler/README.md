# Industry Compiler

Thread: `sd-03`

Existing source anchors:

- [industry_kb_pool.py](/F:/openclaw-agent/dragon-senate-saas-v2/industry_kb_pool.py)
- [dragon-senate-saas-v2/README.md](/F:/openclaw-agent/dragon-senate-saas-v2/README.md)

## 1. Boundary & Contract

Protocol:

- Compile: MQ async
- Search/read: REST

Input example:

```json
{
  "schema_version": "industry.compile.request.v1",
  "trace_id": "trace_ic_001",
  "tenant_id": "tenant_demo",
  "industry_tag": "beauty",
  "base_profile": {
    "positioning": "premium beauty service",
    "tone": "professional"
  },
  "competitor_accounts": ["https://example.com/a", "https://example.com/b"],
  "compile_mode": "profile+kb+playbook"
}
```

Output example:

```json
{
  "schema_version": "industry.compile.result.v1",
  "status": "success",
  "industry_tag": "beauty",
  "profile_id": "kb_beauty_v3",
  "entries_ingested": 42,
  "quality_gate": {
    "accepted": 36,
    "duplicate": 4,
    "rejected": 2
  },
  "artifacts": {
    "profile_version": "v3",
    "playbook_version": "v2"
  }
}
```

## 2. Core Responsibilities

- Build industry profiles
- Compile competitor formulas and playbooks
- Apply quality gates, dedupe, and audit
- Publish retrieval-ready knowledge packs

## 3. Fallback & Mock

- Fall back to `general` profile if compilation fails
- Allow base-profile-only compilation if competitor data is unavailable
- Parent system must continue with generic prompts

## 4. Independent Storage & Dependencies

- Dedicated profile DB
- Dedicated vector store
- Dedicated crawl cache

## 5. Evolution Path

- Rule + cloud generation
- Local RAG compiler
- Versioned industry A/B compilation
