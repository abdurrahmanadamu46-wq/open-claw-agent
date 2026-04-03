# CODEX TASK: Fresh Context 原则 + Token 膨胀防控

> **任务来源**：G10 — AntFarm 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/ANTFARM_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🟠 P1 重要（无限制 session history 会导致 Token 成本无限膨胀）  
> **预估工作量**：1 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查现有 session_manager.py 的 history 截断逻辑
grep -n "max_history\|truncate\|window\|fresh_context\|token.*limit" \
  dragon-senate-saas-v2/session_manager.py 2>/dev/null | head -20

# 2. 检查 LobsterRunSpec 是否已有 fresh_context 字段
grep -n "fresh_context\|context_window\|max_context" \
  dragon-senate-saas-v2/lobster_runner.py 2>/dev/null | head -10

# 3. 检查 commander_router.py 中任务之间如何传递 context
grep -n "session\|history\|context\|messages" \
  dragon-senate-saas-v2/commander_router.py 2>/dev/null | head -15

# 4. 检查现有 token 计数/估算逻辑
grep -n "token.*count\|est_token\|count_token\|tiktoken" \
  dragon-senate-saas-v2/ -r 2>/dev/null | head -10
```

**冲突解决原则**：
- 若 `fresh_context` 字段已存在于 `LobsterRunSpec`：跳过 2.1，直接实现 2.2 的 Token 预算检查
- 若 session_manager 已有截断逻辑：在其基础上新增"强制 fresh"标志，不替换现有逻辑

---

## 一、任务目标

实现 AntFarm Fresh Context 原则，防止 Token 无限膨胀：
1. **Fresh Context 标志**：每只龙虾可标记 `fresh_context=True`，跳过历史 session
2. **Token 预算检查**：每次 LLM 调用前估算 Token 数，超过阈值自动截断历史
3. **任务边界隔离**：不同主任务之间默认隔离 context，防止跨任务污染
4. **自动压缩总结**：历史过长时，先压缩为摘要再附加（配合 memory_compressor）

---

## 二、实施方案

### 2.1 在 LobsterRunSpec 新增 fresh_context 字段

> ⚠️ 注意：`lobster_runner.py` 中 `LobsterRunSpec` 可能已有此字段，检查后追加

```python
@dataclass(slots=True)
class LobsterRunSpec:
    # ... 现有字段 ...

    # 🆕 Fresh Context 控制
    fresh_context: bool = False
    """
    True = 忽略历史 session，以全新 context 开始。
    适用场景：
      - 每个新的主任务开始时（commander 编排新任务）
      - 龙虾切换到不同工作流阶段时
      - 手动"清空记忆"操作后
    False（默认）= 携带历史 session（现有行为）
    """

    max_history_messages: int = 50
    """
    携带的最大历史消息条数（防止无限膨胀）
    超过此数量时，截断最旧的消息（保留 system prompt + 最近 N 条）
    """

    max_context_tokens: int = 8000
    """
    估算的最大上下文 Token 数
    超过时自动触发历史压缩（调用 memory_compressor）
    """
```

### 2.2 Token 预算检查器（新增工具函数）

**目标文件**：`dragon-senate-saas-v2/token_budget.py`（新建）

```python
"""
Token 预算检查工具
借鉴 AntFarm Fresh Context 原则

估算 Token 数、截断历史、触发压缩
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("token_budget")

# 简单 Token 估算：平均 1 token ≈ 3.5 个 UTF-8 字符（中文偏高）
def estimate_tokens(text: str) -> int:
    """快速估算文本的 Token 数（无需加载 tiktoken）"""
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    other_chars = len(text) - chinese_chars
    return int(chinese_chars * 0.7 + other_chars / 3.5)


def estimate_messages_tokens(messages: list[dict[str, Any]]) -> int:
    """估算消息列表的总 Token 数"""
    total = 0
    for msg in messages:
        content = str(msg.get("content") or "")
        total += estimate_tokens(content) + 4  # 每条消息有约4个overhead tokens
    return total


def truncate_history(
    messages: list[dict[str, Any]],
    *,
    max_messages: int = 50,
    max_tokens: int = 8000,
    preserve_system: bool = True,
) -> tuple[list[dict[str, Any]], bool]:
    """
    截断历史消息，防止 Token 膨胀

    策略：
    1. 保留 system prompt（role="system"）
    2. 保留最新的 max_messages 条
    3. 若仍超过 max_tokens，进一步截断

    返回：(truncated_messages, was_truncated)
    """
    if not messages:
        return messages, False

    system_msgs = [m for m in messages if m.get("role") == "system"] if preserve_system else []
    non_system = [m for m in messages if m.get("role") != "system"]

    was_truncated = False

    # 按条数截断
    if len(non_system) > max_messages:
        non_system = non_system[-max_messages:]
        was_truncated = True

    # 按 Token 截断
    result = system_msgs + non_system
    total_tokens = estimate_messages_tokens(result)
    while total_tokens > max_tokens and len(non_system) > 1:
        non_system = non_system[1:]  # 删除最旧的非system消息
        result = system_msgs + non_system
        total_tokens = estimate_messages_tokens(result)
        was_truncated = True

    if was_truncated:
        logger.info(
            "[TokenBudget] Truncated history: kept %d messages, ~%d tokens",
            len(result), total_tokens,
        )

    return result, was_truncated


def apply_fresh_context(
    spec: Any,  # LobsterRunSpec
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    根据 spec 的 fresh_context 配置处理消息历史

    - fresh_context=True: 只保留 system prompt
    - fresh_context=False: 截断到 max_history_messages / max_context_tokens
    """
    if getattr(spec, "fresh_context", False):
        # 只保留 system prompt
        system_msgs = [m for m in messages if m.get("role") == "system"]
        logger.info("[TokenBudget] fresh_context=True, dropped %d history messages", len(messages) - len(system_msgs))
        return system_msgs

    max_messages = getattr(spec, "max_history_messages", 50)
    max_tokens = getattr(spec, "max_context_tokens", 8000)
    result, was_truncated = truncate_history(messages, max_messages=max_messages, max_tokens=max_tokens)
    return result
```

### 2.3 在 LobsterRunner 中集成 Token 预算检查

**目标文件**：`dragon-senate-saas-v2/lobster_runner.py`  
**修改位置**：`run()` 方法中构建 `messages` 列表之后

```python
# 在 messages 列表构建完成后（session_history 加入之后），插入 Token 预算检查

from token_budget import apply_fresh_context

# 原有代码：messages = [system] + session_history + [user]
# 修改后：在 append user message 之前，先对 session_history 应用预算检查

session_history_trimmed = apply_fresh_context(spec, session_history)
messages = [{"role": "system", "content": effective_system_prompt}]
messages.extend(session_history_trimmed)
messages.append({"role": "user", "content": effective_user_prompt})
```

### 2.4 Commander 新任务时强制 fresh_context

**目标文件**：`dragon-senate-saas-v2/commander_router.py`  
**修改位置**：构建新任务的 LobsterRunSpec 时

```python
# 在 commander 开始新的主任务时，为所有龙虾设置 fresh_context=True

def build_mission_spec(lobster_id: str, task: dict, *, is_new_mission: bool = False) -> LobsterRunSpec:
    return LobsterRunSpec(
        role_id=lobster_id,
        # ...其他字段...
        fresh_context=is_new_mission,  # 新任务强制隔离 context
        max_history_messages=50,
        max_context_tokens=8000,
    )
```

---

## 三、前端工程师对接说明

### Token 使用量展示

```typescript
// 在龙虾任务卡片中展示 Token 统计
interface TaskTokenInfo {
  estimated_context_tokens: number;  // 本次调用的上下文 Token 数
  was_history_truncated: boolean;    // 是否触发了历史截断
  fresh_context_used: boolean;       // 是否使用了 fresh context
}

// 提示文案（若 was_history_truncated = true）：
// "⚡ 为节约成本，历史记录已自动压缩"
```

---

## 四、验收标准

- [ ] `estimate_tokens("你好世界")` 返回合理值（约 3-4）
- [ ] `truncate_history(100条消息, max_messages=50)` 返回50条并标记 `was_truncated=True`
- [ ] `apply_fresh_context(spec with fresh_context=True, messages)` 只返回 system prompt
- [ ] LobsterRunner 中 session_history 超过50条时自动截断
- [ ] commander 开始新任务时 spec.fresh_context=True
- [ ] 现有龙虾默认行为不受影响（fresh_context 默认 False）

---

## 五、实施顺序

```
上午（3小时）：
  ① 冲突检查（4条 grep）
  ② 新建 token_budget.py（完整代码见 2.2）
  ③ 在 LobsterRunSpec 新增 fresh_context / max_history_messages / max_context_tokens（见 2.1）

下午（2小时）：
  ④ 在 lobster_runner.py run() 中集成 apply_fresh_context()（见 2.3，约5行）
  ⑤ 在 commander_router.py 的新任务逻辑中设置 fresh_context=True（见 2.4）
  ⑥ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_ANTFARM_FRESH_CONTEXT 为 ✅）
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G10*
