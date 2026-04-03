# Memsearch 语义记忆搜索 — 借鉴分析 + Codex 落地任务

> 分析日期: 2026-03-31
> 分析对象: [memsearch](https://github.com/zilliztech/memsearch) — 向量化语义搜索 + 内容去重 + 文件监听

---

## 一、结论先行

**我们已有 60% 的基础设施，但缺少关键的"语义搜索胶水层"。**

memsearch 的核心价值不在于向量库（我们已有 Qdrant），而在于 3 个我们缺少的能力：
1. **SHA-256 内容去重** — 避免重复 embedding，节省 API 调用
2. **混合搜索 (Dense + BM25 + RRF)** — 比纯向量搜索更准确
3. **文件监听自动索引** — 记忆文件变更时自动重新索引

### 能力对照矩阵

| memsearch 能力 | 我们的现状 | 差距 | 可直接落地？ |
|---------------|----------|------|------------|
| 向量存储 | ✅ Qdrant (`qdrant_config.py`) | 无差距 | — |
| Embedding 提供者 | ✅ OpenAI + HuggingFace (`_resolve_embeddings()`) | 无差距 | — |
| 文档分块 (Chunking) | ✅ `semantic_section_chunking` (agent_rag_pack_factory) | 无差距 | — |
| 相似度搜索 | ✅ `search_formula_documents()` | 只有 Dense，无 BM25 | 🟡 |
| **SHA-256 内容去重** | ❌ 每次 ingest 都重复 embedding | **关键差距** | ✅ 可立即加 |
| **混合搜索 (BM25 + Dense + RRF)** | ❌ 只有纯向量搜索 | **关键差距** | ✅ 可立即加 |
| **文件监听自动索引** | ❌ 无 | 有价值但非急需 | 🔵 后续考虑 |
| Markdown 文件索引 | ❌ 我们是结构化数据入库 | 不同模式 | ⚠️ 部分适用 |
| CLI 搜索工具 | ❌ 无 | 开发调试有用 | 🔵 后续考虑 |
| 本地嵌入 (Ollama) | ✅ 已有 Ollama 部署 | 无差距 | — |

---

## 二、已确认事实：我们的记忆/RAG 体系现状

### 2.1 五层记忆架构

```
┌─────────────────────────────────────────────────────┐
│ 1. Lossless Memory (lossless_memory.py)             │
│    SQLite 事件流 — 每个 node 的每次执行都记录       │
│    功能: append_event / query_events / replay_trace │
│    用途: 审计、回放、调试                            │
├─────────────────────────────────────────────────────┤
│ 2. Memory Governor (memory_governor.py)             │
│    SQLite — episode/policy/tenant/role 记忆          │
│    功能: 记忆编译、回滚模板、kernel report           │
│    用途: 治理决策的历史记忆                          │
├─────────────────────────────────────────────────────┤
│ 3. Senate Kernel (senate_kernel.py)                 │
│    记忆上下文构建 — build_memory_context()           │
│    功能: 从 memory_governor 读取，构建策略上下文     │
│    用途: strategist 使用的记忆输入                   │
├─────────────────────────────────────────────────────┤
│ 4. RAG 向量存储 (qdrant_config.py)                  │
│    Qdrant — 公式/竞品/行业知识的向量检索             │
│    功能: ingest_formula_documents / search           │
│    用途: 内容生成的参考素材                          │
├─────────────────────────────────────────────────────┤
│ 5. Edge Memory Consolidator (memory_consolidator.py)│
│    Token 预算归纳 — 边缘端历史压缩                   │
│    功能: consolidate_by_tokens / consolidate_by_age  │
│    用途: 边缘 WSS 会话的记忆管理                     │
└─────────────────────────────────────────────────────┘
```

### 2.2 现有 RAG 链路

```
竞品公式 → formula_to_document() → ingest_formula_documents() → Qdrant
                                                                  ↓
                                    search_formula_documents() ← 查询
                                    fetch_recent_formula_documents()
                                    query_raganything_hybrid()  ← 多模态
```

---

## 三、可直接落地的 3 个借鉴点

### 3.1 SHA-256 内容去重（P0 — 立即落地）

**痛点**：`ingest_formula_documents()` 每次都重新 embedding，即使文档内容没变。这浪费 API 调用和时间。

**memsearch 方案**：对每个 chunk 计算 SHA-256 hash，已有 hash 的跳过。

**落地位置**：`dragon-senate-saas-v2/qdrant_config.py` 的 `ingest_formula_documents()` 函数

**实现**：
```python
import hashlib

def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

# 在 ingest 前检查 hash，跳过已存在的文档
```

### 3.2 混合搜索 BM25 + Dense + RRF（P0 — 立即落地）

**痛点**：`search_formula_documents()` 只用向量相似度搜索，对精确关键词匹配（如品牌名、具体术语）效果差。

**memsearch 方案**：Dense vector + BM25 全文检索 + Reciprocal Rank Fusion (RRF) 重排。

**落地位置**：`dragon-senate-saas-v2/qdrant_config.py` 新增 `hybrid_search_documents()` 函数

**Qdrant 原生支持**：Qdrant 1.7+ 已内置 sparse vector（BM25）支持，可以直接用。

### 3.3 Lossless Memory 语义搜索（P1 — 高价值）

**痛点**：`lossless_memory.py` 的 `query_events()` 只支持按 node/trace_id/时间范围查询，不支持语义搜索。当问"上次哪个策略效果最好？"时无法回答。

**memsearch 方案**：将 lossless_memory 事件定期索引到 Qdrant，支持语义查询。

**落地位置**：新模块 `dragon-senate-saas-v2/memory_semantic_index.py`

---

## 四、Codex 落地任务

### 任务 1：在 qdrant_config.py 中添加 SHA-256 内容去重

**文件**: `dragon-senate-saas-v2/qdrant_config.py`

**修改 `ingest_formula_documents()` 函数**：

在 ingest 前对每个 Document 计算 SHA-256 hash，检查 Qdrant 中是否已存在同 hash 的文档，跳过已存在的。

**具体实现**：

```python
import hashlib

# 在文件顶部添加一个模块级的 hash 缓存
_ingested_hashes: dict[str, set[str]] = {}  # collection -> set of content hashes


def _content_hash(text: str, metadata: dict) -> str:
    """计算文档内容的 SHA-256 hash，用于去重。"""
    raw = text + json.dumps(metadata, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def ingest_formula_documents(documents: list[Document], *, user_id: str | None = None) -> int:
    """修改现有函数，添加 hash 去重逻辑。"""
    if not documents:
        return 0
    
    collection = _collection_name(user_id)
    
    # 获取或初始化该 collection 的 hash 缓存
    if collection not in _ingested_hashes:
        _ingested_hashes[collection] = set()
    known_hashes = _ingested_hashes[collection]
    
    # 过滤掉已存在的文档
    new_docs = []
    skipped = 0
    for doc in documents:
        h = _content_hash(doc.page_content, doc.metadata or {})
        if h in known_hashes:
            skipped += 1
            continue
        # 在 metadata 中记录 hash，方便后续查询
        doc.metadata = {**(doc.metadata or {}), "content_hash": h}
        new_docs.append(doc)
        known_hashes.add(h)
    
    if not new_docs:
        return 0
    
    # ... 现有的 ingest 逻辑，但只 ingest new_docs ...
    
    return len(new_docs)  # 返回实际 ingest 的数量
```

**注意事项**：
- 保持现有函数签名不变
- `_ingested_hashes` 是进程内缓存，重启后会重新 ingest（可接受，因为 Qdrant 有幂等 upsert）
- 在 `doc.metadata` 中记录 `content_hash` 字段
- 日志输出跳过了多少文档：`print(f"[qdrant] skipped {skipped} unchanged docs, ingesting {len(new_docs)} new")`

---

### 任务 2：在 qdrant_config.py 中添加混合搜索

**文件**: `dragon-senate-saas-v2/qdrant_config.py`

**新增函数 `hybrid_search_documents()`**：

```python
def hybrid_search_documents(
    query: str,
    k: int = 5,
    *,
    user_id: str | None = None,
    bm25_weight: float = 0.3,
    dense_weight: float = 0.7,
) -> list[Document]:
    """
    混合搜索：Dense vector + BM25 全文 + RRF 重排。
    
    借鉴 memsearch 的 hybrid search 策略：
    1. Dense vector search (Qdrant similarity_search)
    2. BM25 keyword search (在 page_content 上做简单的 TF-IDF 匹配)
    3. Reciprocal Rank Fusion (RRF) 合并两路结果
    
    Args:
        query: 搜索查询文本
        k: 返回结果数量
        user_id: 用户隔离
        bm25_weight: BM25 结果在 RRF 中的权重
        dense_weight: Dense 结果在 RRF 中的权重
    
    Returns:
        合并排序后的 Document 列表
    """
```

**RRF 算法实现**：
```python
def _reciprocal_rank_fusion(
    ranked_lists: list[list[tuple[str, float]]],  # [(doc_id, score), ...]
    weights: list[float],
    k_rrf: int = 60,
) -> list[tuple[str, float]]:
    """
    Reciprocal Rank Fusion — 合并多路排序结果。
    score(d) = sum(w_i / (k + rank_i(d))) for each ranker i
    """
    scores: dict[str, float] = {}
    for ranked_list, weight in zip(ranked_lists, weights):
        for rank, (doc_id, _score) in enumerate(ranked_list, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + weight / (k_rrf + rank)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
```

**BM25 简易实现**（不依赖外部库）：
```python
import math
import re
from collections import Counter

def _bm25_search(
    query: str,
    documents: list[Document],
    k: int = 10,
    k1: float = 1.5,
    b: float = 0.75,
) -> list[tuple[Document, float]]:
    """简易 BM25 搜索实现。"""
    query_terms = _tokenize(query)
    if not query_terms or not documents:
        return []
    
    doc_lengths = [len(_tokenize(doc.page_content)) for doc in documents]
    avg_dl = sum(doc_lengths) / len(doc_lengths) if doc_lengths else 1.0
    N = len(documents)
    
    # Document frequency
    df: dict[str, int] = Counter()
    for doc in documents:
        terms = set(_tokenize(doc.page_content))
        for term in terms:
            df[term] += 1
    
    scored = []
    for idx, doc in enumerate(documents):
        doc_terms = _tokenize(doc.page_content)
        tf = Counter(doc_terms)
        dl = doc_lengths[idx]
        score = 0.0
        for term in query_terms:
            if term not in tf:
                continue
            idf = math.log((N - df.get(term, 0) + 0.5) / (df.get(term, 0) + 0.5) + 1.0)
            tf_norm = (tf[term] * (k1 + 1)) / (tf[term] + k1 * (1 - b + b * dl / avg_dl))
            score += idf * tf_norm
        scored.append((doc, score))
    
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]

def _tokenize(text: str) -> list[str]:
    """中英文分词（简易版）。"""
    # 英文: 按空格/标点分词
    # 中文: 按字分词（简易方案，后续可换 jieba）
    tokens = re.findall(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]", text.lower())
    return tokens
```

**注意事项**：
- 保持 `search_formula_documents()` 不变（向后兼容）
- 新增 `hybrid_search_documents()` 作为增强版本
- `strategist` 虾优先使用 `hybrid_search_documents()`
- BM25 从已索引的文档中检索（需要先 fetch 文档列表）

---

### 任务 3：创建 Lossless Memory 语义索引模块

**新文件**: `dragon-senate-saas-v2/memory_semantic_index.py`

**功能**：
1. 从 `lossless_memory.py` 读取事件
2. 将事件转为 Document 格式
3. SHA-256 去重后 ingest 到 Qdrant 的 `memory_events` collection
4. 提供语义搜索接口

```python
"""
Memory Semantic Index — 让 lossless_memory 支持语义搜索

借鉴 memsearch 的理念：
- Markdown/结构化数据 → 向量索引 → 语义搜索
- SHA-256 内容去重
- 混合搜索 (Dense + BM25 + RRF)

用途：
- "上次美妆行业的策略效果如何？" → 找到相关的 strategist 事件
- "哪个竞品公式转化率最高？" → 找到 feedback 事件
- "上周的投放出过什么问题？" → 找到 error 事件
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from langchain_core.documents import Document


def _event_to_document(event: dict[str, Any]) -> Document:
    """将 lossless_memory 事件转为可索引的 Document。"""
    payload = event.get("payload", {})
    page_content = json.dumps(
        {
            "node": event.get("node"),
            "event_type": event.get("event_type"),
            "summary": _extract_summary(payload),
        },
        ensure_ascii=False,
    )
    metadata = {
        "user_id": event.get("user_id", ""),
        "trace_id": event.get("trace_id", ""),
        "node": event.get("node", ""),
        "event_type": event.get("event_type", ""),
        "level": event.get("level", "info"),
        "created_at": event.get("created_at", ""),
        "content_hash": hashlib.sha256(page_content.encode("utf-8")).hexdigest(),
    }
    return Document(page_content=page_content, metadata=metadata)


def _extract_summary(payload: dict[str, Any]) -> str:
    """从 payload 中提取人类可读的摘要。"""
    parts = []
    for key in ["strategy_summary", "summary", "suggestion", "error", "reason"]:
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            parts.append(f"{key}: {val.strip()[:200]}")
    if not parts:
        parts.append(json.dumps(payload, ensure_ascii=False)[:300])
    return " | ".join(parts)


async def index_recent_events(
    *,
    user_id: str,
    hours: int = 24,
    collection: str = "memory_events",
) -> dict[str, Any]:
    """
    从 lossless_memory 读取最近事件并索引到 Qdrant。
    使用 SHA-256 去重，跳过已索引的事件。
    """
    from lossless_memory import query_events
    from qdrant_config import ingest_formula_documents
    
    events = query_events(user_id=user_id, since_hours=hours, limit=500)
    docs = [_event_to_document(e) for e in events]
    ingested = ingest_formula_documents(docs, user_id=f"{user_id}__memory")
    return {
        "total_events": len(events),
        "ingested": ingested,
        "skipped": len(events) - ingested,
        "collection": collection,
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
    """
    if hybrid:
        from qdrant_config import hybrid_search_documents
        docs = hybrid_search_documents(query, k=k, user_id=f"{user_id}__memory")
    else:
        from qdrant_config import search_formula_documents
        docs = search_formula_documents(query, k=k, user_id=f"{user_id}__memory")
    
    results = []
    for doc in docs:
        meta = doc.metadata or {}
        results.append({
            "node": meta.get("node"),
            "event_type": meta.get("event_type"),
            "trace_id": meta.get("trace_id"),
            "level": meta.get("level"),
            "created_at": meta.get("created_at"),
            "content": doc.page_content,
            "relevance_source": "hybrid" if hybrid else "dense",
        })
    return results
```

### 任务 4：在 app.py 中添加语义记忆搜索 API

**文件**: `dragon-senate-saas-v2/app.py`

**新增 2 个 endpoint**:

```python
# ── 语义记忆搜索 ──

@app.post("/memory/semantic/index")
async def memory_semantic_index(
    body: dict,
    current_user: UserClaims = Depends(_decode_user),
):
    """索引最近的 lossless_memory 事件到向量库。"""
    from memory_semantic_index import index_recent_events
    result = await index_recent_events(
        user_id=current_user.user_id,
        hours=int(body.get("hours", 24)),
    )
    return {"ok": True, **result}


@app.post("/memory/semantic/search")
async def memory_semantic_search(
    body: dict,
    current_user: UserClaims = Depends(_decode_user),
):
    """语义搜索历史记忆。"""
    from memory_semantic_index import search_memory
    query = str(body.get("query", "")).strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    results = search_memory(
        query,
        user_id=current_user.user_id,
        k=int(body.get("k", 5)),
        hybrid=bool(body.get("hybrid", True)),
    )
    return {"ok": True, "results": results, "count": len(results)}
```

---

## 五、不建议直接安装 memsearch 的原因

1. **我们已有 Qdrant**，memsearch 用的是 Milvus — 不想引入第二个向量库
2. **memsearch 面向个人工具**，我们是多租户 SaaS — 需要 tenant 隔离
3. **memsearch 的核心算法很简单**，SHA-256 去重 + BM25 + RRF 自己实现更灵活
4. **集成到现有 qdrant_config.py** 比引入新依赖更干净

---

## 六、执行优先级

| 优先级 | 任务 | 算力 | 落地文件 |
|-------|------|------|---------|
| P0 | SHA-256 内容去重 | 低 | `qdrant_config.py` 修改 |
| P0 | 混合搜索 (BM25 + Dense + RRF) | 中 | `qdrant_config.py` 新增函数 |
| P1 | Lossless Memory 语义索引 | 中 | `memory_semantic_index.py` 新建 |
| P1 | API endpoints | 低 | `app.py` 新增 2 个 endpoint |

---

## 七、交接摘要

memsearch 的 3 个核心理念（SHA-256 去重 / 混合搜索 RRF / 文件监听）中，前两个可以直接落地到我们现有的 `qdrant_config.py`。不需要安装 memsearch 或引入 Milvus，因为我们已有 Qdrant + 完整的 5 层记忆体系。关键行动：在 `ingest_formula_documents()` 加 content hash 去重 + 新增 `hybrid_search_documents()` 混合搜索函数 + 新建 `memory_semantic_index.py` 让 lossless_memory 支持语义查询。
