# CODEX TASK: YAML 工作流定义（替代硬编码 DAG）

> **任务来源**：G11 — AntFarm 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/ANTFARM_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🟠 P1 重要（dragon_senate.py 硬编码 DAG 是单点故障和迭代瓶颈）  
> **预估工作量**：2 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查 dragon_senate.py 硬编码 DAG 结构
grep -n "def.*graph\|add_node\|add_edge\|workflow\|DAG\|pipeline" \
  dragon-senate-saas-v2/dragon_senate.py 2>/dev/null | head -20

# 2. 检查 commander_graph_builder.py（是否已有图构建逻辑）
grep -n "yaml\|load.*workflow\|from_file\|graph_def" \
  dragon-senate-saas-v2/commander_graph_builder.py 2>/dev/null | head -10

# 3. 检查是否已有 workflows/ 目录
ls dragon-senate-saas-v2/workflows/ 2>/dev/null || echo "workflows/ 不存在，需新建"

# 4. 确认当前 LangGraph/LangChain 版本支持动态图
python -c "import langgraph; print(langgraph.__version__)" 2>/dev/null || echo "langgraph 未安装"
```

**冲突解决原则**：
- **不删除** `dragon_senate.py` 中的硬编码 DAG，改为让 YAML 覆盖时优先，无 YAML 时回退到硬编码
- YAML 工作流只定义**节点连接关系**，不包含业务逻辑（业务逻辑保留在各龙虾中）
- 第一阶段只支持线性/顺序工作流，条件分支留到第二阶段

---

## 一、任务目标

用 YAML 文件定义龙虾 DAG 工作流，实现热更新和无代码配置：
1. **YAML Schema 设计**：定义清晰的工作流 Schema，支持节点/边/条件/并行
2. **WorkflowLoader**：从 YAML 文件加载工作流定义，构建 LangGraph 图
3. **热更新**：运营人员修改 YAML 后无需重启（扫描文件变更）
4. **回退机制**：YAML 解析失败时，自动回退到硬编码 DAG

---

## 二、实施方案

### 2.1 YAML Schema 规范

**目标文件**：`dragon-senate-saas-v2/workflows/default_mission.yaml`（新建）

```yaml
# Dragon Senate 默认使命工作流
# Schema Version: 1.0
# 文档：每只龙虾对应 DAG 中的一个节点，边代表执行依赖关系

metadata:
  workflow_id: "default_mission"
  version: "1.0.0"
  description: "ClawCommerce 默认使命流：情报→策略→文案→视觉→发布→互动→线索→复盘→跟进"
  author: "commander"
  updated_at: "2026-04-01"

# 节点定义（10只龙虾）
nodes:
  - id: commander
    lobster: commander
    description: "元老院总脑，接收使命，分解子任务，协调全局"
    type: orchestrator   # orchestrator | worker | gate
    expects: "MissionPlan:"
    max_retries: 3
    timeout_seconds: 120

  - id: radar
    lobster: radar
    description: "情报触须，市场情报搜集"
    type: worker
    expects: "SignalBrief:"
    max_retries: 2
    timeout_seconds: 60

  - id: strategist
    lobster: strategist
    description: "战略大脑，制定内容策略路线"
    type: worker
    expects: "StrategyRoute:"
    max_retries: 2
    timeout_seconds: 90

  - id: inkwriter
    lobster: inkwriter
    description: "文字工匠，生成文案包"
    type: worker
    expects: "CopyPack:"
    max_retries: 3
    timeout_seconds: 120

  - id: visualizer
    lobster: visualizer
    description: "视觉幻影，生成分镜/封面方案"
    type: worker
    expects: "StoryboardPack:"
    max_retries: 2
    timeout_seconds: 90

  - id: dispatcher
    lobster: dispatcher
    description: "点兵调将，生成发布执行计划"
    type: worker
    expects: "ExecutionPlan:"
    max_retries: 1
    timeout_seconds: 60

  - id: echoer
    lobster: echoer
    description: "回声捕手，处理互动回复"
    type: worker
    expects: "EngagementReplyPack:"
    max_retries: 2
    timeout_seconds: 60

  - id: catcher
    lobster: catcher
    description: "线索渔夫，评估和分级销售线索"
    type: worker
    expects: "LeadAssessment:"
    max_retries: 1
    timeout_seconds: 60

  - id: abacus
    lobster: abacus
    description: "算盘精算，计算 ROI 和价值评分"
    type: worker
    expects: "ValueScoreCard:"
    max_retries: 2
    timeout_seconds: 90

  - id: followup
    lobster: followup
    description: "跟进猎手，制定跟进行动计划"
    type: worker
    expects: "FollowUpActionPlan:"
    max_retries: 2
    timeout_seconds: 60

# 边定义（执行顺序）
edges:
  - from: commander
    to: radar
    condition: null  # null = 无条件执行

  - from: radar
    to: strategist
    condition: null

  - from: strategist
    to:
      - inkwriter    # 并行执行
      - visualizer   # 并行执行
    parallel: true

  - from: inkwriter
    to: dispatcher
    condition: null

  - from: visualizer
    to: dispatcher
    condition: null
    wait_for: inkwriter  # 等待 inkwriter 完成后再触发 dispatcher

  - from: dispatcher
    to:
      - echoer
      - catcher
    parallel: true

  - from: echoer
    to: abacus
    condition: null

  - from: catcher
    to: abacus
    condition: null
    wait_for: echoer

  - from: abacus
    to: followup
    condition: null

# 全局配置
config:
  max_parallel_lobsters: 3     # 最多同时并行运行的龙虾数
  escalate_on_node_failure: true
  fresh_context_on_new_mission: true
  audit_enabled: true
```

---

### 2.2 WorkflowLoader（YAML 解析器）

**目标文件**：`dragon-senate-saas-v2/workflow_loader.py`（新建）

```python
"""
WorkflowLoader — YAML 工作流定义加载器
借鉴 AntFarm 工作流引擎设计

从 YAML 文件加载工作流定义，构建可执行的 DAG 描述。
不直接构建 LangGraph 图（图构建在 commander_graph_builder.py 中）。
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("workflow_loader")

WORKFLOWS_DIR = os.getenv("WORKFLOWS_DIR", "./dragon-senate-saas-v2/workflows")


@dataclass
class WorkflowNodeDef:
    id: str
    lobster: str
    description: str
    node_type: str = "worker"  # orchestrator | worker | gate
    expects: str | None = None
    max_retries: int = 0
    timeout_seconds: int = 60


@dataclass
class WorkflowEdgeDef:
    from_node: str
    to_nodes: list[str]
    parallel: bool = False
    wait_for: str | None = None
    condition: str | None = None


@dataclass
class WorkflowDef:
    workflow_id: str
    version: str
    description: str
    nodes: list[WorkflowNodeDef] = field(default_factory=list)
    edges: list[WorkflowEdgeDef] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)
    loaded_at: float = field(default_factory=time.monotonic)

    def get_node(self, node_id: str) -> WorkflowNodeDef | None:
        return next((n for n in self.nodes if n.id == node_id), None)

    def get_successors(self, node_id: str) -> list[str]:
        successors = []
        for edge in self.edges:
            if edge.from_node == node_id:
                successors.extend(edge.to_nodes)
        return successors


class WorkflowLoader:
    """
    YAML 工作流加载器（支持热更新）

    用法：
        loader = WorkflowLoader()
        workflow = loader.load("default_mission")
        nodes = workflow.nodes
    """

    def __init__(self, workflows_dir: str = WORKFLOWS_DIR) -> None:
        self._dir = Path(workflows_dir)
        self._cache: dict[str, WorkflowDef] = {}
        self._mtime_cache: dict[str, float] = {}

    def load(self, workflow_id: str) -> WorkflowDef:
        """
        加载工作流定义（带文件变更检测）
        文件未变化时返回缓存，文件更新时重新加载（热更新）
        """
        yaml_path = self._dir / f"{workflow_id}.yaml"
        if not yaml_path.exists():
            raise FileNotFoundError(f"Workflow file not found: {yaml_path}")

        current_mtime = yaml_path.stat().st_mtime
        cached_mtime = self._mtime_cache.get(workflow_id, 0)

        if workflow_id in self._cache and current_mtime <= cached_mtime:
            return self._cache[workflow_id]

        # 重新加载
        logger.info("[WorkflowLoader] Loading %s (mtime changed)", workflow_id)
        with open(yaml_path, encoding="utf-8") as f:
            raw = yaml.safe_load(f)

        workflow = self._parse(raw)
        self._cache[workflow_id] = workflow
        self._mtime_cache[workflow_id] = current_mtime
        return workflow

    def load_or_fallback(self, workflow_id: str) -> WorkflowDef | None:
        """
        加载工作流，失败时返回 None（调用方可以回退到硬编码 DAG）
        """
        try:
            return self.load(workflow_id)
        except Exception as e:
            logger.warning("[WorkflowLoader] Failed to load %s, will fallback to hardcoded DAG: %s", workflow_id, e)
            return None

    def _parse(self, raw: dict) -> WorkflowDef:
        metadata = raw.get("metadata", {})
        nodes_raw = raw.get("nodes", [])
        edges_raw = raw.get("edges", [])
        config = raw.get("config", {})

        nodes = []
        for n in nodes_raw:
            nodes.append(WorkflowNodeDef(
                id=n["id"],
                lobster=n.get("lobster", n["id"]),
                description=n.get("description", ""),
                node_type=n.get("type", "worker"),
                expects=n.get("expects"),
                max_retries=n.get("max_retries", 0),
                timeout_seconds=n.get("timeout_seconds", 60),
            ))

        edges = []
        for e in edges_raw:
            to = e.get("to", [])
            to_nodes = [to] if isinstance(to, str) else list(to)
            edges.append(WorkflowEdgeDef(
                from_node=e["from"],
                to_nodes=to_nodes,
                parallel=bool(e.get("parallel", False)),
                wait_for=e.get("wait_for"),
                condition=e.get("condition"),
            ))

        return WorkflowDef(
            workflow_id=metadata.get("workflow_id", "unknown"),
            version=metadata.get("version", "0.0.0"),
            description=metadata.get("description", ""),
            nodes=nodes,
            edges=edges,
            config=config,
        )


# 全局单例
_loader: WorkflowLoader | None = None

def get_workflow_loader() -> WorkflowLoader:
    global _loader
    if _loader is None:
        _loader = WorkflowLoader()
    return _loader
```

### 2.3 集成到 commander_graph_builder.py

```python
# 在 commander_graph_builder.py 中，优先从 YAML 加载图定义，失败时回退硬编码

from workflow_loader import get_workflow_loader

def build_graph(workflow_id: str = "default_mission"):
    """构建 LangGraph 图：优先 YAML，回退硬编码"""
    loader = get_workflow_loader()
    workflow_def = loader.load_or_fallback(workflow_id)

    if workflow_def is not None:
        return _build_from_yaml(workflow_def)
    else:
        logger.warning("[GraphBuilder] Using hardcoded DAG (YAML unavailable)")
        return _build_hardcoded_dag()  # 原有函数保持不变

def _build_from_yaml(workflow_def):
    """从 WorkflowDef 构建 LangGraph StateGraph"""
    # 根据 workflow_def.nodes 和 workflow_def.edges 动态构建图
    # ...
```

---

## 三、前端工程师对接说明

### 新增 API 端点

```typescript
// GET /api/v1/workflows — 列出所有可用工作流
// GET /api/v1/workflows/{id} — 查看工作流定义
// PUT /api/v1/workflows/{id} — 上传/更新工作流 YAML（运营人员使用）

// 工作流可视化编辑器（建议后续版本）：
// 展示 DAG 拓扑图，节点可拖拽配置 expects / max_retries
```

---

## 四、验收标准

- [ ] `get_workflow_loader().load("default_mission")` 返回 `WorkflowDef`（不报错）
- [ ] `workflow_def.nodes` 包含10个龙虾节点
- [ ] `workflow_def.get_successors("radar")` 返回 `["strategist"]`
- [ ] 修改 YAML 文件后，`loader.load()` 自动重新加载（热更新）
- [ ] YAML 解析失败时 `load_or_fallback()` 返回 `None`（不抛异常）
- [ ] `commander_graph_builder.py` 优先使用 YAML 构建图

---

## 五、实施顺序

```
Day 1（4小时）：
  ① 冲突检查（4条 grep）
  ② 新建 dragon-senate-saas-v2/workflows/ 目录
  ③ 新建 workflows/default_mission.yaml（见 2.1）
  ④ 新建 workflow_loader.py（见 2.2）

Day 2（3小时）：
  ⑤ 在 commander_graph_builder.py 中集成 WorkflowLoader（见 2.3）
  ⑥ 测试：加载 YAML → 构建图 → 执行一次完整龙虾链路
  ⑦ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_ANTFARM_YAML_WORKFLOW 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G11*
