# CODEX TASK：Stanford STORM P1 任务

**来源分析**：STORM_BORROWING_ANALYSIS.md  
**优先级**：P1（4个任务，核心业务价值）  
**日期**：2026-04-02

---

## P1-1：客户 Mind Map（知识地图）

**借鉴自**：Co-STORM MindMap 机制  
**核心价值**：追踪每个线索的"已知/未知"信息，避免龙虾重复问相同问题，让分析有方向  
**落地文件**：`dragon-senate-saas-v2/customer_mind_map.py`（新建）

### 数据结构设计

```python
# dragon-senate-saas-v2/customer_mind_map.py
"""
客户知识地图（借鉴 Co-STORM MindMap）

每个线索对应一棵知识树，记录：
  - 已知信息（explored=True）
  - 未知但重要的信息（explored=False）
  - 信息来源和置信度
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from enum import Enum
import json

class ExploreStatus(str, Enum):
    UNEXPLORED = "unexplored"   # 还未了解
    PARTIAL = "partial"          # 部分了解
    EXPLORED = "explored"        # 已充分了解

@dataclass
class MindMapNode:
    """知识节点"""
    node_id: str
    dimension: str           # 维度名称（如 pain_points / budget / timeline）
    label_cn: str            # 中文标签
    status: ExploreStatus = ExploreStatus.UNEXPLORED
    known_facts: List[str] = field(default_factory=list)    # 已知事实
    open_questions: List[str] = field(default_factory=list) # 待探索问题
    sources: List[str] = field(default_factory=list)        # 信息来源（龙虾名/渠道）
    confidence: float = 0.0  # 置信度 0.0-1.0
    last_updated: Optional[str] = None

# 客户知识地图的标准维度（销售专用）
STANDARD_DIMENSIONS = {
    "basic_info": MindMapNode(
        node_id="basic_info",
        dimension="basic_info",
        label_cn="基本信息",
        open_questions=["公司规模？", "所在行业？", "主营业务？", "成立时间？"]
    ),
    "pain_points": MindMapNode(
        node_id="pain_points",
        dimension="pain_points", 
        label_cn="痛点需求",
        open_questions=["当前最大痛点？", "为什么现在解决？", "已尝试的解决方案？"]
    ),
    "budget": MindMapNode(
        node_id="budget",
        dimension="budget",
        label_cn="预算情况",
        open_questions=["年度预算规模？", "谁审批采购？", "采购周期？", "付款方式偏好？"]
    ),
    "decision_process": MindMapNode(
        node_id="decision_process",
        dimension="decision_process",
        label_cn="决策流程",
        open_questions=["谁是最终决策人？", "还有哪些评估人？", "决策时间线？", "评估标准？"]
    ),
    "competitor": MindMapNode(
        node_id="competitor",
        dimension="competitor",
        label_cn="竞品情况",
        open_questions=["是否已在使用竞品？", "竞品名称？", "对竞品的不满？", "迁移门槛？"]
    ),
    "timeline": MindMapNode(
        node_id="timeline",
        dimension="timeline",
        label_cn="时机窗口",
        open_questions=["期望上线时间？", "为什么是现在而非以后？", "触发采购的事件？"]
    ),
    "risk": MindMapNode(
        node_id="risk",
        dimension="risk",
        label_cn="风险信号",
        open_questions=["是否有抵触信号？", "合同障碍？", "内部阻力？"]
    ),
}

class CustomerMindMap:
    """
    客户知识地图
    
    使用场景：
    1. 苏思分析时，读取 unexplored nodes → 生成有针对性的问题
    2. 老健分配任务时，优先分配"未探索维度"的调研任务
    3. 墨小雅/阿声发消息时，针对空白节点设计探索性问题
    4. 前端展示：客户画像完整度百分比
    """
    
    def __init__(self, lead_id: str, tenant_id: str):
        self.lead_id = lead_id
        self.tenant_id = tenant_id
        # 深拷贝标准维度（每个客户独立）
        import copy
        self.nodes: Dict[str, MindMapNode] = copy.deepcopy(STANDARD_DIMENSIONS)
        self.human_injections: List[dict] = []  # 运营人员插话记录
    
    def update_node(
        self, 
        dimension: str, 
        new_facts: List[str],
        answered_questions: List[str],
        source: str,
        confidence: float = 0.8
    ) -> MindMapNode:
        """
        更新某个维度的信息（龙虾执行后调用）
        """
        if dimension not in self.nodes:
            return None
        
        node = self.nodes[dimension]
        node.known_facts.extend(new_facts)
        
        # 移除已回答的问题
        node.open_questions = [
            q for q in node.open_questions 
            if q not in answered_questions
        ]
        
        node.sources.append(source)
        node.confidence = max(node.confidence, confidence)
        
        # 更新状态
        if len(node.open_questions) == 0:
            node.status = ExploreStatus.EXPLORED
        elif len(node.known_facts) > 0:
            node.status = ExploreStatus.PARTIAL
        
        from datetime import datetime
        node.last_updated = datetime.now().isoformat()
        return node
    
    def get_unexplored_dimensions(self) -> List[MindMapNode]:
        """
        返回还未探索的维度（老健分配任务的依据）
        优先级：UNEXPLORED > PARTIAL
        """
        unexplored = [n for n in self.nodes.values() if n.status == ExploreStatus.UNEXPLORED]
        partial = [n for n in self.nodes.values() if n.status == ExploreStatus.PARTIAL]
        return unexplored + partial
    
    def get_next_questions_for_lobster(self, max_questions: int = 3) -> List[str]:
        """
        为下一次龙虾执行生成"最应该问的问题"
        优先从最重要的未探索维度提取
        """
        priority_order = ["budget", "decision_process", "pain_points", "competitor", "timeline", "risk", "basic_info"]
        questions = []
        
        for dim in priority_order:
            if dim in self.nodes and self.nodes[dim].open_questions:
                questions.extend(self.nodes[dim].open_questions[:2])
                if len(questions) >= max_questions:
                    break
        
        return questions[:max_questions]
    
    def get_exploration_progress(self) -> dict:
        """
        返回客户画像完整度（用于前端展示）
        """
        total = len(self.nodes)
        explored = sum(1 for n in self.nodes.values() if n.status == ExploreStatus.EXPLORED)
        partial = sum(1 for n in self.nodes.values() if n.status == ExploreStatus.PARTIAL)
        
        return {
            "total_dimensions": total,
            "explored": explored,
            "partial": partial,
            "unexplored": total - explored - partial,
            "completion_pct": round((explored + partial * 0.5) / total * 100, 1),
            "dimensions": {
                dim: {
                    "status": node.status,
                    "label": node.label_cn,
                    "known_count": len(node.known_facts),
                    "open_questions": len(node.open_questions)
                }
                for dim, node in self.nodes.items()
            }
        }
    
    def inject_human_context(self, content: str, injected_by: str) -> None:
        """
        运营人员插话（借鉴 Co-STORM Human Intervention）
        """
        from datetime import datetime
        injection = {
            "content": content,
            "injected_by": injected_by,
            "timestamp": datetime.now().isoformat()
        }
        self.human_injections.append(injection)
        
        # TODO: 解析内容，更新相关节点（可用 LLM 解析）
    
    def to_susi_briefing(self) -> str:
        """
        生成给苏思的分析简报（列出已知+待探索）
        """
        lines = ["# 客户知识地图简报\n"]
        
        for dim, node in self.nodes.items():
            status_emoji = {"unexplored": "❓", "partial": "🔄", "explored": "✅"}[node.status]
            lines.append(f"\n## {status_emoji} {node.label_cn}")
            
            if node.known_facts:
                lines.append("**已知：**")
                for fact in node.known_facts:
                    lines.append(f"- {fact}")
            
            if node.open_questions:
                lines.append("**待探索：**")
                for q in node.open_questions:
                    lines.append(f"- {q}")
        
        if self.human_injections:
            lines.append("\n## 👤 运营补充信息")
            for inj in self.human_injections:
                lines.append(f"- [{inj['injected_by']}] {inj['content']}")
        
        return "\n".join(lines)
    
    def to_dict(self) -> dict:
        """序列化为字典（存入 Redis/数据库）"""
        return {
            "lead_id": self.lead_id,
            "tenant_id": self.tenant_id,
            "nodes": {
                dim: {
                    "status": node.status,
                    "known_facts": node.known_facts,
                    "open_questions": node.open_questions,
                    "sources": node.sources,
                    "confidence": node.confidence,
                    "last_updated": node.last_updated
                }
                for dim, node in self.nodes.items()
            },
            "human_injections": self.human_injections
        }
```

---

## P1-2：苏思多视角客户分析

**借鉴自**：STORM Perspective-Guided QA  
**核心价值**：从4个视角全面分析客户，而非目前的单一框架，提升分析深度  
**落地文件**：升级 `docs/lobster-kb/strategist-susi-kb.md`

### 苏思 KB 新增片段

```markdown
## 多视角分析框架（STORM 借鉴）

对每个线索，苏思必须从以下4个视角独立分析，然后综合输出：

### 视角1：销售机会角度
分析问题：
  - 这个线索处于漏斗的哪个阶段？（认知/考虑/决策）
  - 有哪些明确的购买信号？
  - 痛点是否足够尖锐（1-10分评分）？
  - 推荐的下一步行动是什么？

### 视角2：竞品威胁角度
分析问题：
  - 线索是否已在使用竞品？（已知/未知/可能）
  - 我们相比竞品的核心优势是什么？（针对该线索）
  - 迁移成本对客户的影响有多大？
  - 应该如何定位我们的解决方案？

### 视角3：时机窗口角度
分析问题：
  - 为什么这个线索"现在"会考虑采购？（触发事件）
  - 决策时间线是什么？（急迫/不急迫）
  - 是否有"窗口关闭"的风险（预算周期结束、组织架构变动等）？
  - 最佳跟进节奏是什么？

### 视角4：风险信号角度
分析问题：
  - 有哪些抵触/冷淡的信号？
  - 决策链上是否有反对者？
  - 合同/法务风险点？
  - 流失风险（如果不跟进，会失去这个线索的概率）？

### 输出格式（四视角综合报告）

```
[多视角分析报告 - {客户名称}]

📊 销售机会评分：{1-10分} / {阶段}
💡 核心购买信号：{最关键的1-2个信号}
⚔️ 竞品态势：{已知竞品} / {我们的优势}
⏰ 时机判断：{急迫程度} / {推荐跟进频率}
⚠️ 风险提示：{最大风险1-2项}

推荐行动：{具体下一步}
未探索项：{还需要了解的关键信息}
```
```

---

## P1-3：运营人员插话 API

**借鉴自**：Co-STORM Human User 随时介入机制  
**核心价值**：运营人员可实时注入上下文，龙虾任务立即感知并调整，避免"信息孤岛"  
**落地文件**：`dragon-senate-saas-v2/lobster_inject_context_api.py`（新建）

### API 实现规格

```python
# dragon-senate-saas-v2/lobster_inject_context_api.py
"""
运营人员插话 API（借鉴 Co-STORM Human Intervention）

使用场景：
  - 客户刚说了关键信息（如"下个季度有预算"）
  - 运营发现线索的最新动态（如"该公司刚完成A轮融资"）
  - 需要立即修正龙虾的执行方向
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime

router = APIRouter(prefix="/api/lobster", tags=["inject"])

class ContextInjectionRequest(BaseModel):
    lead_id: str
    tenant_id: str
    injected_by: str             # 运营人员 ID
    content: str                  # 插话内容（自然语言）
    priority: Literal["high", "medium", "low"] = "medium"
    target_lobsters: Optional[list[str]] = None  # 指定通知哪些龙虾，None=全部

class ContextInjectionResponse(BaseModel):
    injection_id: str
    status: str
    notified_lobsters: list[str]
    mind_map_updated: bool

@router.post("/inject-context", response_model=ContextInjectionResponse)
async def inject_context(req: ContextInjectionRequest):
    """
    运营人员插话接口
    
    效果：
    1. 更新 customer_mind_map（解析插话内容，填充相关节点）
    2. 通过 lobster_mailbox 通知相关龙虾
    3. 如果有正在执行的任务，发送"上下文更新"信号
    4. 记录到 audit_logger（谁在何时说了什么）
    """
    injection_id = "inj_{}".format(datetime.now().strftime("%Y%m%d%H%M%S"))
    
    # 1. 更新 Mind Map
    mind_map = await get_customer_mind_map(req.lead_id, req.tenant_id)
    mind_map.inject_human_context(req.content, req.injected_by)
    await save_customer_mind_map(mind_map)
    
    # 2. 用 LLM 解析插话内容，提取结构化信息
    parsed = await parse_injection_content(req.content)
    # 例如：{"dimension": "budget", "fact": "下季度有30万预算", "answered_questions": ["年度预算规模？"]}
    if parsed.get("dimension"):
        mind_map.update_node(
            dimension=parsed["dimension"],
            new_facts=[parsed.get("fact", req.content)],
            answered_questions=parsed.get("answered_questions", []),
            source=f"human:{req.injected_by}",
            confidence=0.95  # 人类直接说的，置信度最高
        )
    
    # 3. 决定通知哪些龙虾
    target = req.target_lobsters or ["dispatcher-laojian", "strategist-susi"]
    
    # 4. 通过 mailbox 通知龙虾
    mailbox = get_lobster_mailbox()
    for lobster_id in target:
        await mailbox.send(lobster_id, {
            "type": "human_context_injection",
            "injection_id": injection_id,
            "lead_id": req.lead_id,
            "content": req.content,
            "priority": req.priority,
            "injected_by": req.injected_by,
            "instruction": "运营人员刚补充了重要信息，请在当前任务中考虑此上下文"
        })
    
    # 5. 审计日志
    await audit_log(
        event_type="human_context_injection",
        actor=req.injected_by,
        lead_id=req.lead_id,
        content=req.content,
        injection_id=injection_id
    )
    
    return ContextInjectionResponse(
        injection_id=injection_id,
        status="delivered",
        notified_lobsters=target,
        mind_map_updated=True
    )

async def parse_injection_content(content: str) -> dict:
    """
    用 LLM 解析运营插话，提取结构化信息
    （使用便宜的 gpt-4o-mini，~0.2s）
    """
    # 简化版：关键词匹配（可升级为 LLM 解析）
    dimension_keywords = {
        "budget": ["预算", "万", "费用", "价格", "报价"],
        "decision_process": ["决策", "采购", "审批", "负责人", "老板"],
        "timeline": ["季度", "年底", "月份", "急", "时间"],
        "competitor": ["竞品", "在用", "已有", "方案"],
        "pain_points": ["问题", "痛点", "困难", "需求"],
    }
    
    for dim, keywords in dimension_keywords.items():
        if any(kw in content for kw in keywords):
            return {"dimension": dim, "fact": content}
    
    return {}
```

---

## P1-4：雷达并发多路搜索

**借鉴自**：STORM Concurrent Retrieval（多个问题同时发出搜索）  
**核心价值**：雷达从串行搜索升级为并发搜索，调研速度提升 3x  
**落地文件**：升级 `docs/lobster-kb/radar-lintao-kb.md` + 雷达搜索执行模块

### 并发搜索实现规格

```python
# 新增到 dragon-senate-saas-v2/ 的 radar_concurrent_search.py

import asyncio
from dataclasses import dataclass
from typing import List, Optional
from datetime import datetime

@dataclass
class SearchTask:
    query: str
    dimension: str       # 对应 customer_mind_map 的维度
    rationale: str       # 为什么要搜索这个（Cursor 的 rationale 思想）
    priority: int = 1

@dataclass  
class SearchResult:
    query: str
    dimension: str
    results: List[dict]
    elapsed_ms: int
    source: str          # 使用的搜索引擎

async def concurrent_search(
    tasks: List[SearchTask],
    search_engine: str = "bing",
    max_concurrent: int = 5,
    timeout_seconds: int = 10
) -> List[SearchResult]:
    """
    并发多路搜索（STORM 借鉴）
    
    对比：
    旧版：每个搜索串行执行，3个搜索 = 3 * 2s = 6s
    新版：3个搜索并发执行，3个搜索 = 2s（最慢的那个）
    """
    
    async def search_one(task: SearchTask) -> SearchResult:
        start = datetime.now()
        try:
            results = await call_search_api(task.query, search_engine)
            elapsed = int((datetime.now() - start).total_seconds() * 1000)
            return SearchResult(
                query=task.query,
                dimension=task.dimension,
                results=results,
                elapsed_ms=elapsed,
                source=search_engine
            )
        except asyncio.TimeoutError:
            return SearchResult(
                query=task.query,
                dimension=task.dimension,
                results=[],
                elapsed_ms=timeout_seconds * 1000,
                source=search_engine
            )
    
    # 并发执行，限制最大并发数
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def bounded_search(task: SearchTask) -> SearchResult:
        async with semaphore:
            return await asyncio.wait_for(search_one(task), timeout=timeout_seconds)
    
    results = await asyncio.gather(
        *[bounded_search(task) for task in tasks],
        return_exceptions=True
    )
    
    # 过滤异常结果
    return [r for r in results if isinstance(r, SearchResult)]


def generate_search_tasks_from_mind_map(mind_map, max_tasks: int = 5) -> List[SearchTask]:
    """
    根据客户 Mind Map 的未探索节点，生成搜索任务
    （这是 STORM Perspective-Guided QA 的核心思想）
    """
    tasks = []
    unexplored = mind_map.get_unexplored_dimensions()
    
    for node in unexplored[:max_tasks]:
        if node.open_questions:
            # 将"待探索问题"转化为搜索查询
            question = node.open_questions[0]
            company = mind_map.nodes.get("basic_info", {})
            
            tasks.append(SearchTask(
                query=question,  # 或者加上公司名：f"{company_name} {question}"
                dimension=node.dimension,
                rationale=f"探索客户的{node.label_cn}，当前未知",
                priority=1
            ))
    
    return tasks
```

### 雷达 KB 新增执行规范

```markdown
## 并发搜索规范（新增）

雷达在执行调研任务时，应遵循以下流程：

1. **读取客户 Mind Map**：了解"已知"和"未知"维度
2. **生成搜索任务列表**：针对每个未探索维度生成 1-2 个搜索查询
3. **并发执行所有搜索**（不得串行等待每个结果）
4. **汇总结果**：将搜索结果按维度归类，更新 Mind Map

```
[雷达并发搜索示例]
并发搜索 5 个维度：
  [T1] "xxx科技 销售团队规模" → 探索 basic_info
  [T2] "xxx科技 是否使用CRM" → 探索 competitor
  [T3] "xxx科技 近期融资" → 探索 timeline
  [T4] "xxx科技 HR部门" → 探索 decision_process
  [T5] "xxx科技 销售痛点" → 探索 pain_points
  ↓（并发执行，共耗时 2s）
  [结果汇总] → 更新 Mind Map 各维度
```
```

---

*Stanford STORM P1 任务 | 2026-04-02*
