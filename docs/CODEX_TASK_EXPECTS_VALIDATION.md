# CODEX TASK: expects 验收标准 + max_retries 机制

> **任务来源**：G03 — AntFarm 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/ANTFARM_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🔴 P0 极高（龙虾"完成"但下游拿到废数据，静默失败）  
> **预估工作量**：1 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查 lobster_runner.py 是否已有输出验收逻辑
grep -n "expects\|validate_output\|verify_output\|output_check\|assert.*output" \
  dragon-senate-saas-v2/lobster_runner.py 2>/dev/null

# 2. 检查 workflow_engine.py 是否已有步骤验收
grep -n "expects\|step_result\|validate\|accept" \
  dragon-senate-saas-v2/workflow_engine.py 2>/dev/null | head -20

# 3. 检查各龙虾是否已定义输出格式要求
grep -rn "output_format\|expected_output\|STATUS.*done" \
  dragon-senate-saas-v2/lobsters/ 2>/dev/null | head -20

# 4. 确认 LobsterRunResult 结构（验收需要访问 final_content）
grep -n "LobsterRunResult\|final_content\|stop_reason" \
  dragon-senate-saas-v2/lobster_runner.py 2>/dev/null | head -15
```

**冲突解决原则**：
- 若已有验收逻辑：在其基础上扩展 `expects` 关键词匹配，不重建
- `expects` 验收只在 `LobsterRunner.run()` 的结果返回前插入，不修改龙虾本身
- `max_retries` 逻辑在 `LobsterRunner` 层实现，龙虾无感

---

## 一、任务目标

实现 AntFarm 风格的输出验收机制，解决"龙虾完成了但输出无效"的静默失败问题：
1. **expects 验收**：每个龙虾步骤定义 `expects` 字符串，输出必须包含该字符串才算成功
2. **max_retries**：验收失败时自动重试，最多重试 N 次
3. **失败上报**：重试耗尽后标记任务失败，触发 escalation（见 G04 CODEX_TASK_RETRY_ESCALATE）
4. **零侵入**：龙虾本身不感知验收逻辑，验收在 Runner 层统一处理

---

## 二、实施方案

### 2.1 在 LobsterRunSpec 中新增 expects 字段

**目标文件**：`dragon-senate-saas-v2/lobster_runner.py`  
**修改位置**：`LobsterRunSpec` dataclass

```python
# 在现有 LobsterRunSpec 中新增字段（不修改其他字段）

@dataclass(slots=True)
class LobsterRunSpec:
    # ... 现有字段保持不变 ...

    # 🆕 输出验收相关字段（AntFarm expects 机制）
    expects: str | None = None
    """
    输出验收字符串：final_content 必须包含此字符串才算成功。
    None 表示不验收，任何输出都算成功。

    示例：
      expects = "STATUS: done"    # 吐墨虾文案完成标记
      expects = "SignalBrief:"    # 触须虾输出信号简报标记
      expects = "StrategyRoute:"  # 脑虫虾策略路线图标记
    """

    max_retries: int = 0
    """
    验收失败时的最大重试次数（0 = 不重试，验收失败直接上报）
    建议配置：
      普通步骤：max_retries=2
      关键节点：max_retries=3
      快速任务：max_retries=1
    """

    retry_prompt_suffix: str | None = None
    """
    重试时追加到 user_prompt 的提示（帮助 LLM 理解为什么重试）
    None 时使用默认重试提示
    """
```

### 2.2 在 LobsterRunResult 中新增验收结果字段

```python
@dataclass(slots=True)
class LobsterRunResult:
    # ... 现有字段保持不变 ...

    # 🆕 验收相关字段
    expects_passed: bool | None = None
    """True=验收通过 / False=验收失败 / None=未设置验收"""

    retry_count: int = 0
    """实际发生的重试次数"""

    expects_failure_reason: str | None = None
    """验收失败原因（供调试和 escalation 使用）"""
```

### 2.3 在 LobsterRunner.run() 中实现验收逻辑

**目标文件**：`dragon-senate-saas-v2/lobster_runner.py`  
**修改位置**：`LobsterRunner.run()` 方法的返回前，新增验收 + 重试循环

```python
# 在 LobsterRunner 中新增验收辅助方法

def _validate_expects(
    self,
    final_content: str | None,
    expects: str | None,
) -> tuple[bool, str]:
    """
    验收输出是否满足 expects 条件

    返回：(passed: bool, reason: str)
    """
    if expects is None:
        return True, "no_expects"
    if not final_content:
        return False, f"empty_output (expects: {expects!r})"
    if expects in final_content:
        return True, f"expects_matched: {expects!r}"
    # 模糊匹配（去掉大小写、空格后再试一次）
    if expects.strip().lower() in final_content.strip().lower():
        return True, f"expects_fuzzy_matched: {expects!r}"
    return False, f"expects_not_found: {expects!r} not in output ({len(final_content)} chars)"


async def _run_with_expects(self, spec: LobsterRunSpec) -> LobsterRunResult:
    """
    带 expects 验收的执行包装器

    执行流程：
      run() → 验收 → 通过 → 返回
                   → 失败 → 重试（最多 max_retries 次）→ 通过 → 返回
                                                        → 失败 → 上报 escalation
    """
    retry_count = 0
    last_result: LobsterRunResult | None = None
    expects_failure_reason: str = ""

    while True:
        # 重试时修改 user_prompt，追加重试提示
        if retry_count > 0:
            retry_suffix = spec.retry_prompt_suffix or (
                f"\n\n【重试提示】这是第 {retry_count} 次重试。"
                f"上次输出未通过验收：{expects_failure_reason}。"
                f"请确保输出包含：{spec.expects!r}"
            )
            retry_spec = LobsterRunSpec(
                **{
                    k: getattr(spec, k)
                    for k in spec.__dataclass_fields__
                    if k not in ("user_prompt", "expects", "max_retries", "retry_prompt_suffix")
                },
                user_prompt=spec.user_prompt + retry_suffix,
                expects=spec.expects,
                max_retries=spec.max_retries,
                retry_prompt_suffix=spec.retry_prompt_suffix,
            )
            result = await self.run(retry_spec)
        else:
            result = await self.run(spec)

        last_result = result

        # 验收
        passed, reason = self._validate_expects(result.final_content, spec.expects)
        if passed:
            result.expects_passed = True
            result.retry_count = retry_count
            return result

        # 验收失败
        expects_failure_reason = reason
        logger.warning(
            "[Expects] %s validation failed (attempt %d/%d): %s",
            spec.role_id, retry_count + 1, spec.max_retries + 1, reason,
        )

        if retry_count >= spec.max_retries:
            # 重试耗尽，标记失败
            result.expects_passed = False
            result.retry_count = retry_count
            result.expects_failure_reason = expects_failure_reason
            result.stop_reason = "expects_failed"
            result.error = (
                f"Output validation failed after {retry_count + 1} attempts: {reason}"
            )
            logger.error(
                "[Expects] %s failed after %d retries: %s",
                spec.role_id, retry_count + 1, reason,
            )
            return result

        retry_count += 1
        logger.info(
            "[Expects] %s retrying (%d/%d)...",
            spec.role_id, retry_count, spec.max_retries,
        )
```

---

### 2.4 各龙虾推荐的 expects 配置

**用法：在 commander_router.py 或 workflow_engine.py 构造 LobsterRunSpec 时设置**

```python
# 各龙虾推荐的 expects 字符串（对应 LOBSTER_ROSTER_CANONICAL.md 的核心工件）

LOBSTER_EXPECTS_MAP = {
    "radar":      "SignalBrief:",          # 信号简报标记
    "strategist": "StrategyRoute:",        # 策略路线图标记
    "inkwriter":  "CopyPack:",             # 文案包标记
    "visualizer": "StoryboardPack:",       # 分镜包标记
    "dispatcher": "ExecutionPlan:",        # 执行计划标记
    "echoer":     "EngagementReplyPack:",  # 互动回复包标记
    "catcher":    "LeadAssessment:",       # 线索评估标记
    "abacus":     "ValueScoreCard:",       # 价值评分卡标记
    "followup":   "FollowUpActionPlan:",   # 跟进行动计划标记
    "commander":  "MissionPlan:",          # 任务分解计划标记
}

# 龙虾各阶段 max_retries 建议
LOBSTER_MAX_RETRIES_MAP = {
    "radar":      2,  # 搜索结果可能不稳定
    "strategist": 2,  # 策略复杂，需要保障质量
    "inkwriter":  3,  # 文案格式严格，多一次机会
    "visualizer": 2,
    "dispatcher": 1,  # 执行计划相对简单
    "echoer":     2,
    "catcher":    1,
    "abacus":     2,
    "followup":   2,
    "commander":  3,  # 编排最关键
}
```

---

### 2.5 单元测试

**目标文件**：`dragon-senate-saas-v2/tests/test_expects_validation.py`（新建）

```python
"""expects 验收机制单元测试"""
import asyncio
import pytest
from unittest.mock import AsyncMock, patch
from lobster_runner import LobsterRunner, LobsterRunSpec, LobsterRunResult


class TestExpectsValidation:
    def _make_runner(self):
        mock_router = AsyncMock()
        return LobsterRunner(mock_router)

    def test_validate_expects_pass(self):
        runner = self._make_runner()
        passed, reason = runner._validate_expects("SignalBrief: hot topics...", "SignalBrief:")
        assert passed is True

    def test_validate_expects_fail(self):
        runner = self._make_runner()
        passed, reason = runner._validate_expects("here is some content", "SignalBrief:")
        assert passed is False
        assert "SignalBrief:" in reason

    def test_validate_expects_none_always_passes(self):
        runner = self._make_runner()
        passed, reason = runner._validate_expects("anything", None)
        assert passed is True

    def test_validate_expects_empty_output_fails(self):
        runner = self._make_runner()
        passed, reason = runner._validate_expects("", "SignalBrief:")
        assert passed is False

    def test_validate_expects_fuzzy_match(self):
        runner = self._make_runner()
        # 大小写不同但应模糊匹配通过
        passed, _ = runner._validate_expects("signalbrief: content", "SignalBrief:")
        assert passed is True
```

---

## 三、前端工程师对接说明

### 龙虾任务卡片新增字段

```typescript
interface LobsterTaskResult {
  // 现有字段
  final_content: string | null;
  stop_reason: string;
  error: string | null;

  // 🆕 验收相关字段
  expects_passed: boolean | null;  // null = 未配置验收
  retry_count: number;             // 实际重试次数
  expects_failure_reason: string | null;
}

// stop_reason 新增值：
// "expects_failed" → 验收失败（重试耗尽）→ 前端展示橙色警告 + 重试次数
```

### 前端展示建议

```typescript
// 在龙虾任务卡片中：
// - expects_passed = true → 显示 ✅ 绿色验收通过
// - expects_passed = false → 显示 ⚠️ 橙色"验收失败（重试 N 次）"
// - retry_count > 0 → 显示"重试了 N 次"标签
// - stop_reason = "expects_failed" → 在任务失败面板单独列出
```

---

## 四、验收标准

- [ ] `runner._validate_expects("SignalBrief: xxx", "SignalBrief:")` 返回 `(True, ...)`
- [ ] `runner._validate_expects("random text", "SignalBrief:")` 返回 `(False, ...)`
- [ ] `max_retries=2` 时，验收失败后自动重试2次，第3次失败后 `stop_reason="expects_failed"`
- [ ] `expects=None` 时，任何输出都通过验收
- [ ] 重试 user_prompt 包含"重试提示"文本
- [ ] `result.retry_count` 准确反映实际重试次数
- [ ] `python -m pytest dragon-senate-saas-v2/tests/test_expects_validation.py` 全部通过
- [ ] 现有龙虾执行流程不受影响（expects=None 默认值）

---

## 五、实施顺序

```
上午（3小时）：
  ① 冲突检查（4条 grep）
  ② 在 LobsterRunSpec 新增 expects / max_retries / retry_prompt_suffix 字段
  ③ 在 LobsterRunResult 新增 expects_passed / retry_count / expects_failure_reason 字段
  ④ 在 LobsterRunner 新增 _validate_expects() 和 _run_with_expects() 方法

下午（2小时）：
  ⑤ 在 workflow_engine.py / commander_router.py 中设置各龙虾的 expects + max_retries
  ⑥ 新建 tests/test_expects_validation.py 并通过

收尾（1小时）：
  ⑦ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_ANTFARM_EXPECTS_VALIDATION 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G03*
