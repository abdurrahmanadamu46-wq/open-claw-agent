# CODEX TASK: 日志 Enrich 管道（LogEnrichPipeline）

**优先级：P1**  
**来源：OPENOBSERVE_BORROWING_ANALYSIS.md P1-#2**

---

## 背景

`llm_call_logger.py` 写入的日志字段不统一：有些缺少 `lobster_name`，边缘日志缺少 `node_id`，无派生字段（`is_slow` / `is_error` / `cost_usd`）。借鉴 OpenObserve Pipeline Enrich 概念，在 `llm_call_logger` 写入前插入标准化管道。

---

## 实现

```python
# dragon-senate-saas-v2/log_enrich_pipeline.py

import time
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── 标准日志字段（所有日志都应有的字段）──────────────────

STANDARD_LOG_FIELDS = {
    "tenant_id", "lobster_name", "session_id",
    "node_id", "timestamp", "level",
}

# ── 高成本工具（调用超过此阈值记 is_high_cost）──────────
HIGH_COST_TOOLS = {"image_generate", "voice_synthesize"}
SLOW_THRESHOLD_MS = 5000   # 超过5秒标记为 is_slow
HIGH_COST_USD = 0.05       # 超过5分钱标记为 is_high_cost


class LogEnrichPipeline:
    """
    日志标准化 Enrich 管道
    
    在 llm_call_logger.py 写入 DB 前调用：
      record = pipeline.enrich(raw_record, context)
      await db.insert("llm_call_logs", record)
    
    管道步骤：
      1. inject_standard_fields  — 注入标准字段（tenant_id / lobster_name 等）
      2. compute_derived_fields  — 计算派生字段（is_slow / is_error / cost_usd）
      3. filter_debug            — 生产环境过滤 debug 日志
      4. sanitize                — 清理敏感字段（prompt 内容截断）
    """

    def __init__(self, env: str = "production", debug_filter: bool = True):
        self.env = env
        self.debug_filter = debug_filter  # 生产环境过滤 debug 日志

    def enrich(self, record: dict, context: dict | None = None) -> dict | None:
        """
        执行完整 Enrich 管道
        
        Returns:
            enriched record dict，或 None（表示此条日志应被过滤掉）
        """
        ctx = context or {}
        record = dict(record)  # 不修改原始数据

        record = self._inject_standard_fields(record, ctx)
        record = self._compute_derived_fields(record)
        record = self._sanitize(record)

        if self.debug_filter and record.get("level") == "debug" and self.env == "production":
            return None  # 生产环境丢弃 debug 日志

        return record

    def _inject_standard_fields(self, record: dict, ctx: dict) -> dict:
        """注入缺失的标准字段（从 context 补充）"""
        if not record.get("tenant_id") and ctx.get("tenant_id"):
            record["tenant_id"] = ctx["tenant_id"]

        if not record.get("lobster_name") and ctx.get("lobster_name"):
            record["lobster_name"] = ctx["lobster_name"]

        if not record.get("session_id") and ctx.get("session_id"):
            record["session_id"] = ctx["session_id"]

        if not record.get("node_id") and ctx.get("node_id"):
            record["node_id"] = ctx["node_id"]

        if not record.get("timestamp"):
            record["timestamp"] = time.time()

        if not record.get("level"):
            record["level"] = "info"

        return record

    def _compute_derived_fields(self, record: dict) -> dict:
        """计算派生字段（is_slow / is_error / cost_usd / is_high_cost）"""
        latency = record.get("latency_ms", 0)
        record["is_slow"] = latency > SLOW_THRESHOLD_MS

        status = record.get("status", "")
        record["is_error"] = status in ("error", "failed", "timeout")

        # 估算 cost_usd（如果还没有）
        if "cost_usd" not in record:
            prompt_tokens = record.get("prompt_tokens", 0)
            completion_tokens = record.get("completion_tokens", 0)
            model = record.get("model", "")
            record["cost_usd"] = _estimate_cost(model, prompt_tokens, completion_tokens)

        record["is_high_cost"] = record["cost_usd"] > HIGH_COST_USD

        # 工具调用特化
        if record.get("tool_name") in HIGH_COST_TOOLS:
            record["is_high_cost"] = True

        return record

    def _sanitize(self, record: dict) -> dict:
        """清理/截断敏感或超大字段"""
        # prompt 内容最多保留 500 字符
        if "prompt" in record and len(str(record["prompt"])) > 500:
            record["prompt"] = str(record["prompt"])[:500] + "...[truncated]"

        # 不保存 API key
        record.pop("api_key", None)
        record.pop("secret", None)

        return record


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """根据模型估算成本（美元）"""
    # 简化价格表（每千 token 美元）
    prices = {
        "gpt-4o": (0.005, 0.015),
        "gpt-4o-mini": (0.00015, 0.0006),
        "gpt-4-turbo": (0.01, 0.03),
        "claude-3-5-sonnet": (0.003, 0.015),
        "deepseek-v3": (0.0014, 0.0028),
    }
    for key, (in_price, out_price) in prices.items():
        if key in model.lower():
            return (prompt_tokens * in_price + completion_tokens * out_price) / 1000
    return 0.0


# 全局单例
log_enrich_pipeline = LogEnrichPipeline()
```

---

## 集成到 llm_call_logger.py

```python
# dragon-senate-saas-v2/llm_call_logger.py（改造 write 方法）

from .log_enrich_pipeline import log_enrich_pipeline

class LlmCallLogger:
    async def write(self, record: dict, context: dict = None):
        # Enrich 管道处理
        enriched = log_enrich_pipeline.enrich(record, context)
        if enriched is None:
            return  # 被过滤（debug 日志等）
        
        await self.db.insert("llm_call_logs", enriched)
```

---

## 验收标准

- [ ] `LogEnrichPipeline.enrich()`：完整4步管道
- [ ] `_inject_standard_fields()`：从 context 补充缺失的标准字段
- [ ] `_compute_derived_fields()`：`is_slow` / `is_error` / `cost_usd` / `is_high_cost`
- [ ] `_sanitize()`：prompt 截断 500字符，清除 api_key/secret
- [ ] 生产环境 debug 日志过滤（`debug_filter=True`）
- [ ] `_estimate_cost()`：支持5个主流模型价格估算
- [ ] 集成到 `llm_call_logger.py` 的 `write()` 方法
- [ ] 单元测试：enrich 前后字段对比

---

*Codex Task | 来源：OPENOBSERVE_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
