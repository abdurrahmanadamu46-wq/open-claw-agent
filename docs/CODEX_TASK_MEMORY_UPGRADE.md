# CODEX TASK: mem0 借鉴 — 自动记忆提取 + 冲突检测 + 三层分区 + 边缘缓存

**优先级：P1**  
**来源：MEM0_GRAPHITI_BORROWING_ANALYSIS.md P1-1 + P1-2 + P1-4 + P1-5 + P1-7**  
**借鉴自**：https://github.com/mem0ai/mem0（⭐51.7k）`memory/main.py`

---

## 背景

当前问题：龙虾的记忆是**手动存储**的——需要代码显式调用 `enterprise_memory.save()`，没有自动提取，没有冲突检测，新信息会和旧信息并存造成矛盾。

```python
# 现在 enterprise_memory.py 的问题：
memory.save("客户预算30万")  # 手动写入
# 后来又手动写入：
memory.save("客户预算50万以上")  # 两条矛盾记忆并存！
# 龙虾下次检索时不知道用哪条
```

mem0 的解法：**LLM 自动提取事实 + 与现有记忆对比 + 自动 ADD/UPDATE/DELETE**

---

## A. 自动记忆提取器（MemoryExtractor）

### `dragon-senate-saas-v2/memory_extractor.py`

```python
from __future__ import annotations
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum


class MemoryAction(str, Enum):
    ADD = "ADD"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    NONE = "NONE"


@dataclass
class ExtractedFact:
    """从对话中提取的单条事实"""
    fact: str               # "客户预算50万以上"
    category: str           # "preference" | "info" | "status" | "goal"
    confidence: float = 1.0


@dataclass
class MemoryDecision:
    """记忆操作决策（借鉴 mem0 ADD/UPDATE/DELETE/NONE 机制）"""
    action: MemoryAction
    fact: str
    existing_memory_id: Optional[str] = None  # UPDATE/DELETE 时填写
    reason: str = ""


FACT_EXTRACTION_PROMPT = """
你是一个专业的信息提取助手。从以下对话中提取关键事实，这些事实将被存储为AI龙虾的长期记忆。

对话内容：
{messages}

提取规则：
1. 只提取客观事实（客户信息/偏好/状态/需求/决策）
2. 不提取系统指令、模板内容、礼貌用语
3. 每条事实简洁（30字以内）
4. 分类：info（基本信息）/ preference（偏好）/ status（状态）/ goal（目标）/ pain（痛点）

输出 JSON 格式：
{
  "facts": [
    {"fact": "...", "category": "...", "confidence": 0.9},
    ...
  ]
}
"""

CONFLICT_DETECTION_PROMPT = """
你是记忆管理助手。判断新事实与现有记忆的关系。

新事实：{new_fact}

现有记忆：
{existing_memories}

对每条现有记忆，判断：
- ADD：新事实是全新信息，与现有记忆无关
- UPDATE：新事实更新了某条现有记忆（现有记忆过时了）
- DELETE：新事实说明某条现有记忆已不再有效
- NONE：新事实与某条现有记忆重复，无需操作

输出 JSON：
{
  "decisions": [
    {"action": "ADD|UPDATE|DELETE|NONE", "existing_memory_id": null或ID, "reason": "..."}
  ]
}
"""


class MemoryExtractor:
    """
    自动记忆提取器（借鉴 mem0 memory/main.py 的自动提取机制）
    
    工作流：
      1. 龙虾完成一次对话/任务
      2. 调用 extract_and_merge(messages, lead_id, lobster_id)
      3. LLM 自动提取事实
      4. 与现有记忆对比，决定 ADD/UPDATE/DELETE/NONE
      5. 执行操作，更新记忆库
    """

    def __init__(self, llm_caller, memory_store):
        """
        Args:
            llm_caller: LLM 调用函数 (prompt) → str
            memory_store: 记忆存储接口（需有 get_all/add/update/delete 方法）
        """
        self.llm = llm_caller
        self.store = memory_store

    async def extract_and_merge(
        self,
        messages: list[dict],
        lead_id: str,
        lobster_id: str,
        run_id: Optional[str] = None,
    ) -> dict:
        """
        主入口：提取事实并与现有记忆合并

        Returns:
            {"added": [...], "updated": [...], "deleted": [...], "skipped": [...]}
        """
        # 1. 提取事实
        facts = await self._extract_facts(messages)
        if not facts:
            return {"added": [], "updated": [], "deleted": [], "skipped": []}

        # 2. 获取现有记忆
        existing = await self.store.get_all(lead_id=lead_id, lobster_id=lobster_id)

        # 3. 对每个事实做冲突检测
        result = {"added": [], "updated": [], "deleted": [], "skipped": []}
        
        for fact_obj in facts:
            decisions = await self._detect_conflicts(fact_obj.fact, existing)
            await self._execute_decisions(
                fact_obj, decisions, lead_id, lobster_id, run_id, result
            )

        return result

    async def _extract_facts(self, messages: list[dict]) -> list[ExtractedFact]:
        """LLM 提取对话中的事实"""
        msg_text = "\n".join(
            f"{m.get('role','')}: {m.get('content','')}"
            for m in messages
        )
        prompt = FACT_EXTRACTION_PROMPT.format(messages=msg_text)
        
        try:
            response = await self.llm(prompt)
            data = json.loads(response)
            return [
                ExtractedFact(
                    fact=f["fact"],
                    category=f.get("category", "info"),
                    confidence=f.get("confidence", 1.0),
                )
                for f in data.get("facts", [])
            ]
        except (json.JSONDecodeError, KeyError):
            return []

    async def _detect_conflicts(
        self, new_fact: str, existing_memories: list[dict]
    ) -> list[MemoryDecision]:
        """检测新事实与现有记忆的冲突关系"""
        if not existing_memories:
            return [MemoryDecision(action=MemoryAction.ADD, fact=new_fact)]

        # 只对相关记忆做冲突检测（按向量相似度筛选）
        relevant = existing_memories[:10]  # 简化版：取前10条
        
        existing_text = "\n".join(
            f"[{m['id']}] {m['content']}"
            for m in relevant
        )
        prompt = CONFLICT_DETECTION_PROMPT.format(
            new_fact=new_fact,
            existing_memories=existing_text,
        )

        try:
            response = await self.llm(prompt)
            data = json.loads(response)
            decisions = []
            
            has_non_none = False
            for d in data.get("decisions", []):
                action = MemoryAction(d.get("action", "NONE"))
                if action != MemoryAction.NONE:
                    has_non_none = True
                decisions.append(MemoryDecision(
                    action=action,
                    fact=new_fact,
                    existing_memory_id=d.get("existing_memory_id"),
                    reason=d.get("reason", ""),
                ))
            
            # 如果所有判断都是 NONE（无关或重复），只执行 ADD
            if not has_non_none:
                return [MemoryDecision(action=MemoryAction.ADD, fact=new_fact)]
            
            return decisions
        except (json.JSONDecodeError, KeyError, ValueError):
            return [MemoryDecision(action=MemoryAction.ADD, fact=new_fact)]

    async def _execute_decisions(
        self, fact: ExtractedFact, decisions: list[MemoryDecision],
        lead_id: str, lobster_id: str, run_id: Optional[str],
        result: dict
    ):
        """执行记忆操作"""
        for decision in decisions:
            if decision.action == MemoryAction.ADD:
                memory_id = await self.store.add(
                    content=fact.fact,
                    lead_id=lead_id,
                    lobster_id=lobster_id,
                    run_id=run_id,
                    category=fact.category,
                )
                result["added"].append({"id": memory_id, "content": fact.fact})

            elif decision.action == MemoryAction.UPDATE and decision.existing_memory_id:
                await self.store.update(
                    memory_id=decision.existing_memory_id,
                    new_content=fact.fact,
                )
                result["updated"].append({
                    "id": decision.existing_memory_id,
                    "old": "(旧内容)",
                    "new": fact.fact,
                })

            elif decision.action == MemoryAction.DELETE and decision.existing_memory_id:
                await self.store.delete(decision.existing_memory_id)
                result["deleted"].append({"id": decision.existing_memory_id})

            elif decision.action == MemoryAction.NONE:
                result["skipped"].append(fact.fact)
```

---

## B. 三层记忆分区（MemoryPartition）

### `dragon-senate-saas-v2/memory_partition.py`

```python
"""
三层记忆分区（借鉴 mem0 user_id + agent_id + run_id 设计）

分区层次：
  L1 租户级（tenant_id）：不同企业客户的记忆完全隔离
  L2 线索+龙虾级（lead_id + lobster_id）：某只龙虾对某条线索的记忆
  L3 会话级（run_id）：单次跟进对话的短期记忆
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class MemoryKey:
    """记忆分区键（三层组合）"""
    tenant_id: str
    lead_id: Optional[str] = None       # L2：线索 ID
    lobster_id: Optional[str] = None    # L2：龙虾 ID
    run_id: Optional[str] = None        # L3：会话 ID

    def to_namespace(self) -> str:
        """生成向量库命名空间"""
        parts = [f"t:{self.tenant_id}"]
        if self.lead_id:
            parts.append(f"l:{self.lead_id}")
        if self.lobster_id:
            parts.append(f"a:{self.lobster_id}")
        if self.run_id:
            parts.append(f"r:{self.run_id}")
        return ":".join(parts)

    def to_filter(self) -> dict:
        """生成 Qdrant/向量库过滤条件"""
        f = {"tenant_id": self.tenant_id}
        if self.lead_id:
            f["lead_id"] = self.lead_id
        if self.lobster_id:
            f["lobster_id"] = self.lobster_id
        if self.run_id:
            f["run_id"] = self.run_id
        return f


class MemoryPartitionManager:
    """记忆分区管理器 — 确保三层隔离"""

    @staticmethod
    def lead_memory_key(tenant_id: str, lead_id: str, lobster_id: str) -> MemoryKey:
        """线索级记忆：龙虾对某条线索的长期记忆"""
        return MemoryKey(tenant_id=tenant_id, lead_id=lead_id, lobster_id=lobster_id)

    @staticmethod
    def session_memory_key(tenant_id: str, lead_id: str, lobster_id: str, run_id: str) -> MemoryKey:
        """会话级记忆：本次跟进对话的短期记忆"""
        return MemoryKey(tenant_id=tenant_id, lead_id=lead_id, lobster_id=lobster_id, run_id=run_id)

    @staticmethod
    def lobster_memory_key(tenant_id: str, lobster_id: str) -> MemoryKey:
        """龙虾级记忆：龙虾自身的行为偏好/知识（程序性记忆）"""
        return MemoryKey(tenant_id=tenant_id, lobster_id=lobster_id)

    @staticmethod
    def tenant_memory_key(tenant_id: str) -> MemoryKey:
        """租户级记忆：整个企业的共享知识库"""
        return MemoryKey(tenant_id=tenant_id)
```

---

## C. 程序性记忆（LobsterProceduralMemory）

### `dragon-senate-saas-v2/lobster_procedural_memory.py`

```python
"""
龙虾程序性记忆（借鉴 mem0 PROCEDURAL_MEMORY_SYSTEM_PROMPT）

存储龙虾学到的行为偏好/操作习惯，例如：
  - "对科技行业客户，第一条消息保持简洁专业"
  - "跟进超过3次无回复的线索时，降低频率"
  - "客户提到竞品时，不要直接攻击，引导分析优缺点"
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class ProceduralMemory:
    """程序性记忆条目（龙虾的行为规律/偏好）"""
    memory_id: str
    lobster_id: str
    tenant_id: str
    content: str            # "对科技行业客户，第一条消息保持简洁专业"
    context: str = ""       # 触发条件描述
    reinforcement_count: int = 1    # 被强化次数（次数越多越可靠）
    source: str = "inferred"        # "inferred"=自动推断 | "manual"=人工设定
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


PROCEDURAL_EXTRACTION_PROMPT = """
你正在帮助一个AI龙虾（{lobster_name}）总结行为规律。

分析以下执行记录，提取可复用的行为模式/操作偏好：
{execution_log}

提取规律：
- 只提取可通用的行为规律（不是针对单个客户的事实）
- 规律要可操作（"应该..."/"当...时，应..."）
- 每条规律25字以内

输出 JSON：
{"patterns": ["...", "..."]}
"""


class LobsterProceduralMemory:
    """龙虾程序性记忆管理器"""

    def __init__(self, memory_store, llm_caller):
        self.store = memory_store
        self.llm = llm_caller

    async def extract_patterns(
        self,
        lobster_id: str,
        tenant_id: str,
        execution_log: list[dict],
        lobster_name: str = "AI助手",
    ) -> list[ProceduralMemory]:
        """从执行记录中提取行为规律"""
        import json
        log_text = "\n".join(
            f"[{r.get('timestamp','')}] {r.get('action','')} → {r.get('outcome','')}"
            for r in execution_log
        )
        prompt = PROCEDURAL_EXTRACTION_PROMPT.format(
            lobster_name=lobster_name,
            execution_log=log_text,
        )
        try:
            response = await self.llm(prompt)
            data = json.loads(response)
            memories = []
            for pattern in data.get("patterns", []):
                import uuid
                pm = ProceduralMemory(
                    memory_id=str(uuid.uuid4()),
                    lobster_id=lobster_id,
                    tenant_id=tenant_id,
                    content=pattern,
                    source="inferred",
                )
                memories.append(pm)
            return memories
        except Exception:
            return []

    async def get_relevant_patterns(
        self, lobster_id: str, tenant_id: str, context: str
    ) -> list[ProceduralMemory]:
        """检索与当前场景相关的行为规律（注入龙虾 System Prompt）"""
        # 从向量库按语义检索
        return await self.store.search(
            query=context,
            filter={"lobster_id": lobster_id, "tenant_id": tenant_id},
            memory_type="procedural",
        )
```

---

## D. 边缘记忆缓存（EdgeMemoryCache）

### `edge-runtime/memory_cache.py`

```python
"""
边缘节点记忆缓存
- marionette_executor 执行任务前调用 load()，将线索记忆注入上下文
- 借鉴 mem0 客户端的本地缓存设计
"""
from __future__ import annotations
import json
import os
import time
from dataclasses import dataclass, field
from typing import Optional

EDGE_MEMORY_CACHE_DIR = "/opt/openclaw/edge/memory_cache"
CACHE_TTL_SECONDS = 3600  # 1小时有效期


@dataclass
class CachedMemory:
    """缓存的记忆条目"""
    memory_id: str
    content: str
    category: str
    lead_id: str
    lobster_id: str
    cached_at: float = field(default_factory=time.time)

    def is_expired(self) -> bool:
        return time.time() - self.cached_at > CACHE_TTL_SECONDS


class EdgeMemoryCache:
    """
    边缘节点记忆缓存器
    使用场景：marionette_executor 执行前加载线索记忆，注入到龙虾上下文
    """

    def __init__(self, cache_dir: str = EDGE_MEMORY_CACHE_DIR):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)

    def _cache_file(self, lead_id: str, lobster_id: str) -> str:
        return os.path.join(self.cache_dir, f"{lobster_id}_{lead_id}.json")

    def load(self, lead_id: str, lobster_id: str) -> list[CachedMemory]:
        """加载缓存的记忆（本地文件）"""
        path = self._cache_file(lead_id, lobster_id)
        if not os.path.exists(path):
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            memories = [CachedMemory(**m) for m in data.get("memories", [])]
            # 过滤过期记忆
            valid = [m for m in memories if not m.is_expired()]
            if len(valid) < len(memories):
                self.save(lead_id, lobster_id, valid)  # 清理过期
            return valid
        except Exception:
            return []

    def save(self, lead_id: str, lobster_id: str, memories: list[CachedMemory]):
        """保存记忆到本地文件"""
        path = self._cache_file(lead_id, lobster_id)
        data = {"memories": [m.__dict__ for m in memories]}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def to_context_string(self, memories: list[CachedMemory]) -> str:
        """将记忆列表转换为注入上下文的字符串"""
        if not memories:
            return ""
        lines = ["[关于此线索的记忆]"]
        by_category: dict[str, list[str]] = {}
        for m in memories:
            by_category.setdefault(m.category, []).append(m.content)
        
        category_names = {
            "info": "基本信息", "preference": "偏好",
            "status": "当前状态", "goal": "目标/需求", "pain": "痛点",
        }
        for cat, items in by_category.items():
            lines.append(f"\n{category_names.get(cat, cat)}：")
            for item in items:
                lines.append(f"  - {item}")
        return "\n".join(lines)

    def invalidate(self, lead_id: str, lobster_id: str):
        """使缓存失效（记忆更新后调用）"""
        path = self._cache_file(lead_id, lobster_id)
        if os.path.exists(path):
            os.remove(path)
```

**集成到 marionette_executor**：
```python
# edge-runtime/marionette_executor.py 中添加：
async def execute_task(task):
    # 1. 加载线索记忆
    cache = EdgeMemoryCache()
    memories = cache.load(task.lead_id, task.lobster_id)
    memory_context = cache.to_context_string(memories)

    # 2. 注入到 System Prompt
    system_prompt = f"{lobster_base_prompt}\n\n{memory_context}"

    # 3. 执行任务...
```

---

## API 接口

```
# 记忆管理
GET  /api/v1/memory/{lead_id}?lobster_id=       # 获取某线索的所有记忆
POST /api/v1/memory/extract                      # 手动触发记忆提取
  body: {"messages": [...], "lead_id": "...", "lobster_id": "..."}
DEL  /api/v1/memory/{memory_id}                  # 删除单条记忆
PUT  /api/v1/memory/{memory_id}                  # 修改单条记忆

# 程序性记忆
GET  /api/v1/memory/procedural/{lobster_id}      # 龙虾行为规律列表
POST /api/v1/memory/procedural/extract           # 手动提取行为规律

# 边缘缓存
POST /api/v1/edge/memory/invalidate              # 使边缘节点缓存失效
  body: {"edge_node_id": "...", "lead_id": "...", "lobster_id": "..."}
```

---

## 验收标准

### MemoryExtractor（P1-1 + P1-2）
- [ ] `extract_and_merge()` 自动提取事实（LLM 提取）
- [ ] 支持 ADD/UPDATE/DELETE/NONE 四种操作
- [ ] 提取结果记录到 `llm_call_logger`（成本追踪）
- [ ] 龙虾任务完成后自动调用（集成到 `lobster_runner.py`）

### MemoryPartition（P1-5）
- [ ] `MemoryKey.to_namespace()` 生成唯一命名空间
- [ ] `MemoryKey.to_filter()` 生成向量库过滤条件
- [ ] 三层分区（租户/线索+龙虾/会话）在 Qdrant 中正确隔离
- [ ] `enterprise_memory.py` 升级为使用三层分区

### LobsterProceduralMemory（P1-4）
- [ ] `extract_patterns()` 从执行记录提取行为规律
- [ ] `get_relevant_patterns()` 语义检索相关规律
- [ ] 检索到的规律注入龙虾 System Prompt
- [ ] 前端：每只龙虾的行为规律列表页（可人工添加/删除）

### EdgeMemoryCache（P1-7）
- [ ] `load()` 从本地文件加载缓存记忆
- [ ] `to_context_string()` 生成格式化上下文
- [ ] 集成到 `marionette_executor.py`（执行前自动注入）
- [ ] 记忆更新时自动 `invalidate()` 边缘缓存

---

*Codex Task | 来源：MEM0_GRAPHITI_BORROWING_ANALYSIS.md P1-1,2,4,5,7 | 2026-04-02*
