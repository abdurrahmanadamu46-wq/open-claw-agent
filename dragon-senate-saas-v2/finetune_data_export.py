"""
finetune_data_export.py — 龙虾训练数据导出管道
================================================
从 LLM 调用日志和 per-step reward 数据中导出训练数据，
格式兼容 OpenClaw-RL / GRPO / SFT。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger("finetune_export")

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
    """
    if not Path(LLM_LOG_DB).exists():
        logger.warning("LLM log DB not found: %s", LLM_LOG_DB)
        return []

    conn = sqlite3.connect(LLM_LOG_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    query = """
        SELECT call_id, timestamp, provider_name, model, lobster_id, task_id, tenant_id,
               system_prompt_len, user_message_preview, output_preview, output_len,
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


def _resolve_pool_db_path() -> str:
    return POOL_DB if Path(POOL_DB).exists() else os.getenv("LOBSTER_POOL_DB_PATH", "data/lobster_pool.sqlite")


def _enrich_with_step_rewards(calls: list[dict], lobster_id: str | None = None) -> list[dict]:
    """Enrich call data with per-step reward information from pool DB."""
    pool_db_path = _resolve_pool_db_path()
    if not Path(pool_db_path).exists():
        return calls

    conn = sqlite3.connect(pool_db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    for call in calls:
        cid = call.get("call_id")
        lid = call.get("lobster_id") or lobster_id
        if not lid or not cid:
            continue

        cur.execute(
            """
            SELECT action, reward_score, reward_reason, activity_type
            FROM lobster_step_rewards
            WHERE lobster_id = ? AND llm_call_id = ?
            ORDER BY step_index
            """,
            (lid, cid),
        )
        steps = [dict(r) for r in cur.fetchall()]
        if steps:
            call["step_rewards"] = steps
            scored = [s["reward_score"] for s in steps if s["reward_score"] is not None]
            call["avg_step_reward"] = sum(scored) / max(len(scored), 1) if scored else None

    conn.close()
    return calls


def export_sft_jsonl(calls: list[dict], output_path: str) -> int:
    """
    Export as SFT-compatible JSONL.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    count = 0

    with open(output_path, "w", encoding="utf-8") as f:
        for call in calls:
            messages = []
            if call.get("system_prompt_len", 0) > 0:
                messages.append(
                    {
                        "role": "system",
                        "content": f"[lobster:{call.get('lobster_id', 'unknown')}]",
                    }
                )

            user_msg = call.get("user_message_preview", "")
            if user_msg:
                messages.append({"role": "user", "content": user_msg})

            output = call.get("output_preview", "")
            if output:
                messages.append({"role": "assistant", "content": output})

            if len(messages) < 2:
                continue

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


def export_openclawrl_jsonl(calls: list[dict], output_path: str) -> int:
    """
    Export in OpenClaw-RL compatible format for GRPO training.
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
    format: str = "sft",
    output: str | None = None,
    max_calls: int = 10000,
    since: str | None = None,
) -> dict[str, Any]:
    """
    Main export function. Queries, enriches, and exports training data.
    """
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

    calls = _enrich_with_step_rewards(calls, lobster_id)

    if not output:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        lid = lobster_id or "all"
        output = f"{EXPORT_DIR}/{lid}_{format}_{timestamp}.jsonl"

    if format == "openclawrl":
        count = export_openclawrl_jsonl(calls, output)
    else:
        count = export_sft_jsonl(calls, output)

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

    cur.execute(
        """
        SELECT lobster_id, COUNT(*)
        FROM llm_call_log
        WHERE call_type = 'main_line' AND outcome_score IS NOT NULL
        GROUP BY lobster_id
        """
    )
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
            "Ready for GRPO training!"
            if grpo_ready
            else f"Need {1000 - with_reward} more scored calls for GRPO"
            if with_reward < 1000
            else f"Need {500 - high_reward} more high-reward calls for SFT"
        ),
    }


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
