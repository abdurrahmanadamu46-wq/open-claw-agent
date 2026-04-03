"""
Unit tests for Edge Runtime Memory Consolidator.
"""
import asyncio
import time
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from memory_consolidator import (
    MemoryConsolidator,
    SessionMemory,
    ConsolidationResult,
    estimate_tokens,
    estimate_message_tokens,
    estimate_messages_tokens,
)


# ── Token Estimation Tests ──

def test_estimate_tokens_empty():
    assert estimate_tokens("") == 0


def test_estimate_tokens_english():
    # ~4 chars per token
    result = estimate_tokens("Hello world this is a test message")
    assert 5 <= result <= 15


def test_estimate_tokens_chinese():
    # CJK characters: ~1 token each
    result = estimate_tokens("你好世界这是测试")
    assert result == 8


def test_estimate_tokens_mixed():
    result = estimate_tokens("Hello 你好 world 世界")
    assert result > 4  # 2 CJK + some English tokens


def test_estimate_message_tokens():
    msg = {"role": "user", "content": "Hello world"}
    tokens = estimate_message_tokens(msg)
    assert tokens > 4  # content + overhead


def test_estimate_messages_tokens():
    msgs = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
    ]
    tokens = estimate_messages_tokens(msgs)
    assert tokens > 8


# ── SessionMemory Tests ──

def test_session_memory_creation():
    session = SessionMemory(session_id="test-1")
    assert session.session_id == "test-1"
    assert len(session.messages) == 0
    assert session.last_consolidated == 0
    assert session.long_term_memory == ""
    assert session.total_tokens == 0


def test_session_add_message():
    session = SessionMemory(session_id="test-2")
    session.add_message("user", "Hello!")
    session.add_message("assistant", "Hi there!")

    assert len(session.messages) == 2
    assert session.messages[0]["role"] == "user"
    assert session.messages[0]["content"] == "Hello!"
    assert session.messages[1]["role"] == "assistant"
    assert "timestamp" in session.messages[0]


def test_session_unconsolidated_messages():
    session = SessionMemory(session_id="test-3")
    session.add_message("user", "msg1")
    session.add_message("assistant", "msg2")
    session.add_message("user", "msg3")
    session.add_message("assistant", "msg4")

    assert len(session.unconsolidated_messages) == 4

    session.last_consolidated = 2
    assert len(session.unconsolidated_messages) == 2
    assert session.unconsolidated_messages[0]["content"] == "msg3"


def test_session_get_context_messages():
    session = SessionMemory(session_id="test-4")
    for i in range(10):
        session.add_message("user", f"msg{i}")

    # All from last_consolidated
    msgs = session.get_context_messages()
    assert len(msgs) == 10

    # With max limit
    msgs = session.get_context_messages(max_messages=3)
    assert len(msgs) == 3
    assert msgs[0]["content"] == "msg7"  # last 3

    # After consolidation
    session.last_consolidated = 5
    msgs = session.get_context_messages()
    assert len(msgs) == 5
    assert msgs[0]["content"] == "msg5"


def test_session_to_dict():
    session = SessionMemory(session_id="test-5")
    session.add_message("user", "Hello")
    d = session.to_dict()

    assert d["session_id"] == "test-5"
    assert d["message_count"] == 1
    assert d["last_consolidated"] == 0
    assert d["total_tokens_est"] > 0
    assert d["has_long_term_memory"] is False


# ── Consolidation Tests ──

@pytest.mark.asyncio
async def test_no_consolidation_needed():
    """When tokens are within budget, no consolidation occurs."""
    consolidator = MemoryConsolidator(
        context_window_tokens=65536,
        max_completion_tokens=4096,
    )

    session = SessionMemory(session_id="test")
    session.add_message("user", "Short message")

    result = await consolidator.maybe_consolidate(session)

    assert result.success is True
    assert result.method == "none"
    assert result.messages_archived == 0


@pytest.mark.asyncio
async def test_consolidation_with_raw_archive():
    """When no cloud function, falls back to raw archive."""
    consolidator = MemoryConsolidator(
        context_window_tokens=100,  # Very small budget
        max_completion_tokens=20,
        cloud_summarize_fn=None,  # No cloud function
    )

    session = SessionMemory(session_id="test-raw")
    # Add enough messages to exceed budget
    for i in range(20):
        session.add_message("user", f"This is a long message number {i} with enough content to use tokens " * 3)
        session.add_message("assistant", f"Response number {i} with plenty of text to consume tokens " * 3)

    result = await consolidator.maybe_consolidate(session)

    assert result.success is True
    assert result.method == "raw_archive"
    assert result.messages_archived > 0
    assert session.last_consolidated > 0
    assert len(session.history_entries) > 0


@pytest.mark.asyncio
async def test_consolidation_with_cloud_summary():
    """Test successful cloud-based consolidation."""
    async def mock_cloud_summarize(messages, current_memory):
        return {
            "summary": f"[Summary] Archived {len(messages)} messages about testing.",
            "memory_update": "User is testing the memory system.",
        }

    consolidator = MemoryConsolidator(
        context_window_tokens=100,
        max_completion_tokens=20,
        cloud_summarize_fn=mock_cloud_summarize,
    )

    session = SessionMemory(session_id="test-cloud")
    for i in range(20):
        session.add_message("user", f"Message {i} " * 20)
        session.add_message("assistant", f"Reply {i} " * 20)

    result = await consolidator.maybe_consolidate(session)

    assert result.success is True
    assert result.method == "cloud_summary"
    assert result.messages_archived > 0
    assert session.last_consolidated > 0
    assert len(session.history_entries) > 0
    assert "testing" in session.history_entries[0].lower()
    assert session.long_term_memory == "User is testing the memory system."


@pytest.mark.asyncio
async def test_consolidation_cloud_failure_then_raw():
    """Cloud fails 3 times, then falls back to raw archive."""
    call_count = 0

    async def failing_cloud(messages, current_memory):
        nonlocal call_count
        call_count += 1
        raise ConnectionError("Cloud unreachable")

    consolidator = MemoryConsolidator(
        context_window_tokens=100,
        max_completion_tokens=20,
        cloud_summarize_fn=failing_cloud,
    )

    session = SessionMemory(session_id="test-fail")
    for i in range(30):
        session.add_message("user", f"Message {i} " * 20)
        session.add_message("assistant", f"Reply {i} " * 20)

    # First call: fails (1/3)
    result = await consolidator.maybe_consolidate(session)
    # May fail or succeed depending on how many rounds needed
    # After 3 consecutive failures on same session, should raw archive

    # Force 3 failures
    consolidator._consecutive_failures["test-fail"] = 2
    result = await consolidator.maybe_consolidate(session)
    # After 3rd failure, should fall back to raw archive
    assert result.success is True or result.method == "raw_archive"


@pytest.mark.asyncio
async def test_consolidation_empty_summary_rejection():
    """Cloud returns empty summary — should be rejected."""
    async def empty_cloud(messages, current_memory):
        return {"summary": "", "memory_update": ""}

    consolidator = MemoryConsolidator(
        context_window_tokens=100,
        max_completion_tokens=20,
        cloud_summarize_fn=empty_cloud,
    )

    session = SessionMemory(session_id="test-empty")
    for i in range(20):
        session.add_message("user", f"Message {i} " * 20)
        session.add_message("assistant", f"Reply {i} " * 20)

    result = await consolidator.maybe_consolidate(session)
    # Empty summary should be treated as failure
    assert result.success is False or result.method == "raw_archive"


def test_find_boundary_basic():
    """Test boundary finding at user-turn edges."""
    consolidator = MemoryConsolidator(context_window_tokens=1000)

    session = SessionMemory(session_id="bound")
    session.add_message("user", "Hello")
    session.add_message("assistant", "Hi!")
    session.add_message("user", "How are you?")
    session.add_message("assistant", "Good!")
    session.add_message("user", "Great")

    # Should find boundary at index 2 (second user message)
    boundary = consolidator._find_boundary(session, tokens_to_remove=5)
    assert boundary is not None
    end_idx, tokens = boundary
    assert end_idx == 2  # Second user message starts here


def test_find_boundary_no_boundary():
    """No user-turn boundary if only one turn."""
    consolidator = MemoryConsolidator(context_window_tokens=1000)

    session = SessionMemory(session_id="no-bound")
    session.add_message("user", "Only one message")

    boundary = consolidator._find_boundary(session, tokens_to_remove=5)
    assert boundary is None


def test_consolidator_describe():
    consolidator = MemoryConsolidator(
        context_window_tokens=65536,
        max_completion_tokens=4096,
    )
    desc = consolidator.describe()
    assert desc["context_window_tokens"] == 65536
    assert desc["max_completion_tokens"] == 4096
    assert desc["budget"] == 65536 - 4096 - 1024
    assert desc["target"] == desc["budget"] // 2
    assert desc["has_cloud_summarize"] is False


@pytest.mark.asyncio
async def test_empty_session_no_op():
    """Empty session should be a no-op."""
    consolidator = MemoryConsolidator()
    session = SessionMemory(session_id="empty")
    result = await consolidator.maybe_consolidate(session)
    assert result.success is True
    assert result.method == "none"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
