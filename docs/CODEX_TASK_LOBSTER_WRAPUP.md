# CODEX TASK: 龙虾任务收尾工作流 lobster_wrapup.py

**来源借鉴**: ClawWork wrapup_workflow.py (17KB) + live_agent.py 的执行约束机制  
**优先级**: 🔴 高  
**预计工时**: 2-3h  
**产出文件**: `dragon-senate-saas-v2/lobster_wrapup.py`  
**同步修改**: `dragon-senate-saas-v2/lobster_runner.py`（增加步数+时间软约束）

---

## ⚠️ 重要前提：龙虾不是 Agent

龙虾是**有人格的角色扮演执行者**，同时服务多个客户/租户，并发处理任务包。因此：

- **不设 Token 预算约束**：成本由平台统一管理，不在龙虾层做经济截断
- **只设步数+时间软约束**：防止异常死循环占用资源影响其他客户
- **软约束 ≠ 强制截断**：超限时先预警，给龙虾机会优雅收尾，不强制 kill

ClawWork 的 `max_cost` 经济约束**不适用**于我们的场景，略去。

---

## 任务背景

我们的龙虾目前无任何执行保护机制，一旦任务出现异常（LLM 幻觉循环、工具调用失败重试、Prompt 陷入死循环），会持续占用该龙虾的执行槽，**影响同时服务的其他客户**。

同时，任务异常退出时没有"部分完成"机制，所有进度全部丢失，用户体验差。

---

## 目标

1. 在 `lobster_runner.py` 中增加步数+时间**软约束**（仅预警+优雅退出）
2. 实现 `lobster_wrapup.py`：超限时汇总进度，保存已完成部分，通知 Commander
3. Commander 收到通知后决定是否重新分配剩余步骤

---

## 实现规格

### 第一部分：软约束守卫（修改 lobster_runner.py）

**设计原则**：
- 只监控**步数**和**执行时间**，不涉及 Token/成本
- 超出阈值时先**注入警告上下文**，给龙虾机会自主收尾
- 警告注入后再超限（`warn_steps` → `max_steps`），才触发收尾工作流
- 整个过程不 kill 进程，优雅退出

```python
# 在 lobster_runner.py 顶部增加

from dataclasses import dataclass
import time

@dataclass
class LobsterExecutionGuard:
    """
    龙虾执行软约束守卫。
    
    ⚠️ 设计说明：
    - 龙虾不是 Agent，同时服务多个客户，不设 Token/成本预算
    - 只设步数+时间软约束，防止异常死循环占用执行槽
    - 超限后优雅退出，不强制截断
    """
    max_steps: int = 25          # 步数上限（正常任务10-15步，给足余量）
    max_time_sec: int = 600      # 时间上限：10分钟（含等待和重试）
    warn_steps: int = 18         # 步数预警线：提前告知龙虾准备收尾
    warn_time_sec: int = 480     # 时间预警线：8分钟时预警
    
    def check_soft_limit(
        self,
        steps: int,
        elapsed_sec: float,
    ) -> str | None:
        """
        检查是否触达软约束上限（需要触发收尾工作流）。
        返回原因字符串，None 表示正常。
        """
        if steps >= self.max_steps:
            return f"steps_exceeded ({steps}/{self.max_steps})"
        if elapsed_sec >= self.max_time_sec:
            return f"timeout ({elapsed_sec:.0f}s/{self.max_time_sec}s)"
        return None
    
    def check_warning(
        self,
        steps: int,
        elapsed_sec: float,
    ) -> str | None:
        """
        检查是否进入预警区间（注入提示，不中断）。
        """
        if steps >= self.warn_steps:
            remaining = self.max_steps - steps
            return f"⚠️ 当前任务已执行{steps}步，请在{remaining}步内完成收尾"
        if elapsed_sec >= self.warn_time_sec:
            remaining = self.max_time_sec - elapsed_sec
            return f"⚠️ 任务执行时间较长（{elapsed_sec:.0f}s），请尽快完成当前工作"
        return None
```

**在龙虾任务循环中集成**：

```python
async def run_lobster_task(
    lobster_id: str,
    task: dict,
    guard: LobsterExecutionGuard = None,
) -> dict:
    """运行龙虾任务，带步数+时间软约束守卫"""
    if guard is None:
        guard = LobsterExecutionGuard()
    
    start_time = time.time()
    steps = 0
    completed_steps = []
    warned = False  # 避免重复注入警告
    
    while True:
        elapsed = time.time() - start_time
        
        # 1. 软约束检查（超限 → 触发收尾工作流）
        limit_reason = guard.check_soft_limit(steps, elapsed)
        if limit_reason:
            from dragon_senate_saas_v2.lobster_wrapup import trigger_wrapup
            wrapup_result = await trigger_wrapup(
                lobster_id=lobster_id,
                task_id=task["task_id"],
                reason=limit_reason,
                completed_steps=completed_steps,
                remaining_plan=current_plan,
                execution_stats={"steps": steps, "time_sec": elapsed},
            )
            return wrapup_result
        
        # 2. 预警检查（进入预警区 → 注入提示上下文，不中断）
        if not warned:
            warn_msg = guard.check_warning(steps, elapsed)
            if warn_msg:
                inject_warning_to_context(warn_msg)
                warned = True  # 只注入一次
        
        # 3. 正常执行一步
        step_result = await execute_one_step(lobster_id, task, context)
        completed_steps.append(step_result)
        steps += 1
        
        # 4. 检查是否完成
        if step_result.get("task_done"):
            return {"status": "completed", "steps": steps, "result": step_result}
```

---

### 第二部分：收尾工作流（lobster_wrapup.py）

```python
# dragon-senate-saas-v2/lobster_wrapup.py

from dataclasses import dataclass
from typing import Optional
import asyncio

@dataclass
class WrapupResult:
    """收尾工作流的结果"""
    task_id: str
    lobster_id: str
    status: str                    # "partial" | "abandoned" | "rescued"
    wrapup_reason: str             # 超限原因
    partial_output: str            # 已完成部分的产出物（LLM生成的汇总）
    completion_pct: float          # 估计完成百分比（0.0-1.0）
    submittable: bool              # 是否值得部分提交
    remaining_steps: list          # 剩余未完成的步骤
    notify_commander: bool         # 是否需要通知 Commander
    budget_used: dict              # {"steps": 20, "tokens": 60000, "time_sec": 300}


async def trigger_wrapup(
    lobster_id: str,
    task_id: str,
    reason: str,
    completed_steps: list[dict],
    remaining_plan: list[str],
    budget_used: dict,
) -> WrapupResult:
    """
    任务超预算时触发的收尾工作流。
    
    流程：
    1. 用 LLM 汇总已完成的步骤产出
    2. 评估完成度（是否值得部分提交）
    3. 生成部分完成报告
    4. 决定是否通知 Commander 重新分配剩余步骤
    5. 写入 wrapup 日志
    """
    print(f"🔔 [{lobster_id}] 任务 {task_id} 触发收尾工作流，原因：{reason}")
    
    # Phase 1: 汇总已完成工作
    partial_output = await _summarize_completed_work(
        lobster_id, task_id, completed_steps
    )
    
    # Phase 2: 评估是否值得提交
    completion_pct = _estimate_completion(completed_steps, remaining_plan)
    submittable = await _judge_submittability(partial_output, completion_pct)
    
    # Phase 3: 通知 Commander（如果剩余步骤 > 0 且任务重要）
    notify_commander = len(remaining_plan) > 0 and completion_pct < 0.9
    if notify_commander:
        await _notify_commander(lobster_id, task_id, remaining_plan, partial_output)
    
    # Phase 4: 记录日志
    result = WrapupResult(
        task_id=task_id,
        lobster_id=lobster_id,
        status="partial" if submittable else "abandoned",
        wrapup_reason=reason,
        partial_output=partial_output,
        completion_pct=completion_pct,
        submittable=submittable,
        remaining_steps=remaining_plan,
        notify_commander=notify_commander,
        budget_used=budget_used,
    )
    _log_wrapup(result)
    
    return result


async def _summarize_completed_work(
    lobster_id: str,
    task_id: str,
    completed_steps: list[dict],
) -> str:
    """
    用 LLM 汇总已完成的步骤产出，生成部分完成报告。
    
    Prompt（参考 ClawWork wrapup_workflow.py 的 partial_summary_prompt）：
    """
    if not completed_steps:
        return "（未完成任何步骤）"
    
    steps_text = "\n".join([
        f"步骤 {i+1}: {s.get('action', '')} → {s.get('result_summary', '')}"
        for i, s in enumerate(completed_steps)
    ])
    
    prompt = f"""
你是一名专业的工作汇报助手。
以下是龙虾 {lobster_id} 在任务 {task_id} 中已完成的工作步骤：

{steps_text}

请生成一份简洁的"已完成工作汇总"（200-400字），包括：
1. 已完成了哪些关键工作
2. 产出的核心内容/结论
3. 尚未完成的部分（如果有的话）

直接输出汇总内容，不需要标题。
"""
    from dragon_senate_saas_v2.provider_registry import call_llm
    return await call_llm(prompt, model="gpt-4o-mini", max_tokens=500)


def _estimate_completion(
    completed_steps: list[dict],
    remaining_plan: list[str],
) -> float:
    """
    估算任务完成百分比。
    简单方法：已完成步骤数 / 总步骤数
    """
    total = len(completed_steps) + len(remaining_plan)
    if total == 0:
        return 0.0
    return len(completed_steps) / total


async def _judge_submittability(
    partial_output: str,
    completion_pct: float,
) -> bool:
    """
    判断部分完成的产出是否值得提交。
    规则：
    - 完成度 >= 70%：直接认定可提交
    - 完成度 30-70%：让 LLM 判断内容质量
    - 完成度 < 30%：认定不可提交
    """
    if completion_pct >= 0.7:
        return True
    if completion_pct < 0.3:
        return False
    
    # 中间区间：LLM 判断
    prompt = f"""
以下是一份部分完成的工作产出（完成度约 {completion_pct*100:.0f}%）：

{partial_output[:1000]}

这份部分产出是否有独立的使用价值？（即使未完成，是否已经提供了有意义的内容）

只回答 YES 或 NO。
"""
    from dragon_senate_saas_v2.provider_registry import call_llm
    result = await call_llm(prompt, model="gpt-4o-mini", max_tokens=5)
    return result.strip().upper().startswith("Y")


async def _notify_commander(
    lobster_id: str,
    task_id: str,
    remaining_steps: list[str],
    partial_output: str,
):
    """
    通知 Commander 龙虾任务超限，剩余步骤需要重新分配。
    通过 lobster_mailbox 发送消息给 Commander。
    """
    from dragon_senate_saas_v2.lobster_mailbox import LobsterMailbox
    
    mailbox = LobsterMailbox()
    await mailbox.send(
        from_lobster=lobster_id,
        to_lobster="commander",
        message_type="task_wrapup_notify",
        payload={
            "task_id": task_id,
            "partial_output": partial_output[:500],  # 只发摘要
            "remaining_steps": remaining_steps,
            "needs_reassignment": True,
        }
    )
    print(f"📨 [{lobster_id}] 已通知 Commander 重新分配任务 {task_id} 的剩余步骤")


def _log_wrapup(result: WrapupResult):
    """记录收尾日志到 JSONL 文件"""
    import json
    from datetime import datetime
    from pathlib import Path
    
    log_path = Path("dragon-senate-saas-v2/data/wrapup_log.jsonl")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    
    entry = {
        "timestamp": datetime.now().isoformat(),
        "task_id": result.task_id,
        "lobster_id": result.lobster_id,
        "status": result.status,
        "reason": result.wrapup_reason,
        "completion_pct": result.completion_pct,
        "submittable": result.submittable,
        "budget_used": result.budget_used,
        "remaining_steps_count": len(result.remaining_steps),
    }
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
```

---

## Commander 收到收尾通知的处理逻辑

在 `commander_graph_builder.py` 中增加对 `task_wrapup_notify` 消息的处理：

```python
# commander_graph_builder.py 中增加

async def handle_wrapup_notify(message: dict):
    """
    Commander 收到龙虾任务超限通知后的处理：
    1. 记录部分完成状态
    2. 评估剩余步骤是否需要立即重试或延后
    3. 如果立即重试：选择最合适的龙虾重新分配
    4. 如果延后：加入任务队列等待下次调度
    """
    task_id = message["task_id"]
    remaining = message["remaining_steps"]
    
    if not remaining:
        return  # 无剩余步骤，任务完成
    
    # 评估优先级
    priority = assess_task_priority(task_id)
    
    if priority == "high":
        # 立即重新分配给另一只龙虾
        new_lobster = select_available_lobster(remaining)
        await dispatch_task(new_lobster, {
            "task_id": task_id + "_retry",
            "steps": remaining,
            "context": message["partial_output"],  # 把已完成的作为背景
        })
    else:
        # 加入队列
        await task_queue.enqueue({
            "task_id": task_id + "_remaining",
            "steps": remaining,
            "priority": priority,
        })
```

---

## 测试用例

```python
# tests/test_lobster_wrapup.py

def test_guard_check_steps():
    guard = LobsterExecutionGuard(max_steps=10, max_time_sec=600)
    assert guard.check_soft_limit(9, 10.0) is None
    assert guard.check_soft_limit(10, 10.0) is not None
    assert "steps_exceeded" in guard.check_soft_limit(10, 10.0)

def test_guard_check_timeout():
    guard = LobsterExecutionGuard(max_steps=25, max_time_sec=60)
    assert guard.check_soft_limit(0, 59.9) is None
    assert guard.check_soft_limit(0, 60.0) is not None
    assert "timeout" in guard.check_soft_limit(0, 60.0)

def test_guard_warning_injected_once():
    guard = LobsterExecutionGuard(warn_steps=5, max_steps=10, max_time_sec=600)
    # 步数未到预警线：无警告
    assert guard.check_warning(4, 0) is None
    # 步数到预警线：有警告
    warn = guard.check_warning(5, 0)
    assert warn is not None
    assert "步内完成收尾" in warn

def test_estimate_completion():
    completed = [{"action": "step1"}, {"action": "step2"}]
    remaining = ["step3"]
    pct = _estimate_completion(completed, remaining)
    assert abs(pct - 0.667) < 0.01

async def test_trigger_wrapup_partial():
    result = await trigger_wrapup(
        lobster_id="inkwriter",
        task_id="task_001",
        reason="steps_exceeded (25/25)",
        completed_steps=[{"action": "写了钩子", "result_summary": "完成3个版本"}],
        remaining_plan=["写正文", "写CTA"],
        execution_stats={"steps": 25, "time_sec": 380},
    )
    assert result.status in ("partial", "abandoned")
    assert result.completion_pct > 0
    assert result.partial_output != ""
```

---

## 验收标准

- [ ] `LobsterExecutionGuard` 步数+时间软约束正确触发（不含 Token 约束）
- [ ] 预警区间注入提示上下文（步数达到 warn_steps 或时间达到 warn_time_sec）
- [ ] 同一任务预警只注入一次（`warned` 标志位防止重复）
- [ ] `trigger_wrapup` 成功汇总已完成工作，生成 partial_output
- [ ] 完成度 >=70% 自动认定可提交，<30% 自动放弃，中间由 LLM 判断
- [ ] Commander 收到 `task_wrapup_notify` 消息后正确处理剩余步骤（重试或入队）
- [ ] 收尾日志写入 `data/wrapup_log.jsonl`
- [ ] 全部测试不涉及 Token 计数，无成本截断逻辑
