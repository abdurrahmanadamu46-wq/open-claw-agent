# Codex 任务：龙虾专属模型微调管道 (CODEX-RL-04)

## 任务目标

当 CODEX-RL-01 (LLM调用日志) 和 CODEX-RL-02 (Per-step Reward) 积累了足够训练数据后，构建一个将数据导出为 OpenClaw-RL 兼容格式的管道，以便未来微调龙虾专属模型。

**注意**：此任务不包含实际的 RL 训练（那需要 GPU 集群），只做**数据管道**——将我们积累的 LLM 调用日志和 Reward 数据转换为 OpenClaw-RL / GRPO 兼容的训练数据格式。

---

## 文件 1：新建 `dragon-senate-saas-v2/finetune_data_export.py`

### 功能概述

从 `llm_call_log` (CODEX-RL-01) 和 `lobster_step_rewards` (CODEX-RL-02) 表中提取数据，生成以下格式的 JSONL 训练文件：

```jsonl
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}], "reward": 0.85, "lobster_id": "radar", "call_type": "main_line"}
```

### 完整实现

```python
"""
finetune_data_export.py — 龙虾训练数据导出管道
================================================
从 LLM 调用日志和 per-step reward 数据中导出训练数据，
格式兼容 OpenClaw-RL / GRPO / SFT。

依赖 CODEX-RL-01 (LLM 调用日志) 和 CODEX-RL-02 (Per-step Reward) 已落地。

用法:
    python finetune_data_export.py --lobster-id radar --min-reward 0.7 --output radar_train.jsonl
    python finetune_data_export.py --all --format openclawrl --output all_train.jsonl
"""

from __future__ import annotations

import json
import os
import sqlite3
import argparse
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("finetune_export")

# Database paths (must match CODEX-RL-01 and lobster_pool_manager)
LLM_LOG_DB = os.getenv("LLM_LOG_DB", "data/llm_call_log.sqlite")
POOL_DB = os.getenv("LOBSTER_POOL_DB", "data/lobster_pool.sqlite")
EXPORT_DIR = os.getenv("FINETUNE_EXPORT_DIR", "data/finetune_exports")


def _query_trainable_calls(
    *,
    lobster_id: str | None = None,
    min_reward: float | None = None,
    max_calls: int = 10000,
    since: str | None = None,
) -> list[dict[str, Any]]:
    """
    Query LLM call log for trainable (main_line) calls with outcome scores.
    
    Returns list of dicts with: call_id, lobster_id, model, messages info,
    output, reward score, etc.
    """
    if not Path(LLM_LOG_DB).exists():
        logger.warning("LLM log DB not found: %s", LLM_LOG_DB)
        return []
    
    conn = sqlite3.connect(LLM_LOG_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    query = """
        SELECT call_id, timestamp, provider_name, model, lobster_id, task_id, tenant_id,
               user_message_preview, output_preview, output_len,
               input_tokens, output_tokens, total_tokens, latency_ms,
               call_type, outcome_score, outcome_label, status
        FROM llm_call_log
        WHERE call_type = 'main_line'
          AND status = 'success'
          AND outcome_score IS NOT NULL
    """
    params: list[Any] = []
    
    if lobster_id:
        query += " AND lobster_id = ?"
        params.append(lobster_id)
    
    if min_reward is not None:
        query += " AND outcome_score >= ?"
        params.append(min_reward)
    
    if since:
        query += " AND timestamp >= ?"
        params.append(since)
    
    query += " ORDER BY outcome_score DESC LIMIT ?"
    params.append(max_calls)
    
    cur.execute(query, params)
    results = [dict(row) for row in cur.fetchall()]
    conn.close()
    
    return results


def _enrich_with_step_rewards(calls: list[dict], lobster_id: str | None = None) -> list[dict]:
    """Enrich call data with per-step reward information from pool DB."""
    if not Path(POOL_DB).exists():
        return calls
    
    conn = sqlite3.connect(POOL_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    for call in calls:
        cid = call.get("call_id")
        lid = call.get("lobster_id") or lobster_id
        if not lid:
            continue
        
        cur.execute("""
            SELECT action, reward_score, reward_reason, activity_type
            FROM lobster_step_rewards
            WHERE lobster_id = ? AND llm_call_id = ?
            ORDER BY step_index
        """, (lid, cid))
        
        steps = [dict(r) for r in cur.fetchall()]
        if steps:
            call["step_rewards"] = steps
            call["avg_step_reward"] = sum(
                s["reward_score"] for s in steps if s["reward_score"] is not None
            ) / max(len([s for s in steps if s["reward_score"] is not None]), 1)
    
    conn.close()
    return calls


def export_sft_jsonl(
    calls: list[dict],
    output_path: str,
) -> int:
    """
    Export as SFT-compatible JSONL (supervised fine-tuning format).
    
    Format:
    {"messages": [...], "reward": float, "metadata": {...}}
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    count = 0
    
    with open(output_path, "w", encoding="utf-8") as f:
        for call in calls:
            # Reconstruct simplified messages
            messages = []
            
            # System message (we only have hash/len, use placeholder)
            if call.get("system_prompt_len", 0) > 0:
                messages.append({
                    "role": "system",
                    "content": f"[lobster:{call.get('lobster_id', 'unknown')}]",
                })
            
            # User message
            user_msg = call.get("user_message_preview", "")
            if user_msg:
                messages.append({"role": "user", "content": user_msg})
            
            # Assistant output
            output = call.get("output_preview", "")
            if output:
                messages.append({"role": "assistant", "content": output})
            
            if len(messages) < 2:
                continue  # Need at least user + assistant
            
            record = {
                "messages": messages,
                "reward": call.get("outcome_score", 0.0),
                "metadata": {
                    "call_id": call.get("call_id"),
                    "lobster_id": call.get("lobster_id"),
                    "model": call.get("model"),
                    "tokens": call.get("total_tokens", 0),
                    "latency_ms": call.get("latency_ms", 0),
                    "outcome_label": call.get("outcome_label"),
                    "step_rewards": call.get("step_rewards"),
                },
            }
            
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    
    return count


def export_openclawrl_jsonl(
    calls: list[dict],
    output_path: str,
) -> int:
    """
    Export in OpenClaw-RL compatible format for GRPO training.
    
    Format matches OpenClaw-RL's rollout collection output:
    {"prompt": str, "response": str, "reward": float, "session_id": str}
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    count = 0
    
    with open(output_path, "w", encoding="utf-8") as f:
        for call in calls:
            prompt = call.get("user_message_preview", "")
            response = call.get("output_preview", "")
            
            if not prompt or not response:
                continue
            
            record = {
                "prompt": prompt,
                "response": response,
                "reward": call.get("outcome_score", 0.0),
                "session_id": call.get("task_id") or call.get("call_id"),
                "lobster_id": call.get("lobster_id"),
                "model": call.get("model"),
                "turn_type": "main_line",
            }
            
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    
    return count


def export_training_data(
    *,
    lobster_id: str | None = None,
    min_reward: float = 0.5,
    format: str = "sft",  # "sft" | "openclawrl"
    output: str | None = None,
    max_calls: int = 10000,
    since: str | None = None,
) -> dict[str, Any]:
    """
    Main export function. Queries, enriches, and exports training data.
    
    Returns summary stats.
    """
    # Query
    calls = _query_trainable_calls(
        lobster_id=lobster_id,
        min_reward=min_reward,
        max_calls=max_calls,
        since=since,
    )
    
    if not calls:
        return {
            "status": "no_data",
            "message": "No trainable calls found matching criteria",
            "lobster_id": lobster_id,
            "min_reward": min_reward,
        }
    
    # Enrich with step rewards
    calls = _enrich_with_step_rewards(calls, lobster_id)
    
    # Generate output path
    if not output:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        lid = lobster_id or "all"
        output = f"{EXPORT_DIR}/{lid}_{format}_{timestamp}.jsonl"
    
    # Export
    if format == "openclawrl":
        count = export_openclawrl_jsonl(calls, output)
    else:
        count = export_sft_jsonl(calls, output)
    
    # Stats
    rewards = [c.get("outcome_score", 0) for c in calls if c.get("outcome_score") is not None]
    
    return {
        "status": "success",
        "format": format,
        "output_path": output,
        "total_calls_queried": len(calls),
        "records_exported": count,
        "lobster_id": lobster_id or "all",
        "min_reward": min_reward,
        "avg_reward": round(sum(rewards) / len(rewards), 3) if rewards else 0,
        "reward_distribution": {
            "excellent_09_10": len([r for r in rewards if r >= 0.9]),
            "good_07_09": len([r for r in rewards if 0.7 <= r < 0.9]),
            "ok_05_07": len([r for r in rewards if 0.5 <= r < 0.7]),
            "poor_00_05": len([r for r in rewards if r < 0.5]),
        },
    }


def readiness_check() -> dict[str, Any]:
    """
    Check if we have enough data for fine-tuning.
    
    Thresholds (rough guidelines):
    - SFT: 500+ examples with reward >= 0.7
    - GRPO: 1000+ examples with any reward
    - LoRA: 200+ examples per lobster
    """
    if not Path(LLM_LOG_DB).exists():
        return {"ready": False, "reason": "LLM log DB not found", "recommendation": "Run CODEX-RL-01 first"}
    
    conn = sqlite3.connect(LLM_LOG_DB)
    cur = conn.cursor()
    
    cur.execute("SELECT COUNT(*) FROM llm_call_log WHERE call_type = 'main_line' AND status = 'success'")
    total_main = cur.fetchone()[0]
    
    cur.execute("SELECT COUNT(*) FROM llm_call_log WHERE outcome_score IS NOT NULL")
    with_reward = cur.fetchone()[0]
    
    cur.execute("SELECT COUNT(*) FROM llm_call_log WHERE outcome_score >= 0.7")
    high_reward = cur.fetchone()[0]
    
    cur.execute("""
        SELECT lobster_id, COUNT(*) 
        FROM llm_call_log 
        WHERE call_type = 'main_line' AND outcome_score IS NOT NULL
        GROUP BY lobster_id
    """)
    by_lobster = {r[0]: r[1] for r in cur.fetchall() if r[0]}
    
    conn.close()
    
    sft_ready = high_reward >= 500
    grpo_ready = with_reward >= 1000
    lora_ready = all(v >= 200 for v in by_lobster.values()) if by_lobster else False
    
    return {
        "ready": sft_ready or grpo_ready,
        "total_main_line_calls": total_main,
        "calls_with_reward": with_reward,
        "high_reward_calls": high_reward,
        "by_lobster": by_lobster,
        "sft_ready": sft_ready,
        "grpo_ready": grpo_ready,
        "lora_per_lobster_ready": lora_ready,
        "recommendation": (
            "Ready for GRPO training!" if grpo_ready
            else f"Need {1000 - with_reward} more scored calls for GRPO"
            if with_reward < 1000
            else f"Need {500 - high_reward} more high-reward calls for SFT"
        ),
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export lobster training data")
    parser.add_argument("--lobster-id", type=str, help="Filter by lobster ID")
    parser.add_argument("--all", action="store_true", help="Export all lobsters")
    parser.add_argument("--min-reward", type=float, default=0.5)
    parser.add_argument("--format", choices=["sft", "openclawrl"], default="sft")
    parser.add_argument("--output", type=str)
    parser.add_argument("--max-calls", type=int, default=10000)
    parser.add_argument("--since", type=str, help="ISO datetime filter")
    parser.add_argument("--check", action="store_true", help="Run readiness check only")
    
    args = parser.parse_args()
    
    logging.basicConfig(level=logging.INFO)
    
    if args.check:
        result = readiness_check()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        lid = None if args.all else args.lobster_id
        result = export_training_data(
            lobster_id=lid,
            min_reward=args.min_reward,
            format=args.format,
            output=args.output,
            max_calls=args.max_calls,
            since=args.since,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
```

---

## 文件 2：修改 `dragon-senate-saas-v2/app.py`

### 添加 API 端点

```python
@app.get("/api/diagnostics/finetune-readiness")
async def get_finetune_readiness():
    """Check if we have enough data for model fine-tuning."""
    from finetune_data_export import readiness_check
    return readiness_check()


@app.post("/api/diagnostics/finetune-export")
async def trigger_finetune_export(
    lobster_id: str | None = None,
    min_reward: float = 0.5,
    format: str = "sft",
):
    """Trigger a training data export."""
    from finetune_data_export import export_training_data
    return export_training_data(
        lobster_id=lobster_id,
        min_reward=min_reward,
        format=format,
    )
```

---

## 测试要求

在 `dragon-senate-saas-v2/tests/test_finetune_export.py` 新建测试文件：

```python
"""Tests for finetune data export pipeline (CODEX-RL-04)."""
import json
import os
import tempfile
import sqlite3

import pytest

# Override paths
_tmpdir = tempfile.mkdtemp()
os.environ["LLM_LOG_DB"] = os.path.join(_tmpdir, "test_llm_log.sqlite")
os.environ["LOBSTER_POOL_DB"] = os.path.join(_tmpdir, "test_pool.sqlite")
os.environ["FINETUNE_EXPORT_DIR"] = os.path.join(_tmpdir, "exports")

from finetune_data_export import (
    export_sft_jsonl,
    export_openclawrl_jsonl,
    export_training_data,
    readiness_check,
    _query_trainable_calls,
)


def _seed_test_data(count: int = 10, min_score: float = 0.5):
    """Seed the test LLM log DB with sample data."""
    db_path = os.environ["LLM_LOG_DB"]
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS llm_call_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_id TEXT UNIQUE, timestamp TEXT, provider_name TEXT, model TEXT,
            lobster_id TEXT, task_id TEXT, tenant_id TEXT,
            system_prompt_hash TEXT, system_prompt_len INTEGER DEFAULT 0,
            user_message_preview TEXT, user_message_len INTEGER DEFAULT 0,
            messages_count INTEGER DEFAULT 0, total_input_chars INTEGER DEFAULT 0,
            temperature REAL, max_tokens INTEGER, tools_count INTEGER DEFAULT 0,
            output_preview TEXT, output_len INTEGER DEFAULT 0, finish_reason TEXT,
            input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0, latency_ms REAL DEFAULT 0,
            estimated_cost_cny REAL DEFAULT 0,
            call_type TEXT DEFAULT 'main_line',
            outcome_score REAL, outcome_label TEXT, outcome_detail TEXT,
            status TEXT DEFAULT 'success', error_message TEXT
        )
    """)
    
    import uuid
    for i in range(count):
        score = min_score + (i / count) * (1.0 - min_score)
        conn.execute(
            """INSERT INTO llm_call_log 
               (call_id, timestamp, provider_name, model, lobster_id, task_id,
                system_prompt_len, user_message_preview, output_preview, output_len,
                input_tokens, output_tokens, total_tokens, call_type, outcome_score, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()), "2026-03-31T00:00:00Z", "deepseek", "deepseek-chat",
                "radar" if i % 2 == 0 else "inkwriter", f"task_{i}",
                100, f"User question {i}", f"Assistant response {i} with ## heading",
                50, 200, 100, 300, "main_line", round(score, 2), "success",
            ),
        )
    conn.commit()
    conn.close()


class TestQueryTrainableCalls:
    def setup_method(self):
        _seed_test_data(20)

    def test_returns_list(self):
        calls = _query_trainable_calls()
        assert isinstance(calls, list)
        assert len(calls) > 0

    def test_filter_by_lobster(self):
        calls = _query_trainable_calls(lobster_id="radar")
        assert all(c["lobster_id"] == "radar" for c in calls)

    def test_filter_by_min_reward(self):
        calls = _query_trainable_calls(min_reward=0.8)
        assert all(c["outcome_score"] >= 0.8 for c in calls)


class TestExportSFT:
    def setup_method(self):
        _seed_test_data(10)

    def test_export_creates_file(self):
        calls = _query_trainable_calls()
        output = os.path.join(_tmpdir, "test_sft.jsonl")
        count = export_sft_jsonl(calls, output)
        assert count > 0
        assert os.path.exists(output)

    def test_export_format(self):
        calls = _query_trainable_calls()
        output = os.path.join(_tmpdir, "test_sft2.jsonl")
        export_sft_jsonl(calls, output)
        
        with open(output) as f:
            line = json.loads(f.readline())
        assert "messages" in line
        assert "reward" in line
        assert "metadata" in line
        assert isinstance(line["messages"], list)


class TestExportOpenClawRL:
    def setup_method(self):
        _seed_test_data(10)

    def test_export_format(self):
        calls = _query_trainable_calls()
        output = os.path.join(_tmpdir, "test_rl.jsonl")
        count = export_openclawrl_jsonl(calls, output)
        assert count > 0
        
        with open(output) as f:
            line = json.loads(f.readline())
        assert "prompt" in line
        assert "response" in line
        assert "reward" in line
        assert "lobster_id" in line


class TestExportTrainingData:
    def setup_method(self):
        _seed_test_data(10)

    def test_full_pipeline(self):
        result = export_training_data(format="sft", min_reward=0.5)
        assert result["status"] == "success"
        assert result["records_exported"] > 0


class TestReadinessCheck:
    def setup_method(self):
        _seed_test_data(10)

    def test_returns_dict(self):
        result = readiness_check()
        assert isinstance(result, dict)
        assert "ready" in result
        assert "recommendation" in result
        assert "by_lobster" in result
```

---

## 验证标准

1. ✅ `export_sft_jsonl()` 生成正确的 SFT JSONL 格式
2. ✅ `export_openclawrl_jsonl()` 生成 OpenClaw-RL GRPO 兼容格式
3. ✅ `readiness_check()` 正确评估数据量是否达标
4. ✅ 支持按龙虾/按 reward/按时间过滤
5. ✅ CLI 可独立运行 (`python finetune_data_export.py --check`)
6. ✅ API 端点可触发导出和检查
7. ✅ 9 项单测全部通过
8. ✅ 依赖 CODEX-RL-01 已落地（使用其 SQLite 表）

## 不要做的事

- ❌ 不要包含实际的 RL 训练代码（那是 OpenClaw-RL 框架的事）
- ❌ 不要引入 PyTorch/TensorFlow 等 ML 依赖
- ❌ 不要导出完整的 system prompt（只导出 lobster_id 标识）
- ❌ 不要修改 `dragon_senate.py`
