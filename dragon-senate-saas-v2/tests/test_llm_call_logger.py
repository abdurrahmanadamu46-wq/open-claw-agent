"""Tests for LLM call logger (CODEX-RL-01)."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["LLM_LOG_DB"] = os.path.join(tempfile.mkdtemp(), "test_llm_log.sqlite")

import provider_registry as provider_registry_module  # noqa: E402

provider_registry_module = importlib.reload(provider_registry_module)

from provider_registry import (  # noqa: E402
    _LLM_LOG_BUFFER,
    _flush_llm_log_buffer,
    llm_log_stats,
    log_llm_call,
    update_llm_call_outcome,
)


class TestLLMCallLogger(unittest.TestCase):
    def setUp(self):
        _LLM_LOG_BUFFER.clear()

    def test_log_llm_call_returns_call_id(self):
        call_id = log_llm_call(
            provider_name="deepseek",
            model="deepseek-chat",
            output="Hello world",
            input_tokens=100,
            output_tokens=50,
        )
        self.assertIsInstance(call_id, str)
        self.assertEqual(len(call_id), 36)

    def test_log_adds_to_buffer(self):
        log_llm_call(provider_name="test", model="test-model")
        self.assertEqual(len(_LLM_LOG_BUFFER), 1)

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
        self.assertEqual(count, 1)
        self.assertEqual(len(_LLM_LOG_BUFFER), 0)

    def test_call_type_classification(self):
        log_llm_call(provider_name="test", model="m", call_type="main_line")
        log_llm_call(provider_name="test", model="m", call_type="side_system")
        log_llm_call(provider_name="test", model="m", call_type="side_rag")
        self.assertEqual(len(_LLM_LOG_BUFFER), 3)
        types = [r["call_type"] for r in _LLM_LOG_BUFFER]
        self.assertEqual(types, ["main_line", "side_system", "side_rag"])

    def test_message_stats_extraction(self):
        messages = [
            {"role": "system", "content": "You are a helpful assistant"},
            {"role": "user", "content": "Hello!"},
        ]
        log_llm_call(provider_name="test", model="m", messages=messages)
        record = _LLM_LOG_BUFFER[-1]
        self.assertEqual(record["messages_count"], 2)
        self.assertGreater(record["system_prompt_len"], 0)
        self.assertEqual(record["user_message_preview"], "Hello!")

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
        self.assertEqual(record["estimated_cost_cny"], 2.0)

    def test_update_outcome(self):
        call_id = log_llm_call(provider_name="test", model="m")
        _flush_llm_log_buffer()
        update_llm_call_outcome(call_id, outcome_score=0.85, outcome_label="good")

    def test_llm_log_stats_returns_dict(self):
        log_llm_call(provider_name="test", model="m", lobster_id="radar", call_type="main_line")
        log_llm_call(provider_name="test", model="m", lobster_id="radar", call_type="side_system")
        _flush_llm_log_buffer()
        stats = llm_log_stats()
        self.assertIsInstance(stats, dict)
        self.assertGreaterEqual(stats["total_calls"], 2)
        self.assertGreaterEqual(stats["main_line_calls"], 1)

    def test_error_logging(self):
        log_llm_call(
            provider_name="test",
            model="m",
            status="error",
            error_message="Connection timeout",
        )
        record = _LLM_LOG_BUFFER[-1]
        self.assertEqual(record["status"], "error")
        self.assertEqual(record["error_message"], "Connection timeout")

    def test_buffer_max_size(self):
        for _ in range(600):
            log_llm_call(provider_name="test", model="m")
        self.assertEqual(len(_LLM_LOG_BUFFER), 500)


if __name__ == "__main__":
    unittest.main()
