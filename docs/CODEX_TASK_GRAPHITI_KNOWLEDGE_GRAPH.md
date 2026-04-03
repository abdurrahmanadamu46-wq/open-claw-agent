# CODEX TASK: graphiti 借鉴 — 时序知识图谱 + 图谱命名空间 + P2 升级包

**优先级：P1（图谱核心）+ P2（可视化/混合搜索/社区摘要）**  
**来源：MEM0_GRAPHITI_BORROWING_ANALYSIS.md P1-3 + P1-6 + P2-1~5**  
**借鉴自**：https://github.com/getzep/graphiti（⭐24.4k）`graphiti_core/`

---

## 背景

当前 `commander_graph_builder.py` 存在两个核心缺陷：
1. **无时序**：图谱中的关系没有时间戳，无法区分"历史关系"和"现在关系"
2. **无命名空间隔离**：所有租户的知识图谱混在一起（数据安全风险）

graphiti 的设计：**带时间戳的三元组 + 命名空间隔离 + 实体自动去重**

---

## P1-3: 时序知识图谱升级（TemporalGraphBuilder）

### 升级 `dragon-senate-saas-v2/commander_graph_builder.py`

**核心数据结构（借鉴 graphiti edges.py 时序边设计）**：

```python
"""
时序知识图谱节点和边（借鉴 graphiti nodes.py + edges.py）

三元组带时间戳：(主体, 关系, 客体, valid_at, expired_at)
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import uuid


@dataclass
class GraphEntity:
    """知识图谱实体节点（借鉴 graphiti Entity 节点）"""
    entity_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""                  # "张总"
    entity_type: str = ""           # "person" | "company" | "product" | "channel"
    namespace: str = ""             # 命名空间（租户隔离）
    attributes: dict = field(default_factory=dict)  # 附加属性
    embedding: Optional[list] = None  # 向量（用于语义检索）
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class TemporalEdge:
    """
    时序边（借鉴 graphiti EntityEdge 设计）
    关键区别：每条边有 valid_at（生效时间）和 expired_at（过期时间）
    """
    edge_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    source_id: str = ""         # 主体实体 ID
    target_id: str = ""         # 客体实体 ID
    relation: str = ""          # 关系类型："推荐" | "同事" | "竞品" | "供应商"
    fact: str = ""              # 关系描述："张总推荐了李总联系我们"
    namespace: str = ""
    valid_at: datetime = field(default_factory=datetime.utcnow)      # 关系生效时间
    expired_at: Optional[datetime] = None                             # None=仍有效
    episode_id: str = ""        # 来源 episode ID（溯源）
    confidence: float = 1.0


@dataclass  
class Episode:
    """
    知识来源（借鉴 graphiti Episode 设计）
    每次"对话/事件"对应一个 Episode，从中提取实体和关系
    """
    episode_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""              # "followup_2026-04-02_张总"
    content: str = ""          # 原始文本
    source_type: str = ""      # "conversation" | "document" | "email" | "manual"
    reference_time: datetime = field(default_factory=datetime.utcnow)
    namespace: str = ""
    lead_id: Optional[str] = None
    lobster_id: Optional[str] = None


ENTITY_EXTRACTION_PROMPT = """
从以下文本中提取实体和它们之间的关系，用于构建知识图谱。

文本内容：
{content}

背景（参考时间：{reference_time}）：{context}

提取规则：
1. 实体类型：person（人）、company（公司）、product（产品/服务）、channel（渠道）
2. 关系应描述真实存在的联系（推荐/同事/竞品/供应商/合作/客户等）
3. 实体名称使用最常见/规范的称谓

输出 JSON：
{
  "entities": [
    {"name": "张总", "type": "person", "attributes": {"title": "CEO", "company": "ABC科技"}}
  ],
  "relations": [
    {"source": "张总", "target": "李总", "relation": "推荐", "fact": "张总推荐李总联系我们"}
  ]
}
"""


class TemporalGraphBuilder:
    """
    时序知识图谱构建器
    借鉴 graphiti graphiti.py add_episode() 的设计
    """

    def __init__(self, graph_store, llm_caller, embedder=None):
        """
        Args:
            graph_store: 图谱存储（Neo4j/内存实现）
            llm_caller: LLM 调用接口
            embedder: 向量化接口（用于语义检索）
        """
        self.store = graph_store
        self.llm = llm_caller
        self.embedder = embedder

    async def add_episode(
        self,
        name: str,
        content: str,
        source_type: str,
        reference_time: datetime,
        namespace: str,
        lead_id: Optional[str] = None,
        lobster_id: Optional[str] = None,
        context: str = "",
    ) -> Episode:
        """
        处理一段新内容（对话/文档），提取实体和关系写入时序图谱
        借鉴 graphiti.add_episode() 的增量处理方式
        """
        # 1. 创建 Episode 记录
        episode = Episode(
            name=name,
            content=content,
            source_type=source_type,
            reference_time=reference_time,
            namespace=namespace,
            lead_id=lead_id,
            lobster_id=lobster_id,
        )

        # 2. LLM 提取实体和关系
        entities_raw, relations_raw = await self._extract_entities_relations(
            content, reference_time, context
        )

        # 3. 实体去重（与现有图谱中的实体合并）
        entity_map = {}  # name → entity_id
        for ent in entities_raw:
            existing = await self.store.find_entity(
                name=ent["name"],
                entity_type=ent.get("type", ""),
                namespace=namespace,
            )
            if existing:
                # 已存在，更新属性
                entity_map[ent["name"]] = existing.entity_id
                await self.store.update_entity(existing.entity_id, ent.get("attributes", {}))
            else:
                # 新实体
                new_entity = GraphEntity(
                    name=ent["name"],
                    entity_type=ent.get("type", ""),
                    namespace=namespace,
                    attributes=ent.get("attributes", {}),
                )
                if self.embedder:
                    new_entity.embedding = await self.embedder(ent["name"])
                await self.store.save_entity(new_entity)
                entity_map[ent["name"]] = new_entity.entity_id

        # 4. 使旧关系过期，添加新时序边
        for rel in relations_raw:
            src_id = entity_map.get(rel["source"])
            tgt_id = entity_map.get(rel["target"])
            if not src_id or not tgt_id:
                continue

            # 使同方向旧关系过期（借鉴 graphiti 时序设计）
            await self.store.expire_edge(
                source_id=src_id,
                target_id=tgt_id,
                relation=rel["relation"],
                expired_at=reference_time,
            )

            # 添加新时序边
            edge = TemporalEdge(
                source_id=src_id,
                target_id=tgt_id,
                relation=rel["relation"],
                fact=rel.get("fact", ""),
                namespace=namespace,
                valid_at=reference_time,
                episode_id=episode.episode_id,
            )
            await self.store.save_edge(edge)

        await self.store.save_episode(episode)
        return episode

    async def search(
        self,
        query: str,
        namespace: str,
        reference_time: Optional[datetime] = None,
        num_results: int = 10,
    ) -> list[dict]:
        """
        混合搜索（BM25关键词 + 向量语义 + 图遍历）
        借鉴 graphiti search/ 的 hybrid search 设计
        """
        results = []

        # 向量搜索
        if self.embedder:
            query_vec = await self.embedder(query)
            vector_results = await self.store.vector_search(
                query_vec, namespace=namespace, limit=num_results
            )
            results.extend(vector_results)

        # 关键词搜索（BM25）
        keyword_results = await self.store.keyword_search(
            query, namespace=namespace, limit=num_results
        )
        results.extend(keyword_results)

        # 去重，按 reference_time 过滤有效边（只返回未过期的关系）
        if reference_time:
            results = [
                r for r in results
                if r.get("expired_at") is None or r["expired_at"] > reference_time
            ]

        return results[:num_results]

    async def get_entity_timeline(
        self, entity_name: str, namespace: str
    ) -> list[TemporalEdge]:
        """
        获取实体的关系时间线（历史全部版本）
        例：张总 历史职位：CEO(2024) → 顾问(2025)
        """
        entity = await self.store.find_entity(entity_name, namespace=namespace)
        if not entity:
            return []
        return await self.store.get_all_edges(entity.entity_id, namespace=namespace)

    async def _extract_entities_relations(
        self, content: str, reference_time: datetime, context: str
    ) -> tuple[list[dict], list[dict]]:
        """LLM 提取实体和关系"""
        import json
        prompt = ENTITY_EXTRACTION_PROMPT.format(
            content=content,
            reference_time=reference_time.strftime("%Y-%m-%d"),
            context=context or "无额外背景",
        )
        try:
            response = await self.llm(prompt)
            data = json.loads(response)
            return data.get("entities", []), data.get("relations", [])
        except Exception:
            return [], []
```

---

## P1-6: 图谱命名空间隔离

**集成到图谱存储接口（GraphNamespace）**：

```python
# dragon-senate-saas-v2/graph_namespace.py

class GraphNamespace:
    """
    图谱命名空间管理（借鉴 graphiti namespaces/）
    确保每个租户的知识图谱完全隔离
    """
    
    @staticmethod
    def tenant_ns(tenant_id: str) -> str:
        """租户级命名空间（所有线索共享）"""
        return f"ns:tenant:{tenant_id}"

    @staticmethod
    def lead_ns(tenant_id: str, lead_id: str) -> str:
        """线索级命名空间（该线索的专属图谱）"""
        return f"ns:tenant:{tenant_id}:lead:{lead_id}"

    @staticmethod
    def validate(namespace: str, tenant_id: str) -> bool:
        """验证命名空间属于该租户（防止越权访问）"""
        return namespace.startswith(f"ns:tenant:{tenant_id}")
```

---

## P2-1: 记忆管理 UI（前端）

**页面路径**：`/crm/leads/{lead_id}/memories`

**布局设计**：
```
┌─────────────────────────────────────────────┐
│ 🧠 线索记忆管理 — 张总（ABC科技）            │
│ 搜索记忆... [🔍] [+ 手动添加] [导出]        │
├─────────────────────────────────────────────┤
│ 基本信息                                     │
│ ○ 预算：50万以上               [编辑] [删除]  │
│ ○ 职位：CEO                    [编辑] [删除]  │
│                                              │
│ 偏好                                         │
│ ○ 偏好邮件沟通，不接受电话打扰  [编辑] [删除] │
│                                              │
│ 当前状态                                     │
│ ○ 已进入审批流程               [编辑] [删除]  │
│                                              │
│ 龙虾行为规律（仅管理员可见）                  │
│ ○ 对此类客户适合正式语气跟进   [编辑] [删除]  │
└─────────────────────────────────────────────┘
```

**API**：
```
GET  /api/v1/memory/{lead_id}?lobster_id=&category=    # 分类列表
POST /api/v1/memory                                     # 手动添加
PUT  /api/v1/memory/{id}                                # 编辑
DEL  /api/v1/memory/{id}                                # 删除
```

### 验收标准
- [ ] 按 category 分组展示记忆
- [ ] 支持手动 CRUD（人工纠错）
- [ ] 记忆来源标注（"自动提取 by followup · 2026-04-01"）
- [ ] 记忆修改历史（hover 显示原始内容）

---

## P2-2: 知识图谱可视化（前端）

**页面路径**：`/crm/graph`

**可视化方案**：基于 Cytoscape.js（轻量级）或 D3-force

**展示内容**：
```
                    [ABC科技]
                    /        \
               [张总]←─推荐─[李总]
               ↑                ↓
          [供应商A]          [客户B]

节点颜色：人(蓝) 公司(绿) 产品(橙) 渠道(紫)
边颜色：当前有效(实线) 历史已过期(虚线灰色)
时间轴：拖动查看"历史图谱状态"
```

**API**：
```
GET /api/v1/graph?namespace=&entity_id=&depth=2    # 获取图谱数据
GET /api/v1/graph/timeline/{entity_id}             # 实体关系时间线
POST /api/v1/graph/episode                         # 手动添加图谱内容
```

### 验收标准
- [ ] 实体节点渲染（按类型着色）
- [ ] 边渲染（有效/过期状态区分）
- [ ] 时间轴滑动（查看历史图谱状态）
- [ ] 点击节点展开关联实体

---

## P2-3: BM25+向量混合搜索（升级 enterprise_memory.py）

```python
# 升级 dragon-senate-saas-v2/enterprise_memory.py

class HybridMemorySearch:
    """混合记忆搜索（借鉴 graphiti search/ 的双通道设计）"""

    async def search(
        self,
        query: str,
        lead_id: str,
        lobster_id: str,
        top_k: int = 10,
        vector_weight: float = 0.7,
        bm25_weight: float = 0.3,
    ) -> list[dict]:
        """BM25关键词 + 向量语义 融合检索"""
        # 向量检索
        vector_results = await self._vector_search(query, lead_id, lobster_id, top_k)
        # BM25 关键词检索
        bm25_results = await self._bm25_search(query, lead_id, lobster_id, top_k)
        # RRF 融合排序（Reciprocal Rank Fusion）
        return self._rrf_merge(vector_results, bm25_results, vector_weight, bm25_weight)

    def _rrf_merge(self, vec_results, bm25_results, vec_w, bm25_w) -> list[dict]:
        """RRF 融合算法（无需归一化分数）"""
        k = 60  # RRF 常数
        scores: dict[str, float] = {}
        
        for rank, item in enumerate(vec_results):
            mid = item["id"]
            scores[mid] = scores.get(mid, 0) + vec_w * (1 / (k + rank + 1))
        
        for rank, item in enumerate(bm25_results):
            mid = item["id"]
            scores[mid] = scores.get(mid, 0) + bm25_w * (1 / (k + rank + 1))
        
        all_items = {item["id"]: item for item in vec_results + bm25_results}
        return sorted(all_items.values(), key=lambda x: scores.get(x["id"], 0), reverse=True)
```

---

## P2-4: 记忆时间线（前端组件）

**组件路径**：`/crm/leads/{lead_id}/timeline`

**展示**：
```
2026-04-02 followup-小催  ○──────────────────────────
  ADD: 客户预算更新为50万以上（原30万被替换）
  ADD: 客户进入审批流程

2026-03-28 echoer-阿声    ○──────────────────────────
  ADD: 客户偏好邮件沟通
  
2026-03-15 catcher-铁狗   ○──────────────────────────
  ADD: 客户预算30万
  ADD: 张总，ABC科技CEO
```

---

## P2-5: 社区摘要（CommunitySummarizer）

```python
# dragon-senate-saas-v2/community_summarizer.py
"""
社区摘要（借鉴 graphiti 社区聚合设计）
将密集关联的线索实体聚合成"圈子"，生成行业摘要
"""

COMMUNITY_SUMMARY_PROMPT = """
以下是一组相互关联的企业/人员实体及其关系：
{entities_and_relations}

请生成一段简洁的圈子摘要（100字以内），描述：
1. 这是什么类型的圈子（行业/地区/供应链等）
2. 核心关键人/企业
3. 潜在的商业机会

输出格式：{"summary": "...", "opportunity": "..."}
"""


class CommunitySummarizer:
    """圈子/社区摘要生成器"""

    async def summarize_cluster(
        self, entities: list[GraphEntity], edges: list[TemporalEdge], llm_caller
    ) -> dict:
        import json
        entities_text = "\n".join(f"{e.name}（{e.entity_type}）" for e in entities)
        relations_text = "\n".join(f"{e.fact}" for e in edges)
        prompt = COMMUNITY_SUMMARY_PROMPT.format(
            entities_and_relations=f"实体：\n{entities_text}\n\n关系：\n{relations_text}"
        )
        try:
            resp = await llm_caller(prompt)
            return json.loads(resp)
        except Exception:
            return {"summary": "圈子摘要生成失败", "opportunity": ""}
```

---

## 综合验收标准

### P1（时序图谱 + 命名空间）
- [ ] `TemporalGraphBuilder.add_episode()` 正确提取实体/关系并写入图谱
- [ ] 时序边：旧关系自动 `expire`，新关系 `valid_at` 正确
- [ ] 实体去重：同名实体自动合并（不重复创建节点）
- [ ] `GraphNamespace.validate()` 阻止跨租户访问
- [ ] `commander_graph_builder.py` 升级为使用 `TemporalGraphBuilder`
- [ ] 每次龙虾完成 episode 后自动调用 `add_episode()`

### P2（前端 + 混合搜索 + 社区摘要）
- [ ] 记忆管理页（CRUD + 历史版本）
- [ ] 知识图谱可视化（Cytoscape.js，时间轴）
- [ ] `HybridMemorySearch` RRF 融合检索，精度优于纯向量
- [ ] 记忆时间线（按龙虾+时间排序）
- [ ] `CommunitySummarizer` 生成圈子摘要（触发条件：同一图谱中出现≥5个相互关联实体）

---

*Codex Task | 来源：MEM0_GRAPHITI_BORROWING_ANALYSIS.md P1-3,6 + P2-1~5 | 2026-04-02*
