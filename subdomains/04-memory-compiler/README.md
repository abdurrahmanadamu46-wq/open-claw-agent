# Memory Compiler

Thread: `sd-04`

Existing source anchors:

- [lossless_memory.py](/F:/openclaw-agent/dragon-senate-saas-v2/lossless_memory.py)
- [memory_governor.py](/F:/openclaw-agent/dragon-senate-saas-v2/memory_governor.py)
- [services/lobster-memory](/F:/openclaw-agent/services/lobster-memory/README.md)

## 1. Boundary & Contract

Protocol:

- Ingest: MQ or REST
- Retrieve: REST

Input example:

```json
{
  "schema_version": "memory.compile.request.v1",
  "trace_id": "trace_mem_001",
  "tenant_id": "tenant_demo",
  "user_id": "admin",
  "events": [
    {
      "node": "strategist",
      "event_type": "strategy_generated",
      "payload": {
        "score": 0.78
      }
    }
  ],
  "compile_targets": ["episode", "policy", "retrieval_pack"]
}
```

Output example:

```json
{
  "schema_version": "memory.compile.result.v1",
  "status": "success",
  "episode_id": "ep_001",
  "policy_snapshot_id": "pol_003",
  "retrieval_pack_id": "pack_021",
  "memory_hits": 7,
  "fallback_used": false,
  "reason_codes": []
}
```

## 2. Core Responsibilities

- Store lossless events
- Compile episode and policy layers
- Create retrieval packs
- Apply recency, reward, and decay policies

## 3. Fallback & Mock

- Return `memory_hits=0` and empty retrieval pack if unavailable
- Do not block senate execution on missing memory

## 4. Independent Storage & Dependencies

- Dedicated vector store
- Dedicated event index DB
- Optional object storage for trace snapshots

## 5. Evolution Path

- Event store
- Layered memory compiler
- Compression and cost-aware retrieval
