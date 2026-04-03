# Research Radar Batch

Thread: `sd-02`

Existing source anchors:

- [research_radar_fetchers.py](/F:/openclaw-agent/dragon-senate-saas-v2/research_radar_fetchers.py)
- [research_radar_ranker.py](/F:/openclaw-agent/dragon-senate-saas-v2/research_radar_ranker.py)
- [research_radar_daily_runner.py](/F:/openclaw-agent/dragon-senate-saas-v2/scripts/research_radar_daily_runner.py)

## 1. Boundary & Contract

Protocol:

- Batch run: MQ async
- Query: REST
- Digest push: Webhook

Input example:

```json
{
  "schema_version": "radar.batch.request.v1",
  "trace_id": "trace_rr_001",
  "tenant_id": "tenant_demo",
  "topics": ["multi-agent", "memory", "reward model"],
  "sources": ["github", "arxiv", "paperswithcode"],
  "time_window_hours": 24,
  "limit": 100,
  "only_executable": true
}
```

Output example:

```json
{
  "schema_version": "radar.batch.result.v1",
  "status": "success",
  "batch_id": "rr_001",
  "signals": [
    {
      "signal_id": "sig_001",
      "title": "Memory-augmented multi-agent planning",
      "source": "arxiv",
      "score": 0.91,
      "tags": ["agent", "memory"]
    }
  ],
  "digest_summary": "top executable signals generated",
  "fallback_used": false,
  "reason_codes": []
}
```

## 2. Core Responsibilities

- Fetch from multiple research sources
- Normalize and deduplicate signals
- Rank by execution value
- Emit digest summaries and integration hints

## 3. Fallback & Mock

- Skip failed sources instead of failing the whole batch
- Fall back to last successful snapshot if all fetchers fail
- Parent system can keep working with empty signal list

## 4. Independent Storage & Dependencies

- Dedicated signal store
- Dedicated cache and dedupe lock
- Optional raw snapshot object store

## 5. Evolution Path

- API + HTML fetch
- Embedding rerank
- Research-agent swarm
