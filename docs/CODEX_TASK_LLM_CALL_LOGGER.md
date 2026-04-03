# Codex 任务：LLM 调用日志记录层 (CODEX-RL-01)

## 任务目标

借鉴 OpenClaw-RL 的"对话驱动持续优化"理念，为所有 LLM 调用添加异步日志记录层，积累 input→output→outcome 三元组训练数据。未来可用于龙虾专属模型微调。

**核心思路**：每次 LLM 调用时，异步记录完整的请求/响应/元数据到 SQLite 表，不影响主线执行性能。

---

## 文件 1：修改 `dragon-senate-saas-v2/provider_registry.py`

### 当前状态
`ProviderInstance` 已有 `record_success()` 和 `record_error()` 方法，但**只统计计数，不记录内容**。

### 需要添加的内容

在文件末尾（`get_provider_registry()` 函数之后）添加以下新部分：

```python
# ────────────────────────────────────────────────────────────────────
# LLM 调用日志 — 积累训练数据（借鉴 OpenClaw-RL 对话轨迹收集）
# ────────────────────────────────────────────────────────────────────

import json
import sqlite3
import asyncio
import uuid
from pathlib import Path
from collections import deque
from threading import Lock

_LLM_LOG_DB_PATH = os.getenv("LLM_LOG_DB", "data/llm_call_log.sqlite")
_LLM_LOG_BUFFER: deque[dict[str, Any]] = deque(maxlen=500)
_LLM_LOG_LOCK = Lock()
_LLM_LOG_FLUSH_TASK: asyncio.Task | None = None


def _ensure_llm_log_schema() -> None:
    """Create the LLM call log table if not exists."""
    Path(_LLM_LOG_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_LLM_LOG_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS llm_call_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_id TEXT NOT NULL UNIQUE,
            timestamp TEXT NOT NULL,
            provider_name TEXT NOT NULL,
            model TEXT NOT NULL,
            lobster_id TEXT,
            task_id TEXT,
            tenant_id TEXT,
            
            -- Input
            system_prompt_hash TEXT,
            system_prompt_len INTEGER DEFAULT 0,
            user_message_preview TEXT,
            user_message_len INTEGER DEFAULT 0,
            messages_count INTEGER DEFAULT 0,
            total_input_chars INTEGER DEFAULT 0,
            temperature REAL,
            max_tokens INTEGER,
            tools_count INTEGER DEFAULT 0,
            
            -- Output
            output_preview TEXT,
            output_len INTEGER DEFAULT 0,
            finish_reason TEXT,
            
            -- Metrics
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            latency_ms REAL DEFAULT 0,
            estimated_cost_cny REAL DEFAULT 0,
            
            -- Classification (借鉴 OpenClaw-RL main-line vs side)
            call_type TEXT DEFAULT 'main_line',
            
            -- Outcome (后续补填)
            outcome_score REAL,
            outcome_label TEXT,
            outcome_detail TEXT,
            
            -- Status
            status TEXT DEFAULT 'success',
            error_message TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_lobster ON llm_call_log(lobster_id, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_provider ON llm_call_log(provider_name, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_type ON llm_call_log(call_type, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_llm_log_tenant ON llm_call_log(tenant_id, timestamp)")
    conn.commit()
    conn.close()


def log_llm_call(
    *,
    provider_name: str,
    model: str,
    messages: list[dict[str, Any]] | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    tools: list | None = None,
    output: str | None = None,
    finish_reason: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    latency_ms: float = 0,
    lobster_id: str | None = None,
    task_id: str | None = None,
    tenant_id: str | None = None,
    call_type: str = "main_line",
    status: str = "success",
    error_message: str | None = None,
    input_price_per_mtok: float = 0.0,
    output_price_per_mtok: float = 0.0,
) -> str:
    """
    Record an LLM call to the async buffer. Returns call_id.
    
    call_type should be one of:
      - "main_line": Lobster's own reasoning/generation (trainable)
      - "side_system": System prompt injection (non-trainable)
      - "side_rag": RAG context injection (non-trainable)
      - "side_tool": Tool result processing (non-trainable)
      - "side_routing": Commander routing decision (non-trainable)
    """
    call_id = str(uuid.uuid4())
    
    # Extract message stats
    system_prompt_hash = None
    system_prompt_len = 0
    user_message_preview = None
    user_message_len = 0
    messages_count = 0
    total_input_chars = 0
    
    if messages:
        messages_count = len(messages)
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total_input_chars += len(content)
                if msg.get("role") == "system":
                    system_prompt_len = len(content)
                    system_prompt_hash = str(hash(content))
                elif msg.get("role") == "user":
                    user_message_len = len(content)
                    user_message_preview = content[:200]
    
    # Estimated cost
    total_tokens = input_tokens + output_tokens
    estimated_cost = (
        (input_tokens / 1_000_000) * input_price_per_mtok +
        (output_tokens / 1_000_000) * output_price_per_mtok
    )
    
    record = {
        "call_id": call_id,
        "timestamp": datetime.now(timezone.utc).isoformat() if 'datetime' in dir() else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provider_name": provider_name,
        "model": model,
        "lobster_id": lobster_id,
        "task_id": task_id,
        "tenant_id": tenant_id,
        "system_prompt_hash": system_prompt_hash,
        "system_prompt_len": system_prompt_len,
        "user_message_preview": user_message_preview,
        "user_message_len": user_message_len,
        "messages_count": messages_count,
        "total_input_chars": total_input_chars,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "tools_count": len(tools) if tools else 0,
        "output_preview": (output[:300] if output else None),
        "output_len": len(output) if output else 0,
        "finish_reason": finish_reason,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "latency_ms": latency_ms,
        "estimated_cost_cny": round(estimated_cost, 6),
        "call_type": call_type,
        "outcome_score": None,
        "outcome_label": None,
        "outcome_detail": None,
        "status": status,
        "error_message": error_message[:500] if error_message else None,
    }
    
    with _LLM_LOG_LOCK:
        _LLM_LOG_BUFFER.append(record)
    
    return call_id


def update_llm_call_outcome(
    call_id: str,
    *,
    outcome_score: float | None = None,
    outcome_label: str | None = None,
    outcome_detail: str | None = None,
) -> None:
    """
    Update the outcome of a previously logged LLM call.
    This is the key feedback loop for future RL training.
    
    Example:
      update_llm_call_outcome(call_id, outcome_score=0.85, outcome_label="good_copy")
    """
    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        conn.execute(
            """UPDATE llm_call_log 
               SET outcome_score = ?, outcome_label = ?, outcome_detail = ?
               WHERE call_id = ?""",
            (outcome_score, outcome_label, outcome_detail, call_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning("Failed to update LLM call outcome %s: %s", call_id, e)


def _flush_llm_log_buffer() -> int:
    """Flush buffered log entries to SQLite. Returns count flushed."""
    with _LLM_LOG_LOCK:
        if not _LLM_LOG_BUFFER:
            return 0
        batch = list(_LLM_LOG_BUFFER)
        _LLM_LOG_BUFFER.clear()
    
    if not batch:
        return 0
    
    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        columns = list(batch[0].keys())
        placeholders = ", ".join(["?"] * len(columns))
        col_names = ", ".join(columns)
        
        conn.executemany(
            f"INSERT OR IGNORE INTO llm_call_log ({col_names}) VALUES ({placeholders})",
            [tuple(record.get(c) for c in columns) for record in batch],
        )
        conn.commit()
        conn.close()
        return len(batch)
    except Exception as e:
        logger.warning("Failed to flush LLM log buffer: %s", e)
        return 0


async def _llm_log_flush_loop() -> None:
    """Background loop that flushes the LLM log buffer every 10 seconds."""
    while True:
        await asyncio.sleep(10)
        count = _flush_llm_log_buffer()
        if count > 0:
            logger.debug("Flushed %d LLM call logs to SQLite", count)


def start_llm_log_flusher() -> None:
    """Start the background LLM log flush loop (call once at app startup)."""
    global _LLM_LOG_FLUSH_TASK
    if _LLM_LOG_FLUSH_TASK is None or _LLM_LOG_FLUSH_TASK.done():
        loop = asyncio.get_event_loop()
        _LLM_LOG_FLUSH_TASK = loop.create_task(_llm_log_flush_loop())


def stop_llm_log_flusher() -> None:
    """Stop the background flush loop."""
    global _LLM_LOG_FLUSH_TASK
    if _LLM_LOG_FLUSH_TASK and not _LLM_LOG_FLUSH_TASK.done():
        _LLM_LOG_FLUSH_TASK.cancel()
        _LLM_LOG_FLUSH_TASK = None
    # Final flush
    _flush_llm_log_buffer()


def llm_log_stats() -> dict[str, Any]:
    """Return summary stats from the LLM call log for diagnostics."""
    try:
        _ensure_llm_log_schema()
        conn = sqlite3.connect(_LLM_LOG_DB_PATH)
        cur = conn.cursor()
        
        cur.execute("SELECT COUNT(*) FROM llm_call_log")
        total = cur.fetchone()[0]
        
        cur.execute("SELECT COUNT(*) FROM llm_call_log WHERE call_type = 'main_line'")
        main_line = cur.fetchone()[0]
        
        cur.execute("SELECT COUNT(*) FROM llm_call_log WHERE outcome_score IS NOT NULL")
        with_outcome = cur.fetchone()[0]
        
        cur.execute("SELECT SUM(total_tokens), SUM(estimated_cost_cny) FROM llm_call_log")
        row = cur.fetchone()
        total_tokens = row[0] or 0
        total_cost = row[1] or 0.0
        
        cur.execute("""
            SELECT lobster_id, COUNT(*), SUM(total_tokens)
            FROM llm_call_log
            WHERE lobster_id IS NOT NULL
            GROUP BY lobster_id
            ORDER BY COUNT(*) DESC
        """)
        by_lobster = [
            {"lobster_id": r[0], "call_count": r[1], "total_tokens": r[2] or 0}
            for r in cur.fetchall()
        ]
        
        conn.close()
        return {
            "total_calls": total,
            "main_line_calls": main_line,
            "side_calls": total - main_line,
            "with_outcome": with_outcome,
            "trainable_ratio": round(with_outcome / total, 3) if total > 0 else 0,
            "total_tokens": total_tokens,
            "total_cost_cny": round(total_cost, 4),
            "by_lobster": by_lobster,
            "buffer_size": len(_LLM_LOG_BUFFER),
        }
    except Exception as e:
        return {"error": str(e)}
```

### 需要在文件顶部添加的 import

在现有的 `import time` 后面添加：

```python
from datetime import datetime, timezone
```

---

## 文件 2：修改 `dragon-senate-saas-v2/app.py`

### 在 FastAPI app 启动时调用

在 `app.py` 的 `@app.on_event("startup")` 或等效的启动函数中添加：

```python
from provider_registry import start_llm_log_flusher
start_llm_log_flusher()
```

在 `@app.on_event("shutdown")` 中添加：

```python
from provider_registry import stop_llm_log_flusher
stop_llm_log_flusher()
```

### 添加诊断 API 端点

在 `app.py` 中添加一个新的诊断端点：

```python
@app.get("/api/diagnostics/llm-log-stats")
async def get_llm_log_stats():
    from provider_registry import llm_log_stats
    return llm_log_stats()
```

---

## 测试要求

在 `dragon-senate-saas-v2/tests/test_llm_call_logger.py` 新建测试文件：

```python
"""Tests for LLM call logger (CODEX-RL-01)."""
import os
import tempfile
import pytest

# Override DB path before import
os.environ["LLM_LOG_DB"] = os.path.join(tempfile.mkdtemp(), "test_llm_log.sqlite")

from provider_registry import (
    log_llm_call,
    update_llm_call_outcome,
    _flush_llm_log_buffer,
    llm_log_stats,
    _LLM_LOG_BUFFER,
)


class TestLLMCallLogger:
    def setup_method(self):
        _LLM_LOG_BUFFER.clear()

    def test_log_llm_call_returns_call_id(self):
        call_id = log_llm_call(
            provider_name="deepseek",
            model="deepseek-chat",
            output="Hello world",
            input_tokens=100,
            output_tokens=50,
        )
        assert isinstance(call_id, str)
        assert len(call_id) == 36  # UUID format

    def test_log_adds_to_buffer(self):
        log_llm_call(provider_name="test", model="test-model")
        assert len(_LLM_LOG_BUFFER) == 1

    def test_flush_writes_to_sqlite(self):
        log_llm_call(
            provider_name="deepseek",
            model="deepseek-chat",
            lobster_id="radar",
            call_type="main_line",
            input_tokens=200,
            output_tokens=100,
        )
        count = _flush_llm_log_buffer()
        assert count == 1
        assert len(_LLM_LOG_BUFFER) == 0

    def test_call_type_classification(self):
        log_llm_call(provider_name="test", model="m", call_type="main_line")
        log_llm_call(provider_name="test", model="m", call_type="side_system")
        log_llm_call(provider_name="test", model="m", call_type="side_rag")
        assert len(_LLM_LOG_BUFFER) == 3
        types = [r["call_type"] for r in _LLM_LOG_BUFFER]
        assert types == ["main_line", "side_system", "side_rag"]

    def test_message_stats_extraction(self):
        messages = [
            {"role": "system", "content": "You are a helpful assistant"},
            {"role": "user", "content": "Hello!"},
        ]
        log_llm_call(provider_name="test", model="m", messages=messages)
        record = _LLM_LOG_BUFFER[-1]
        assert record["messages_count"] == 2
        assert record["system_prompt_len"] > 0
        assert record["user_message_preview"] == "Hello!"

    def test_cost_estimation(self):
        log_llm_call(
            provider_name="deepseek",
            model="deepseek-chat",
            input_tokens=1_000_000,
            output_tokens=500_000,
            input_price_per_mtok=1.0,
            output_price_per_mtok=2.0,
        )
        record = _LLM_LOG_BUFFER[-1]
        assert record["estimated_cost_cny"] == 2.0  # 1*1 + 0.5*2 = 2.0

    def test_update_outcome(self):
        call_id = log_llm_call(provider_name="test", model="m")
        _flush_llm_log_buffer()
        # Should not raise
        update_llm_call_outcome(call_id, outcome_score=0.85, outcome_label="good")

    def test_llm_log_stats_returns_dict(self):
        log_llm_call(provider_name="test", model="m", lobster_id="radar", call_type="main_line")
        log_llm_call(provider_name="test", model="m", lobster_id="radar", call_type="side_system")
        _flush_llm_log_buffer()
        stats = llm_log_stats()
        assert isinstance(stats, dict)
        assert stats["total_calls"] >= 2
        assert stats["main_line_calls"] >= 1

    def test_error_logging(self):
        log_llm_call(
            provider_name="test",
            model="m",
            status="error",
            error_message="Connection timeout",
        )
        record = _LLM_LOG_BUFFER[-1]
        assert record["status"] == "error"
        assert record["error_message"] == "Connection timeout"

    def test_buffer_max_size(self):
        for i in range(600):
            log_llm_call(provider_name="test", model="m")
        # Buffer maxlen is 500
        assert len(_LLM_LOG_BUFFER) == 500
```

---

## 验证标准

1. ✅ `log_llm_call()` 函数可记录完整的 LLM 调用信息
2. ✅ `call_type` 字段区分 main_line / side_system / side_rag / side_tool / side_routing
3. ✅ `update_llm_call_outcome()` 可补填效果反馈
4. ✅ 异步缓冲 + 定期 flush，不阻塞主线
5. ✅ `llm_log_stats()` 返回按龙虾/按类型的统计
6. ✅ 10 项单测全部通过
7. ✅ 不破坏现有 `ProviderRegistry` 功能

## 不要做的事

- ❌ 不要修改 `ProviderSpec` 或 `ProviderInstance` 已有的类定义
- ❌ 不要引入新的外部依赖（只用标准库 + 已有的 sqlite3）
- ❌ 不要记录完整的 system prompt 内容（只记录 hash 和长度，保护隐私）
- ❌ 不要让日志写入阻塞 LLM 调用（必须异步缓冲）
- ❌ 不要修改 `dragon_senate.py`
