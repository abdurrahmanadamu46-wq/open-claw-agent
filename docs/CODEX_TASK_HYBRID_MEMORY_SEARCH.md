# CODEX TASK: 龙虾混合记忆搜索（Dense + BM25 Sparse + RRF）

**优先级：P1**  
**来源：QDRANT_BORROWING_ANALYSIS.md P1-#1（Qdrant Hybrid Search）**

---

## 背景

龙虾记忆搜索目前仅使用 Dense 向量（语义相似），对精确词汇不敏感：用户问"上次给王老板发的提案"，纯语义搜索可能找到语义相似但词汇不精确的其他提案。借鉴 Qdrant 混合搜索，引入 BM25 Sparse 向量做关键词精确匹配，用 RRF（倒数排名融合）合并两路结果，实现**语义理解 + 关键词精确**双保险召回。

---

## 一、核心实现

```python
# dragon-senate-saas-v2/hybrid_memory_search.py

from typing import Optional
from qdrant_client import QdrantClient, models

class HybridMemorySearch:
    """
    混合记忆搜索：Dense（语义）+ Sparse BM25（关键词）→ RRF 融合重排
    
    搜索质量对比：
      纯 Dense：召回率高，但精确词汇可能失配
      纯 Sparse：精确匹配，但无法理解近义词/同义词
      混合 RRF：两路 Top-50 → RRF 融合 → Top-10，精准度+召回率双优
    """

    COLLECTION_NAME = "lobster_memory"

    def __init__(self, qdrant_client: QdrantClient, dense_embedder, sparse_embedder):
        self.client = qdrant_client
        self.dense_embedder = dense_embedder   # OpenAI text-embedding-3-small
        self.sparse_embedder = sparse_embedder  # BM25 sparse vectorizer

    def search(
        self,
        query: str,
        tenant_id: str,
        lobster_name: Optional[str] = None,
        memory_type: Optional[str] = None,  # short_term / long_term / battle_log
        days: Optional[int] = None,          # 限制最近N天的记忆
        limit: int = 10,
    ) -> list[dict]:
        """
        混合搜索接口
        
        Args:
            query: 搜索查询文本
            tenant_id: 租户ID（必须，防止跨租户泄露）
            lobster_name: 可选，限定特定龙虾的记忆
            memory_type: 可选，按记忆类型过滤
            days: 可选，只搜索最近N天
            limit: 返回数量
        """
        # 1. 生成两路向量
        dense_vec = self.dense_embedder.embed(query)
        sparse_vec = self.sparse_embedder.embed(query)  # BM25 稀疏向量

        # 2. 构建 Payload 过滤条件（关键：租户隔离）
        must_conditions = [
            models.FieldCondition(
                key="tenant_id",
                match=models.MatchValue(value=tenant_id),
            )
        ]
        if lobster_name:
            must_conditions.append(models.FieldCondition(
                key="lobster_name",
                match=models.MatchValue(value=lobster_name),
            ))
        if memory_type:
            must_conditions.append(models.FieldCondition(
                key="memory_type",
                match=models.MatchValue(value=memory_type),
            ))
        if days:
            import time
            cutoff = time.time() - days * 86400
            must_conditions.append(models.FieldCondition(
                key="created_at",
                range=models.Range(gte=cutoff),
            ))

        payload_filter = models.Filter(must=must_conditions)

        # 3. 混合搜索（两路 Prefetch + RRF 融合）
        results = self.client.query_points(
            collection_name=self.COLLECTION_NAME,
            prefetch=[
                # Dense 语义搜索
                models.Prefetch(
                    query=dense_vec,
                    using="dense",
                    filter=payload_filter,
                    limit=50,
                ),
                # Sparse BM25 关键词搜索
                models.Prefetch(
                    query=models.SparseVector(
                        indices=sparse_vec.indices,
                        values=sparse_vec.values,
                    ),
                    using="sparse",
                    filter=payload_filter,
                    limit=50,
                ),
            ],
            # RRF 融合重排（两路结果合并）
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=limit,
            with_payload=True,
        )

        return [
            {
                "id": str(r.id),
                "score": r.score,
                "content": r.payload.get("content"),
                "lobster_name": r.payload.get("lobster_name"),
                "memory_type": r.payload.get("memory_type"),
                "created_at": r.payload.get("created_at"),
                "metadata": r.payload.get("metadata", {}),
            }
            for r in results.points
        ]

    def search_for_lobster(
        self,
        query: str,
        tenant_id: str,
        lobster_name: str,
        limit: int = 5,
    ) -> list[dict]:
        """便捷方法：龙虾调用自身记忆时使用"""
        return self.search(
            query=query,
            tenant_id=tenant_id,
            lobster_name=lobster_name,
            limit=limit,
        )
```

---

## 二、BM25 Sparse Embedder

```python
# dragon-senate-saas-v2/bm25_sparse_embedder.py

from dataclasses import dataclass

@dataclass
class SparseVector:
    indices: list[int]
    values: list[float]


class BM25SparseEmbedder:
    """
    BM25 稀疏向量生成器
    
    方案选择：
      选项A：fastembed（推荐，本地运行，无API费用）
        from fastembed import SparseTextEmbedding
        model = SparseTextEmbedding("Qdrant/bm25")
        
      选项B：Qdrant 内置 BM25（服务端计算）
        → 需要 Qdrant v1.7+，在 collection 创建时配置
    
    这里使用选项A（fastembed，更灵活）
    """

    def __init__(self, model_name: str = "Qdrant/bm25"):
        try:
            from fastembed import SparseTextEmbedding
            self._model = SparseTextEmbedding(model_name=model_name)
        except ImportError:
            raise ImportError("请安装: pip install fastembed")

    def embed(self, text: str) -> SparseVector:
        """生成 BM25 稀疏向量"""
        result = list(self._model.embed([text]))[0]
        return SparseVector(
            indices=result.indices.tolist(),
            values=result.values.tolist(),
        )

    def embed_batch(self, texts: list[str]) -> list[SparseVector]:
        results = list(self._model.embed(texts))
        return [
            SparseVector(indices=r.indices.tolist(), values=r.values.tolist())
            for r in results
        ]
```

---

## 三、Collection 初始化（支持 Dense + Sparse 双向量）

```python
# dragon-senate-saas-v2/memory_collection_init.py

def init_lobster_memory_collection(client: QdrantClient):
    """
    初始化龙虾记忆 Collection
    支持 Dense（1536维）+ Sparse BM25 双向量
    
    注意：如已存在 Collection 且只有 Dense，需要迁移
    """
    collection_name = "lobster_memory"

    # 检查是否已存在
    existing = [c.name for c in client.get_collections().collections]
    if collection_name in existing:
        # 检查是否已有 sparse 配置
        info = client.get_collection(collection_name)
        if "sparse" in (info.config.params.sparse_vectors or {}):
            print(f"[Memory] Collection {collection_name} 已配置 sparse，跳过")
            return
        # 需要重建（Qdrant 不支持在线添加 sparse 配置）
        print(f"[Memory] 需要重建 Collection 以支持 hybrid search")
        # TODO: 迁移现有数据

    client.create_collection(
        collection_name=collection_name,
        # Dense 向量（OpenAI text-embedding-3-small）
        vectors_config=models.VectorParams(
            size=1536,
            distance=models.Distance.COSINE,
        ),
        # Sparse 向量（BM25）
        sparse_vectors_config={
            "sparse": models.SparseVectorParams(
                index=models.SparseIndexParams(
                    on_disk=False,  # RAM 内索引（搜索更快）
                )
            )
        },
    )

    # 创建 Payload 索引（加速过滤查询）
    for field in ["tenant_id", "lobster_name", "memory_type"]:
        client.create_payload_index(
            collection_name=collection_name,
            field_name=field,
            field_schema=models.PayloadSchemaType.KEYWORD,
        )
    client.create_payload_index(
        collection_name=collection_name,
        field_name="created_at",
        field_schema=models.PayloadSchemaType.FLOAT,
    )
    print(f"[Memory] Collection {collection_name} 初始化完成（Dense + Sparse）")
```

---

## 四、集成到 enterprise_memory.py

```python
# dragon-senate-saas-v2/enterprise_memory.py（改造 search 方法）

from .hybrid_memory_search import HybridMemorySearch
from .bm25_sparse_embedder import BM25SparseEmbedder

class EnterpriseMemory:

    def __init__(self, ...):
        ...
        # ← 新增：混合搜索初始化
        self._sparse_embedder = BM25SparseEmbedder()
        self._hybrid_search = HybridMemorySearch(
            qdrant_client=self._qdrant,
            dense_embedder=self._dense_embedder,
            sparse_embedder=self._sparse_embedder,
        )

    def search(
        self,
        query: str,
        tenant_id: str,
        lobster_name: str = None,
        memory_type: str = None,
        days: int = None,
        limit: int = 10,
        use_hybrid: bool = True,  # 默认启用混合搜索
    ) -> list[dict]:
        """
        记忆搜索（自动选择混合搜索或纯 Dense 搜索）
        """
        if use_hybrid:
            return self._hybrid_search.search(
                query=query,
                tenant_id=tenant_id,
                lobster_name=lobster_name,
                memory_type=memory_type,
                days=days,
                limit=limit,
            )
        else:
            # 降级：纯 Dense 搜索（兼容旧实现）
            return self._dense_search(query, tenant_id, limit)
```

---

## 验收标准

**后端（dragon-senate-saas-v2/）：**
- [ ] `BM25SparseEmbedder`：fastembed Qdrant/bm25 模型，embed/embed_batch
- [ ] `HybridMemorySearch.search()`：Dense + Sparse Prefetch + RRF 融合
- [ ] Payload 过滤：tenant_id（必须）/ lobster_name / memory_type / days
- [ ] `memory_collection_init.py`：Collection 支持 Dense + Sparse 双向量配置
- [ ] Payload 索引：tenant_id / lobster_name / memory_type / created_at
- [ ] `EnterpriseMemory.search()` 集成混合搜索（`use_hybrid=True` 为默认）

**测试：**
- [ ] 精确词汇搜索（"王老板提案"）：混合搜索 > 纯语义搜索
- [ ] 语义近义词搜索（"开心的时刻"）：混合搜索 ≈ 纯语义搜索（不退化）
- [ ] 租户隔离：tenant_A 的记忆不出现在 tenant_B 的搜索结果中
- [ ] 依赖：`pip install fastembed qdrant-client`

---

*Codex Task | 来源：QDRANT_BORROWING_ANALYSIS.md P1-#1 | 2026-04-02*
