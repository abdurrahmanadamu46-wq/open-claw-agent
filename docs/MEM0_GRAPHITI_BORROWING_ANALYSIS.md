# mem0 + graphiti 联合借鉴分析报告

**来源项目A**：https://github.com/mem0ai/mem0（⭐51,697）  
**来源项目B**：https://github.com/getzep/graphiti（⭐24,412）  
**语言**：Python  
**定位**：
- mem0：AI Agent 通用记忆层（向量记忆 + 图记忆 + 程序性记忆）
- graphiti：实时知识图谱（时序性三元组 + Neo4j + 时间感知检索）  
**分析日期**：2026-04-02

---

## 一、两个项目架构速览

### mem0 架构
```
mem0/
├── memory/
│   ├── main.py          ← 核心记忆类（add/get/search/update/delete）
│   ├── graph_memory.py  ← 图谱记忆（Neo4j/Kuzu/Apache AGE/Memgraph）
│   ├── storage.py       ← SQLite 元数据存储（记忆历史/版本）
│   └── base.py          ← 抽象基类
├── vector_stores/       ← 27种向量库适配（Qdrant/Chroma/pgvector等）
├── embeddings/          ← 15种嵌入模型（OpenAI/Gemini/Ollama等）
├── llms/                ← 20+种 LLM 适配（OpenAI/Anthropic/DeepSeek等）
├── graphs/              ← 图谱工具（关系抽取/Neptune集成）
└── reranker/            ← 重排序器（提高召回精度）

核心能力：
  mem.add(messages, user_id)     → 提取事实，存入向量+图谱
  mem.search(query, user_id)     → 语义检索 + 知识图谱检索
  mem.get_all(user_id)           → 获取所有记忆
  mem.update(memory_id, data)    → 更新记忆（含冲突检测）
  mem.delete(memory_id)          → 删除
```

### graphiti 架构
```
graphiti_core/
├── graphiti.py          ← 核心入口（add_episode/search/get_entity等）
├── nodes.py             ← 节点模型（Entity/Community）
├── edges.py             ← 边模型（Relation/Episode/EntityEdge）
├── search/
│   ├── search.py        ← 搜索引擎（混合搜索：向量+BM25+图遍历）
│   ├── search_config.py ← 搜索配置（权重/过滤器）
│   └── search_config_recipes.py  ← 搜索配方（预设配置）
├── llm_client/          ← LLM 客户端（OpenAI/Anthropic/Gemini/Groq）
├── prompts/             ← 各类提取 Prompt（实体/关系/社区摘要）
├── namespaces/          ← 命名空间（多租户隔离）
└── driver/              ← Neo4j 驱动封装

核心能力：
  graphiti.add_episode(name, content, source_desc, reference_time)
             → LLM 提取实体和关系 → 写入 Neo4j 时序图谱
  graphiti.search(query, num_results)
             → BM25+向量+图遍历混合搜索
  graphiti.get_entity_edge(...)  → 查询两实体间的关系历史
```

---

## 二、已落地声明（跳过）

| 功能 | 我们已落地文件 |
|------|-------------|
| 企业记忆存储 | `enterprise_memory.py`（已落地）|
| 向量语义搜索 | `CODEX_TASK_HYBRID_MEMORY_SEARCH.md`（已落地）|
| 向量快照备份 | `CODEX_TASK_VECTOR_SNAPSHOT_BACKUP.md`（已落地）|
| Commander 图谱构建 | `commander_graph_builder.py`（已落地）|
| 租户记忆同步 | `tenant_memory_sync.py`（已落地）|

---

## 三、逐层对比分析

### 🌐 前端 SaaS 控制台

| 来源能力 | 我们现状 | 差距/价值 |
|---------|---------|---------|
| **mem0 记忆浏览器**（所有 memories 列表/搜索/删除）| 无记忆可视化 | ✅ **P1高价值** — 客户记忆管理页（查看/删除/修改龙虾对客户的记忆）|
| **graphiti 知识图谱可视化**（实体-关系-时间线展示）| 无图谱可视化 | ✅ **P1高价值** — 客户关系网络图（线索A认识线索B，A推荐过C）|
| **记忆时间线**（mem0 memory history，每条记忆的修改历史）| 无 | ✅ **P2价值** — 跟进历史时间线（龙虾记住了什么/什么时候更新的）|
| **搜索测试面板**（mem0 `search` API 调试）| 无 | ✅ **P2价值** — 记忆搜索测试（输入 query → 预览龙虾会检索到什么上下文）|

### 🧠 云端大脑层（Commander）

| 来源能力 | 我们现状 | 差距/价值 |
|---------|---------|---------|
| **mem0 自动事实提取**（LLM 自动从对话提取结构化事实，存入向量库）| `enterprise_memory.py` 手动存储 | ✅ **P1最高价值** — **自动记忆提取**：龙虾对话结束后自动提取关键事实存储 |
| **mem0 记忆冲突检测+更新**（新事实与旧记忆冲突时自动处理：ADD/UPDATE/DELETE/NONE）| 无冲突检测 | ✅ **P1高价值** — 记忆自动去重更新（不会记两条矛盾的信息）|
| **graphiti 时序图谱**（每条关系都带时间戳，支持"历史关系"查询）| `commander_graph_builder.py` 无时序 | ✅ **P1高价值** — 时序客户图谱（"3个月前"的线索关系 vs 现在的）|
| **mem0 程序性记忆**（PROCEDURAL_MEMORY — 龙虾的行为偏好/习惯）| 无 | ✅ **P1高价值** — 龙虾偏好记忆（"我偏好用正式语气跟进此类客户"）|
| **graphiti 社区摘要**（将密集关联的实体自动聚合成社区，生成摘要）| 无 | ✅ **P2价值** — 行业圈子摘要（同一个企业生态圈的线索自动聚合）|

### 🦞 9个龙虾层

| 来源能力 | 对应龙虾 | 借鉴价值 |
|---------|---------|---------|
| **mem0 `user_id` 分区记忆**（每个用户独立记忆空间）| 所有龙虾 | ✅ **P1最高** — 每只龙虾有独立记忆空间（`lobster_id` 作为 `agent_id`）|
| **mem0 `run_id` 会话记忆**（同一次对话内的短期记忆）| echoer/followup | ✅ **P1高** — 跟进会话内短期记忆（echoer 记住本次对话说了什么）|
| **graphiti 实体去重**（同一个实体多次提到时自动合并，不重复创建节点）| radar（捕手雷达）| ✅ **P1高** — 线索实体自动去重（"张总"和"张经理"可能是同一人）|
| **mem0 reranker**（对检索结果用 cross-encoder 重新排序，提高精度）| strategist（谋士）| ✅ **P2价值** — 记忆检索精度提升（相关度排序更准确）|
| **graphiti BM25+向量混合搜索**（关键词+语义双通道）| 所有需要检索的虾 | ✅ **P2价值** — 更好的记忆检索（关键词检索补充向量检索的盲点）|

### 🏗️ L1.5 支撑微服务集群

| 来源能力 | 我们现状 | 差距/价值 |
|---------|---------|---------|
| **mem0 多租户隔离**（`user_id`/`agent_id`/`run_id` 三层分区）| `tenant_memory_sync.py` 有基础 | ✅ **P1高价值** — 三层记忆分区（租户级/龙虾级/会话级完整隔离）|
| **mem0 27种向量库适配**（Qdrant/pgvector/Chroma/Milvus等一键切换）| Qdrant（已落地）| ⭕ 已落地（我们的 Qdrant 集成更垂直）|
| **graphiti 命名空间**（`namespaces/` — 多租户图谱隔离）| commander_graph_builder 无隔离 | ✅ **P1高价值** — 图谱租户隔离（每个租户的知识图谱完全独立）|
| **mem0 SQLite 记忆元数据**（记忆创建时间/修改历史/hash去重）| 无记忆元数据管理 | ✅ **P2价值** — 记忆元数据（什么时候记住的，被更新了几次）|
| **graphiti OTEL 追踪**（OpenTelemetry 追踪图谱操作）| `CODEX_TASK_DISTRIBUTED_TRACING.md` 已落地 | ⭕ 已落地 |

### 🛰️ 云边调度层

| 来源能力 | 我们现状 | 差距/价值 |
|---------|---------|---------|
| **记忆选择性同步**（mem0 按 user_id 同步指定记忆到边缘）| `tenant_memory_sync.py` 全量同步 | ✅ **P2价值** — 按需同步（只把"正在服务的线索"的记忆推送到边缘）|
| **graphiti 增量图谱更新**（add_episode 是增量的，不重建整个图谱）| 批量重建 | ✅ **P2价值** — 增量图谱推送（新事实 → 只更新变化的节点/边）|

### 🖥️ 边缘执行层

| 来源能力 | 我们现状 | 差距/价值 |
|---------|---------|---------|
| **本地记忆缓存**（边缘节点缓存当前任务线索的记忆）| 无边缘记忆 | ✅ **P1高价值** — 边缘记忆缓存：marionette_executor 执行前加载线索记忆上下文 |
| **离线记忆追加**（断网时本地记录，联网后同步）| 无离线记忆 | ✅ **P2价值** — 边缘离线记忆暂存（断网时操作记录缓存，恢复后同步）|

---

## 四、核心架构对比

### mem0 记忆更新流程（最有价值的设计）

```
龙虾完成一次跟进对话 → add_memory(messages)
         ↓
    LLM 提取事实：["客户对产品A感兴趣", "客户预算50万以上"]
         ↓
    与现有记忆对比：
      - "客户预算30万" → UPDATE（旧记忆过时了）
      - "客户对产品A感兴趣" → ADD（新增）
      - 无冲突记忆 → NONE
         ↓
    向量存储 + 图谱节点更新
         ↓
    下次跟进：search("客户预算") → 返回最新的"预算50万以上"
```

### graphiti 时序三元组设计

```
三元组：(主体, 关系, 客体, 时间戳)

例子：
  ("张总", "担任", "CEO", 2024-01-01) → 有效期至 2025-06-01
  ("张总", "担任", "顾问", 2025-06-01) → 当前有效

查询：
  "张总现在是什么职位？" → 返回最新有效边："顾问"
  "张总历史职位？" → 返回全部时序边
```

---

## 五、优先级汇总

### 🔴 P1（新增，高价值）

| # | 功能 | 来源 | 落地路径 |
|---|------|------|---------|
| P1-1 | **自动事实提取**（对话→结构化记忆）| mem0 `memory/main.py` | `dragon-senate-saas-v2/memory_extractor.py` |
| P1-2 | **记忆冲突检测+更新**（ADD/UPDATE/DELETE/NONE）| mem0 冲突处理逻辑 | `dragon-senate-saas-v2/memory_conflict_resolver.py` |
| P1-3 | **时序知识图谱**（带时间戳的实体-关系三元组）| graphiti `graphiti.py` + `edges.py` | 升级 `commander_graph_builder.py` |
| P1-4 | **程序性记忆**（龙虾行为偏好/习惯记忆）| mem0 PROCEDURAL_MEMORY | `dragon-senate-saas-v2/lobster_procedural_memory.py` |
| P1-5 | **三层记忆分区**（租户/龙虾/会话三级隔离）| mem0 user_id+agent_id+run_id | `dragon-senate-saas-v2/memory_partition.py` |
| P1-6 | **图谱租户隔离**（namespaces）| graphiti namespaces | 升级 `commander_graph_builder.py` |
| P1-7 | **边缘记忆缓存**（执行前加载线索记忆）| mem0 client + local cache | `edge-runtime/memory_cache.py` |

### 🟡 P2

| # | 功能 | 来源 | 落地路径 |
|---|------|------|---------|
| P2-1 | **记忆管理 UI**（列表/搜索/删除）| mem0 API | 前端 `/crm/memories` |
| P2-2 | **知识图谱可视化**（实体-关系网络图）| graphiti + D3.js/Cytoscape | 前端 `/crm/graph` |
| P2-3 | **BM25+向量混合搜索** | graphiti search/ | 升级 `enterprise_memory.py` |
| P2-4 | **记忆时间线** | mem0 memory history | 前端 `跟进历史` 组件 |
| P2-5 | **社区摘要**（实体聚合）| graphiti community | `dragon-senate-saas-v2/community_summarizer.py` |

---

## 六、与我们项目的互补性

```
mem0（记忆层）         graphiti（图谱层）         我们（营销执行层）
──────────────         ─────────────────          ─────────────────
对话事实提取  →   实体关系三元组存储  →   龙虾跟进时调用记忆
记忆更新冲突  →   时序历史完整保留  →   生成个性化内容
向量语义检索  →   图谱关系推理      →   边缘执行时检索上下文

三者合力实现：
  "龙虾记得客户说过的每一句重要的话（mem0），
   知道客户在公司生态里的位置（graphiti），
   在跟进时能做出最个性化的回应（我们的执行层）"
```

---

*来源：mem0（⭐51.7k）+ graphiti（⭐24.4k）| 分析日期：2026-04-02*
