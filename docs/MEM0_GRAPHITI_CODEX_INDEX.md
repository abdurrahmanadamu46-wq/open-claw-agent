# mem0 + graphiti 借鉴落地索引

**分析日期**：2026-04-02  
**来源A**：https://github.com/mem0ai/mem0（⭐51,697）  
**来源B**：https://github.com/getzep/graphiti（⭐24,412）  
**定位**：
- mem0：AI Agent 通用记忆层（向量+图谱+程序性三层记忆）
- graphiti：实时时序知识图谱（三元组+时间戳+Neo4j）

---

## 核心价值总结

```
我们的记忆层现状（已落地）：
  enterprise_memory.py    → 手动写入，无自动提取，无冲突检测
  commander_graph_builder → 无时序，无命名空间，同名实体会重复创建
  tenant_memory_sync.py   → 全量同步，无按需推送

借鉴后升级效果：
  MemoryExtractor          → 龙虾对话结束后 LLM 自动提取事实
  ADD/UPDATE/DELETE/NONE   → 新事实自动替换旧记忆，不会矛盾并存
  TemporalGraphBuilder     → 知识图谱带时间戳，"现在"vs"3个月前"
  GraphNamespace           → 每个租户图谱完全隔离，零越权风险
  EdgeMemoryCache          → 边缘执行前自动注入线索记忆上下文
  LobsterProceduralMemory  → 龙虾自己学会的行为规律被记住并复用
```

---

## 已落地声明（跳过）

| 功能 | 已落地文件 |
|------|----------|
| 向量语义搜索 | `CODEX_TASK_HYBRID_MEMORY_SEARCH.md` |
| 向量快照备份 | `CODEX_TASK_VECTOR_SNAPSHOT_BACKUP.md` |
| Commander 图谱构建（基础）| `commander_graph_builder.py` |
| 租户记忆同步 | `tenant_memory_sync.py` |
| OTEL 追踪 | `CODEX_TASK_DISTRIBUTED_TRACING.md` |

---

## 生成文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `docs/MEM0_GRAPHITI_BORROWING_ANALYSIS.md` | 完整6层逐层对比分析 | ✅ |
| `docs/CODEX_TASK_MEMORY_UPGRADE.md` | **P1** mem0借鉴：自动提取+冲突检测+三层分区+程序性记忆+边缘缓存 | ✅ |
| `docs/CODEX_TASK_GRAPHITI_KNOWLEDGE_GRAPH.md` | **P1+P2** graphiti借鉴：时序图谱+命名空间+可视化+混合搜索 | ✅ |

---

## P1 推荐执行顺序

```
1. MemoryExtractor + MemoryConflictResolver（最高价值）
   ← enterprise_memory.py 手动存储 → LLM 自动提取事实
   ← ADD/UPDATE/DELETE/NONE 冲突处理
   ← 落地：dragon-senate-saas-v2/memory_extractor.py
   ← 集成点：lobster_runner.py 任务完成后自动调用

2. MemoryPartition（三层分区）
   ← 租户/龙虾/会话 三级隔离
   ← 落地：dragon-senate-saas-v2/memory_partition.py
   ← 升级现有 enterprise_memory.py

3. GraphNamespace + TemporalGraphBuilder
   ← commander_graph_builder.py 升级为时序版本
   ← 旧关系自动 expire，新关系带时间戳
   ← 实体自动去重（不再重复创建节点）

4. EdgeMemoryCache
   ← 边缘节点执行前加载线索记忆
   ← marionette_executor.py 注入记忆上下文
   ← 落地：edge-runtime/memory_cache.py

5. LobsterProceduralMemory
   ← 龙虾自学的行为规律持久化
   ← 落地：dragon-senate-saas-v2/lobster_procedural_memory.py
```

---

## 逐层落地对照表

| 系统层 | mem0借鉴 | graphiti借鉴 |
|--------|---------|------------|
| **前端** | 记忆管理页（CRUD+历史）| 知识图谱可视化（Cytoscape.js）|
| **大脑层** | 自动事实提取 + ADD/UPDATE/DELETE/NONE | 时序图谱 add_episode() |
| **9龙虾** | 三层记忆分区（lobster_id=agent_id）| 实体去重 + 线索关系网络 |
| **L1.5微服务** | MemoryPartition 隔离 | GraphNamespace 命名空间 |
| **云边调度** | 按需同步（当前任务线索的记忆）| 增量图谱更新 |
| **边缘层** | EdgeMemoryCache 本地缓存 | — |

---

## 与其他已落地能力协同

```
mem0 自动提取事实
       ↓
MemoryConflictResolver（去重冲突）
       ↓
Qdrant 向量存储（CODEX_TASK_HYBRID_MEMORY_SEARCH 已落地）
       +
graphiti TemporalGraphBuilder
       ↓
Neo4j 时序图谱（实体关系网络）
       ↓
EdgeMemoryCache（推送到边缘）
       ↓
marionette_executor 执行时注入上下文
       ↓
龙虾生成高度个性化的跟进内容
```

---

## 独有优势（mem0/graphiti 没有的）

```
🦞 记忆直接驱动龙虾行为（mem0 只存储，不执行）
📱 记忆内容与中国 IM 渠道集成（微信/企微消息历史→自动提取）
💰 记忆提取成本记录到 llm_call_logger（每次提取费用可见）
🔒 记忆访问通过 rbac_permission.py 控制权限
📊 记忆命中率可接入 observability_api.py 监控
```

---

*更新于 2026-04-02*
