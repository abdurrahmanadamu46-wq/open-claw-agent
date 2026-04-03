# Codex 任务：Per-step Reward 框架 + Main-line/Side 标记 (CODEX-RL-02 + CODEX-RL-03)

## 任务目标

借鉴 OpenClaw-RL 的 Process Reward Model (PRM) 和 main-line/side 分类，为龙虾执行链的每一步添加：
1. **Per-step 质量评分**：不只给整个任务评分，而是给龙虾每一步独立评分
2. **Main-line vs Side 标记**：区分龙虾自主决策（可优化）和系统行为（不可优化）

**核心思路**：在 `LobsterRunner` 的 Hook 系统中添加 `RewardHook`，在每步执行后计算质量分并标记类型。这些数据与 CODEX-RL-01 的 LLM 调用日志配合，构成完整的训练数据管道。

---

## 文件 1：修改 `dragon-senate-saas-v2/lobster_runner.py`

### 当前状态
`LobsterRunner` 已有 Hook 系统：
- `LobsterHook` (抽象基类) 有 `on_start`, `on_step`, `on_end`, `on_error` 方法
- `CompositeHook` 组合多个 Hook
- `AuditHook` 记录审计日志
- `MetricsHook` 记录执行指标

### 需要添加的内容

#### 1. 新增 `StepActivity` 数据类

在 Hook 类定义之前添加：

```python
@dataclass
class StepActivity:
    """Record of a single step within a lobster execution.
    
    Inspired by OpenClaw-RL's per-step reward model (PRM) and
    main-line vs side classification.
    """
    step_index: int
    lobster_id: str
    activity_type: str  # "main_line" | "side_system" | "side_rag" | "side_tool" | "side_routing"
    action: str         # what the step did, e.g. "generate_copy", "load_role_card", "call_tool"
    
    # Timing
    started_at: float = 0.0
    ended_at: float = 0.0
    duration_ms: float = 0.0
    
    # Content summary (no full content for privacy)
    input_summary: str = ""   # first 200 chars of input
    output_summary: str = ""  # first 200 chars of output
    
    # Reward (filled by RewardHook or post-hoc)
    reward_score: float | None = None    # 0.0 to 1.0
    reward_reason: str = ""
    
    # LLM call link (connects to CODEX-RL-01 log)
    llm_call_id: str | None = None
    tokens_used: int = 0
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "lobster_id": self.lobster_id,
            "activity_type": self.activity_type,
            "action": self.action,
            "duration_ms": round(self.duration_ms, 1),
            "input_summary": self.input_summary,
            "output_summary": self.output_summary,
            "reward_score": self.reward_score,
            "reward_reason": self.reward_reason,
            "llm_call_id": self.llm_call_id,
            "tokens_used": self.tokens_used,
            "is_trainable": self.activity_type == "main_line",
        }
```

#### 2. 新增 `StepTracker` 类

```python
class StepTracker:
    """Tracks per-step activities during a lobster execution.
    
    Usage:
        tracker = StepTracker("radar")
        tracker.begin_step("generate_signal_brief", activity_type="main_line")
        # ... lobster does work ...
        tracker.end_step(output_summary="Found 3 trends", reward_score=0.8)
        
        # At the end:
        report = tracker.summary()
    """
    
    def __init__(self, lobster_id: str, task_id: str | None = None):
        self.lobster_id = lobster_id
        self.task_id = task_id
        self.steps: list[StepActivity] = []
        self._current_step: StepActivity | None = None
        self._step_counter = 0
    
    def begin_step(
        self,
        action: str,
        *,
        activity_type: str = "main_line",
        input_summary: str = "",
    ) -> StepActivity:
        """Start tracking a new step."""
        if self._current_step is not None:
            # Auto-end previous step
            self.end_step()
        
        self._step_counter += 1
        step = StepActivity(
            step_index=self._step_counter,
            lobster_id=self.lobster_id,
            activity_type=activity_type,
            action=action,
            started_at=time.monotonic(),
            input_summary=input_summary[:200],
        )
        self._current_step = step
        return step
    
    def end_step(
        self,
        *,
        output_summary: str = "",
        reward_score: float | None = None,
        reward_reason: str = "",
        llm_call_id: str | None = None,
        tokens_used: int = 0,
    ) -> StepActivity | None:
        """End the current step and record it."""
        step = self._current_step
        if step is None:
            return None
        
        step.ended_at = time.monotonic()
        step.duration_ms = (step.ended_at - step.started_at) * 1000
        step.output_summary = output_summary[:200]
        step.reward_score = reward_score
        step.reward_reason = reward_reason
        step.llm_call_id = llm_call_id
        step.tokens_used = tokens_used
        
        self.steps.append(step)
        self._current_step = None
        return step
    
    def record_side_step(
        self,
        action: str,
        *,
        activity_type: str = "side_system",
        duration_ms: float = 0,
        input_summary: str = "",
        output_summary: str = "",
    ) -> StepActivity:
        """Record a non-trainable side step (no begin/end needed)."""
        self._step_counter += 1
        step = StepActivity(
            step_index=self._step_counter,
            lobster_id=self.lobster_id,
            activity_type=activity_type,
            action=action,
            duration_ms=duration_ms,
            input_summary=input_summary[:200],
            output_summary=output_summary[:200],
        )
        self.steps.append(step)
        return step
    
    def summary(self) -> dict[str, Any]:
        """Generate a summary report of all steps."""
        main_steps = [s for s in self.steps if s.activity_type == "main_line"]
        side_steps = [s for s in self.steps if s.activity_type != "main_line"]
        scored_steps = [s for s in main_steps if s.reward_score is not None]
        
        avg_reward = (
            sum(s.reward_score for s in scored_steps) / len(scored_steps)
            if scored_steps else None
        )
        
        total_tokens = sum(s.tokens_used for s in self.steps)
        total_duration = sum(s.duration_ms for s in self.steps)
        
        return {
            "lobster_id": self.lobster_id,
            "task_id": self.task_id,
            "total_steps": len(self.steps),
            "main_line_steps": len(main_steps),
            "side_steps": len(side_steps),
            "scored_steps": len(scored_steps),
            "avg_reward": round(avg_reward, 3) if avg_reward is not None else None,
            "min_reward": min((s.reward_score for s in scored_steps), default=None),
            "max_reward": max((s.reward_score for s in scored_steps), default=None),
            "total_tokens": total_tokens,
            "total_duration_ms": round(total_duration, 1),
            "steps": [s.to_dict() for s in self.steps],
            "weakest_step": (
                min(scored_steps, key=lambda s: s.reward_score).to_dict()
                if scored_steps else None
            ),
        }
```

#### 3. 新增 `RewardHook` 类

在 `MetricsHook` 类之后添加：

```python
class RewardHook(LobsterHook):
    """Hook that tracks per-step rewards and main-line/side classification.
    
    Inspired by OpenClaw-RL's Process Reward Model (PRM).
    Works with StepTracker to record per-step quality scores.
    
    Reward scoring strategy (simple heuristic v1):
    - Output length > 0 = base 0.5
    - Output has structured markers (JSON, markdown headers) = +0.2
    - Execution within expected time = +0.2
    - No error = +0.1
    - Total capped at 1.0
    """
    
    def __init__(self, max_expected_duration_ms: float = 30000):
        self.trackers: dict[str, StepTracker] = {}
        self.max_expected_duration_ms = max_expected_duration_ms
    
    def get_tracker(self, lobster_id: str, task_id: str | None = None) -> StepTracker:
        """Get or create a StepTracker for a lobster."""
        if lobster_id not in self.trackers:
            self.trackers[lobster_id] = StepTracker(lobster_id, task_id)
        return self.trackers[lobster_id]
    
    def on_start(self, lobster_id: str, task_id: str | None = None, **kwargs: Any) -> None:
        """Initialize tracker on execution start."""
        self.trackers[lobster_id] = StepTracker(lobster_id, task_id)
    
    def on_step(
        self,
        lobster_id: str,
        step_name: str,
        *,
        activity_type: str = "main_line",
        input_data: str = "",
        output_data: str = "",
        duration_ms: float = 0,
        llm_call_id: str | None = None,
        tokens_used: int = 0,
        error: str | None = None,
        **kwargs: Any,
    ) -> None:
        """Record a step with auto-computed reward score."""
        tracker = self.get_tracker(lobster_id)
        
        # Compute heuristic reward for main-line steps
        reward_score = None
        reward_reason = ""
        
        if activity_type == "main_line" and not error:
            score = 0.0
            reasons = []
            
            # Base: has output
            if output_data and len(output_data) > 10:
                score += 0.5
                reasons.append("has_output")
            
            # Structure: has structured markers
            if any(marker in output_data for marker in ["{", "##", "- ", "1.", "|"]):
                score += 0.2
                reasons.append("structured")
            
            # Timing: within expected duration
            if 0 < duration_ms < self.max_expected_duration_ms:
                score += 0.2
                reasons.append("on_time")
            
            # No error
            score += 0.1
            reasons.append("no_error")
            
            reward_score = min(score, 1.0)
            reward_reason = "+".join(reasons)
        elif error:
            reward_score = 0.0
            reward_reason = f"error:{error[:100]}"
        
        # Record step
        if activity_type == "main_line":
            step = tracker.begin_step(step_name, activity_type=activity_type, input_summary=input_data)
            tracker.end_step(
                output_summary=output_data,
                reward_score=reward_score,
                reward_reason=reward_reason,
                llm_call_id=llm_call_id,
                tokens_used=tokens_used,
            )
        else:
            tracker.record_side_step(
                step_name,
                activity_type=activity_type,
                duration_ms=duration_ms,
                input_summary=input_data,
                output_summary=output_data,
            )
    
    def on_end(self, lobster_id: str, **kwargs: Any) -> dict[str, Any] | None:
        """Return the step summary when execution completes."""
        tracker = self.trackers.get(lobster_id)
        if tracker:
            return tracker.summary()
        return None
    
    def on_error(self, lobster_id: str, error: str, **kwargs: Any) -> None:
        """Record error in current step."""
        tracker = self.trackers.get(lobster_id)
        if tracker and tracker._current_step:
            tracker.end_step(
                output_summary=f"ERROR: {error[:200]}",
                reward_score=0.0,
                reward_reason=f"execution_error",
            )
```

---

## 文件 2：修改 `dragon-senate-saas-v2/lobster_pool_manager.py`

### 在 SQLite schema 中添加 step reward 表

在 `ensure_lobster_pool_schema()` 中添加新表：

```python
# Per-step reward tracking (借鉴 OpenClaw-RL PRM)
conn.execute("""
    CREATE TABLE IF NOT EXISTS lobster_step_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        lobster_id TEXT NOT NULL,
        task_id TEXT,
        step_index INTEGER NOT NULL,
        action TEXT NOT NULL,
        activity_type TEXT NOT NULL DEFAULT 'main_line',
        reward_score REAL,
        reward_reason TEXT,
        duration_ms REAL DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        llm_call_id TEXT
    )
""")
conn.execute("CREATE INDEX IF NOT EXISTS idx_step_rewards_lobster ON lobster_step_rewards(lobster_id, timestamp)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_step_rewards_type ON lobster_step_rewards(activity_type)")
```

### 添加持久化函数

```python
def record_step_rewards(lobster_id: str, task_id: str | None, steps: list[dict]) -> None:
    """Persist step reward data from a StepTracker summary to SQLite."""
    conn = sqlite3.connect(DB_PATH)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for step in steps:
        conn.execute(
            """INSERT INTO lobster_step_rewards 
               (timestamp, lobster_id, task_id, step_index, action, activity_type,
                reward_score, reward_reason, duration_ms, tokens_used, llm_call_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                now, lobster_id, task_id,
                step.get("step_index", 0),
                step.get("action", ""),
                step.get("activity_type", "main_line"),
                step.get("reward_score"),
                step.get("reward_reason", ""),
                step.get("duration_ms", 0),
                step.get("tokens_used", 0),
                step.get("llm_call_id"),
            ),
        )
    conn.commit()
    conn.close()


def lobster_reward_analysis(lobster_id: str, limit: int = 100) -> dict[str, Any]:
    """Analyze per-step rewards for a specific lobster.
    
    Returns average reward by action type, weakest actions, trend over time.
    Useful for identifying which steps need optimization.
    """
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # Average reward by action
    cur.execute("""
        SELECT action, activity_type, 
               COUNT(*), AVG(reward_score), MIN(reward_score), MAX(reward_score),
               AVG(duration_ms), SUM(tokens_used)
        FROM lobster_step_rewards
        WHERE lobster_id = ? AND reward_score IS NOT NULL
        GROUP BY action, activity_type
        ORDER BY AVG(reward_score) ASC
    """, (lobster_id,))
    
    by_action = [
        {
            "action": r[0], "activity_type": r[1],
            "count": r[2], "avg_reward": round(r[3], 3),
            "min_reward": round(r[4], 3), "max_reward": round(r[5], 3),
            "avg_duration_ms": round(r[6], 1), "total_tokens": r[7] or 0,
        }
        for r in cur.fetchall()
    ]
    
    # Overall stats
    cur.execute("""
        SELECT COUNT(*), AVG(reward_score), 
               COUNT(CASE WHEN activity_type = 'main_line' THEN 1 END),
               COUNT(CASE WHEN activity_type != 'main_line' THEN 1 END)
        FROM lobster_step_rewards
        WHERE lobster_id = ?
    """, (lobster_id,))
    
    row = cur.fetchone()
    conn.close()
    
    return {
        "lobster_id": lobster_id,
        "total_steps": row[0] or 0,
        "avg_reward": round(row[1], 3) if row[1] else None,
        "main_line_count": row[2] or 0,
        "side_count": row[3] or 0,
        "by_action": by_action,
        "weakest_actions": by_action[:3] if by_action else [],
    }
```

---

## 测试要求

在 `dragon-senate-saas-v2/tests/test_per_step_reward.py` 新建测试文件：

```python
"""Tests for per-step reward framework (CODEX-RL-02 + CODEX-RL-03)."""
import time
from lobster_runner import StepActivity, StepTracker, RewardHook


class TestStepActivity:
    def test_to_dict(self):
        step = StepActivity(
            step_index=1,
            lobster_id="radar",
            activity_type="main_line",
            action="scan_trends",
            reward_score=0.8,
        )
        d = step.to_dict()
        assert d["is_trainable"] is True
        assert d["reward_score"] == 0.8

    def test_side_step_not_trainable(self):
        step = StepActivity(
            step_index=1,
            lobster_id="radar",
            activity_type="side_system",
            action="load_prompt",
        )
        assert step.to_dict()["is_trainable"] is False


class TestStepTracker:
    def test_begin_end_step(self):
        tracker = StepTracker("radar")
        tracker.begin_step("scan", activity_type="main_line", input_summary="query")
        step = tracker.end_step(output_summary="result", reward_score=0.9)
        assert step is not None
        assert step.reward_score == 0.9
        assert step.duration_ms >= 0
        assert len(tracker.steps) == 1

    def test_record_side_step(self):
        tracker = StepTracker("radar")
        step = tracker.record_side_step("load_role_card", activity_type="side_system")
        assert step.activity_type == "side_system"
        assert len(tracker.steps) == 1

    def test_summary(self):
        tracker = StepTracker("radar", task_id="t1")
        tracker.begin_step("scan", activity_type="main_line")
        tracker.end_step(reward_score=0.8, tokens_used=100)
        tracker.record_side_step("load_rag", activity_type="side_rag")
        tracker.begin_step("generate", activity_type="main_line")
        tracker.end_step(reward_score=0.6, tokens_used=200)

        summary = tracker.summary()
        assert summary["total_steps"] == 3
        assert summary["main_line_steps"] == 2
        assert summary["side_steps"] == 1
        assert summary["scored_steps"] == 2
        assert summary["avg_reward"] == 0.7  # (0.8 + 0.6) / 2
        assert summary["total_tokens"] == 300
        assert summary["weakest_step"]["reward_score"] == 0.6

    def test_auto_end_previous_step(self):
        tracker = StepTracker("radar")
        tracker.begin_step("step1")
        tracker.begin_step("step2")  # should auto-end step1
        tracker.end_step()
        assert len(tracker.steps) == 2

    def test_empty_summary(self):
        tracker = StepTracker("radar")
        summary = tracker.summary()
        assert summary["total_steps"] == 0
        assert summary["avg_reward"] is None


class TestRewardHook:
    def test_on_start_creates_tracker(self):
        hook = RewardHook()
        hook.on_start("radar", task_id="t1")
        assert "radar" in hook.trackers

    def test_on_step_main_line_with_output(self):
        hook = RewardHook()
        hook.on_start("radar")
        hook.on_step(
            "radar", "generate_brief",
            activity_type="main_line",
            output_data='{"trends": ["ai", "saas"]}',
            duration_ms=5000,
        )
        summary = hook.on_end("radar")
        assert summary is not None
        assert summary["main_line_steps"] == 1
        step = summary["steps"][0]
        assert step["reward_score"] > 0.5  # should have decent score
        assert step["is_trainable"] is True

    def test_on_step_side_step(self):
        hook = RewardHook()
        hook.on_start("radar")
        hook.on_step(
            "radar", "load_system_prompt",
            activity_type="side_system",
            output_data="loaded",
            duration_ms=10,
        )
        summary = hook.on_end("radar")
        assert summary["side_steps"] == 1
        assert summary["steps"][0]["is_trainable"] is False

    def test_on_step_error_gives_zero_reward(self):
        hook = RewardHook()
        hook.on_start("radar")
        hook.on_step(
            "radar", "generate_brief",
            activity_type="main_line",
            error="LLM timeout",
        )
        summary = hook.on_end("radar")
        assert summary["steps"][0]["reward_score"] == 0.0

    def test_on_error_records_in_tracker(self):
        hook = RewardHook()
        hook.on_start("inkwriter")
        tracker = hook.get_tracker("inkwriter")
        tracker.begin_step("generate_copy", activity_type="main_line")
        hook.on_error("inkwriter", error="API failed")
        assert len(tracker.steps) == 1
        assert tracker.steps[0].reward_score == 0.0

    def test_mixed_steps(self):
        hook = RewardHook()
        hook.on_start("inkwriter", task_id="t1")
        
        # Side: load role card
        hook.on_step("inkwriter", "load_role_card", activity_type="side_system", output_data="loaded")
        # Side: inject RAG context  
        hook.on_step("inkwriter", "inject_rag", activity_type="side_rag", output_data="3 docs")
        # Main: generate copy
        hook.on_step(
            "inkwriter", "generate_copy",
            activity_type="main_line",
            output_data="## 标题\n\n成交型文案内容...",
            duration_ms=8000,
            tokens_used=500,
        )
        # Main: refine copy
        hook.on_step(
            "inkwriter", "refine_copy",
            activity_type="main_line",
            output_data="优化后的文案...",
            duration_ms=5000,
            tokens_used=300,
        )
        
        summary = hook.on_end("inkwriter")
        assert summary["main_line_steps"] == 2
        assert summary["side_steps"] == 2
        assert summary["total_tokens"] == 800
        assert summary["avg_reward"] is not None
        assert summary["avg_reward"] > 0
```

---

## 验证标准

1. ✅ `StepActivity` 数据类可正确区分 main_line vs side 类型
2. ✅ `StepTracker` 可跟踪 begin/end 步骤和 side 步骤
3. ✅ `StepTracker.summary()` 返回完整统计（含 weakest_step）
4. ✅ `RewardHook` 可自动计算启发式 reward score
5. ✅ `RewardHook` 正确集成到 `LobsterHook` 接口
6. ✅ `record_step_rewards()` 可持久化到 SQLite
7. ✅ `lobster_reward_analysis()` 可分析龙虾弱点
8. ✅ 15 项单测全部通过
9. ✅ 不破坏现有 Hook 系统

## 不要做的事

- ❌ 不要修改 `LobsterHook`, `CompositeHook`, `AuditHook`, `MetricsHook` 已有的实现
- ❌ 不要引入机器学习依赖（reward 评分目前用简单启发式）
- ❌ 不要让 reward 计算阻塞主线执行
- ❌ 不要修改 `dragon_senate.py`
- ❌ 不要记录完整的 prompt/output 内容（只记录摘要和长度）
