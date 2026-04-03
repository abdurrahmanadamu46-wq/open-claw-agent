# Codex 任务：语义记忆搜索 — SHA-256 去重 + 混合搜索 + 记忆语义索引

## 任务背景

我们的项目 `dragon-senate-saas-v2/` 有一个向量检索模块 `qdrant_config.py`，目前只支持纯向量相似度搜索，且每次 ingest 都会重复 embedding 已有文档。我们还有一个事件记忆模块 `lossless_memory.py`，只支持按字段查询，不支持语义搜索。

**你的任务**：
1. 在 `qdrant_config.py` 中添加 SHA-256 内容去重
2. 在 `qdrant_config.py` 中新增混合搜索函数 (BM25 + Dense + RRF)
3. 新建 `memory_semantic_index.py` — Lossless Memory 语义索引
4. 在 `app.py` 中添加 2 个语义搜索 API endpoint
5. 编写测试

---

## 已有代码参考

### `dragon-senate-saas-v2/qdrant_config.py` 关键函数

```python
# 现有的 embedding 解析
def _resolve_embeddings() -> tuple[Any, int]:
    # 优先 OpenAI text-embedding-3-small (dim=1536)
    # 回退 HuggingFace sentence-transformers (dim=384)

def _get_client() -> QdrantClient:
    # 连接 Qdrant，url 来自 QDRANT_URL 环境变量

def _get_embeddings() -> tuple[Any, int]:
    # 缓存 embedding 实例

# 现有的 ingest 函数（你需要修改这个）
def ingest_formula_documents(documents: list[Document], *, user_id: str | None = None) -> int:
    # 将 Document 列表 ingest 到 Qdrant
    # 目前没有去重，每次都重新 embedding
    # 使用 langchain_community.vectorstores.Qdrant

# 现有的搜索函数（保持不变，新增 hybrid 版本）
def search_formula_documents(query: str, k: int = 5, *, user_id: str | None = None) -> list[Document]:
    # 纯向量相似度搜索
    # 使用 vector_store.similarity_search(query, k=...)

def fetch_recent_formula_documents(k: int = 20, *, user_id: str | None = None) -> list[Document]:
    # 获取最近的文档

def rag_status() -> dict[str, Any]:
    # 返回 RAG 状态信息
```

### `dragon-senate-saas-v2/lossless_memory.py` 关键函数

```python
def _db_path() -> str:
    return os.getenv("LOSSLESS_MEMORY_DB_PATH", "./data/lossless_memory.sqlite").strip()

def ensure_schema() -> None:
    # 创建 SQLite 表

def append_event(*, user_id, trace_id, node, event_type, level="info", payload=None) -> dict:
    # 记录事件

def query_events(*, user_id=None, trace_id=None, node=None, since_hours=None, limit=100) -> list[dict]:
    # 按字段查询事件（不支持语义搜索）

def replay_trace(*, trace_id) -> list[dict]:
    # 回放整条 trace

def trace_snapshot(*, trace_id) -> dict:
    # trace 快照
```

### `dragon-senate-saas-v2/app.py` 中现有的 import 模式

```python
from qdrant_config import rag_status
from lossless_memory import append_event as append_lossless_event
from lossless_memory import ensure_schema as ensure_lossless_memory_schema
from lossless_memory import query_events as lossless_query_events
```

---

## 任务 1：在 qdrant_config.py 中添加 SHA-256 内容去重

**文件**: `dragon-senate-saas-v2/qdrant_config.py`

**要求**：修改 `ingest_formula_documents()` 函数，在 ingest 前对每个 Document 计算 SHA-256 hash，跳过已存在的文档。

**需要添加的代码**：

1. 在文件顶部添加 `import hashlib` 和 `import json`（如果还没有的话）

2. 添加模块级缓存和 hash 函数：

```python
# ── SHA-256 内容去重（借鉴 memsearch） ──
_ingested_hashes: dict[str, set[str]] = {}  # collection_name -> set of content hashes


def _content_hash(text: str, metadata: dict[str, Any] | None = None) -> str:
    """计算文档内容的 SHA-256 hash，用于 ingest 去重。"""
    raw = str(text or "")
    if metadata:
        # 只用稳定字段参与 hash，排除时间戳等变化字段
        stable_keys = sorted(k for k in metadata if k not in {"created_at", "updated_at", "content_hash", "ingested_at"})
        stable_meta = {k: metadata[k] for k in stable_keys}
        raw += json.dumps(stable_meta, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
```

3. 修改 `ingest_formula_documents()` 函数体，在现有 ingest 逻辑前加入去重过滤：

```python
def ingest_formula_documents(documents: list[Document], *, user_id: str | None = None) -> int:
    if not documents:
        return 0
    
    collection = _collection_name(user_id)  # 使用现有的 collection name 函数
    
    # SHA-256 去重
    if collection not in _ingested_hashes:
        _ingested_hashes[collection] = set()
    known = _ingested_hashes[collection]
    
    new_docs: list[Document] = []
    skipped = 0
    for doc in documents:
        h = _content_hash(doc.page_content, doc.metadata)
        if h in known:
            skipped += 1
            continue
        doc.metadata = {**(doc.metadata or {}), "content_hash": h}
        new_docs.append(doc)
        known.add(h)
    
    if skipped:
        print(f"[qdrant] dedup: skipped {skipped} unchanged docs, ingesting {len(new_docs)} new")
    
    if not new_docs:
        return 0
    
    # ... 保持现有的 Qdrant ingest 逻辑不变，但把 documents 替换为 new_docs ...
    
    return len(new_docs)
```

**关键要求**：
- 不改变函数签名
- 不改变返回值语义（返回实际 ingest 的数量）
- `_ingested_hashes` 是进程内缓存，进程重启后第一次会重新 ingest（可接受）
- 在 `doc.metadata` 中添加 `content_hash` 字段
- 日志格式: `print(f"[qdrant] dedup: skipped {skipped} unchanged docs, ingesting {len(new_docs)} new")`

---

## 任务 2：在 qdrant_config.py 中新增混合搜索

**文件**: `dragon-senate-saas-v2/qdrant_config.py`

**要求**：新增 3 个函数，不修改任何现有函数。

### 2.1 `_tokenize()` — 中英文分词

```python
def _tokenize(text: str) -> list[str]:
    """
    中英文混合分词（简易版）。
    英文: 按空格/标点分词并小写化
    中文: 按字分词（简易方案）
    """
    import re
    tokens = re.findall(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]", text.lower())
    return tokens
```

### 2.2 `_bm25_search()` — BM25 全文检索

```python
def _bm25_search(
    query: str,
    documents: list[Document],
    k: int = 10,
    k1: float = 1.5,
    b: float = 0.75,
) -> list[tuple[Document, float]]:
    """
    简易 BM25 搜索实现，不依赖外部库。
    返回 (Document, score) 列表，按 score 降序。
    """
    import math
    from collections import Counter
    
    query_terms = _tokenize(query)
    if not query_terms or not documents:
        return []
    
    doc_term_lists = [_tokenize(doc.page_content) for doc in documents]
    doc_lengths = [len(terms) for terms in doc_term_lists]
    avg_dl = sum(doc_lengths) / len(doc_lengths) if doc_lengths else 1.0
    N = len(documents)
    
    # Document frequency
    df: dict[str, int] = Counter()
    for terms in doc_term_lists:
        for term in set(terms):
            df[term] += 1
    
    scored: list[tuple[Document, float]] = []
    for idx, doc in enumerate(documents):
        tf = Counter(doc_term_lists[idx])
        dl = doc_lengths[idx]
        score = 0.0
        for term in query_terms:
            if term not in tf:
                continue
            term_df = df.get(term, 0)
            idf = math.log((N - term_df + 0.5) / (term_df + 0.5) + 1.0)
            tf_norm = (tf[term] * (k1 + 1)) / (tf[term] + k1 * (1 - b + b * dl / avg_dl))
            score += idf * tf_norm
        if score > 0:
            scored.append((doc, score))
    
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]
```

### 2.3 `hybrid_search_documents()` — 混合搜索

```python
def hybrid_search_documents(
    query: str,
    k: int = 5,
    *,
    user_id: str | None = None,
    bm25_weight: float = 0.3,
    dense_weight: float = 0.7,
    k_rrf: int = 60,
) -> list[Document]:
    """
    混合搜索：Dense vector + BM25 全文 + Reciprocal Rank Fusion (RRF) 重排。
    
    策略：
    1. Dense search: 使用现有的 Qdrant similarity_search 获取 top-K*2 结果
    2. BM25 search: 在 dense 结果集 + fetch_recent 的合集上做关键词搜索
    3. RRF: 用加权 reciprocal rank 合并两路结果
    
    Args:
        query: 搜索查询文本
        k: 最终返回结果数量
        user_id: 用户/租户隔离
        bm25_weight: BM25 结果在 RRF 中的权重
        dense_weight: Dense 结果在 RRF 中的权重
        k_rrf: RRF 的 k 常数（默认 60，标准值）
    
    Returns:
        排序后的 Document 列表
    """
    # 1. Dense vector search
    dense_results = search_formula_documents(query, k=k * 3, user_id=user_id)
    
    # 2. 扩展候选池（加入最近文档，增加 BM25 的召回范围）
    recent_docs = fetch_recent_formula_documents(k=max(k * 5, 50), user_id=user_id)
    
    # 合并去重
    seen_contents: set[str] = set()
    candidate_pool: list[Document] = []
    for doc in dense_results + recent_docs:
        content_key = doc.page_content[:200]  # 用前200字符去重
        if content_key not in seen_contents:
            seen_contents.add(content_key)
            candidate_pool.append(doc)
    
    # 3. BM25 search on candidate pool
    bm25_results = _bm25_search(query, candidate_pool, k=k * 3)
    
    # 4. RRF 合并
    # 给每个 doc 一个唯一 ID
    doc_map: dict[str, Document] = {}
    
    dense_ranked: list[tuple[str, float]] = []
    for idx, doc in enumerate(dense_results):
        doc_id = f"d_{idx}_{doc.page_content[:50]}"
        doc_map[doc_id] = doc
        dense_ranked.append((doc_id, 1.0 / (idx + 1)))
    
    bm25_ranked: list[tuple[str, float]] = []
    for idx, (doc, score) in enumerate(bm25_results):
        doc_id = f"b_{idx}_{doc.page_content[:50]}"
        # 如果 dense 中已有相同文档，使用相同 ID
        for did, d in doc_map.items():
            if d.page_content[:200] == doc.page_content[:200]:
                doc_id = did
                break
        doc_map[doc_id] = doc
        bm25_ranked.append((doc_id, score))
    
    # RRF 公式: score(d) = sum(w_i / (k_rrf + rank_i(d)))
    rrf_scores: dict[str, float] = {}
    for rank, (doc_id, _) in enumerate(dense_ranked, start=1):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + dense_weight / (k_rrf + rank)
    for rank, (doc_id, _) in enumerate(bm25_ranked, start=1):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + bm25_weight / (k_rrf + rank)
    
    # 排序并返回
    sorted_ids = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    final: list[Document] = []
    for doc_id, _ in sorted_ids[:k]:
        if doc_id in doc_map:
            final.append(doc_map[doc_id])
    
    return final
```

**关键要求**：
- 不修改现有的 `search_formula_documents()` 函数
- `hybrid_search_documents()` 是独立新函数
- 不引入新的外部依赖（BM25 和 RRF 都自己实现）
- `_tokenize()` 支持中英文混合
- 函数签名与 `search_formula_documents()` 保持一致的风格

---

## 任务 3：新建 memory_semantic_index.py

**新文件**: `dragon-senate-saas-v2/memory_semantic_index.py`

**完整代码**：

```python
"""
Memory Semantic Index — 让 lossless_memory 支持语义搜索。

借鉴 memsearch 的理念：
- 结构化数据 → 向量索引 → 语义搜索
- SHA-256 内容去重（避免重复 embedding）
- 混合搜索 (Dense + BM25 + RRF)

用途：
- "上次美妆行业的策略效果如何？" → 找到 strategist 事件
- "哪个竞品公式转化率最高？" → 找到 feedback 事件
- "上周的投放出过什么问题？" → 找到 error 事件
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from langchain_core.documents import Document


def _event_to_document(event: dict[str, Any]) -> Document:
    """将 lossless_memory 事件转为可索引的 Document。"""
    payload = event.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            payload = {"raw": payload}

    summary = _extract_summary(payload)
    node = str(event.get("node") or "unknown")
    event_type = str(event.get("event_type") or "unknown")

    page_content = f"[{node}] [{event_type}] {summary}"

    content_hash = hashlib.sha256(page_content.encode("utf-8")).hexdigest()

    metadata = {
        "source": "lossless_memory",
        "user_id": str(event.get("user_id") or ""),
        "trace_id": str(event.get("trace_id") or ""),
        "node": node,
        "event_type": event_type,
        "level": str(event.get("level") or "info"),
        "created_at": str(event.get("created_at") or ""),
        "content_hash": content_hash,
    }
    return Document(page_content=page_content, metadata=metadata)


def _extract_summary(payload: dict[str, Any]) -> str:
    """从 payload 中提取人类可读的摘要。"""
    if not isinstance(payload, dict):
        return str(payload)[:300]

    parts: list[str] = []
    summary_keys = [
        "strategy_summary", "summary", "suggestion", "error", "reason",
        "result", "action", "decision", "recommendation", "output",
    ]
    for key in summary_keys:
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            parts.append(f"{key}: {val.strip()[:200]}")
        elif isinstance(val, dict):
            parts.append(f"{key}: {json.dumps(val, ensure_ascii=False)[:200]}")

    if not parts:
        raw = json.dumps(payload, ensure_ascii=False)
        parts.append(raw[:300])

    return " | ".join(parts)


async def index_recent_events(
    *,
    user_id: str,
    hours: int = 24,
    limit: int = 500,
) -> dict[str, Any]:
    """
    从 lossless_memory 读取最近事件并索引到 Qdrant。
    使用 SHA-256 去重，跳过已索引的事件。

    Returns:
        dict with total_events, ingested, skipped
    """
    from lossless_memory import query_events  # lazy import 避免循环依赖
    from qdrant_config import ingest_formula_documents  # lazy import

    events = query_events(user_id=user_id, since_hours=hours, limit=limit)
    if not events:
        return {"total_events": 0, "ingested": 0, "skipped": 0}

    docs = [_event_to_document(e) for e in events]

    # 用 user_id__memory 作为隔离的 collection scope
    ingested = ingest_formula_documents(docs, user_id=f"{user_id}__memory")

    return {
        "total_events": len(events),
        "ingested": ingested,
        "skipped": len(events) - ingested,
    }


def search_memory(
    query: str,
    *,
    user_id: str,
    k: int = 5,
    hybrid: bool = True,
) -> list[dict[str, Any]]:
    """
    语义搜索 lossless_memory 事件。

    Args:
        query: 自然语言查询，如 "上次美妆策略效果"
        user_id: 用户隔离
        k: 返回数量
        hybrid: 是否使用混合搜索 (BM25 + Dense + RRF)

    Returns:
        匹配的事件列表，每个包含 node, event_type, trace_id, content 等
    """
    memory_scope = f"{user_id}__memory"

    if hybrid:
        try:
            from qdrant_config import hybrid_search_documents
            docs = hybrid_search_documents(query, k=k, user_id=memory_scope)
        except ImportError:
            from qdrant_config import search_formula_documents
            docs = search_formula_documents(query, k=k, user_id=memory_scope)
    else:
        from qdrant_config import search_formula_documents
        docs = search_formula_documents(query, k=k, user_id=memory_scope)

    results: list[dict[str, Any]] = []
    for doc in docs:
        meta = doc.metadata or {}
        results.append({
            "node": meta.get("node"),
            "event_type": meta.get("event_type"),
            "trace_id": meta.get("trace_id"),
            "level": meta.get("level"),
            "created_at": meta.get("created_at"),
            "content": doc.page_content,
            "search_mode": "hybrid" if hybrid else "dense",
        })
    return results
```

---

## 任务 4：在 app.py 中添加 2 个 API endpoint

**文件**: `dragon-senate-saas-v2/app.py`

### 4.1 添加 import

在现有的 lossless_memory import 附近，不需要在顶部 import memory_semantic_index，因为 endpoint 内部用 lazy import。

### 4.2 添加 Pydantic 模型

在现有的请求模型定义区域添加：

```python
class MemorySemanticIndexRequest(BaseModel):
    hours: int = Field(default=24, ge=1, le=720)
    limit: int = Field(default=500, ge=1, le=2000)


class MemorySemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    k: int = Field(default=5, ge=1, le=50)
    hybrid: bool = Field(default=True)
```

### 4.3 添加 2 个 endpoint

在 `/memory/` 相关的 endpoint 附近添加：

```python
@app.post("/memory/semantic/index")
async def memory_semantic_index_endpoint(
    body: MemorySemanticIndexRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    """索引最近的 lossless_memory 事件到向量库，支持后续语义搜索。"""
    from memory_semantic_index import index_recent_events

    result = await index_recent_events(
        user_id=current_user.user_id,
        hours=body.hours,
        limit=body.limit,
    )
    return {"ok": True, **result}


@app.post("/memory/semantic/search")
async def memory_semantic_search_endpoint(
    body: MemorySemanticSearchRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    """语义搜索历史记忆事件。支持混合搜索 (Dense + BM25 + RRF)。"""
    from memory_semantic_index import search_memory

    results = search_memory(
        body.query,
        user_id=current_user.user_id,
        k=body.k,
        hybrid=body.hybrid,
    )
    return {"ok": True, "results": results, "count": len(results), "query": body.query}
```

### 4.4 在 route map 中注册

在 `app.state` 初始化区域的 route_map 字典中添加：

```python
"memory_semantic_index": "/memory/semantic/index",
"memory_semantic_search": "/memory/semantic/search",
```

---

## 任务 5：编写测试

**新文件**: `dragon-senate-saas-v2/tests/test_memory_semantic_index.py`

```python
"""Tests for memory_semantic_index module."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import unittest

# 确保 dragon-senate-saas-v2 在 path 中
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestEventToDocument(unittest.TestCase):
    """Test _event_to_document conversion."""

    def test_basic_event(self):
        from memory_semantic_index import _event_to_document

        event = {
            "user_id": "user_1",
            "trace_id": "trace_001",
            "node": "strategist",
            "event_type": "strategy_generated",
            "level": "info",
            "created_at": "2026-03-31T00:00:00Z",
            "payload": {"strategy_summary": "Focus on beauty vertical with UGC content"},
        }
        doc = _event_to_document(event)
        self.assertIn("strategist", doc.page_content)
        self.assertIn("strategy_generated", doc.page_content)
        self.assertIn("beauty", doc.page_content.lower())
        self.assertEqual(doc.metadata["node"], "strategist")
        self.assertEqual(doc.metadata["source"], "lossless_memory")
        self.assertTrue(doc.metadata["content_hash"])

    def test_empty_payload(self):
        from memory_semantic_index import _event_to_document

        event = {
            "user_id": "user_1",
            "trace_id": "trace_002",
            "node": "radar",
            "event_type": "scan_completed",
            "payload": {},
        }
        doc = _event_to_document(event)
        self.assertIn("radar", doc.page_content)
        self.assertTrue(len(doc.page_content) > 0)

    def test_string_payload(self):
        from memory_semantic_index import _event_to_document

        event = {
            "user_id": "user_1",
            "trace_id": "trace_003",
            "node": "echoer",
            "event_type": "reply_sent",
            "payload": "plain string payload",
        }
        doc = _event_to_document(event)
        self.assertIn("echoer", doc.page_content)

    def test_content_hash_deterministic(self):
        from memory_semantic_index import _event_to_document

        event = {
            "node": "abacus",
            "event_type": "score_computed",
            "payload": {"score": 0.85},
        }
        doc1 = _event_to_document(event)
        doc2 = _event_to_document(event)
        self.assertEqual(doc1.metadata["content_hash"], doc2.metadata["content_hash"])


class TestExtractSummary(unittest.TestCase):
    """Test _extract_summary helper."""

    def test_strategy_summary(self):
        from memory_semantic_index import _extract_summary

        payload = {"strategy_summary": "Use short video for dental marketing"}
        result = _extract_summary(payload)
        self.assertIn("strategy_summary", result)
        self.assertIn("dental", result.lower())

    def test_multiple_keys(self):
        from memory_semantic_index import _extract_summary

        payload = {
            "summary": "Task completed",
            "error": "Rate limit exceeded",
        }
        result = _extract_summary(payload)
        self.assertIn("summary", result)
        self.assertIn("error", result)

    def test_empty_payload(self):
        from memory_semantic_index import _extract_summary

        result = _extract_summary({})
        self.assertTrue(len(result) > 0)

    def test_nested_dict_value(self):
        from memory_semantic_index import _extract_summary

        payload = {"result": {"status": "ok", "count": 42}}
        result = _extract_summary(payload)
        self.assertIn("result", result)


class TestContentHash(unittest.TestCase):
    """Test SHA-256 content hashing in qdrant_config."""

    def test_hash_deterministic(self):
        from qdrant_config import _content_hash

        h1 = _content_hash("hello world", {"key": "value"})
        h2 = _content_hash("hello world", {"key": "value"})
        self.assertEqual(h1, h2)

    def test_hash_different_content(self):
        from qdrant_config import _content_hash

        h1 = _content_hash("hello", {})
        h2 = _content_hash("world", {})
        self.assertNotEqual(h1, h2)

    def test_hash_ignores_timestamp(self):
        from qdrant_config import _content_hash

        h1 = _content_hash("same", {"created_at": "2026-01-01"})
        h2 = _content_hash("same", {"created_at": "2026-12-31"})
        self.assertEqual(h1, h2)


class TestTokenize(unittest.TestCase):
    """Test _tokenize for hybrid search."""

    def test_english(self):
        from qdrant_config import _tokenize

        tokens = _tokenize("Hello World 123")
        self.assertEqual(tokens, ["hello", "world", "123"])

    def test_chinese(self):
        from qdrant_config import _tokenize

        tokens = _tokenize("美妆行业")
        self.assertEqual(tokens, ["美", "妆", "行", "业"])

    def test_mixed(self):
        from qdrant_config import _tokenize

        tokens = _tokenize("抖音 douyin content")
        self.assertIn("抖", tokens)
        self.assertIn("音", tokens)
        self.assertIn("douyin", tokens)
        self.assertIn("content", tokens)


if __name__ == "__main__":
    unittest.main()
```

---

## 通用规则

1. **文件位置**: 所有文件在 `dragon-senate-saas-v2/` 目录下
2. **不引入新依赖**: BM25、RRF、SHA-256、分词全部自己实现，不添加新 pip 包
3. **保持向后兼容**: 不修改 `search_formula_documents()` 和 `fetch_recent_formula_documents()` 的签名和行为
4. **Lazy import**: `memory_semantic_index.py` 中对 `qdrant_config` 和 `lossless_memory` 使用 lazy import
5. **日志格式**: `print(f"[qdrant] ...")` 和 `print(f"[memory_semantic] ...")`
6. **异常安全**: 所有 Qdrant 操作 `try/except`
7. **租户隔离**: memory 搜索用 `{user_id}__memory` 作为 collection scope

---

## 文件清单

```
dragon-senate-saas-v2/
├── qdrant_config.py               # 修改 — 添加 SHA-256 去重 + 混合搜索
├── memory_semantic_index.py       # 新建 — Lossless Memory 语义索引
├── app.py                         # 修改 — 添加 2 个 API endpoint
├── tests/
│   └── test_memory_semantic_index.py  # 新建 — 测试
├── lossless_memory.py             # 不修改
└── memory_governor.py             # 不修改
```

## 验证标准

1. ✅ `_content_hash()` 对相同内容返回相同 hash
2. ✅ `_content_hash()` 忽略 `created_at` 等时间戳字段
3. ✅ `ingest_formula_documents()` 跳过已有 hash 的文档并打日志
4. ✅ `_tokenize()` 支持中英文混合
5. ✅ `_bm25_search()` 返回按 score 降序排列的结果
6. ✅ `hybrid_search_documents()` 合并 Dense + BM25 结果
7. ✅ `_event_to_document()` 正确转换事件为 Document
8. ✅ `search_memory()` 返回结构化结果列表
9. ✅ API endpoint 有 Pydantic 校验
10. ✅ 所有测试通过
