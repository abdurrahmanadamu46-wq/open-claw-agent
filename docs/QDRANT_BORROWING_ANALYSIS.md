# Qdrant 借鉴分析报告
## https://github.com/qdrant/qdrant

**分析日期：2026-04-02**  
**规则：生成过 Codex Task 的任务默认已落地 | 我们更好的默认略过**

---

## 一、Qdrant 项目定性

```
Qdrant（Rust，21k+ Star）：高性能向量数据库（Vector Search Engine）
  核心能力：
    向量存储           — Dense/Sparse/Multi-vector
    近似最近邻搜索     — HNSW 索引（高速 ANN）
    有效载荷过滤       — 向量搜索 + 结构化过滤联合查询
    集合管理           — Collection（类似表）+ 分片
    快照/备份          — 在线快照，S3/本地备份
    分布式集群         — 内置 Raft 共识（水平扩展）
    REST + gRPC API   — 标准接口
    多租户             — Payload 字段过滤隔离（非原生多租户）
    量化压缩           — Scalar/Product 量化（减少内存）
    混合搜索           — Dense + Sparse 融合（BM25 + 向量）
```

---

## 二、已落地的能力（略过）

```
CODEX_TASK_SEMANTIC_MEMORY_SEARCH.md 已落地：
  ✅ 语义记忆搜索（已接入向量数据库）

CODEX_TASK_MEMSEARCH_BORROWING.md 已落地：
  ✅ 记忆搜索借鉴分析

dragon-senate-saas-v2/enterprise_memory.py 已存在：
  ✅ 企业记忆系统

dragon-senate-saas-v2/dataset_store.py 已存在：
  ✅ 数据集存储
```

---

## 三、Qdrant 对我们的真实价值

### 核心判断

Qdrant 本身是基础设施层（向量数据库），我们已通过 `CODEX_TASK_SEMANTIC_MEMORY_SEARCH` 接入了向量搜索能力。真正的借鉴价值在于 **Qdrant 的高级搜索设计模式**，可以升级我们已有的向量搜索实现质量。

---

### 3.1 云端大脑/龙虾层 — 混合搜索（Hybrid Search: Dense + Sparse）

**Qdrant 混合搜索：**
```python
# Qdrant 混合搜索（Dense向量 + Sparse BM25关键词）
client.query_points(
    collection_name="lobster_memory",
    prefetch=[
        # Dense 向量：语义相似（"快乐" 能找到 "开心"）
        models.Prefetch(
            query=dense_embedding,   # 768维向量
            using="dense",
            limit=50,
        ),
        # Sparse 向量：关键词精确匹配（BM25）
        models.Prefetch(
            query=sparse_embedding,  # BM25稀疏向量
            using="sparse",
            limit=50,
        ),
    ],
    # 融合重排：RRF（倒数排名融合）
    query=models.FusionQuery(fusion=models.Fusion.RRF),
    limit=10,
)
```

**对我们的价值：**
```
我们的龙虾记忆搜索目前只用 Dense 向量（语义相似）
问题：纯语义搜索对精确词汇不敏感
  用户问"上次给王老板发的提案"→ 语义搜可能找到其他提案（语义相似但不精确）
  
借鉴混合搜索：
  Dense：语义理解（"王老板" ≈ "王总" ≈ "王董"）
  Sparse：关键词精确匹配（"王老板" 必须出现在文档中）
  RRF 融合：两路结果合并重排，精准度 + 召回率双优
  
  实现位置：dragon-senate-saas-v2/enterprise_memory.py
  改造成本：中等（需要额外的 BM25 sparse embedding）
```

**优先级：P1**（龙虾记忆核心能力升级）

---

### 3.2 云端大脑/龙虾层 — Payload 过滤精确召回

**Qdrant Payload 过滤：**
```python
# 向量搜索 + 结构化过滤（精确匹配）
client.search(
    collection_name="lobster_memory",
    query_vector=embedding,
    query_filter=models.Filter(
        must=[
            # 只搜索指定租户的记忆
            models.FieldCondition(
                key="tenant_id",
                match=models.MatchValue(value="tenant_xyz"),
            ),
            # 只搜索指定龙虾的记忆
            models.FieldCondition(
                key="lobster_name",
                match=models.MatchValue(value="strategist"),
            ),
            # 时间范围过滤（最近30天）
            models.FieldCondition(
                key="created_at",
                range=models.Range(gte=thirty_days_ago),
            ),
        ]
    ),
    limit=10,
)
```

**对我们的价值：**
```
我们已有向量搜索，但过滤条件可能不完整：
  ① tenant_id 隔离（必须有，防止跨租户记忆泄露）
  ② lobster_name 过滤（每个龙虾只搜自己的记忆）
  ③ memory_type 过滤（short_term/long_term/battle_log）
  ④ 时间范围过滤（近期记忆优先）
  
  CODEX_TASK_SEMANTIC_MEMORY_SEARCH 已落地，
  但具体过滤字段设计可能不完整 → 需要审查
  如已完整实现 → 略过
```

**需要审查已落地实现，如已完整则略过。（暂设 P2 待确认）**

---

### 3.3 龙虾层 — 多向量（Multi-vector）存储龙虾多维度

**Qdrant Multi-vector：**
```python
# 同一条记录存储多个向量（不同语义空间）
client.upsert(
    collection_name="lobster_profile",
    points=[
        models.PointStruct(
            id=1,
            vector={
                "skill_vector": skill_embedding,      # 技能向量
                "personality_vector": persona_embed,  # 性格向量
                "battle_vector": battle_embedding,    # 战斗记忆向量
            },
            payload={"lobster_name": "strategist", ...}
        )
    ]
)

# 按不同向量维度搜索
client.search(
    collection_name="lobster_profile",
    query_vector=("skill_vector", query_embed),  # 用技能向量搜索
)
```

**对我们的价值：**
```
我们的龙虾有三层维度：
  ① 技能（skills）— 技能文本的向量
  ② 性格/灵魂（soul）— 龙虾宪法/性格的向量  
  ③ 战斗记录（battle_log）— 历史执行经验的向量
  
  Multi-vector 可以让一个龙虾的 profile 存在一条记录中，
  但按不同维度召回（"找最擅长策略的龙虾" vs "找性格最稳的龙虾"）
  
  当前规模（9个龙虾）用 Multi-vector 收益不大，
  但如未来龙虾扩展到 50+，Multi-vector 让检索更精准
```

**优先级：P3**（9个龙虾时不必要，未来扩展时考虑）

---

### 3.4 SaaS 系统 — 集合快照（Snapshot 备份）

**Qdrant Snapshot：**
```
POST /collections/{name}/snapshots
  → 创建集合快照（WAL + 索引 + Payload 全量）
  → 可以导出到 S3 / 本地存储
  
GET /collections/{name}/snapshots
  → 列出所有快照版本

POST /collections/{name}/snapshots/{name}/recover
  → 从快照恢复（无需停机）
```

**对我们的价值：**
```
我们的向量数据库（龙虾记忆 + 企业记忆）需要备份
CODEX_TASK_OPENCLAW_BACKUP 已落地：
  ✅ 数据备份（Postgres/文件）
  
  向量数据库快照是额外的备份维度
  如我们使用 Qdrant 作为向量库 → 需要定期 snapshot
  → 可以集成到已有备份系统（OPENCLAW_BACKUP）
```

**优先级：P2**（向量记忆备份，集成到已有备份系统）

---

### 3.5 支撑微服务集群 — Qdrant 量化压缩（内存优化）

**Qdrant 量化：**
```python
# Scalar 量化（float32 → int8，内存减少 4x）
client.create_collection(
    collection_name="lobster_memory",
    vectors_config=models.VectorParams(size=1536, distance=models.Distance.COSINE),
    quantization_config=models.ScalarQuantization(
        scalar=models.ScalarQuantizationConfig(
            type=models.ScalarType.INT8,
            quantile=0.99,
            always_ram=True,
        )
    ),
)
```

**对我们的价值：**
```
OpenAI text-embedding-3-small：1536维 float32
每条记忆向量：1536 × 4 bytes = 6KB
1万条记忆：60MB（可接受）
10万条记忆：600MB（需要量化）

当前龙虾记忆体量：可能 < 1万条 → 暂不需要量化
→ P3（记忆量超过 5万条时启用）
```

**优先级：P3**（暂不需要）

---

## 四、对比总结

| 维度 | Qdrant | 我们 | 胜负 | 行动 |
|-----|--------|------|------|------|
| **混合搜索（Dense+Sparse）** | ✅ | 仅 Dense | Qdrant 胜 | **P1** |
| **向量记忆备份（Snapshot）** | ✅ | 数据库备份已有 | 部分差距 | **P2** |
| Payload 过滤 | ✅ | ✅ 已落地 | 平（待确认）| — |
| Multi-vector 多维度 | ✅ | 单向量 | Qdrant 胜 | P3 |
| 量化压缩 | ✅ | 暂不需要 | P3 | — |
| 分布式集群 | ✅ | 单实例够用 | P3 | — |
| AI 龙虾体系 | ❌ | ✅ 深度定制 | 我们胜 | — |

---

## 五、借鉴清单

### P1（1个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 1 | **混合搜索升级**（Dense + BM25 Sparse + RRF 融合重排）| 2天 |

### P2（1个）
| # | 借鉴点 | 工时 |
|---|--------|------|
| 2 | **向量记忆定期快照备份**（集成 Qdrant snapshot → 已有备份系统）| 0.5天 |

---

*分析基于 Qdrant v1.9.x（2026-04-02）*
