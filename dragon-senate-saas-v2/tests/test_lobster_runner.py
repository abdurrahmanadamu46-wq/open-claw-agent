"""
Unit tests for LobsterRunner, LobsterHook, LobsterRunSpec/Result.
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import sys
import os

# Add parent dir to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lobster_runner import (
    LobsterRunner,
    LobsterRunSpec,
    LobsterRunResult,
    LobsterHook,
    CompositeHook,
    AuditHook,
    MetricsHook,
    HookContext,
)
from commander_router import clear_strategy_intensity_manager_cache
from commander_router import get_strategy_intensity_manager


# ── Fixtures ──

class MockLLMRouter:
    """Mock LLM router that returns predictable responses."""

    def __init__(self, responses: list[str] | None = None):
        self.responses = responses or ["Test response from LLM"]
        self._call_count = 0
        self.calls: list[dict] = []

    async def routed_ainvoke_text(self, *, system_prompt, user_prompt, meta=None, temperature=None):
        self.calls.append({
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "meta": meta,
            "temperature": temperature,
        })
        idx = min(self._call_count, len(self.responses) - 1)
        self._call_count += 1
        return self.responses[idx]


class TrackingHook(LobsterHook):
    """Hook that records all lifecycle events."""

    def __init__(self):
        self.events: list[str] = []
        self.contexts: list[HookContext] = []

    async def before_iteration(self, ctx):
        self.events.append("before_iteration")
        self.contexts.append(ctx)

    async def on_llm_response(self, ctx):
        self.events.append("on_llm_response")

    async def before_execute_tools(self, ctx):
        self.events.append("before_execute_tools")

    async def after_execute_tools(self, ctx):
        self.events.append("after_execute_tools")

    async def after_iteration(self, ctx):
        self.events.append("after_iteration")

    async def on_complete(self, ctx):
        self.events.append("on_complete")
        self.contexts.append(ctx)


@pytest.fixture(autouse=True)
def isolated_strategy_intensity_state(tmp_path, monkeypatch):
    monkeypatch.setenv("STRATEGY_INTENSITY_STATE_PATH", str(tmp_path / "strategy_intensity_state.json"))
    monkeypatch.setenv("MEMORY_COMPRESSION_ENABLED", "false")
    monkeypatch.setenv("LOBSTER_FILE_MEMORY_ENABLED", "false")
    monkeypatch.setenv("LOBSTER_MEMORY_AUTO_EXTRACT", "false")
    clear_strategy_intensity_manager_cache()
    yield
    clear_strategy_intensity_manager_cache()


# ── Tests ──

@pytest.mark.asyncio
async def test_simple_run_no_tools():
    """Test basic LLM call without tools."""
    router = MockLLMRouter(["Hello from the radar lobster!"])
    runner = LobsterRunner(router)

    spec = LobsterRunSpec(
        role_id="radar",
        system_prompt="You are the radar lobster.",
        user_prompt="Scan for signals.",
    )

    result = await runner.run(spec)

    assert result.final_content == "Hello from the radar lobster!"
    assert result.stop_reason == "completed"
    assert result.error is None
    assert result.elapsed_ms > 0
    assert len(result.messages) == 3  # system + user + assistant
    assert result.messages[0]["role"] == "system"
    assert result.messages[1]["role"] == "user"
    assert result.messages[2]["role"] == "assistant"
    assert len(router.calls) == 1


@pytest.mark.asyncio
async def test_hook_lifecycle():
    """Test that all hook methods are called in correct order."""
    router = MockLLMRouter(["Done!"])
    hook = TrackingHook()
    runner = LobsterRunner(router)

    spec = LobsterRunSpec(
        role_id="strategist",
        system_prompt="You are the strategist.",
        user_prompt="Plan the campaign.",
        hook=hook,
    )

    result = await runner.run(spec)

    assert result.stop_reason == "completed"
    # For simple (no-tool) path: before_iteration → on_llm_response → after_iteration → on_complete
    assert hook.events == [
        "before_iteration",
        "on_llm_response",
        "after_iteration",
        "on_complete",
    ]


@pytest.mark.asyncio
async def test_hook_lifecycle_with_tools():
    """Test hook lifecycle when tools are used."""
    # First response uses a tool, second response is final
    router = MockLLMRouter([
        'Let me search. ```tool_call\n{"name": "web_search", "arguments": {"query": "test"}}\n```',
        "Based on the search results, here is my analysis.",
    ])
    hook = TrackingHook()

    async def mock_tool_executor(name, args):
        return "Search result: test data"

    runner = LobsterRunner(router)
    spec = LobsterRunSpec(
        role_id="radar",
        system_prompt="You are radar.",
        user_prompt="Search for data.",
        tools=[{"type": "function", "function": {"name": "web_search"}}],
        tool_executor=mock_tool_executor,
        hook=hook,
    )

    result = await runner.run(spec)

    assert result.stop_reason == "completed"
    assert "web_search" in result.tools_used
    assert "before_execute_tools" in hook.events
    assert "after_execute_tools" in hook.events


@pytest.mark.asyncio
async def test_composite_hook():
    """Test that CompositeHook runs multiple hooks."""
    hook1 = TrackingHook()
    hook2 = TrackingHook()
    composite = CompositeHook([hook1, hook2])

    router = MockLLMRouter(["Result!"])
    runner = LobsterRunner(router)

    spec = LobsterRunSpec(
        role_id="inkwriter",
        system_prompt="You are inkwriter.",
        user_prompt="Write copy.",
        hook=composite,
    )

    result = await runner.run(spec)

    assert result.stop_reason == "completed"
    assert len(hook1.events) > 0
    assert len(hook2.events) > 0
    assert hook1.events == hook2.events


@pytest.mark.asyncio
async def test_composite_hook_error_isolation():
    """Test that one hook's error doesn't block others."""

    class ErrorHook(LobsterHook):
        async def on_complete(self, ctx):
            raise ValueError("Hook exploded!")

    error_hook = ErrorHook()
    tracking_hook = TrackingHook()
    composite = CompositeHook([error_hook, tracking_hook])

    router = MockLLMRouter(["Result!"])
    runner = LobsterRunner(router)

    spec = LobsterRunSpec(
        role_id="echoer",
        system_prompt="You are echoer.",
        user_prompt="Reply.",
        hook=composite,
    )

    # Should not raise despite ErrorHook
    result = await runner.run(spec)
    assert result.stop_reason == "completed"
    assert "on_complete" in tracking_hook.events


@pytest.mark.asyncio
async def test_metrics_hook():
    """Test MetricsHook collects run data."""
    metrics = MetricsHook()
    router = MockLLMRouter(["Done!"])
    runner = LobsterRunner(router)

    spec = LobsterRunSpec(
        role_id="abacus",
        system_prompt="You are abacus.",
        user_prompt="Calculate ROI.",
        hook=metrics,
    )

    await runner.run(spec)
    await runner.run(spec)

    assert len(metrics.runs) == 2
    assert metrics.runs[0]["role_id"] == "abacus"
    assert metrics.runs[0]["stop_reason"] == "completed"
    assert metrics.runs[0]["elapsed_ms"] > 0


@pytest.mark.asyncio
async def test_error_handling():
    """Test that LLM errors are caught and reported."""

    class FailingRouter:
        async def routed_ainvoke_text(self, **kwargs):
            raise ConnectionError("LLM unreachable")

    runner = LobsterRunner(FailingRouter())
    spec = LobsterRunSpec(
        role_id="catcher",
        system_prompt="You are catcher.",
        user_prompt="Catch leads.",
    )

    result = await runner.run(spec)

    assert result.stop_reason == "error"
    assert result.error is not None
    assert "ConnectionError" in result.error


@pytest.mark.asyncio
async def test_strategy_intensity_blocks_when_daily_limit_reached():
    router = MockLLMRouter(["This should never run"])
    runner = LobsterRunner(router)

    spec = LobsterRunSpec(
        role_id="dispatcher",
        system_prompt="You dispatch.",
        user_prompt="Publish the campaign.",
        meta={
            "tenant_id": "tenant-limit",
            "action_type": "posts",
            "daily_counts": {"posts": 2},
        },
    )

    result = await runner.run(spec)

    assert result.stop_reason == "blocked"
    assert result.strategy_intensity is not None
    assert result.strategy_intensity["current_level"] == 1
    assert "已达上限" in str(result.error)
    assert len(router.calls) == 0


@pytest.mark.asyncio
async def test_strategy_intensity_requires_approval_for_l3_runs():
    manager = get_strategy_intensity_manager("tenant-approval")
    assert manager.escalate(reason="to_l2")
    assert manager.escalate(reason="to_l3")

    router = MockLLMRouter(["This should never run"])
    runner = LobsterRunner(router)
    spec = LobsterRunSpec(
        role_id="radar",
        system_prompt="You are radar.",
        user_prompt="Scan and report.",
        meta={
            "tenant_id": "tenant-approval",
            "task_type": "signal_scan",
        },
    )

    result = await runner.run(spec)

    assert result.stop_reason == "pending_approval"
    assert result.strategy_intensity is not None
    assert result.strategy_intensity["current_level"] == 3
    assert "需要人工审批" in str(result.error)
    assert len(router.calls) == 0


@pytest.mark.asyncio
async def test_max_iterations():
    """Test max iterations limit."""
    # Always return tool calls, never finish
    tool_response = '```tool_call\n{"name": "loop_tool", "arguments": {}}\n```'
    router = MockLLMRouter([tool_response] * 5)

    async def mock_executor(name, args):
        return "ok"

    runner = LobsterRunner(router)
    spec = LobsterRunSpec(
        role_id="dispatcher",
        system_prompt="You dispatch.",
        user_prompt="Execute plan.",
        tools=[{"type": "function", "function": {"name": "loop_tool"}}],
        tool_executor=mock_executor,
        max_iterations=3,
    )

    result = await runner.run(spec)

    assert result.stop_reason == "max_iterations"
    assert "max iterations" in result.final_content.lower()


@pytest.mark.asyncio
async def test_tool_call_parsing():
    """Test tool call extraction from LLM response."""
    runner = LobsterRunner(MockLLMRouter())

    content = '''Here is my analysis.

```tool_call
{"name": "web_search", "arguments": {"query": "competitor analysis"}}
```

And also:

```tool_call
{"name": "read_file", "arguments": {"path": "/data/report.md"}}
```
'''
    calls = runner._parse_tool_calls(content)
    assert len(calls) == 2
    assert calls[0]["name"] == "web_search"
    assert calls[0]["arguments"]["query"] == "competitor analysis"
    assert calls[1]["name"] == "read_file"


@pytest.mark.asyncio
async def test_tool_call_no_match():
    """Test that non-tool content returns empty list."""
    runner = LobsterRunner(MockLLMRouter())
    calls = runner._parse_tool_calls("Just a normal response with no tools.")
    assert calls == []


@pytest.mark.asyncio
async def test_concurrent_tools():
    """Test concurrent tool execution."""
    call_order = []

    async def slow_executor(name, args):
        call_order.append(f"start:{name}")
        await asyncio.sleep(0.01)
        call_order.append(f"end:{name}")
        return f"result from {name}"

    router = MockLLMRouter([
        '```tool_call\n{"name": "tool_a", "arguments": {}}\n```\n```tool_call\n{"name": "tool_b", "arguments": {}}\n```',
        "Final answer.",
    ])

    runner = LobsterRunner(router)
    spec = LobsterRunSpec(
        role_id="dispatcher",
        system_prompt="Test.",
        user_prompt="Go.",
        tools=[{"type": "function", "function": {"name": "tool_a"}},
               {"type": "function", "function": {"name": "tool_b"}}],
        tool_executor=slow_executor,
        concurrent_tools=True,
    )

    result = await runner.run(spec)
    assert result.stop_reason == "completed"
    assert "tool_a" in result.tools_used
    assert "tool_b" in result.tools_used


@pytest.mark.asyncio
async def test_runner_can_compress_memory_layers(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_COMPRESSION_ENABLED", "true")
    monkeypatch.setenv("MEMORY_COMPRESSION_DIR", str(tmp_path / "memory"))

    router = MockLLMRouter([
        "这是龙虾主任务输出。",
        '{"task_summary":"任务总结","decision":"保留视频优先","outcome":"success","next_steps":["继续迭代"],"key_entities":["客户A","抖音"],"metrics":{"conversion":0.18}}',
    ])
    runner = LobsterRunner(router)

    result = await runner.run(
        LobsterRunSpec(
            role_id="inkwriter",
            system_prompt="You are inkwriter.",
            user_prompt="写一段成交文案。",
            meta={"tenant_id": "tenant-memory", "task_id": "task-memory-1", "user_id": "user-memory"},
        )
    )

    assert result.stop_reason == "completed"

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from memory_compressor import MemoryCompressor  # noqa: WPS433

    compressor = MemoryCompressor(None, storage_dir=str(tmp_path / "memory"))
    reports = compressor.get_reports(tenant_id="tenant-memory")
    assert len(reports) == 1
    assert reports[0].lobster_id == "inkwriter"
    assert reports[0].task_summary == "任务总结"


@pytest.mark.asyncio
async def test_run_spec_defaults():
    """Test LobsterRunSpec default values."""
    spec = LobsterRunSpec(
        role_id="test",
        system_prompt="sys",
        user_prompt="usr",
    )
    assert spec.max_iterations == 10
    assert spec.tools is None
    assert spec.hook is None
    assert spec.concurrent_tools is True
    assert spec.temperature is None
    assert spec.meta is None


@pytest.mark.asyncio
async def test_run_result_fields():
    """Test LobsterRunResult field population."""
    router = MockLLMRouter(["Hello!"])
    runner = LobsterRunner(router)

    result = await runner.run(LobsterRunSpec(
        role_id="test",
        system_prompt="sys",
        user_prompt="usr",
    ))

    assert isinstance(result, LobsterRunResult)
    assert result.final_content is not None
    assert isinstance(result.messages, list)
    assert isinstance(result.tools_used, list)
    assert isinstance(result.usage, dict)
    assert isinstance(result.elapsed_ms, float)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
