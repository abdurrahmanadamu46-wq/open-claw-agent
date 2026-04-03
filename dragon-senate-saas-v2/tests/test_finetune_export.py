"""Tests for finetune data export pipeline (CODEX-RL-04)."""

from __future__ import annotations

import importlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_tmpdir = tempfile.mkdtemp()
os.environ["LLM_LOG_DB"] = os.path.join(_tmpdir, "test_llm_log.sqlite")
os.environ["LOBSTER_POOL_DB"] = os.path.join(_tmpdir, "test_pool.sqlite")
os.environ["LOBSTER_POOL_DB_PATH"] = os.environ["LOBSTER_POOL_DB"]
os.environ["FINETUNE_EXPORT_DIR"] = os.path.join(_tmpdir, "exports")

import finetune_data_export as finetune_data_export_module  # noqa: E402

finetune_data_export_module = importlib.reload(finetune_data_export_module)

from finetune_data_export import (  # noqa: E402
    _query_trainable_calls,
    export_openclawrl_jsonl,
    export_sft_jsonl,
    export_training_data,
    readiness_check,
)


def _seed_test_data(count: int = 10, min_score: float = 0.5):
    """Seed the test LLM log DB with sample data."""
    db_path = os.environ["LLM_LOG_DB"]
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
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
        """
    )

    import uuid

    for i in range(count):
        score = min_score + (i / count) * (1.0 - min_score)
        conn.execute(
            """
            INSERT INTO llm_call_log
            (call_id, timestamp, provider_name, model, lobster_id, task_id,
             system_prompt_len, user_message_preview, output_preview, output_len,
             input_tokens, output_tokens, total_tokens, call_type, outcome_score, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                "2026-03-31T00:00:00Z",
                "deepseek",
                "deepseek-chat",
                "radar" if i % 2 == 0 else "inkwriter",
                f"task_{i}",
                100,
                f"User question {i}",
                f"Assistant response {i} with ## heading",
                50,
                200,
                100,
                300,
                "main_line",
                round(score, 2),
                "success",
            ),
        )
    conn.commit()
    conn.close()


class TestQueryTrainableCalls(unittest.TestCase):
    def setUp(self):
        _seed_test_data(20)

    def test_returns_list(self):
        calls = _query_trainable_calls()
        self.assertIsInstance(calls, list)
        self.assertGreater(len(calls), 0)

    def test_filter_by_lobster(self):
        calls = _query_trainable_calls(lobster_id="radar")
        self.assertTrue(all(c["lobster_id"] == "radar" for c in calls))

    def test_filter_by_min_reward(self):
        calls = _query_trainable_calls(min_reward=0.8)
        self.assertTrue(all(c["outcome_score"] >= 0.8 for c in calls))


class TestExportSFT(unittest.TestCase):
    def setUp(self):
        _seed_test_data(10)

    def test_export_creates_file(self):
        calls = _query_trainable_calls()
        output = os.path.join(_tmpdir, "test_sft.jsonl")
        count = export_sft_jsonl(calls, output)
        self.assertGreater(count, 0)
        self.assertTrue(os.path.exists(output))

    def test_export_format(self):
        calls = _query_trainable_calls()
        output = os.path.join(_tmpdir, "test_sft2.jsonl")
        export_sft_jsonl(calls, output)
        with open(output, encoding="utf-8") as f:
            line = json.loads(f.readline())
        self.assertIn("messages", line)
        self.assertIn("reward", line)
        self.assertIn("metadata", line)
        self.assertIsInstance(line["messages"], list)


class TestExportOpenClawRL(unittest.TestCase):
    def setUp(self):
        _seed_test_data(10)

    def test_export_format(self):
        calls = _query_trainable_calls()
        output = os.path.join(_tmpdir, "test_rl.jsonl")
        count = export_openclawrl_jsonl(calls, output)
        self.assertGreater(count, 0)
        with open(output, encoding="utf-8") as f:
            line = json.loads(f.readline())
        self.assertIn("prompt", line)
        self.assertIn("response", line)
        self.assertIn("reward", line)
        self.assertIn("lobster_id", line)


class TestExportTrainingData(unittest.TestCase):
    def setUp(self):
        _seed_test_data(10)

    def test_full_pipeline(self):
        result = export_training_data(format="sft", min_reward=0.5)
        self.assertEqual(result["status"], "success")
        self.assertGreater(result["records_exported"], 0)


class TestReadinessCheck(unittest.TestCase):
    def setUp(self):
        _seed_test_data(10)

    def test_returns_dict(self):
        result = readiness_check()
        self.assertIsInstance(result, dict)
        self.assertIn("ready", result)
        self.assertIn("recommendation", result)
        self.assertIn("by_lobster", result)


if __name__ == "__main__":
    unittest.main()
