# Codex 任务：从 dragon_senate.py 提取剩余 4 只龙虾为独立模块

> 状态更新（2026-03-31）：本任务已完成，`strategist / visualizer / dispatcher / followup` 已提取到 `dragon-senate-saas-v2/lobsters/`。本文件仅保留为历史任务记录，不应再作为当前待办。

## 任务背景

`dragon-senate-saas-v2/dragon_senate.py` 是一个 ~2000 行的 LangGraph 主图文件，包含 9 只龙虾（AI Agent）的节点函数。我们已经把其中 5 只（radar / echoer / catcher / abacus / inkwriter）提取为 `dragon-senate-saas-v2/lobsters/` 下的独立模块。

**你的任务**：按照完全相同的模式，提取剩余 4 只龙虾：**strategist / visualizer / dispatcher / followup**。

---

## 已完成的模式参考

### 文件结构
```
dragon-senate-saas-v2/lobsters/
├── __init__.py          # 包初始化，导出所有虾
├── shared.py            # 共享常量和工具函数
├── base_lobster.py      # BaseLobster 基类
├── radar.py             # ✅ 已提取 — 参考模式
├── echoer.py            # ✅ 已提取
├── catcher.py           # ✅ 已提取
├── abacus.py            # ✅ 已提取
├── inkwriter.py         # ✅ 已提取
├── strategist.py        # ❌ 待提取（你来做）
├── visualizer.py        # ❌ 待提取（你来做）
├── dispatcher.py        # ❌ 待提取（你来做）
├── followup.py          # ❌ 待提取（你来做）
```

### 每个模块的标准模式（参考 lobsters/radar.py）

```python
"""
{Name} 🦐 {中文名} — {职责一句话}

Primary Artifact: {工件名}
Upstream: {上游虾}
Downstream: {下游虾}

Extracted from dragon_senate.py — contains full implementation.
"""

from __future__ import annotations

from typing import Any
# 按需 import 其他

from lobsters.base_lobster import BaseLobster
from lobsters.shared import agent_log, keywords, invoke_clawhub_skill  # 按需选择

_instance: {Name}Lobster | None = None


class {Name}Lobster(BaseLobster):
    role_id = "{role_id}"


def _get() -> {Name}Lobster:
    global _instance
    if _instance is None:
        _instance = {Name}Lobster()
    return _instance


async def {role_id}(state: dict[str, Any]) -> dict[str, Any]:
    """
    LangGraph node entry point — full {role_id} implementation.
    {简述逻辑}
    """
    # ⚠️ 外部依赖必须用延迟 import，避免循环引用
    from llm_router import RouteMeta, llm_router
    from senate_kernel import xxx as kernel_xxx
    
    # ... 完整逻辑从 dragon_senate.py 中复制 ...


role_card = lambda: _get().role_card  # noqa: E731
display_name = lambda: _get().display_name  # noqa: E731
zh_name = lambda: _get().zh_name  # noqa: E731
```

### 关键规则

1. **从 `dragon_senate.py` 复制完整逻辑**，不是写 shim/delegate
2. **外部依赖用延迟 import**（在函数体内 `from xxx import yyy`），因为这些模块和 dragon_senate.py 在同一个 Python 路径下
3. **工具函数从 `lobsters.shared` 导入**（`agent_log`, `invoke_clawhub_skill`, `safe_json_parse`, `STORYBOARD_OPTIONS`, `keywords`, `safe_slug`, `default_competitor_handles`, `build_formula_json`, `formula_to_document`, `extract_rag_reference`, `extract_industry_kb_reference`, `normalize_skill_names`, `normalize_command_names`, `bool_env`, `int_env` 等）
4. **函数签名保持 `async def xxx(state: dict[str, Any]) -> dict[str, Any]`**
5. **不要修改 `dragon_senate.py`**，我会自己来做接线

---

## 具体任务

### 任务 1：提取 `strategist.py`

**来源**：`dragon_senate.py` 中的 `async def strategist(state: DragonState)` 函数（约 200 行）

**关键特征**：
- 从 state 读取 hot_topics, task_description, user_id, tenant_id, industry_tag, radar_data, source_credibility, memory_context
- 调用 `kernel_build_memory_context`, `kernel_compute_source_credibility`, `kernel_estimate_strategy_confidence`
- 调用 `fetch_recent_formula_documents`, `search_formula_documents` (来自 qdrant_config)
- 调用 `query_raganything_hybrid` (来自 multimodal_rag_adapter)
- 调用 `recommend_policy` (来自 policy_bandit)
- 调用 `llm_router.routed_ainvoke_text`
- 调用 `append_lossless_event` (来自 lossless_memory)
- 使用 `_daily_rag_scan_cache`（模块级缓存 dict）— 这个需要在模块里重建
- 返回 strategy, source_credibility, memory_context, strategy_confidence, policy_bandit, rag_recent_digest, call_log

**需要从 shared.py 导入的**：`agent_log`, `invoke_clawhub_skill`, `safe_json_parse`, `STORYBOARD_OPTIONS`, `extract_rag_reference`, `extract_industry_kb_reference`

**延迟 import 的外部依赖**：
```python
from senate_kernel import build_memory_context as kernel_build_memory_context
from senate_kernel import compute_source_credibility as kernel_compute_source_credibility
from senate_kernel import estimate_strategy_confidence as kernel_estimate_strategy_confidence
from qdrant_config import fetch_recent_formula_documents, search_formula_documents
from multimodal_rag_adapter import query_raganything_hybrid
from policy_bandit import recommend_policy
from llm_router import RouteMeta, llm_router
from lossless_memory import append_event as append_lossless_event
```

**中文名**: 脑虫虾
**Primary Artifact**: StrategyRoute
**Upstream**: Radar (via hotspot_investigation)
**Downstream**: ConstitutionalGuardian

---

### 任务 2：提取 `visualizer.py`

**来源**：`dragon_senate.py` 中的 `async def visualizer(state: DragonState)` 函数（约 180 行）

**关键特征**：
- 读取 inkwriter_output.scenes
- 检测 digital_human_mode / vlog_mode
- 调用 `detect_industry`, `resolve_workflow` (from industry_workflows)
- 调用 `inspect_comfyui_capabilities`, `build_comfyui_generation_plan` (from comfyui_capability_matrix)
- 调用 `list_templates_by_industry`, `resolve_template` (from workflow_template_registry)
- 调用 `recommend_policy` (from policy_bandit)
- 调用 `generate_storyboard_video_local` (from comfyui_adapter)
- 调用 `generate_storyboard_video` (from libtv_skill_adapter) — 作为 fallback
- 返回 visualizer_output (prompt_pack, media_pack, engine, style_profile, industry, workflow_template, template_selection, capability_snapshot, generation_plan, comfyui_render, libtv_session)

**需要从 shared.py 导入的**：`agent_log`, `invoke_clawhub_skill`

**延迟 import 的外部依赖**：
```python
from industry_workflows import detect_industry, resolve_workflow
from comfyui_adapter import generate_storyboard_video_local
from comfyui_capability_matrix import build_comfyui_generation_plan, inspect_comfyui_capabilities
from libtv_skill_adapter import generate_storyboard_video
from workflow_template_registry import list_templates_by_industry, resolve_template
from policy_bandit import recommend_policy
```

**中文名**: 幻影虾
**Primary Artifact**: StoryboardPack
**Upstream**: InkWriter
**Downstream**: Dispatcher

---

### 任务 3：提取 `dispatcher.py`

**来源**：`dragon_senate.py` 中的 `async def dispatcher(state: DragonState)` 函数（约 130 行）

**关键特征**：
- 组装 content_package（jobs、ops_instruction、visual_delivery）
- 调用 `build_post_production_plan` (from media_post_pipeline)
- 调用 clawteam_inbox 函数集（enqueue_inbox_tasks, claim_ready_tasks, mark_many_completed, get_ready_tasks, summary）
- 使用 `_build_clawteam_tasks` 辅助函数 — **需要一起提取到模块中**
- 调用 `append_lossless_event`
- 返回 content_package, dispatch_plan, clawteam_queue, call_log

**需要从 shared.py 导入的**：`agent_log`, `invoke_clawhub_skill`

**⚠️ 特殊处理**：`_build_clawteam_tasks()` 辅助函数目前在 `dragon_senate.py` 中，需要复制到 dispatcher 模块里（或放到 shared.py）。

**延迟 import 的外部依赖**：
```python
from clawteam_inbox import claim_ready_tasks, enqueue_inbox_tasks, get_ready_tasks, mark_many_completed
from clawteam_inbox import summary as clawteam_summary
from media_post_pipeline import build_post_production_plan
from lossless_memory import append_event as append_lossless_event
```

**中文名**: 点兵虾
**Primary Artifact**: ExecutionPlan
**Upstream**: InkWriter, Visualizer
**Downstream**: DiscoverEdgeSkills

---

### 任务 4：提取 `followup.py`

**来源**：`dragon_senate.py` 中的 `async def followup(state: DragonState)` 函数（约 180 行）

**关键特征**：
- 最复杂的虾 — 支持 deterministic sub-agent spawning
- 调用 `_build_followup_spawn_plan()` 和 `_run_followup_child()` — **两个辅助函数需要一起提取**
- 调用 followup_subagent_store 函数集（create_spawn_run, finish_spawn_run, get_spawn_run, plan_deterministic_subagents, record_child_run）
- 调用 clawteam_inbox 函数集（enqueue_inbox_tasks, claim_ready_tasks, mark_many_completed, mark_many_failed）
- 调用 `llm_router.routed_ainvoke_text`（在子 agent 中）
- 使用 `asyncio.Semaphore` 做并发控制
- 返回 followup_output, followup_spawn, clawteam_queue, call_log

**需要从 shared.py 导入的**：`agent_log`, `invoke_clawhub_skill`, `bool_env`, `int_env`

**⚠️ 特殊处理**：
1. `_build_followup_spawn_plan()` 辅助函数需复制到 followup 模块
2. `_run_followup_child()` 辅助函数需复制到 followup 模块
3. 这两个辅助函数目前在 `dragon_senate.py` 中也被 `dm_followup()` 使用，所以保留 dragon_senate.py 中的副本或从 followup.py import

**延迟 import 的外部依赖**：
```python
from llm_router import RouteMeta, llm_router
from followup_subagent_store import create_spawn_run, finish_spawn_run, get_spawn_run, plan_deterministic_subagents, record_child_run
from clawteam_inbox import claim_ready_tasks, enqueue_inbox_tasks, mark_many_completed, mark_many_failed
```

**中文名**: 回访虾
**Primary Artifact**: FollowUpActionPlan
**Upstream**: HumanApprovalGate
**Downstream**: Feedback

---

## 完成后需要做的事

### 更新 `lobsters/__init__.py`
添加新提取的模块到导出：
```python
from lobsters.strategist import strategist, StrategistLobster
from lobsters.visualizer import visualizer, VisualizerLobster
from lobsters.dispatcher import dispatcher, DispatcherLobster
from lobsters.followup import followup, FollowUpLobster
```

### 现有 strategist.py / visualizer.py / dispatcher.py / followup.py 的处理
这些文件目前是 shim（delegate 回 dragon_senate.py），需要**整体替换**为完整实现。

---

## 验证标准

每个提取的模块应该：
1. ✅ 包含完整逻辑（不是 shim）
2. ✅ 继承 BaseLobster
3. ✅ 使用 `lobsters.shared` 中的共享工具函数
4. ✅ 外部依赖使用延迟 import
5. ✅ 暴露 role_card / display_name / zh_name
6. ✅ 函数签名保持 `async def xxx(state: dict[str, Any]) -> dict[str, Any]`
