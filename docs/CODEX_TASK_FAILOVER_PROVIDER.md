# CODEX TASK: FailoverProvider 多 Provider 故障转移

> **任务来源**：G02 — IronClaw 借鉴分析差距报告 2026-04-01  
> **参考文档**：docs/IRONCLAW_BORROWING_ANALYSIS.md / docs/BORROWING_GAP_ANALYSIS_2026-04-01.md  
> **优先级**：🔴 P0 极高（任一 Provider 宕机 → 全部龙虾停摆）  
> **预估工作量**：1 天  
> **负责人**：Codex  

---

## ⚠️ 开始前：冲突检查（必须执行）

```bash
# 1. 检查 provider_registry.py 现有 Provider 切换逻辑
grep -n "fallback\|failover\|retry\|RateLimitError\|switch\|next_provider" \
  dragon-senate-saas-v2/provider_registry.py 2>/dev/null

# 2. 检查 llm_router.py 是否已有故障切换
grep -n "failover\|fallback\|retry\|exception\|error.*provider" \
  dragon-senate-saas-v2/llm_router.py 2>/dev/null | head -20

# 3. 确认当前 Provider 列表
grep -n "providers\|PROVIDERS\|provider_name\|class.*Provider" \
  dragon-senate-saas-v2/provider_registry.py 2>/dev/null | head -20

# 4. 检查现有错误码处理
grep -n "429\|401\|403\|503\|RateLimit\|AuthError\|ServiceUnavailable" \
  dragon-senate-saas-v2/provider_registry.py dragon-senate-saas-v2/llm_router.py 2>/dev/null
```

**冲突解决原则**：
- 若已有 retry 逻辑：在其基础上扩展为多 Provider 切换，不重建
- FailoverProvider 是包装层，不修改现有 Provider 实现
- 只新增 `failover_provider.py`，修改 `provider_registry.py` 的注册入口

---

## 一、任务目标

实现多 Provider 自动故障转移，使得：
1. **可重试错误**（429 限速 / 503 超时）→ 自动切换下一个 Provider 重试
2. **不可重试错误**（401/403 认证失败）→ 立即上报，跳过重试节省时间
3. **全部 Provider 失败**→ 返回标准错误响应，不抛出未捕获异常
4. **健康状态追踪**→ 记录每个 Provider 的成功/失败次数，供监控使用

---

## 二、实施方案

### 2.1 新建 FailoverProvider（核心文件）

**目标文件**：`dragon-senate-saas-v2/failover_provider.py`（新建）

```python
"""
FailoverProvider — 多 Provider 自动故障转移包装器
借鉴 IronClaw FailoverProvider 设计

设计理念：
- 透明包装：对龙虾调用方无感，接口与单 Provider 完全一致
- 错误分类：可重试（限速/超时）vs 不可重试（认证失败）
- 快速失败：不可重试错误立即上报，不浪费重试次数
- 状态追踪：每个 Provider 的健康状况持久化到内存+可选 SQLite
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger("failover_provider")


# ── 错误分类 ──────────────────────────────────────────────────────

# 可重试错误：限速/超时/临时服务不可用
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
RETRYABLE_ERROR_KEYWORDS = [
    "rate limit", "ratelimit", "too many requests",
    "timeout", "timed out", "connection reset",
    "service unavailable", "overloaded",
]

# 不可重试错误：认证失败/权限拒绝
NON_RETRYABLE_STATUS_CODES = {400, 401, 403}
NON_RETRYABLE_ERROR_KEYWORDS = [
    "invalid api key", "unauthorized", "forbidden",
    "authentication", "invalid_api_key",
]


def classify_error(error: Exception) -> str:
    """
    分类错误类型
    返回: "retryable" | "non_retryable" | "unknown"
    """
    msg = str(error).lower()
    # 检查状态码（从异常属性或消息中提取）
    status = getattr(error, "status_code", None) or getattr(error, "http_status", None)
    if status:
        if int(status) in NON_RETRYABLE_STATUS_CODES:
            return "non_retryable"
        if int(status) in RETRYABLE_STATUS_CODES:
            return "retryable"
    # 关键词匹配
    for kw in NON_RETRYABLE_ERROR_KEYWORDS:
        if kw in msg:
            return "non_retryable"
    for kw in RETRYABLE_ERROR_KEYWORDS:
        if kw in msg:
            return "retryable"
    return "unknown"


# ── Provider 健康状态 ──────────────────────────────────────────────

@dataclass
class ProviderHealth:
    provider_name: str
    success_count: int = 0
    failure_count: int = 0
    last_failure_at: float = 0.0
    last_failure_reason: str = ""
    is_suspended: bool = False   # 连续失败太多时临时挂起
    suspend_until: float = 0.0   # 挂起到什么时候

    @property
    def is_available(self) -> bool:
        if not self.is_suspended:
            return True
        # 挂起期已过，自动恢复
        if time.monotonic() > self.suspend_until:
            self.is_suspended = False
            return True
        return False

    def record_success(self) -> None:
        self.success_count += 1
        self.is_suspended = False

    def record_failure(self, reason: str, suspend_seconds: float = 60.0) -> None:
        self.failure_count += 1
        self.last_failure_at = time.monotonic()
        self.last_failure_reason = reason
        # 连续失败 3 次，临时挂起
        if self.failure_count % 3 == 0:
            self.is_suspended = True
            self.suspend_until = time.monotonic() + suspend_seconds
            logger.warning(
                "[Failover] Provider %s suspended for %.0fs (consecutive failures)",
                self.provider_name, suspend_seconds,
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider_name": self.provider_name,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "is_available": self.is_available,
            "is_suspended": self.is_suspended,
            "last_failure_reason": self.last_failure_reason,
        }


# ── FailoverProvider 主类 ──────────────────────────────────────────

class FailoverProvider:
    """
    多 Provider 故障转移包装器

    用法：
        providers = [
            registry.get_provider("dashscope"),
            registry.get_provider("deepseek"),
            registry.get_provider("local"),
        ]
        failover = FailoverProvider(providers)
        result = await failover.ainvoke(messages, **kwargs)

    当 providers[0] 失败时，自动切换到 providers[1]，依此类推。
    不可重试错误（401/403）立即上报，不浪费后续重试。
    """

    def __init__(
        self,
        providers: list[Any],
        *,
        max_retries_per_provider: int = 1,
        retry_delay_seconds: float = 1.0,
        suspend_seconds: float = 60.0,
    ) -> None:
        self.providers = providers
        self.max_retries_per_provider = max_retries_per_provider
        self.retry_delay_seconds = retry_delay_seconds
        self.suspend_seconds = suspend_seconds
        self._health: dict[str, ProviderHealth] = {
            self._provider_name(p): ProviderHealth(self._provider_name(p))
            for p in providers
        }

    @staticmethod
    def _provider_name(provider: Any) -> str:
        return str(
            getattr(provider, "provider_name", None)
            or getattr(provider, "name", None)
            or type(provider).__name__
        )

    def health_report(self) -> list[dict[str, Any]]:
        """返回所有 Provider 的健康状态报告"""
        return [h.to_dict() for h in self._health.values()]

    async def ainvoke(self, messages: list[dict], **kwargs: Any) -> Any:
        """
        异步调用，自动故障转移

        尝试顺序：providers[0] → providers[1] → ... → 全部失败
        """
        last_error: Exception | None = None
        errors: list[str] = []

        for provider in self.providers:
            name = self._provider_name(provider)
            health = self._health[name]

            if not health.is_available:
                logger.info("[Failover] Skipping suspended provider: %s", name)
                continue

            for attempt in range(self.max_retries_per_provider + 1):
                try:
                    if attempt > 0:
                        await asyncio.sleep(self.retry_delay_seconds * attempt)

                    # 调用 Provider（适配不同 Provider 接口）
                    result = await self._call_provider(provider, messages, **kwargs)
                    health.record_success()
                    logger.info("[Failover] Provider %s succeeded (attempt %d)", name, attempt + 1)
                    return result

                except Exception as e:
                    error_type = classify_error(e)
                    last_error = e
                    error_msg = f"{name}[{attempt+1}]: {type(e).__name__}: {e}"
                    errors.append(error_msg)
                    logger.warning("[Failover] %s | type=%s", error_msg, error_type)

                    if error_type == "non_retryable":
                        # 不可重试：记录失败，立即切换下一个 Provider
                        health.record_failure(f"non_retryable: {e}", self.suspend_seconds)
                        logger.error(
                            "[Failover] Non-retryable error on %s, switching immediately: %s",
                            name, e,
                        )
                        break  # 跳出 attempt 循环，切换下一个 Provider

                    # 可重试或未知错误：记录并重试
                    health.record_failure(f"retryable: {e}", self.suspend_seconds)
                    if attempt >= self.max_retries_per_provider:
                        logger.warning("[Failover] Max retries reached for %s, switching", name)

        # 所有 Provider 均失败
        error_summary = " | ".join(errors)
        logger.error("[Failover] All providers failed: %s", error_summary)
        raise RuntimeError(
            f"All {len(self.providers)} providers failed. "
            f"Last error: {last_error}. Details: {error_summary}"
        )

    async def _call_provider(self, provider: Any, messages: list[dict], **kwargs: Any) -> Any:
        """
        适配不同 Provider 的调用接口
        根据实际 provider_registry.py 中 Provider 的接口调整
        """
        # 优先使用 ainvoke（异步接口）
        if hasattr(provider, "ainvoke"):
            return await provider.ainvoke(messages, **kwargs)
        # 降级使用 invoke（同步包装为异步）
        if hasattr(provider, "invoke"):
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, lambda: provider.invoke(messages, **kwargs))
        # 降级使用 acomplete / complete
        if hasattr(provider, "acomplete"):
            return await provider.acomplete(messages, **kwargs)
        raise NotImplementedError(f"Provider {type(provider).__name__} has no invoke/ainvoke interface")
```

---

### 2.2 集成到 provider_registry.py

**目标文件**：`dragon-senate-saas-v2/provider_registry.py`  
**⚠️ 只在注册入口处新增 FailoverProvider 包装，不修改现有 Provider 实现**

```python
# 在 provider_registry.py 中新增 FailoverProvider 工厂方法

from failover_provider import FailoverProvider

class ProviderRegistry:
    # ... 现有代码保持不变 ...

    def get_failover_provider(
        self,
        primary_names: list[str] | None = None,
        *,
        max_retries_per_provider: int = 1,
    ) -> FailoverProvider:
        """
        创建 FailoverProvider，按优先级顺序排列 Provider

        默认顺序：主配置 Provider → 备用 Provider → 本地 Provider
        """
        # 从环境变量读取优先级顺序（可配置）
        import os
        order_str = os.getenv("PROVIDER_FAILOVER_ORDER", "")
        if order_str:
            names = [n.strip() for n in order_str.split(",") if n.strip()]
        elif primary_names:
            names = primary_names
        else:
            # 默认顺序：已注册的 Provider，local 兜底
            names = list(self._providers.keys())

        providers = []
        for name in names:
            p = self._providers.get(name)
            if p is not None:
                providers.append(p)

        if not providers:
            raise ValueError("No providers available for failover")

        return FailoverProvider(
            providers,
            max_retries_per_provider=max_retries_per_provider,
        )
```

---

### 2.3 在 llm_router.py 中使用 FailoverProvider

```python
# 在 LLMRouter.routed_ainvoke_text() 中，将单 Provider 调用替换为 FailoverProvider

# 修改前（示例）：
# provider = registry.get_provider(provider_name)
# result = await provider.ainvoke(messages)

# 修改后：
# failover = registry.get_failover_provider()
# result = await failover.ainvoke(messages)
```

---

### 2.4 单元测试

**目标文件**：`dragon-senate-saas-v2/tests/test_failover_provider.py`（新建）

```python
"""FailoverProvider 单元测试"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock
from failover_provider import FailoverProvider, classify_error


class TestClassifyError:
    def test_401_is_non_retryable(self):
        err = Exception("401 Unauthorized invalid_api_key")
        assert classify_error(err) == "non_retryable"

    def test_429_is_retryable(self):
        err = Exception("429 Too Many Requests rate limit exceeded")
        assert classify_error(err) == "retryable"

    def test_503_is_retryable(self):
        err = Exception("503 Service Unavailable")
        assert classify_error(err) == "retryable"


class TestFailoverProvider:
    @pytest.fixture
    def good_provider(self):
        p = MagicMock()
        p.provider_name = "good"
        p.ainvoke = AsyncMock(return_value="ok response")
        return p

    @pytest.fixture
    def rate_limit_then_ok_provider(self):
        p = MagicMock()
        p.provider_name = "rate_limit_then_ok"
        call_count = {"n": 0}
        async def ainvoke(messages, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise Exception("429 rate limit")
            return "ok after retry"
        p.ainvoke = ainvoke
        return p

    @pytest.fixture
    def always_fail_401_provider(self):
        p = MagicMock()
        p.provider_name = "always_401"
        p.ainvoke = AsyncMock(side_effect=Exception("401 Unauthorized invalid_api_key"))
        return p

    def test_first_provider_succeeds(self, good_provider):
        fp = FailoverProvider([good_provider])
        result = asyncio.run(fp.ainvoke([{"role": "user", "content": "hi"}]))
        assert result == "ok response"

    def test_failover_to_second_on_401(self, always_fail_401_provider, good_provider):
        fp = FailoverProvider([always_fail_401_provider, good_provider])
        result = asyncio.run(fp.ainvoke([{"role": "user", "content": "hi"}]))
        assert result == "ok response"

    def test_all_fail_raises(self, always_fail_401_provider):
        fp = FailoverProvider([always_fail_401_provider])
        with pytest.raises(RuntimeError, match="All.*providers failed"):
            asyncio.run(fp.ainvoke([{"role": "user", "content": "hi"}]))

    def test_health_report(self, good_provider):
        fp = FailoverProvider([good_provider])
        asyncio.run(fp.ainvoke([{"role": "user", "content": "hi"}]))
        report = fp.health_report()
        assert report[0]["success_count"] == 1
        assert report[0]["failure_count"] == 0
```

---

## 三、前端工程师对接说明

### 新增 API 端点

```typescript
// GET /api/v1/providers/health
// 返回所有 Provider 健康状态（供运维大盘展示）
interface ProviderHealthResponse {
  providers: Array<{
    provider_name: string;
    success_count: number;
    failure_count: number;
    is_available: boolean;
    is_suspended: boolean;
    last_failure_reason: string;
  }>;
  generated_at: string;
}

// 建议在 /operations/ 运维页面新增"Provider 健康状态"卡片
// - 绿色：is_available = true
// - 红色：is_suspended = true（展示 suspend 剩余时间）
```

### 环境变量配置

```bash
# .env 新增（可选）
# Provider 故障转移顺序（逗号分隔，左边优先）
PROVIDER_FAILOVER_ORDER=dashscope,deepseek,volcengine,local
```

---

## 四、验收标准

- [ ] `from failover_provider import FailoverProvider` 正常导入
- [ ] Provider 1 返回 429 时，自动切换到 Provider 2 并成功
- [ ] Provider 1 返回 401 时，立即切换到 Provider 2（不重试 Provider 1）
- [ ] 所有 Provider 失败时，抛出 `RuntimeError` 而非未捕获的原始异常
- [ ] `fp.health_report()` 返回各 Provider 成功/失败计数
- [ ] `python -m pytest dragon-senate-saas-v2/tests/test_failover_provider.py` 全部通过
- [ ] 现有 Provider 测试不受影响

---

## 五、实施顺序

```
上午（3小时）：
  ① 执行冲突检查（4条 grep）
  ② 新建 failover_provider.py（完整代码见 2.1）
  ③ 在 provider_registry.py 新增 get_failover_provider() 方法（见 2.2）

下午（2小时）：
  ④ 在 llm_router.py 中替换单 Provider 调用为 FailoverProvider（见 2.3）
  ⑤ 新建 tests/test_failover_provider.py 并通过（见 2.4）

收尾（1小时）：
  ⑥ 更新 PROJECT_CONTROL_CENTER.md（标记 CODEX_IRONCLAW_FAILOVER_PROVIDER 为 ✅）
  ⑦ 在 app.py 新增 GET /api/v1/providers/health 端点
```

---

*创建时间：2026-04-01 | 来源：BORROWING_GAP_ANALYSIS_2026-04-01.md G02*
