# CODEX-MEM-01: 知识三层压缩策略

> **编号**: CODEX-MEM-01
> **优先级**: P1
> **算力**: 中
> **来源**: awesome-openclaw-usecases-zh (OpenCrew 多智能体 OS)
> **印证**: OpenCrew (25x压缩) + memsearch (SHA-256增量) + HiClaw (记忆治理) = 三方印证
> **前端对齐**: 记忆管理面板增加「压缩层级」标签 + 存储占用统计
> **关联**: 增强已有 `CODEX_TASK_SEMANTIC_MEMORY_SEARCH.md`，不替换

---

## 一、背景

当前 `lobster-memory` 的 Memory Consolidator 只做单层 token 预算归纳。
OpenCrew 展示了三层压缩策略，效率提升 100 倍以上：

| 层级 | 内容 | 压缩比 | 示例 |
|:----:|------|:------:|------|
| L0 | 原始对话记录 | 1x | "用户问了X，龙虾回答了Y，中间讨论了Z..." (5000 tokens) |
| L1 | 结构化工作报告 | 25x | `{task, decision, outcome, next_steps}` (200 tokens) |
| L2 | 抽象复用知识 | 100x+ | "该客户偏好视频内容，转化率高于图文 2.3x" (50 tokens) |

---

## 二、目标

在 `services/lobster-memory/` 中增加三层压缩管道，与已有的 memsearch 向量索引互补。

---

## 三、需要创建/修改的文件

### 3.1 `dragon-senate-saas-v2/memory_compressor.py`（新建）

```python
"""
CODEX-MEM-01: 知识三层压缩管道

L0 (raw)   → 原始对话存储 (Markdown 文件)
L1 (report) → 结构化工作报告 (JSON, 25x 压缩)
L2 (wisdom) → 抽象复用知识 (短句, 100x+ 压缩)

触发时机:
- L0→L1: 每次任务完成时自动提取
- L1→L2: 累积 10 条 L1 报告后批量提炼
- L2 条目定期 merge 去重
"""

import json
import hashlib
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path

logger = logging.getLogger("memory_compressor")

# ── 数据结构 ──

@dataclass
class L0RawEntry:
    """原始对话记录"""
    entry_id: str
    lobster_id: str
    task_id: str
    content: str           # 完整对话 Markdown
    token_count: int
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    content_hash: str = ""

    def __post_init__(self):
        if not self.content_hash:
            self.content_hash = hashlib.sha256(self.content.encode()).hexdigest()[:16]

@dataclass
class L1Report:
    """结构化工作报告 (25x 压缩)"""
    report_id: str
    source_entry_id: str
    lobster_id: str
    task_summary: str       # 一句话任务描述
    decision: str           # 做了什么决策
    outcome: str            # 结果如何
    next_steps: list[str]   # 后续动作
    key_entities: list[str] # 涉及的关键实体 (客户/产品/渠道)
    metrics: dict           # 关键指标 {"conversion": 0.12, "cost": 0.08}
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    token_count: int = 0

@dataclass
class L2Wisdom:
    """抽象复用知识 (100x+ 压缩)"""
    wisdom_id: str
    category: str           # "customer_insight" | "channel_pattern" | "content_rule" | "cost_model"
    statement: str          # 一句话知识: "该客户偏好视频内容，转化率高于图文 2.3x"
    confidence: float       # 0.0-1.0, 基于支撑 L1 报告数量
    source_reports: list[str]  # L1 report_id 列表
    lobster_ids: list[str]  # 涉及哪些龙虾
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    merge_count: int = 1    # 被合并的次数

# ── 压缩器 ──

class MemoryCompressor:
    """
    三层压缩管道管理器。

    使用示例:
        compressor = MemoryCompressor(llm_fn, storage_dir)
        l1 = await compressor.compress_l0_to_l1(raw_entry)
        wisdoms = await compressor.compress_l1_batch_to_l2(l1_reports)
    """

    def __init__(self, llm_call_fn, storage_dir: str = "data/memory"):
        self._llm = llm_call_fn
        self._storage = Path(storage_dir)
        self._storage.mkdir(parents=True, exist_ok=True)
        (self._storage / "l0").mkdir(exist_ok=True)
        (self._storage / "l1").mkdir(exist_ok=True)
        (self._storage / "l2").mkdir(exist_ok=True)

    async def compress_l0_to_l1(self, entry: L0RawEntry) -> L1Report:
        """L0 → L1: 从原始对话中提取结构化报告"""
        prompt = f"""你是一个知识压缩专家。请从以下对话记录中提取结构化工作报告。

对话记录:
{entry.content[:3000]}

请严格按以下 JSON 格式输出:
{{
  "task_summary": "一句话描述任务",
  "decision": "做了什么关键决策",
  "outcome": "结果如何（成功/失败/进行中）",
  "next_steps": ["后续动作1", "后续动作2"],
  "key_entities": ["涉及的客户/产品/渠道"],
  "metrics": {{"关键指标名": 数值}}
}}"""

        response = await self._llm(prompt, max_tokens=500)
        try:
            data = json.loads(response)
        except json.JSONDecodeError:
            data = {
                "task_summary": response[:100],
                "decision": "无法解析",
                "outcome": "unknown",
                "next_steps": [],
                "key_entities": [],
                "metrics": {},
            }

        report = L1Report(
            report_id=f"l1-{entry.content_hash}",
            source_entry_id=entry.entry_id,
            lobster_id=entry.lobster_id,
            task_summary=data.get("task_summary", ""),
            decision=data.get("decision", ""),
            outcome=data.get("outcome", ""),
            next_steps=data.get("next_steps", []),
            key_entities=data.get("key_entities", []),
            metrics=data.get("metrics", {}),
            token_count=len(response.split()),
        )

        # 持久化
        self._save_l1(report)
        logger.info(f"L0→L1 compressed: {entry.token_count} tokens → ~{report.token_count} tokens ({entry.token_count // max(report.token_count,1)}x)")
        return report

    async def compress_l1_batch_to_l2(self, reports: list[L1Report], category: str = "general") -> list[L2Wisdom]:
        """L1 → L2: 从多条报告中提炼抽象复用知识"""
        if len(reports) < 3:
            logger.info(f"L1→L2 skipped: only {len(reports)} reports (need ≥3)")
            return []

        reports_text = "\n".join([
            f"- [{r.lobster_id}] {r.task_summary} → {r.outcome} (决策: {r.decision})"
            for r in reports
        ])

        prompt = f"""你是一个知识提炼专家。请从以下 {len(reports)} 条工作报告中提炼出可复用的抽象知识。

工作报告:
{reports_text}

请输出 JSON 数组，每条知识包含:
[
  {{
    "statement": "一句话知识（可以在未来的类似场景中直接应用）",
    "confidence": 0.8,
    "category": "customer_insight|channel_pattern|content_rule|cost_model|workflow_pattern"
  }}
]

只输出真正有价值的、可复用的知识，不要重复原始报告内容。"""

        response = await self._llm(prompt, max_tokens=800)
        wisdoms = []
        try:
            items = json.loads(response)
            for item in items:
                w = L2Wisdom(
                    wisdom_id=hashlib.sha256(item["statement"].encode()).hexdigest()[:12],
                    category=item.get("category", category),
                    statement=item["statement"],
                    confidence=item.get("confidence", 0.5),
                    source_reports=[r.report_id for r in reports],
                    lobster_ids=list(set(r.lobster_id for r in reports)),
                )
                self._save_l2(w)
                wisdoms.append(w)
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"L1→L2 parse failed: {e}")

        logger.info(f"L1→L2 compressed: {len(reports)} reports → {len(wisdoms)} wisdom entries")
        return wisdoms

    def get_wisdoms(self, category: Optional[str] = None, lobster_id: Optional[str] = None) -> list[L2Wisdom]:
        """查询 L2 知识库"""
        wisdoms = []
        for f in (self._storage / "l2").glob("*.json"):
            w = L2Wisdom(**json.loads(f.read_text(encoding="utf-8")))
            if category and w.category != category:
                continue
            if lobster_id and lobster_id not in w.lobster_ids:
                continue
            wisdoms.append(w)
        return sorted(wisdoms, key=lambda w: w.confidence, reverse=True)

    def _save_l1(self, report: L1Report):
        path = self._storage / "l1" / f"{report.report_id}.json"
        path.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2), encoding="utf-8")

    def _save_l2(self, wisdom: L2Wisdom):
        path = self._storage / "l2" / f"{wisdom.wisdom_id}.json"
        path.write_text(json.dumps(asdict(wisdom), ensure_ascii=False, indent=2), encoding="utf-8")
```

---

## 四、接入点

### 4.1 `lobster_runner.py` 集成

在每次龙虾任务完成后自动触发 L0→L1 压缩：

```python
from memory_compressor import MemoryCompressor, L0RawEntry

# 任务完成回调中
async def on_task_complete(lobster_id, task_id, conversation_text, token_count):
    entry = L0RawEntry(entry_id=task_id, lobster_id=lobster_id,
                       task_id=task_id, content=conversation_text, token_count=token_count)
    l1 = await compressor.compress_l0_to_l1(entry)
```

### 4.2 前端对齐清单

| API | 前端页面 | 功能 |
|-----|---------|------|
| `GET /api/memory/wisdoms` | `web/src/app/operations/memory/page.tsx` | L2 知识列表 (语句/置信度/分类/来源龙虾) |
| `GET /api/memory/reports?lobster_id=X` | 同上，L1 标签页 | L1 报告列表 (任务/决策/结果) |
| `GET /api/memory/stats` | 同上，统计卡片 | 各层数量和压缩比统计 |

---

## 五、与已有 CODEX 关系

| 现有任务 | 关系 |
|---------|------|
| `CODEX_TASK_SEMANTIC_MEMORY_SEARCH.md` | **互补**: memsearch 做向量检索，本任务做压缩分层 |
| `lobster-memory` 服务 | **增强**: 增加 L1/L2 存储层 |

---

## 六、验收标准

- [ ] L0→L1 压缩比 ≥ 20x
- [ ] L1→L2 每 10 条报告提炼 2-5 条知识
- [ ] SHA-256 去重，相同内容不重复压缩
- [ ] 知识查询支持按分类和龙虾过滤
- [ ] 测试覆盖 ≥ 80%
