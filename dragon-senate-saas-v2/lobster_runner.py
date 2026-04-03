"""
LobsterRunner — OpenClaw 统一运行时执行引擎
=====================================
借鉴 NanoBot AgentRunner 的设计模式，为 10 个角色面具提供统一的：
  LLM 调用 → 工具执行 → 结果合并 循环

  10 个角色面具：commander（编排角色）+ 9 个执行角色
    radar / strategist / inkwriter / visualizer / dispatcher /
    echoer / catcher / abacus / followup

设计理念：单一运行时，多角色面具。每次调用传入角色配置（LobsterRunSpec），
Runner 负责重试、流式、Hook 生命周期、审计日志，角色切换零成本。

Architecture:
  BaseLobster  →  角色配置载体（role-card、prompt-kit、skill-set）
  LobsterRunner → 统一执行引擎（LLM 循环、Hook、重试）
  LobsterHook  →  生命周期扩展点（审计、流式、监控）
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Awaitable, Callable, Optional

from lobsters.lobster_security import (
    build_yellowline_confirmation,
    check_role_yellowline,
    check_redline,
    check_yellowline,
    detect_injection,
    sanitize_untrusted_content,
)

logger = logging.getLogger("lobster_runner")


# ────────────────────────────────────────────────────────────────────
# Hook — 生命周期扩展点
# ────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class HookContext:
    """Context passed to every hook callback."""
    role_id: str
    iteration: int
    messages: list[dict[str, Any]]
    response: Any = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    tool_results: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)
    final_content: str | None = None
    error: str | None = None
    stop_reason: str = "running"
    elapsed_ms: float = 0.0


@dataclass
class StepActivity:
    """Record of a single step within a lobster execution."""

    step_index: int
    lobster_id: str
    activity_type: str
    action: str
    started_at: float = 0.0
    ended_at: float = 0.0
    duration_ms: float = 0.0
    input_summary: str = ""
    output_summary: str = ""
    reward_score: float | None = None
    reward_reason: str = ""
    llm_call_id: str | None = None
    tokens_used: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "lobster_id": self.lobster_id,
            "activity_type": self.activity_type,
            "action": self.action,
            "duration_ms": round(self.duration_ms, 1),
            "input_summary": self.input_summary,
            "output_summary": self.output_summary,
            "reward_score": self.reward_score,
            "reward_reason": self.reward_reason,
            "llm_call_id": self.llm_call_id,
            "tokens_used": self.tokens_used,
            "is_trainable": self.activity_type == "main_line",
        }


class StepTracker:
    """Tracks per-step activities during a lobster execution."""

    def __init__(self, lobster_id: str, task_id: str | None = None):
        self.lobster_id = lobster_id
        self.task_id = task_id
        self.steps: list[StepActivity] = []
        self._current_step: StepActivity | None = None
        self._step_counter = 0

    def begin_step(
        self,
        action: str,
        *,
        activity_type: str = "main_line",
        input_summary: str = "",
    ) -> StepActivity:
        """Start tracking a new step."""
        if self._current_step is not None:
            self.end_step()

        self._step_counter += 1
        step = StepActivity(
            step_index=self._step_counter,
            lobster_id=self.lobster_id,
            activity_type=activity_type,
            action=action,
            started_at=time.monotonic(),
            input_summary=input_summary[:200],
        )
        self._current_step = step
        return step

    def end_step(
        self,
        *,
        output_summary: str = "",
        reward_score: float | None = None,
        reward_reason: str = "",
        llm_call_id: str | None = None,
        tokens_used: int = 0,
    ) -> StepActivity | None:
        """End the current step and record it."""
        step = self._current_step
        if step is None:
            return None

        step.ended_at = time.monotonic()
        step.duration_ms = (step.ended_at - step.started_at) * 1000
        step.output_summary = output_summary[:200]
        step.reward_score = reward_score
        step.reward_reason = reward_reason
        step.llm_call_id = llm_call_id
        step.tokens_used = tokens_used

        self.steps.append(step)
        self._current_step = None
        return step

    def record_side_step(
        self,
        action: str,
        *,
        activity_type: str = "side_system",
        duration_ms: float = 0,
        input_summary: str = "",
        output_summary: str = "",
    ) -> StepActivity:
        """Record a non-trainable side step."""
        self._step_counter += 1
        step = StepActivity(
            step_index=self._step_counter,
            lobster_id=self.lobster_id,
            activity_type=activity_type,
            action=action,
            duration_ms=duration_ms,
            input_summary=input_summary[:200],
            output_summary=output_summary[:200],
        )
        self.steps.append(step)
        return step

    def summary(self) -> dict[str, Any]:
        """Generate a summary report of all steps."""
        main_steps = [s for s in self.steps if s.activity_type == "main_line"]
        side_steps = [s for s in self.steps if s.activity_type != "main_line"]
        scored_steps = [s for s in main_steps if s.reward_score is not None]
        avg_reward = (
            sum(s.reward_score for s in scored_steps) / len(scored_steps)
            if scored_steps else None
        )
        total_tokens = sum(s.tokens_used for s in self.steps)
        total_duration = sum(s.duration_ms for s in self.steps)

        return {
            "lobster_id": self.lobster_id,
            "task_id": self.task_id,
            "total_steps": len(self.steps),
            "main_line_steps": len(main_steps),
            "side_steps": len(side_steps),
            "scored_steps": len(scored_steps),
            "avg_reward": round(avg_reward, 3) if avg_reward is not None else None,
            "min_reward": min((s.reward_score for s in scored_steps), default=None),
            "max_reward": max((s.reward_score for s in scored_steps), default=None),
            "total_tokens": total_tokens,
            "total_duration_ms": round(total_duration, 1),
            "steps": [s.to_dict() for s in self.steps],
            "weakest_step": (
                min(scored_steps, key=lambda s: s.reward_score).to_dict()
                if scored_steps else None
            ),
        }


class LobsterHook:
    """
    Base hook class with 6 lifecycle extension points.
    Override any method to add custom behavior (audit, streaming, monitoring).

    Lifecycle:
      before_iteration → on_llm_response → before_execute_tools →
      after_execute_tools → after_iteration → on_complete
    """

    async def before_iteration(self, ctx: HookContext) -> None:
        """Called before each LLM call iteration."""
        pass

    async def on_llm_response(self, ctx: HookContext) -> None:
        """Called after receiving LLM response, before tool execution check."""
        pass

    async def before_execute_tools(self, ctx: HookContext) -> None:
        """Called before executing tool calls (if any)."""
        pass

    async def after_execute_tools(self, ctx: HookContext) -> None:
        """Called after all tool calls complete."""
        pass

    async def after_iteration(self, ctx: HookContext) -> None:
        """Called at the end of each iteration."""
        pass

    async def on_complete(self, ctx: HookContext) -> None:
        """Called when the run loop completes (success or failure)."""
        pass


class CompositeHook(LobsterHook):
    """Chain multiple hooks, each runs best-effort (errors logged, not raised)."""

    def __init__(self, hooks: list[LobsterHook]) -> None:
        self._hooks = hooks

    async def _run_all(self, method: str, ctx: HookContext) -> None:
        for hook in self._hooks:
            try:
                fn = getattr(hook, method)
                await fn(ctx)
            except Exception as e:
                logger.warning("Hook %s.%s failed: %s", type(hook).__name__, method, e)

    async def before_iteration(self, ctx: HookContext) -> None:
        await self._run_all("before_iteration", ctx)

    async def on_llm_response(self, ctx: HookContext) -> None:
        await self._run_all("on_llm_response", ctx)

    async def before_execute_tools(self, ctx: HookContext) -> None:
        await self._run_all("before_execute_tools", ctx)

    async def after_execute_tools(self, ctx: HookContext) -> None:
        await self._run_all("after_execute_tools", ctx)

    async def after_iteration(self, ctx: HookContext) -> None:
        await self._run_all("after_iteration", ctx)

    async def on_complete(self, ctx: HookContext) -> None:
        await self._run_all("on_complete", ctx)


# ────────────────────────────────────────────────────────────────────
# Built-in Hooks
# ────────────────────────────────────────────────────────────────────

class AuditHook(LobsterHook):
    """
    Logs every LLM call and tool execution to the audit system.
    If audit_logger is available, records to database; otherwise logs to stdout.
    """

    def __init__(
        self,
        tenant_id: str = "tenant_main",
        user_id: str = "system",
        trace_id: str | None = None,
    ) -> None:
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.trace_id = trace_id

    async def on_llm_response(self, ctx: HookContext) -> None:
        logger.info(
            "[Audit] %s iter=%d tokens=%s",
            ctx.role_id,
            ctx.iteration,
            ctx.usage,
        )

    async def before_execute_tools(self, ctx: HookContext) -> None:
        tool_names = [tc.get("name", "?") for tc in ctx.tool_calls]
        logger.info(
            "[Audit] %s executing tools: %s",
            ctx.role_id,
            tool_names,
        )

    async def on_complete(self, ctx: HookContext) -> None:
        logger.info(
            "[Audit] %s completed: reason=%s elapsed=%.0fms error=%s",
            ctx.role_id,
            ctx.stop_reason,
            ctx.elapsed_ms,
            ctx.error or "none",
        )
        failure_detail = None
        if ctx.error is not None or ctx.stop_reason not in {"completed"}:
            try:
                from lobster_failure_reason import classify_failure

                failure_detail = classify_failure(
                    task_id=self.trace_id or "",
                    lobster_id=ctx.role_id,
                    stop_reason=ctx.stop_reason,
                    error=ctx.error,
                    tools_used=[tc.get("name", "?") for tc in ctx.tool_calls],
                    auto_retried=False,
                    occurred_at=datetime.now(timezone.utc).isoformat(),
                ).to_dict()
            except Exception:
                failure_detail = None
        # Try to write to audit_logger if available
        try:
            from audit_logger import record_audit_log

            await record_audit_log(
                tenant_id=self.tenant_id,
                user_id=self.user_id,
                action=f"lobster_run:{ctx.role_id}",
                category="ai_execution",
                summary=f"Lobster {ctx.role_id} completed: {ctx.stop_reason}",
                detail={
                    "role_id": ctx.role_id,
                    "stop_reason": ctx.stop_reason,
                    "iterations": ctx.iteration + 1,
                    "usage": ctx.usage,
                    "elapsed_ms": ctx.elapsed_ms,
                    "error": ctx.error,
                    "failure_reason": failure_detail,
                    "content_preview": (ctx.final_content or "")[:200],
                },
                result="success" if ctx.error is None else "failure",
                error_message=ctx.error,
                source="lobster_runner",
                trace_id=self.trace_id,
            )
        except Exception:
            pass  # audit is best-effort


class MetricsHook(LobsterHook):
    """Collects per-run metrics for monitoring dashboards."""

    def __init__(self) -> None:
        self.runs: list[dict[str, Any]] = []

    async def on_complete(self, ctx: HookContext) -> None:
        self.runs.append({
            "role_id": ctx.role_id,
            "stop_reason": ctx.stop_reason,
            "iterations": ctx.iteration + 1,
            "usage": dict(ctx.usage),
            "elapsed_ms": ctx.elapsed_ms,
            "error": ctx.error,
            "timestamp": time.time(),
        })


class RewardHook(LobsterHook):
    """Hook that tracks per-step rewards and main-line/side classification."""

    def __init__(self, max_expected_duration_ms: float = 30000):
        self.trackers: dict[str, StepTracker] = {}
        self.max_expected_duration_ms = max_expected_duration_ms

    def get_tracker(self, lobster_id: str, task_id: str | None = None) -> StepTracker:
        """Get or create a StepTracker for a lobster."""
        if lobster_id not in self.trackers:
            self.trackers[lobster_id] = StepTracker(lobster_id, task_id)
        return self.trackers[lobster_id]

    def on_start(self, lobster_id: str, task_id: str | None = None, **kwargs: Any) -> None:
        """Initialize tracker on execution start."""
        self.trackers[lobster_id] = StepTracker(lobster_id, task_id)

    def on_step(
        self,
        lobster_id: str,
        step_name: str,
        *,
        activity_type: str = "main_line",
        input_data: str = "",
        output_data: str = "",
        duration_ms: float = 0,
        llm_call_id: str | None = None,
        tokens_used: int = 0,
        error: str | None = None,
        **kwargs: Any,
    ) -> None:
        """Record a step with auto-computed reward score."""
        tracker = self.get_tracker(lobster_id)

        reward_score = None
        reward_reason = ""
        if activity_type == "main_line" and not error:
            score = 0.0
            reasons: list[str] = []
            if output_data and len(output_data) > 10:
                score += 0.5
                reasons.append("has_output")
            if any(marker in output_data for marker in ["{", "##", "- ", "1.", "|"]):
                score += 0.2
                reasons.append("structured")
            if 0 < duration_ms < self.max_expected_duration_ms:
                score += 0.2
                reasons.append("on_time")
            score += 0.1
            reasons.append("no_error")
            reward_score = min(score, 1.0)
            reward_reason = "+".join(reasons)
        elif error:
            reward_score = 0.0
            reward_reason = f"error:{error[:100]}"

        if activity_type == "main_line":
            tracker.begin_step(step_name, activity_type=activity_type, input_summary=input_data)
            tracker.end_step(
                output_summary=output_data,
                reward_score=reward_score,
                reward_reason=reward_reason,
                llm_call_id=llm_call_id,
                tokens_used=tokens_used,
            )
        else:
            tracker.record_side_step(
                step_name,
                activity_type=activity_type,
                duration_ms=duration_ms,
                input_summary=input_data,
                output_summary=output_data,
            )

    def on_end(self, lobster_id: str, **kwargs: Any) -> dict[str, Any] | None:
        """Return the step summary when execution completes."""
        tracker = self.trackers.get(lobster_id)
        if tracker:
            return tracker.summary()
        return None

    def on_error(self, lobster_id: str, error: str, **kwargs: Any) -> None:
        """Record error in current step."""
        tracker = self.trackers.get(lobster_id)
        if tracker and tracker._current_step:
            tracker.end_step(
                output_summary=f"ERROR: {error[:200]}",
                reward_score=0.0,
                reward_reason="execution_error",
            )


# ────────────────────────────────────────────────────────────────────
# Run Spec & Result
# ────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class LobsterRunSpec:
    """
    Configuration for a single lobster execution.

    The lobster provides:
    - role_id: which lobster is running
    - system_prompt: from prompt-kit/system.prompt.md
    - user_prompt: constructed from DragonState + user-template.md
    - model_override: optional per-lobster model binding
    - tools: optional tool definitions for tool-use loop
    - max_iterations: how many LLM↔tool rounds allowed
    - temperature: LLM temperature
    - meta: routing metadata for LLMRouter (RouteMeta fields)
    """
    role_id: str
    system_prompt: str
    user_prompt: str
    model_override: str | None = None
    tools: list[dict[str, Any]] | None = None
    tool_executor: Optional[Callable[[str, dict], Awaitable[str]]] = None
    max_iterations: int = 10
    temperature: float | None = None
    meta: dict[str, Any] | None = None
    force_tier: Any | None = None
    prompt_skill_id: str | None = None
    prompt_variables: dict[str, Any] | None = None
    session_id: str | None = None
    session_mode: str | None = None
    peer_id: str | None = None
    fresh_context: bool = False
    max_history_messages: int = 50
    max_context_tokens: int = 8000
    expects: str | None = None
    max_retries: int = 0
    retry_prompt_suffix: str | None = None
    expects_retry_depth: int = 0
    hook: LobsterHook | None = None
    concurrent_tools: bool = True
    lobster: Any | None = None


@dataclass(slots=True)
class LobsterRunResult:
    """
    Outcome of a lobster execution.

    - final_content: the last LLM response text
    - messages: full message history (for session persistence)
    - tools_used: list of tool names invoked
    - usage: token usage summary
    - stop_reason: "completed" | "max_iterations" | "error" | "tool_error"
    - error: error message if any
    - elapsed_ms: total execution time
    """
    final_content: str | None
    messages: list[dict[str, Any]]
    tools_used: list[str] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)
    stop_reason: str = "completed"
    error: str | None = None
    elapsed_ms: float = 0.0
    step_summary: dict[str, Any] | None = None
    output_format_template: str | None = None
    strategy_intensity: dict[str, Any] | None = None
    expects_passed: bool | None = None
    retry_count: int = 0
    expects_failure_reason: str | None = None
    escalation_id: str | None = None
    failure_reason: dict[str, Any] | None = None
    task_resolution: dict[str, Any] | None = None


class LobsterExecutionMode(str, Enum):
    FOREGROUND = "foreground"
    BACKGROUND = "background"
    AUTO = "auto"


def _iter_hook_extensions(hook: LobsterHook) -> list[Any]:
    """Flatten hook tree so extension methods can be called without modifying CompositeHook."""
    if isinstance(hook, CompositeHook):
        flattened: list[Any] = []
        for child in getattr(hook, "_hooks", []):
            flattened.extend(_iter_hook_extensions(child))
        return flattened
    return [hook]


def _call_hook_extension(hook: LobsterHook, method: str, *args: Any, **kwargs: Any) -> Any:
    """Call optional sync extension methods such as RewardHook.on_step()."""
    result = None
    for item in _iter_hook_extensions(hook):
        fn = getattr(item, method, None)
        if not callable(fn):
            continue
        try:
            value = fn(*args, **kwargs)
            if value is not None:
                result = value
        except Exception as e:
            logger.warning("Hook extension %s.%s failed: %s", type(item).__name__, method, e)
    return result


def select_output_format(lobster: Any, task_type: str) -> str | None:
    """Select the appropriate output format template for a task type."""
    if lobster is None:
        return None
    format_map = {
        "alert": ["risk_event", "threshold_breach", "urgent_notification"],
        "digest": ["weekly_report", "periodic_summary", "daily_recap"],
        "comparison": ["competitor_compare", "ab_test_result", "channel_compare"],
        "analysis": ["deep_analysis", "root_cause", "strategy_review"],
    }
    for fmt, task_types in format_map.items():
        if task_type in task_types:
            return getattr(lobster, "output_formats", {}).get(fmt)
    return None


# ────────────────────────────────────────────────────────────────────
# LobsterRunner — 核心执行引擎
# ────────────────────────────────────────────────────────────────────

class LobsterRunner:
    """
    Unified execution engine for all 10 lobsters.
    （commander 元老院总脑 + 9 只业务龙虾）

    Usage:
        runner = LobsterRunner(llm_router)
        result = await runner.run(LobsterRunSpec(
            role_id="radar",
            system_prompt="...",
            user_prompt="...",
        ))

    The runner handles:
    1. LLM invocation via LLMRouter (local/cloud routing, fallback)
    2. Tool call parsing and execution (if tools provided)
    3. Multi-iteration loop (LLM → tools → LLM → ...)
    4. Hook lifecycle (audit, metrics, streaming)
    5. Error handling and graceful degradation
    """

    def __init__(self, llm_router: Any) -> None:
        """
        Args:
            llm_router: LLMRouter instance (from llm_router.py)
        """
        self.llm_router = llm_router

    async def run_lobster_with_background_support(
        self,
        spec: LobsterRunSpec,
        description: str,
        *,
        mode: LobsterExecutionMode = LobsterExecutionMode.AUTO,
        notification_queue: "asyncio.Queue | None" = None,
        on_background_hint: "Callable[[str, str], None] | None" = None,
    ) -> Any:
        return await run_lobster_with_background_support(
            self,
            spec,
            description,
            mode=mode,
            notification_queue=notification_queue,
            on_background_hint=on_background_hint,
        )

    def _load_lobster_runtime(self, spec: LobsterRunSpec) -> Any:
        """Best-effort lobster runtime object for prompt + working-state composition."""
        if spec.lobster is not None:
            return spec.lobster
        try:
            from lobsters.base_lobster import BaseLobster

            class _RuntimeLobster(BaseLobster):
                role_id = spec.role_id

            return _RuntimeLobster()
        except Exception:
            return None

    def _infer_prompt_skill_id(self, spec: LobsterRunSpec, lobster: Any) -> str | None:
        if spec.prompt_skill_id:
            return spec.prompt_skill_id

        meta = spec.meta or {}
        for key in ("prompt_skill_id", "skill_id", "current_skill_id"):
            value = str(meta.get(key) or "").strip()
            if value:
                return value

        task_type = str(meta.get("task_type") or spec.role_id)
        inferred_map = {
            ("inkwriter", "content_generation"): "inkwriter_copy_generate",
            ("echoer", "engagement_copy"): "echoer_reply_generate",
            ("followup", "followup_voice"): "followup_multi_touch",
        }
        inferred = inferred_map.get((spec.role_id, task_type))
        if inferred:
            return inferred

        starter_skills = list(getattr(lobster, "starter_skills", []) or [])
        if starter_skills:
            return str(starter_skills[0])

        role_card_skills = getattr(lobster, "role_card", {}).get("skills", []) if lobster is not None else []
        if isinstance(role_card_skills, list) and role_card_skills:
            return str(role_card_skills[0])
        return None

    def _resolve_industry(self, spec: LobsterRunSpec) -> str | None:
        meta = spec.meta or {}
        for key in ("industry", "industry_tag"):
            value = str(meta.get(key) or "").strip()
            if value:
                return value

        industry_context = meta.get("industry_context")
        if isinstance(industry_context, dict):
            value = str(industry_context.get("industry") or industry_context.get("industry_tag") or "").strip()
            if value:
                return value
        return None

    def _resolve_prompt_variables(self, spec: LobsterRunSpec) -> dict[str, Any]:
        variables = dict(spec.prompt_variables or {})
        meta = spec.meta or {}
        extra = meta.get("prompt_variables")
        if isinstance(extra, dict):
            variables.update(extra)
        if "task_description" not in variables:
            variables["task_description"] = spec.user_prompt
        return variables

    def _resolve_user_prompt(self, spec: LobsterRunSpec, lobster: Any) -> str:
        try:
            from prompt_asset_loader import get_prompt_loader
        except Exception:
            return spec.user_prompt

        skill_id = self._infer_prompt_skill_id(spec, lobster)
        if not skill_id:
            return spec.user_prompt

        try:
            template = get_prompt_loader().get_best_for(skill_id, self._resolve_industry(spec))
        except Exception:
            return spec.user_prompt
        if template is None:
            return spec.user_prompt

        variables = self._resolve_prompt_variables(spec)
        try:
            rendered = template.render(variables) if hasattr(template, "render") else str(getattr(template, "content", "") or "")
        except Exception:
            rendered = str(getattr(template, "content", "") or "")
        rendered_text = str(rendered or "").strip()
        return rendered_text or spec.user_prompt

    @staticmethod
    def _extract_json_payload(text: str) -> str:
        import re

        raw = str(text or "").strip()
        if not raw:
            return raw
        fenced = re.findall(r"```(?:json)?\s*(.*?)```", raw, re.DOTALL | re.IGNORECASE)
        if fenced:
            return str(fenced[0]).strip()
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            return raw[start:end + 1]
        return raw

    @staticmethod
    def _build_structured_output_prompt(output_model: Any) -> str:
        schema_json = "{}"
        schema_name = getattr(output_model, "__name__", "StructuredOutput")
        try:
            schema_json = json.dumps(output_model.model_json_schema(), ensure_ascii=False, indent=2)
        except Exception:
            pass
        return (
            "\n\n[Structured Output Guard]\n"
            f"You must return valid JSON matching the schema `{schema_name}` exactly.\n"
            "Do not add markdown fences, explanations, or any extra prose.\n"
            f"JSON Schema:\n{schema_json}"
        )

    async def run_structured_output(
        self,
        spec: LobsterRunSpec,
        *,
        output_model: Any | None = None,
        max_retries: int = 3,
    ) -> Any:
        try:
            from lobster_output_schemas import get_output_schema_for_lobster
        except Exception:
            get_output_schema_for_lobster = lambda _lobster_id: None  # type: ignore[assignment]

        resolved_model = output_model or get_output_schema_for_lobster(spec.role_id)
        if resolved_model is None:
            return await self.run(spec)

        instructor_enabled = False
        model_name = str(spec.model_override or "")
        schema_name = getattr(resolved_model, "__name__", "StructuredOutput")
        task_id = str((spec.meta or {}).get("task_id") or (spec.meta or {}).get("trace_id") or f"{spec.role_id}_{int(time.time())}")
        tenant_id = str((spec.meta or {}).get("tenant_id") or "tenant_main").strip() or "tenant_main"
        system_suffix = self._build_structured_output_prompt(resolved_model)
        last_error = ""

        for attempt in range(max(1, int(max_retries))):
            structured_spec = replace(
                spec,
                system_prompt=f"{spec.system_prompt}{system_suffix}",
                user_prompt=str(spec.user_prompt or ""),
                tools=None,
                tool_executor=None,
                concurrent_tools=False,
            )
            try:
                try:
                    import anthropic  # noqa: F401
                    import instructor  # noqa: F401

                    instructor_enabled = True
                except Exception:
                    instructor_enabled = False

                result = await self.run(structured_spec)
                payload = self._extract_json_payload(str(result.final_content or ""))
                parsed = resolved_model.model_validate_json(payload)
                try:
                    from instructor_output_guard import get_instructor_output_guard_store

                    get_instructor_output_guard_store().record_run(
                        tenant_id=tenant_id,
                        lobster_id=spec.role_id,
                        task_id=task_id,
                        schema_name=schema_name,
                        retry_count=attempt,
                        success=True,
                        instructor_enabled=instructor_enabled,
                        model=model_name,
                    )
                except Exception:
                    pass
                return parsed
            except Exception as exc:  # noqa: BLE001
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt >= max(1, int(max_retries)) - 1:
                    break
        try:
            from instructor_output_guard import get_instructor_output_guard_store

            get_instructor_output_guard_store().record_run(
                tenant_id=tenant_id,
                lobster_id=spec.role_id,
                task_id=task_id,
                schema_name=schema_name,
                retry_count=max(0, int(max_retries) - 1),
                success=False,
                instructor_enabled=instructor_enabled,
                model=model_name,
                error_message=last_error,
            )
        except Exception:
            pass
        raise ValueError(f"structured_output_validation_failed:{schema_name}:{last_error}")

        prompt = get_prompt_loader().get_best_for(skill_id, self._resolve_industry(spec))
        if prompt is None:
            return spec.user_prompt

        variables = self._resolve_prompt_variables(spec)
        rendered = prompt.fill(**variables).strip()
        base_prompt = rendered or spec.user_prompt
        try:
            from prompt_registry import get_prompt_registry

            flag_ctx = self._resolve_feature_flag_context(spec)
            ab_prompt, variant_name = get_prompt_registry().get_prompt_with_ab(
                spec.role_id,
                skill_id,
                flag_ctx,
                fallback_prompt=base_prompt,
            )
            spec.meta = dict(spec.meta or {})
            spec.meta["prompt_variant_name"] = variant_name
            spec.meta["prompt_experiment_flag"] = f"prompt.{spec.role_id}.{skill_id}.experiment"
            return ab_prompt or base_prompt
        except Exception:
            return base_prompt

    def _resolve_strategy_intensity_manager(self, spec: LobsterRunSpec) -> Any:
        try:
            from commander_router import get_strategy_intensity_manager
        except Exception:
            return None

        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or meta.get("user_id") or "tenant_main").strip() or "tenant_main"
        return get_strategy_intensity_manager(tenant_id)

    def _resolve_autonomy_policy(self, spec: LobsterRunSpec) -> Any:
        try:
            from autonomy_policy import get_autonomy_policy_manager
        except Exception:
            return None
        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or meta.get("user_id") or "tenant_main").strip() or "tenant_main"
        return get_autonomy_policy_manager().get_policy(tenant_id)

    def _resolve_contextual_skills(self, spec: LobsterRunSpec) -> list[Any]:
        try:
            from lobster_skill_registry import get_skill_registry
            from skill_loader import SkillLoader
        except Exception:
            return []
        context = dict(spec.meta or {})
        context.setdefault("task_description", spec.user_prompt)
        skills = SkillLoader(get_skill_registry()).load_on_demand(spec.role_id, context)
        try:
            from lobster_config_center import get_lobster_config_center

            tenant_id = str(context.get("tenant_id") or context.get("user_id") or "tenant_main").strip() or "tenant_main"
            overrides = get_lobster_config_center().get_runtime_overrides(spec.role_id, tenant_id)
            selected_ids = {str(item) for item in (overrides.active_skill_ids or []) if str(item).strip()}
            if selected_ids:
                skills = [skill for skill in skills if str(getattr(skill, "id", "")) in selected_ids]
        except Exception:
            pass
        approved: list[Any] = []
        for skill in skills:
            status = str(getattr(skill, "publish_status", "approved") or "approved").strip().lower()
            if status != "approved":
                logger.warning(
                    "Skip skill %s for lobster=%s because publish_status=%s",
                    getattr(skill, "id", ""),
                    spec.role_id,
                    status or "unknown",
                )
                continue
            approved.append(skill)
        return approved

    def _augment_system_prompt_with_agent_context(self, lobster: Any, spec: LobsterRunSpec, base_prompt: str) -> str:
        parts = [base_prompt]
        agents_rules = str(getattr(lobster, "agents_rules", "") or "").strip()
        if agents_rules:
            parts.append(f"## AGENTS Rules\n{agents_rules}")

        heartbeat = getattr(lobster, "heartbeat", {}) or {}
        on_wake = heartbeat.get("on_wake", []) if isinstance(heartbeat, dict) else []
        if on_wake:
            wake_lines = []
            for item in on_wake[:6]:
                if isinstance(item, dict):
                    wake_lines.append(f"- check={item.get('check')} action={item.get('action')}")
            if wake_lines:
                parts.append("## On Wake Checklist\n" + "\n".join(wake_lines))

        working = getattr(lobster, "working", {}) or {}
        current_task = working.get("current_task") if isinstance(working, dict) else None
        if isinstance(current_task, dict) and current_task:
            parts.append(
                "## Recovered Working Context\n"
                f"- task_id: {current_task.get('task_id')}\n"
                f"- description: {current_task.get('description')}\n"
                f"- started_at: {current_task.get('started_at')}"
            )

        try:
            from lobster_config_center import get_lobster_config_center

            tenant_id = str((spec.meta or {}).get("tenant_id") or (spec.meta or {}).get("user_id") or "tenant_main").strip() or "tenant_main"
            overrides = get_lobster_config_center().get_runtime_overrides(spec.role_id, tenant_id)
            if overrides.strategy_level is not None:
                parts.append(f"## Tenant Strategy Hint\n- configured strategy level: {overrides.strategy_level}")
            if overrides.active_tools:
                parts.append("## Active Tool Allowlist\n" + "\n".join(f"- {item}" for item in overrides.active_tools[:12]))
            if overrides.custom_prompt:
                parts.append(f"## Tenant Custom Instructions\n{overrides.custom_prompt}")
        except Exception:
            pass

        kb_refs = self._load_bound_knowledge_context(spec)
        if kb_refs:
            lines = [
                f"- [{str(item.get('kb_name') or item.get('kb_id') or 'knowledge')}] {str(item.get('content') or '').strip()[:180]}"
                for item in kb_refs[:3]
            ]
            parts.append("## Bound Knowledge Base Context\n" + "\n".join(lines))

        contextual_skills = self._resolve_contextual_skills(spec)
        if contextual_skills:
            lines = []
            for skill in contextual_skills[:6]:
                gotchas = "; ".join(skill.gotchas[:2]) if getattr(skill, "gotchas", None) else ""
                lines.append(
                    f"- {skill.id}: {skill.name} [{skill.category or 'uncategorized'}]"
                    + (f" | gotchas: {gotchas}" if gotchas else "")
                )
            parts.append("## Relevant Skills\n" + "\n".join(lines))

        try:
            from module_registry import get_module_registry

            modules = get_module_registry().get_available_modules(spec.role_id)
            if modules:
                module_lines = [
                    f"- {item['module_id']}: {item['name']} | inputs={','.join(item['inputs'])} | outputs={','.join(item['outputs'])} | avg_tokens={item['avg_tokens']}"
                    for item in modules[:8]
                ]
                parts.append("## Available Modules\n" + "\n".join(module_lines))
        except Exception:
            pass

        industry_tag = self._resolve_industry(spec)
        if industry_tag:
            try:
                from knowledge_pack_loader import load_industry_section

                industry_section = load_industry_section(spec.role_id, industry_tag)
                if industry_section:
                    parts.append(industry_section)
            except Exception:
                pass

        return "\n\n---\n\n".join(part for part in parts if str(part).strip())

    def _load_bound_knowledge_context(self, spec: LobsterRunSpec) -> list[dict[str, Any]]:
        try:
            from knowledge_base_manager import get_knowledge_base_manager
        except Exception:
            return []
        tenant_id = str((spec.meta or {}).get("tenant_id") or (spec.meta or {}).get("user_id") or "tenant_main").strip() or "tenant_main"
        try:
            return get_knowledge_base_manager().search_bound_knowledge(
                spec.role_id,
                tenant_id,
                spec.user_prompt,
                top_k=3,
            )
        except Exception:
            return []

    def _build_context_engine_block(
        self,
        *,
        spec: LobsterRunSpec,
        task: str,
        session_history: list[dict[str, Any]],
    ) -> tuple[str, list[dict[str, Any]]]:
        try:
            from context_engine import ContextBudget, LobsterContextEngine
        except Exception:
            return "", session_history
        meta = dict(spec.meta or {})
        lead_profile = {}
        for key in ("lead_profile", "lead", "customer_profile"):
            if isinstance(meta.get(key), dict):
                lead_profile = dict(meta.get(key) or {})
                break
        skill_docs = [
            {
                "id": getattr(skill, "id", ""),
                "name": getattr(skill, "name", ""),
                "description": getattr(skill, "description", ""),
                "content": "\n".join(
                    part for part in [
                        str(getattr(skill, "description", "") or ""),
                        "; ".join(getattr(skill, "gotchas", [])[:3]) if getattr(skill, "gotchas", None) else "",
                    ] if part
                ),
            }
            for skill in (self._resolve_contextual_skills(spec) or [])[:8]
        ]
        knowledge_snippets = self._load_bound_knowledge_context(spec)
        budget = ContextBudget(max_total_tokens=int(spec.max_context_tokens or 8000))
        engine = LobsterContextEngine(budget=budget)
        built = engine.build_context(
            task=task,
            lead_profile=lead_profile,
            conversation_history=session_history,
            skill_docs=skill_docs,
            knowledge_snippets=knowledge_snippets,
        )
        if built.selected_history_indexes:
            selected_history = [
                session_history[idx]
                for idx in built.selected_history_indexes
                if 0 <= idx < len(session_history)
            ]
        else:
            selected_history = session_history
        return built.context_text, selected_history

    def _build_bootstrap_context_block(self, bootstrap_data: dict[str, Any] | None) -> str:
        if not isinstance(bootstrap_data, dict) or not bootstrap_data:
            return ""
        lines = []
        for key, value in bootstrap_data.items():
            if key in {"bootstrap_complete", "bootstrap_at", "session_id", "tenant_id"}:
                continue
            text = str(value or "").strip()
            if text:
                lines.append(f"- {key}: {text}")
        if not lines:
            return ""
        return "## Bootstrap Context\n" + "\n".join(lines)

    def _resolve_feature_flag_context(self, spec: LobsterRunSpec) -> Any:
        try:
            from feature_flags import FeatureFlagContext, Environment
        except Exception:
            return None
        meta = spec.meta or {}
        env_name = str(meta.get("environment") or os.getenv("APP_ENV", "prod")).strip().lower() or "prod"
        try:
            environment = Environment(env_name)
        except Exception:
            environment = Environment.PROD
        return FeatureFlagContext(
            tenant_id=str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main",
            user_id=str(meta.get("user_id") or spec.peer_id or "").strip(),
            lobster_id=spec.role_id,
            edge_node_id=str(meta.get("edge_node_id") or "").strip(),
            edge_node_tags=[str(item).strip() for item in meta.get("edge_node_tags", []) if str(item).strip()] if isinstance(meta.get("edge_node_tags"), list) else [],
            environment=environment,
        )

    async def _record_prompt_experiment_outcome(
        self,
        *,
        spec: LobsterRunSpec,
        final_content: str | None,
        elapsed_ms: float,
    ) -> None:
        meta = spec.meta or {}
        variant_name = str(meta.get("prompt_variant_name") or "").strip()
        flag_name = str(meta.get("prompt_experiment_flag") or "").strip()
        if not variant_name or variant_name == "control" or not flag_name or not str(final_content or "").strip():
            return
        try:
            from llm_quality_judge import get_quality_judge
            from prompt_registry import get_prompt_registry

            eval_template = {
                "inkwriter": "copy_quality",
                "catcher": "compliance_check",
                "abacus": "lead_score_quality",
            }.get(spec.role_id, "copy_quality")
            score_payload = get_quality_judge().evaluate(
                content=str(final_content),
                eval_template=eval_template,
                context={
                    "industry": str(meta.get("industry") or meta.get("industry_tag") or ""),
                    "platform": str(meta.get("channel") or meta.get("platform") or ""),
                    "target_audience": str(meta.get("target_audience") or ""),
                    "interaction_data": str(meta.get("interaction_data") or ""),
                },
                tenant_id=str(meta.get("tenant_id") or "tenant_main"),
                auto_save_score=False,
            )
            scores = score_payload.get("scores", {}) if isinstance(score_payload, dict) else {}
            quality_score = float(scores.get("overall") or scores.get("quality") or 0.0)
            get_prompt_registry().record_experiment_outcome(
                flag_name=flag_name,
                lobster=spec.role_id,
                skill=str(self._infer_prompt_skill_id(spec, spec.lobster) or ""),
                variant_name=variant_name,
                tenant_id=str(meta.get("tenant_id") or "tenant_main"),
                quality_score=quality_score,
                latency_ms=int(elapsed_ms),
                prompt_name=str(self._infer_prompt_skill_id(spec, spec.lobster) or ""),
                prompt_version=0,
                gen_id=str(meta.get("gen_id") or ""),
            )
            try:
                from experiment_registry import get_experiment_registry

                get_experiment_registry().append_prompt_experiment_result(
                    flag_name=flag_name,
                    lobster_name=spec.role_id,
                    tenant_id=str(meta.get("tenant_id") or "tenant_main"),
                    variant_name=variant_name,
                    input_payload={
                        "input_text": spec.user_prompt,
                        "role_id": spec.role_id,
                        "skill_id": str(self._infer_prompt_skill_id(spec, spec.lobster) or ""),
                    },
                    output_text=str(final_content),
                    scores={
                        "quality_score": quality_score,
                        "latency_ms": round(float(elapsed_ms or 0.0), 1),
                    },
                    gen_id=str(meta.get("gen_id") or ""),
                    latency_ms=int(elapsed_ms),
                    prompt_name=str(self._infer_prompt_skill_id(spec, spec.lobster) or ""),
                    prompt_version=str(meta.get("prompt_version") or "0"),
                    model=str(meta.get("model") or spec.model_override or ""),
                    context_snapshot={
                        "tenant_id": str(meta.get("tenant_id") or "tenant_main"),
                        "platform": str(meta.get("channel") or meta.get("platform") or ""),
                    },
                )
            except Exception as experiment_exc:
                logger.warning("Prompt experiment registry sync skipped for %s: %s", spec.role_id, experiment_exc)
        except Exception as exc:
            logger.warning("Prompt experiment outcome skipped for %s: %s", spec.role_id, exc)

    def _build_online_eval_context(self, spec: LobsterRunSpec) -> dict[str, Any]:
        meta = dict(spec.meta or {})
        context: dict[str, Any] = {}
        for key in (
            "tenant_id",
            "user_id",
            "platform",
            "channel",
            "industry",
            "industry_tag",
            "target_audience",
            "memory_context",
            "retrieved_memory",
            "context_documents",
            "interaction_data",
            "task_type",
        ):
            if key in meta and meta.get(key) not in (None, "", [], {}):
                context[key] = meta.get(key)
        return context

    def _schedule_online_eval(self, spec: LobsterRunSpec, result: LobsterRunResult) -> None:
        if result.error or result.stop_reason not in {"completed", "expects_failed"}:
            return
        if not str(result.final_content or "").strip():
            return
        try:
            from online_eval_sampler import get_online_eval_sampler

            meta = spec.meta or {}
            get_online_eval_sampler().schedule(
                lobster_name=spec.role_id,
                input_text=spec.user_prompt,
                output_text=str(result.final_content or ""),
                tenant_id=str(meta.get("tenant_id") or "tenant_main"),
                context=self._build_online_eval_context(spec),
                prompt_name=str(self._infer_prompt_skill_id(spec, spec.lobster) or ""),
                prompt_version=str(meta.get("prompt_version") or ""),
                model=str(meta.get("model") or spec.model_override or ""),
                gen_id=str(meta.get("gen_id") or ""),
                latency_ms=int(result.elapsed_ms or 0),
                tokens_used=int((result.usage or {}).get("total_tokens") or 0),
                cost_usd=float((meta.get("cost_usd") or 0.0)),
            )
        except Exception as exc:
            logger.warning("Online eval scheduling skipped for %s: %s", spec.role_id, exc)

    async def _build_lobster_memory_context(self, lobster: Any, spec: LobsterRunSpec) -> str:
        if not self._lobster_file_memory_enabled() or lobster is None or not hasattr(lobster, "memory"):
            return ""
        query = str(spec.user_prompt or "").strip()
        if not query:
            return ""
        try:
            memories = await lobster.memory.recall(query=query, top_k=3)
        except Exception:
            return ""
        if not memories:
            return ""
        lines = []
        for item in memories:
            content = str(item.get("content") or "").strip().replace("\n", " ")
            content = await self._sanitize_untrusted_block(
                lobster=lobster,
                spec=spec,
                text=content,
                source="memory_recall",
            )
            lines.append(f"- [{item.get('category')}] {item.get('key')}: {content[:220]}")
        return "## Recalled Memory\n" + "\n".join(lines)

    def _build_action_profile(self, spec: LobsterRunSpec, action_type: str, channel_name: str | None) -> dict[str, Any]:
        meta = spec.meta or {}
        irreversible = bool(
            meta.get("irreversible")
            or meta.get("is_irreversible")
            or action_type in {"dms", "outbound_call", "price_commitment"}
            or (action_type == "posts" and bool(channel_name))
        )
        affects_shared_state = bool(
            meta.get("affects_shared_state")
            or meta.get("shared_state")
            or (self._resolve_session_mode(spec) == "shared")
        )
        return {
            "action_type": action_type,
            "channel": channel_name,
            "irreversible": irreversible,
            "affects_shared_state": affects_shared_state,
        }

    def _resolve_session_peer_id(self, spec: LobsterRunSpec) -> str:
        meta = spec.meta or {}
        for value in (
            spec.peer_id,
            meta.get("peer_id"),
            meta.get("sender_id"),
            meta.get("peer"),
            meta.get("chat_id"),
            meta.get("user_id"),
            meta.get("scheduler_task_id"),
        ):
            text = str(value or "").strip()
            if text:
                return text
        return spec.role_id

    def _resolve_session_mode(self, spec: LobsterRunSpec) -> str:
        meta = spec.meta or {}
        for value in (
            spec.session_mode,
            meta.get("session_mode"),
            meta.get("dm_scope"),
            meta.get("session_scope"),
        ):
            text = str(value or "").strip().lower()
            if text in {"shared", "isolated", "per-peer", "per_peer", "peer"}:
                if text in {"per_peer", "peer"}:
                    return "per-peer"
                return text
        return "shared"

    def _resolve_session_context(self, spec: LobsterRunSpec) -> tuple[Any, list[dict[str, Any]]]:
        try:
            from session_manager import get_session_manager
        except Exception:
            return None, []
        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or meta.get("user_id") or "tenant_main").strip() or "tenant_main"
        channel = str(meta.get("channel") or meta.get("channel_type") or meta.get("source_channel") or "runner").strip() or "runner"
        peer_id = self._resolve_session_peer_id(spec)
        session = get_session_manager().get_or_create(
            peer_id=peer_id,
            lobster_id=spec.role_id,
            mode=self._resolve_session_mode(spec),
            channel=channel,
            tenant_id=tenant_id,
            session_id=spec.session_id,
        )
        history = session.messages[-50:] if getattr(session, "messages", None) else []
        normalized_history = []
        for item in history:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            content = str(item.get("content") or "").strip()
            if role and content:
                normalized_history.append({"role": role, "content": content})
        return session, normalized_history

    def _persist_session_messages(
        self,
        session: Any,
        *,
        user_prompt: str,
        final_content: str | None,
        error: str | None,
    ) -> None:
        if session is None:
            return
        try:
            from session_manager import get_session_manager
        except Exception:
            return
        session_mgr = get_session_manager()
        if user_prompt.strip():
            session_mgr.append_message(session.session_id, role="user", content=user_prompt)
        if final_content and final_content.strip():
            session_mgr.append_message(session.session_id, role="assistant", content=final_content)
        elif error:
            session_mgr.append_message(session.session_id, role="assistant", content=f"[error] {error}")

    def _memory_compression_enabled(self) -> bool:
        return os.getenv("MEMORY_COMPRESSION_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}

    def _lobster_file_memory_enabled(self) -> bool:
        return os.getenv("LOBSTER_FILE_MEMORY_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}

    def _lobster_memory_auto_extract_enabled(self) -> bool:
        return os.getenv("LOBSTER_MEMORY_AUTO_EXTRACT", "true").strip().lower() not in {"0", "false", "no", "off"}

    def _render_memory_markdown(self, messages: list[dict[str, Any]]) -> str:
        sections: list[str] = []
        for message in messages:
            role = str(message.get("role") or "unknown").upper()
            name = str(message.get("name") or "").strip()
            title = f"## {role}"
            if name:
                title += f" ({name})"
            content = str(message.get("content") or "").strip()
            if not content:
                continue
            sections.append(f"{title}\n\n{content}")
        return "\n\n".join(sections)

    async def _compress_memory_after_run(
        self,
        *,
        spec: LobsterRunSpec,
        messages: list[dict[str, Any]],
        usage: dict[str, int],
        final_content: str | None,
        error: str | None,
        stop_reason: str,
    ) -> None:
        if error is not None or not final_content or stop_reason not in {"completed", "max_iterations"}:
            return
        if not self._memory_compression_enabled():
            return
        try:
            from llm_router import RouteMeta
            from memory_compressor import L0RawEntry, MemoryCompressor
        except Exception:
            return

        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or meta.get("user_id") or "tenant_main").strip() or "tenant_main"
        user_id = str(meta.get("user_id") or meta.get("scheduler_task_id") or meta.get("task_id") or "memory-system").strip() or "memory-system"
        task_id = str(meta.get("task_id") or meta.get("trace_id") or f"{spec.role_id}_{int(time.time())}").strip()
        conversation_text = self._render_memory_markdown(messages)
        if not conversation_text.strip():
            return
        token_count = max(int(sum(int(v or 0) for v in usage.values())), len(conversation_text.split()))

        async def _memory_llm(prompt: str, max_tokens: int) -> str:
            return await self.llm_router.routed_ainvoke_text(
                system_prompt="你是知识压缩专家。请严格遵循用户要求，只返回 JSON，不要添加解释。",
                user_prompt=prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=max_tokens,
                    tenant_tier=str(meta.get("tenant_tier") or "basic"),
                    user_id=user_id,
                    tenant_id=tenant_id,
                    task_type="memory_compression",
                ),
                temperature=0.1,
            )

        compressor = MemoryCompressor(
            llm_call_fn=_memory_llm,
            storage_dir=os.getenv("MEMORY_COMPRESSION_DIR", "./data/memory"),
        )
        entry = L0RawEntry(
            entry_id=task_id,
            lobster_id=spec.role_id,
            task_id=task_id,
            content=conversation_text,
            token_count=token_count,
            tenant_id=tenant_id,
        )
        await compressor.compress_l0_to_l1(entry)
        await compressor.maybe_promote_pending_to_l2(tenant_id=tenant_id, min_reports=10, batch_size=10)

    async def _extract_and_store_lobster_experiences(
        self,
        *,
        lobster: Any,
        spec: LobsterRunSpec,
        messages: list[dict[str, Any]],
        final_content: str | None,
        error: str | None,
    ) -> None:
        if not self._lobster_file_memory_enabled() or not self._lobster_memory_auto_extract_enabled():
            return
        if lobster is None or not hasattr(lobster, "memory") or error is not None or not final_content:
            return
        try:
            from lobsters.experience_extractor import ExperienceExtractor
            from llm_router import RouteMeta
        except Exception:
            return

        meta = spec.meta or {}
        user_id = str(meta.get("user_id") or meta.get("task_id") or "memory-system").strip() or "memory-system"
        tenant_id = str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        session_log = self._render_memory_markdown(messages)
        if not session_log.strip():
            return

        async def _memory_llm(prompt: str, max_tokens: int) -> str:
            return await self.llm_router.routed_ainvoke_text(
                system_prompt="你是经验提炼器。只输出 JSON 数组，不要输出解释。",
                user_prompt=prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=max_tokens,
                    tenant_tier=str(meta.get("tenant_tier") or "basic"),
                    user_id=user_id,
                    tenant_id=tenant_id,
                    task_type="lobster_experience_extract",
                ),
                temperature=0.1,
            )

        extractor = ExperienceExtractor(_memory_llm)
        extracted = await extractor.extract(session_log, spec.role_id)
        for item in extracted:
            await lobster.memory.remember(
                category=item["category"],
                key=item["key"],
                value=item["value"],
                metadata={
                    "source": "auto_extract",
                    "task_id": str(meta.get("task_id") or meta.get("trace_id") or ""),
                    "tenant_id": tenant_id,
                },
            )

    async def _extract_structured_memories_after_run(
        self,
        *,
        spec: LobsterRunSpec,
        messages: list[dict[str, Any]],
        final_content: str | None,
        error: str | None,
    ) -> None:
        if error is not None or not final_content:
            return
        try:
            from enterprise_memory import EnterpriseMemoryBank
            from llm_router import RouteMeta
            from memory_extractor import MemoryExtractor
        except Exception:
            return

        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        task_id = str(meta.get("task_id") or meta.get("trace_id") or f"{spec.role_id}_{int(time.time())}").strip()
        session_id = str(spec.session_id or meta.get("session_id") or "").strip()
        lead_id = str(meta.get("lead_id") or meta.get("leadId") or meta.get("customer_id") or "").strip()
        conversation_text = self._render_memory_markdown(messages)
        if not conversation_text.strip():
            return

        async def _memory_llm(prompt: str, max_tokens: int) -> str:
            return await self.llm_router.routed_ainvoke_text(
                system_prompt="你是结构化记忆提取器。只输出 JSON，不要输出解释。",
                user_prompt=prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=max_tokens,
                    tenant_tier=str(meta.get("tenant_tier") or "basic"),
                    user_id=str(meta.get("user_id") or task_id or "memory-system"),
                    tenant_id=tenant_id,
                    task_type="memory_fact_extraction",
                ),
                temperature=0.1,
            )

        extractor = MemoryExtractor(llm_call_fn=_memory_llm)
        bank = EnterpriseMemoryBank()
        result = await extractor.extract_and_merge(
            bank=bank,
            tenant_id=tenant_id,
            lobster_id=spec.role_id,
            task_id=task_id,
            conversation_text=conversation_text,
            session_id=session_id,
            lead_id=lead_id,
        )
        logger.info(
            "[MemoryExtractor] lobster=%s tenant=%s task=%s added=%d updated=%d skipped=%d",
            spec.role_id,
            tenant_id,
            task_id,
            result.added,
            result.updated,
            result.skipped,
        )

    async def _update_temporal_graph_after_run(
        self,
        *,
        spec: LobsterRunSpec,
        messages: list[dict[str, Any]],
        final_content: str | None,
        error: str | None,
    ) -> None:
        if error is not None or not final_content:
            return
        try:
            from llm_router import RouteMeta
            from temporal_knowledge_graph import TemporalGraphBuilder
        except Exception:
            return

        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        task_id = str(meta.get("task_id") or meta.get("trace_id") or f"{spec.role_id}_{int(time.time())}").strip()
        lead_id = str(meta.get("lead_id") or meta.get("leadId") or meta.get("customer_id") or "").strip() or None
        conversation_text = self._render_memory_markdown(messages)
        if not conversation_text.strip():
            return

        async def _graph_llm(prompt: str, max_tokens: int) -> str:
            return await self.llm_router.routed_ainvoke_text(
                system_prompt="你是知识图谱抽取器。只输出 JSON，不要输出解释。",
                user_prompt=prompt,
                meta=RouteMeta(
                    critical=False,
                    est_tokens=max_tokens,
                    tenant_tier=str(meta.get("tenant_tier") or "basic"),
                    user_id=str(meta.get("user_id") or task_id or "graph-system"),
                    tenant_id=tenant_id,
                    task_type="temporal_graph_extract",
                ),
                temperature=0.1,
            )

        builder = TemporalGraphBuilder(llm_call_fn=_graph_llm)
        graph_result = await builder.add_episode(
            tenant_id=tenant_id,
            name=f"{spec.role_id}_{task_id}",
            content=conversation_text,
            source_type="conversation",
            lead_id=lead_id,
            lobster_id=spec.role_id,
        )
        logger.info(
            "[TemporalGraph] lobster=%s tenant=%s episode=%s entities=%s edges=%s",
            spec.role_id,
            tenant_id,
            graph_result.get("episode_id"),
            graph_result.get("entities_added"),
            graph_result.get("edges_added"),
        )

    async def _record_activity_stream(
        self,
        *,
        spec: LobsterRunSpec,
        result: LobsterRunResult,
        task_id: str,
        task_description: str,
    ) -> None:
        try:
            from activity_stream import get_activity_stream
        except Exception:
            return

        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        lead_id = str(meta.get("lead_id") or meta.get("leadId") or meta.get("customer_id") or "").strip()
        stream = get_activity_stream()
        await stream.record_lobster_execution(
            tenant_id=tenant_id,
            lobster_id=spec.role_id,
            lobster_name=spec.role_id,
            task_id=task_id or f"{spec.role_id}_{int(time.time())}",
            success=result.error is None and result.stop_reason in {"completed", "max_iterations"},
            details={
                "task_description": task_description[:300],
                "lead_id": lead_id,
                "stop_reason": result.stop_reason,
                "error": result.error or "",
                "elapsed_ms": round(float(result.elapsed_ms or 0), 2),
                "tool_count": len(result.tools_used or []),
                "tokens": sum(int(v or 0) for v in (result.usage or {}).values()),
            },
        )

    async def _emit_step_event(
        self,
        *,
        spec: LobsterRunSpec,
        action_type: str,
        why: str = "",
        result_preview: str = "",
        round_index: int = 0,
        status: str = "done",
    ) -> None:
        try:
            from api_lobster_realtime import publish_step_event
        except Exception:
            return
        task_id = str((spec.meta or {}).get("task_id") or (spec.meta or {}).get("trace_id") or "")
        await publish_step_event(
            lobster_id=spec.role_id,
            action_type=action_type,
            round=round_index,
            why=why,
            status=status,
            result_preview=result_preview,
            task_id=task_id,
        )

    def _resolve_action_type(self, spec: LobsterRunSpec) -> str:
        meta = spec.meta or {}
        explicit = str(meta.get("action_type") or meta.get("channel_action") or "").strip().lower()
        if explicit:
            return explicit

        task_hint = " ".join(
            [
                str(meta.get("task_type") or ""),
                str(meta.get("channel") or ""),
                spec.role_id,
            ]
        ).lower()
        if any(token in task_hint for token in ("dm", "private", "followup", "wechat", "lead_capture", "outreach")):
            return "dms"
        if any(token in task_hint for token in ("reply", "comment", "engagement", "inbox")):
            return "replies"
        if any(token in task_hint for token in ("post", "publish", "content", "script", "campaign")):
            return "posts"
        if spec.role_id in {"echoer", "catcher"}:
            return "replies"
        if spec.role_id == "followup":
            return "dms"
        if spec.role_id in {"inkwriter", "visualizer", "dispatcher"}:
            return "posts"
        return spec.role_id

    def _resolve_action_count(self, spec: LobsterRunSpec, action_type: str, intensity_mgr: Any) -> int:
        meta = spec.meta or {}
        bucket = intensity_mgr.resolve_usage_bucket(action_type) if intensity_mgr is not None else None
        candidate_keys = [key for key in [action_type, bucket] if key]

        for key in ("daily_action_counts", "daily_counts", "resource_counters", "usage_today"):
            counters = meta.get(key)
            if not isinstance(counters, dict):
                continue
            for candidate in candidate_keys:
                try:
                    return max(0, int(counters.get(candidate, 0)))
                except (TypeError, ValueError):
                    continue

        try:
            return max(0, int(meta.get("daily_count", 0)))
        except (TypeError, ValueError):
            return 0

    def _resolve_channel_name(self, spec: LobsterRunSpec, action_type: str, intensity_mgr: Any) -> str | None:
        meta = spec.meta or {}
        for key in ("channel", "channel_type", "target_channel"):
            value = str(meta.get(key) or "").strip()
            if value:
                return value
        if intensity_mgr is None:
            return None
        return intensity_mgr.resolve_channel(action_type)

    def _is_task_approved(self, spec: LobsterRunSpec) -> bool:
        meta = spec.meta or {}
        return any(
            bool(meta.get(key))
            for key in ("approved", "approval_granted", "human_approved", "manual_approved")
        )

    def _build_guardrail_result(
        self,
        *,
        stop_reason: str,
        message: str,
        output_format_template: str | None,
        strategy_intensity: dict[str, Any] | None,
    ) -> LobsterRunResult:
        return LobsterRunResult(
            final_content=None,
            messages=[],
            tools_used=[],
            usage={},
            stop_reason=stop_reason,
            error=message,
            elapsed_ms=0.0,
            step_summary=None,
            output_format_template=output_format_template,
            strategy_intensity=strategy_intensity,
        )

    def _validate_expects(self, final_content: str | None, expects: str | None) -> tuple[bool, str]:
        if expects is None:
            return True, "no_expects"
        normalized_expects = str(expects or "").strip()
        if not normalized_expects:
            return True, "no_expects"
        if not final_content:
            return False, f"empty_output (expects: {normalized_expects!r})"
        if normalized_expects in final_content:
            return True, f"expects_matched: {normalized_expects!r}"
        if normalized_expects.lower() in str(final_content).strip().lower():
            return True, f"expects_fuzzy_matched: {normalized_expects!r}"
        return False, f"expects_not_found: {normalized_expects!r} not in output ({len(str(final_content))} chars)"

    def _build_retry_prompt_suffix(self, spec: LobsterRunSpec, reason: str, retry_count: int) -> str:
        if spec.retry_prompt_suffix:
            return str(spec.retry_prompt_suffix)
        expects_hint = str(spec.expects or "").strip()
        return (
            "\n\n[Retry Hint]\n"
            f"This is retry attempt #{retry_count}.\n"
            f"Previous output failed validation: {reason}.\n"
            + (f"Please ensure the final answer contains: {expects_hint}\n" if expects_hint else "")
        )

    async def _schedule_escalation(self, spec: LobsterRunSpec, result: LobsterRunResult, retry_count: int) -> str | None:
        if not (spec.meta or {}).get("escalate_on_failure", True):
            return None
        try:
            from escalation_manager import escalate

            event = await escalate(
                tenant_id=str((spec.meta or {}).get("tenant_id", "tenant_main")),
                task_id=str((spec.meta or {}).get("task_id", "")).strip() or None,
                lobster_id=spec.role_id,
                error_summary=str(result.error or result.expects_failure_reason or result.stop_reason or "unknown_failure"),
                retry_count=retry_count,
                context=dict(spec.meta or {}),
            )
            return event.escalation_id
        except Exception as esc_err:  # noqa: BLE001
            logger.warning("[Escalation] Failed to escalate %s: %s", spec.role_id, esc_err)
            return None

    def _attach_failure_reason(self, spec: LobsterRunSpec, result: LobsterRunResult) -> LobsterRunResult:
        if result.error is None and result.stop_reason in {"completed", "max_iterations"}:
            if result.stop_reason == "max_iterations":
                try:
                    from lobster_failure_reason import classify_failure

                    task_id = str((spec.meta or {}).get("task_id") or (spec.meta or {}).get("trace_id") or "")
                    result.failure_reason = classify_failure(
                        task_id=task_id,
                        lobster_id=spec.role_id,
                        stop_reason=result.stop_reason,
                        error=result.error,
                        tools_used=list(result.tools_used or []),
                        auto_retried=bool(result.retry_count),
                        occurred_at=datetime.now(timezone.utc).isoformat(),
                    ).to_dict()
                except Exception:
                    pass
            return result
        try:
            from lobster_failure_reason import classify_failure

            task_id = str((spec.meta or {}).get("task_id") or (spec.meta or {}).get("trace_id") or "")
            result.failure_reason = classify_failure(
                task_id=task_id,
                lobster_id=spec.role_id,
                stop_reason=result.stop_reason,
                error=result.error,
                tools_used=list(result.tools_used or []),
                auto_retried=bool(result.retry_count),
                occurred_at=datetime.now(timezone.utc).isoformat(),
            ).to_dict()
        except Exception:
            result.failure_reason = None
        return result

    async def _finalize_with_expects(self, spec: LobsterRunSpec, result: LobsterRunResult) -> LobsterRunResult:
        if result.stop_reason in {"blocked", "pending_approval"}:
            return self._attach_failure_reason(spec, result)
        if spec.expects is None and result.error and result.stop_reason == "error" and result.escalation_id is None:
            result.retry_count = int(spec.expects_retry_depth or 0)
            result.escalation_id = await self._schedule_escalation(spec, result, result.retry_count)
            return self._attach_failure_reason(spec, result)
        passed, reason = self._validate_expects(result.final_content, spec.expects)
        if passed:
            validation_ok, retry_result = await self._finalize_with_output_validation(spec, result)
            if not validation_ok:
                return self._attach_failure_reason(spec, retry_result or result)
            result.expects_passed = None if spec.expects is None else True
            result.retry_count = int(spec.expects_retry_depth or 0)
            self._schedule_online_eval(spec, result)
            self._schedule_post_task_processing(spec, result)
            return self._attach_failure_reason(spec, result)

        retry_count = int(spec.expects_retry_depth or 0)
        logger.warning(
            "[Expects] %s validation failed (attempt %d/%d): %s",
            spec.role_id,
            retry_count + 1,
            int(spec.max_retries) + 1,
            reason,
        )
        if retry_count < int(spec.max_retries):
            retry_spec = replace(
                spec,
                user_prompt=spec.user_prompt + self._build_retry_prompt_suffix(spec, reason, retry_count + 1),
                expects_retry_depth=retry_count + 1,
            )
            return await self.run(retry_spec)

        result.expects_passed = False
        result.retry_count = retry_count
        result.expects_failure_reason = reason
        result.stop_reason = "expects_failed"
        result.error = f"Output validation failed after {retry_count + 1} attempts: {reason}"
        result.escalation_id = await self._schedule_escalation(spec, result, retry_count)
        return self._attach_failure_reason(spec, result)

    async def _finalize_with_output_validation(
        self,
        spec: LobsterRunSpec,
        result: LobsterRunResult,
    ) -> tuple[bool, LobsterRunResult | None]:
        if result.error is not None or not str(result.final_content or "").strip():
            return True, None
        meta = spec.meta or {}
        if not bool(meta.get("enable_output_validation")):
            return True, None
        industry_tag = str(meta.get("industry_tag") or meta.get("industry") or "").strip()
        if not industry_tag:
            return True, None
        try:
            from lobster_post_task_processor import get_lobster_post_task_processor

            task_id = str(meta.get("task_id") or meta.get("trace_id") or f"{spec.role_id}_{int(time.time())}")
            tenant_id = str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main"
            post = await get_lobster_post_task_processor().process(
                task_id=task_id,
                tenant_id=tenant_id,
                lobster_id=spec.role_id,
                prompt=spec.user_prompt,
                output=str(result.final_content or ""),
                industry_tag=industry_tag,
                enable_output_validation=True,
                auto_retry_on_violation=bool(meta.get("auto_retry_on_violation")),
            )
            validation = post.get("validation") if isinstance(post, dict) else {}
            if isinstance(validation, dict) and not bool(validation.get("passed", True)):
                violations = [str(item).strip() for item in (validation.get("violations") or []) if str(item).strip()]
                retry_budget = max(1 if bool(meta.get("auto_retry_on_violation")) else 0, int(spec.max_retries or 0))
                if bool(meta.get("auto_retry_on_violation")) and int(spec.expects_retry_depth or 0) < retry_budget:
                    retry_spec = replace(
                        spec,
                        user_prompt=spec.user_prompt
                        + "\n\n[输出领域规则验证失败，请修正后重试]\n"
                        + "\n".join(f"- {item}" for item in violations),
                        expects_retry_depth=int(spec.expects_retry_depth or 0) + 1,
                    )
                    return False, await self.run(retry_spec)
                failed = replace(result)
                failed.stop_reason = "output_validation_failed"
                failed.error = "；".join(violations) or "output_validation_failed"
                failed.expects_failure_reason = failed.error
                return False, failed
        except Exception as exc:  # noqa: BLE001
            logger.warning("Output validation skipped for %s: %s", spec.role_id, exc)
        return True, None

    def _schedule_post_task_processing(self, spec: LobsterRunSpec, result: LobsterRunResult) -> None:
        if result.error is not None or not str(result.final_content or "").strip():
            return
        meta = spec.meta or {}
        tenant_id = str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        task_id = str(meta.get("task_id") or meta.get("trace_id") or f"{spec.role_id}_{int(time.time())}")

        async def _runner() -> None:
            try:
                from lobster_post_task_processor import get_lobster_post_task_processor

                await get_lobster_post_task_processor().process(
                    task_id=task_id,
                    tenant_id=tenant_id,
                    lobster_id=spec.role_id,
                    prompt=spec.user_prompt,
                    output=str(result.final_content or ""),
                    industry_tag=str(meta.get("industry_tag") or meta.get("industry") or "").strip() or None,
                    enable_output_validation=bool(meta.get("enable_output_validation")),
                    auto_retry_on_violation=bool(meta.get("auto_retry_on_violation")),
                    reply_channel_id=str(meta.get("reply_channel_id") or "").strip() or None,
                    reply_chat_id=str(meta.get("reply_chat_id") or meta.get("chat_id") or "").strip() or None,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Post task processing skipped for %s: %s", spec.role_id, exc)

        try:
            asyncio.create_task(_runner())
        except Exception:
            pass

    async def _log_security_event(self, lobster: Any, event_type: str, data: dict[str, Any]) -> None:
        if lobster is not None and hasattr(lobster, "_log_security_event"):
            try:
                await lobster._log_security_event(event_type, data)
                return
            except Exception:
                pass
        try:
            from audit_logger import record_audit_log

            await record_audit_log(
                tenant_id=str(data.get("tenant_id") or "tenant_main"),
                user_id=str(data.get("lobster_id") or getattr(lobster, "role_id", "lobster")),
                operator=str(getattr(lobster, "role_id", "lobster")),
                action=event_type,
                category="security",
                resource_type="lobster",
                resource_id=str(data.get("task_id") or ""),
                summary=f"{getattr(lobster, 'role_id', 'lobster')}:{event_type}",
                detail=data,
                result="blocked" if event_type == "redline_triggered" else "warning",
                source="lobster_runner",
                trace_id=str(data.get("trace_id") or data.get("task_id") or ""),
            )
        except Exception:
            pass

    async def _pre_security_check(
        self,
        *,
        lobster: Any,
        spec: LobsterRunSpec,
        user_input: str,
        output_format_template: str | None,
        strategy_intensity: dict[str, Any] | None,
    ) -> LobsterRunResult | None:
        if lobster is not None and getattr(lobster, "SECURITY_ENABLED", True) is False:
            return None

        task_id = str((spec.meta or {}).get("task_id") or (spec.meta or {}).get("trace_id") or "")
        trace_id = str((spec.meta or {}).get("trace_id") or task_id)
        tenant_id = str((spec.meta or {}).get("tenant_id") or "tenant_main")
        lobster_id = str(getattr(lobster, "role_id", spec.role_id))

        is_redline, red_reason = check_redline(user_input)
        if is_redline:
            await self._log_security_event(
                lobster,
                "redline_triggered",
                {
                    "tenant_id": tenant_id,
                    "lobster_id": lobster_id,
                    "task_id": task_id,
                    "trace_id": trace_id,
                    "reason": red_reason,
                    "input_preview": user_input[:200],
                },
            )
            return self._build_guardrail_result(
                stop_reason="blocked",
                message=(
                    f"🚫 [红线拦截] 检测到高风险操作：{red_reason}，已拒绝执行。"
                    " 如需帮助，请改用安全、非破坏性的目标描述。"
                ),
                output_format_template=output_format_template,
                strategy_intensity=strategy_intensity,
            )

        is_injection, injection_reason = detect_injection(user_input)
        if is_injection:
            await self._log_security_event(
                lobster,
                "injection_detected",
                {
                    "tenant_id": tenant_id,
                    "lobster_id": lobster_id,
                    "task_id": task_id,
                    "trace_id": trace_id,
                    "reason": injection_reason,
                    "source": "user_input",
                    "input_preview": user_input[:200],
                },
            )
            return self._build_guardrail_result(
                stop_reason="blocked",
                message=f"🚫 [红线拦截] 检测到疑似提示词注入：{injection_reason}，已拒绝执行。",
                output_format_template=output_format_template,
                strategy_intensity=strategy_intensity,
            )

        is_yellowline, yellow_reason = check_yellowline(user_input)
        is_role_yellowline, role_yellow_reason = check_role_yellowline(lobster_id, user_input)
        if (is_yellowline or is_role_yellowline) and not self._is_task_approved(spec):
            final_reason = role_yellow_reason or yellow_reason
            await self._log_security_event(
                lobster,
                "role_yellowline" if is_role_yellowline else "yellowline_detected",
                {
                    "tenant_id": tenant_id,
                    "lobster_id": lobster_id,
                    "task_id": task_id,
                    "trace_id": trace_id,
                    "reason": final_reason,
                    "input_preview": user_input[:200],
                },
            )
            scope = str((spec.meta or {}).get("scope") or (spec.meta or {}).get("impact_scope") or "未指定范围")
            return self._build_guardrail_result(
                stop_reason="pending_approval",
                message=build_yellowline_confirmation(
                    final_reason,
                    operation=user_input[:120],
                    scope=scope,
                    reversible=False,
                ),
                output_format_template=output_format_template,
                strategy_intensity=strategy_intensity,
            )

        return None

    async def _sanitize_untrusted_block(
        self,
        *,
        lobster: Any,
        spec: LobsterRunSpec,
        text: str,
        source: str,
    ) -> str:
        sanitized, event = sanitize_untrusted_content(text, source=source)
        if event:
            await self._log_security_event(
                lobster,
                event["event"],
                {
                    "tenant_id": str((spec.meta or {}).get("tenant_id") or "tenant_main"),
                    "lobster_id": str(getattr(lobster, "role_id", spec.role_id)),
                    "task_id": str((spec.meta or {}).get("task_id") or (spec.meta or {}).get("trace_id") or ""),
                    "trace_id": str((spec.meta or {}).get("trace_id") or (spec.meta or {}).get("task_id") or ""),
                    "reason": str(event.get("reason") or ""),
                    "source": str(event.get("source") or source),
                    "content_preview": str(event.get("content_preview") or "")[:200],
                },
            )
        return sanitized

    def _build_duplicate_task_result(
        self,
        *,
        spec: LobsterRunSpec,
        message: str,
        output_format_template: str | None,
        strategy_intensity: dict[str, Any] | None,
    ) -> LobsterRunResult:
        result = LobsterRunResult(
            final_content=None,
            messages=[],
            tools_used=[],
            usage={},
            stop_reason="blocked",
            error=message,
            elapsed_ms=0.0,
            step_summary=None,
            output_format_template=output_format_template,
            strategy_intensity=strategy_intensity,
        )
        result.expects_passed = None
        result.retry_count = int(spec.expects_retry_depth or 0)
        result.expects_failure_reason = "duplicate_task_execution_blocked"
        return result

    async def _resolve_task_resolution(
        self,
        *,
        spec: LobsterRunSpec,
        lobster: Any,
        task_id: str,
        tenant_id: str,
    ) -> tuple[dict[str, Any] | None, str | None]:
        try:
            from task_resolution import (
                TaskResolver,
                get_task_resolution_store,
                normalize_required_skills,
            )
        except Exception:
            return None, None

        prompt_skill_id = self._infer_prompt_skill_id(spec, lobster)
        required_skills = normalize_required_skills(
            role_id=spec.role_id,
            explicit_required_skills=(spec.meta or {}).get("required_skills"),
            prompt_skill_id=prompt_skill_id,
            tool_defs=spec.tools or [],
        )
        if not required_skills:
            return None, prompt_skill_id

        resolver = TaskResolver(skill_cache=get_task_resolution_store())
        resolution = await resolver.resolve(
            task_id=task_id or f"{spec.role_id}_{int(time.time())}",
            lobster_id=spec.role_id,
            tenant_id=tenant_id,
            required_skills=required_skills,
        )
        return resolution.to_dict(), prompt_skill_id

    async def _cache_task_resolution_result(
        self,
        *,
        spec: LobsterRunSpec,
        result: LobsterRunResult,
        task_resolution: dict[str, Any] | None,
        prompt_skill_id: str | None,
        tenant_id: str,
        task_id: str,
    ) -> None:
        if result.error is not None or result.stop_reason not in {"completed", "max_iterations"}:
            return
        skill_id = str(prompt_skill_id or "").strip()
        if not skill_id:
            return
        try:
            from task_resolution import get_task_resolution_store, resolve_skill_version
        except Exception:
            return
        await get_task_resolution_store().put(
            tenant_id=tenant_id,
            lobster_id=spec.role_id,
            skill_id=skill_id,
            version=resolve_skill_version(skill_id),
            cached_result={
                "final_content": result.final_content,
                "stop_reason": result.stop_reason,
                "task_id": task_id,
            },
            metadata={
                "task_id": task_id,
                "lobster_id": spec.role_id,
                "resolution_pending": len((task_resolution or {}).get("pending") or []),
            },
        )

    def _update_working_started(self, lobster: Any, *, task_id: str, task_description: str) -> None:
        """Persist working.json at task start."""
        if lobster is None:
            return
        try:
            from lobsters.base_lobster import save_working

            working = dict(getattr(lobster, "working", {}) or {})
            working["agent_id"] = lobster.role_id
            working["version"] = str(working.get("version") or "1.0.0")
            working["current_task"] = {
                "task_id": task_id,
                "description": task_description,
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
            working["updated_at"] = datetime.now(timezone.utc).isoformat()
            lobster.working = working
            save_working(lobster.role_id, working)
        except Exception as e:
            logger.warning("Failed to persist working start for %s: %s", getattr(lobster, "role_id", "?"), e)

    def _update_working_completed(self, lobster: Any, *, task_id: str, task_description: str) -> None:
        """Persist working.json at successful completion."""
        if lobster is None:
            return
        try:
            from lobsters.base_lobster import save_working

            working = dict(getattr(lobster, "working", {}) or {})
            completed = working.get("current_task") or {
                "task_id": task_id,
                "description": task_description,
            }
            completed["completed_at"] = datetime.now(timezone.utc).isoformat()
            working["last_completed"] = completed
            working["current_task"] = None
            working["next_steps"] = []
            working["blocked_by"] = []
            working["updated_at"] = datetime.now(timezone.utc).isoformat()
            lobster.working = working
            save_working(lobster.role_id, working)
        except Exception as e:
            logger.warning("Failed to persist working completion for %s: %s", getattr(lobster, "role_id", "?"), e)

    def _update_working_failed(self, lobster: Any, *, task_id: str, task_description: str, error: str) -> None:
        """Persist working.json on failure."""
        if lobster is None:
            return
        try:
            from lobsters.base_lobster import save_working

            working = dict(getattr(lobster, "working", {}) or {})
            if working.get("current_task") is None:
                working["current_task"] = {
                    "task_id": task_id,
                    "description": task_description,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }
            working["blocked_by"] = [str(error)]
            working["updated_at"] = datetime.now(timezone.utc).isoformat()
            lobster.working = working
            save_working(lobster.role_id, working)
        except Exception as e:
            logger.warning("Failed to persist working failure for %s: %s", getattr(lobster, "role_id", "?"), e)

    async def run(self, spec: LobsterRunSpec) -> LobsterRunResult:
        meta = dict(spec.meta or {})
        task_id = str(meta.get("task_id") or meta.get("trace_id") or "").strip()
        tenant_id = str(meta.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        if not task_id:
            return await self._run_unlocked(spec)
        intensity_mgr = self._resolve_strategy_intensity_manager(spec)
        strategy_snapshot = intensity_mgr.get_snapshot() if intensity_mgr is not None else None
        try:
            from task_idempotency_lock import TaskAlreadyRunningError, get_idempotency_lock
        except Exception as exc:  # noqa: BLE001
            logger.warning("Task idempotency lock unavailable, continue unlocked: %s", exc)
            return await self._run_unlocked(spec)

        try:
            async with get_idempotency_lock().acquire(
                task_id=task_id,
                lobster_id=spec.role_id,
                tenant_id=tenant_id,
            ):
                return await self._run_unlocked(spec)
        except TaskAlreadyRunningError as exc:
            logger.warning(
                "[IdempotencyLock] duplicate task blocked tenant=%s task=%s lobster=%s",
                tenant_id,
                task_id,
                spec.role_id,
            )
            return self._attach_failure_reason(
                spec,
                self._build_duplicate_task_result(
                    spec=spec,
                    message=str(exc),
                    output_format_template=select_output_format(spec.lobster, str(meta.get("task_type") or spec.role_id)),
                    strategy_intensity=strategy_snapshot,
                ),
            )

    async def _run_unlocked(self, spec: LobsterRunSpec) -> LobsterRunResult:
        """
        Execute a lobster's LLM loop.

        For simple lobsters (no tools): single LLM call, return content.
        For tool-using lobsters: iterate LLM → tools → LLM until done.
        """
        hook = spec.hook or LobsterHook()
        start_time = time.monotonic()
        task_id = str((spec.meta or {}).get("task_id") or (spec.meta or {}).get("trace_id") or "")
        lobster = self._load_lobster_runtime(spec)
        if spec.lobster is None and lobster is not None:
            spec.lobster = lobster
        tenant_id = str((spec.meta or {}).get("tenant_id") or "tenant_main").strip() or "tenant_main"
        if hasattr(lobster, "bind_runtime_context"):
            try:
                lobster.bind_runtime_context(tenant_id)
            except Exception:
                pass
        session_context, session_history = self._resolve_session_context(spec)
        if spec.fresh_context:
            session_history = []
        bootstrap_data: dict[str, Any] | None = None
        bootstrap_incomplete = False
        if session_context is not None:
            try:
                from lobster_bootstrap import check_bootstrap_status, get_bootstrap_data, load_bootstrap_md

                bootstrap_incomplete = not check_bootstrap_status(spec.role_id, session_context.session_id)
                if bootstrap_incomplete:
                    effective_system_prompt = load_bootstrap_md(spec.role_id) or spec.system_prompt
                else:
                    bootstrap_data = get_bootstrap_data(spec.role_id, session_context.session_id)
                    effective_system_prompt = getattr(lobster, "system_prompt_full", "") or spec.system_prompt
                    bootstrap_block = self._build_bootstrap_context_block(bootstrap_data)
                    if bootstrap_block:
                        effective_system_prompt = f"{effective_system_prompt}\n\n---\n\n{bootstrap_block}"
            except Exception as bootstrap_exc:
                logger.warning("Bootstrap load skipped for %s: %s", spec.role_id, bootstrap_exc)
                effective_system_prompt = getattr(lobster, "system_prompt_full", "") or spec.system_prompt
        else:
            effective_system_prompt = getattr(lobster, "system_prompt_full", "") or spec.system_prompt
        task_type = str((spec.meta or {}).get("task_type") or spec.role_id)
        output_format_template = select_output_format(lobster, task_type)
        if not bootstrap_incomplete:
            effective_system_prompt = self._augment_system_prompt_with_agent_context(
                lobster,
                spec,
                effective_system_prompt,
            )
        effective_user_prompt = self._resolve_user_prompt(spec, lobster)
        if not spec.fresh_context:
            memory_context_block = await self._build_lobster_memory_context(lobster, spec)
            if memory_context_block:
                effective_user_prompt = f"{memory_context_block}\n\n---\n\n{effective_user_prompt}"
        context_engine_block, session_history = self._build_context_engine_block(
            spec=spec,
            task=effective_user_prompt,
            session_history=session_history,
        )
        if context_engine_block:
            effective_user_prompt = f"{context_engine_block}\n\n---\n\n{effective_user_prompt}"
        try:
            from token_budget import apply_fresh_context

            session_history = [item for item in apply_fresh_context(spec, session_history) if item.get("role") != "system"]
        except Exception:
            pass
        task_description = effective_user_prompt
        intensity_mgr = self._resolve_strategy_intensity_manager(spec)
        autonomy_policy = self._resolve_autonomy_policy(spec)
        strategy_snapshot = intensity_mgr.get_snapshot() if intensity_mgr is not None else None
        task_resolution: dict[str, Any] | None = None
        prompt_skill_id: str | None = None
        try:
            task_resolution, prompt_skill_id = await self._resolve_task_resolution(
                spec=spec,
                lobster=lobster,
                task_id=task_id,
                tenant_id=tenant_id,
            )
        except Exception as resolution_exc:  # noqa: BLE001
            logger.warning("Task resolution skipped for %s: %s", spec.role_id, resolution_exc)
        action_type = self._resolve_action_type(spec)
        channel_name = self._resolve_channel_name(spec, action_type, intensity_mgr) if intensity_mgr is not None else None
        action_profile = self._build_action_profile(spec, action_type, channel_name)
        flag_ctx = self._resolve_feature_flag_context(spec)
        if flag_ctx is not None:
            try:
                from feature_flags import ff_is_enabled, is_lobster_enabled

                if not ff_is_enabled("lobster.pool.all_enabled", flag_ctx):
                    return self._build_guardrail_result(
                        stop_reason="disabled",
                        message="全局龙虾功能开关已关闭，当前执行被熔断。",
                        output_format_template=output_format_template,
                        strategy_intensity=strategy_snapshot,
                    )
                if not is_lobster_enabled(spec.role_id, flag_ctx):
                    return self._build_guardrail_result(
                        stop_reason="disabled",
                        message=f"龙虾 {spec.role_id} 已被 Feature Flag 关闭。",
                        output_format_template=output_format_template,
                        strategy_intensity=strategy_snapshot,
                    )
            except Exception as flag_exc:
                logger.warning("Feature flag guard skipped for %s: %s", spec.role_id, flag_exc)
        security_result = await self._pre_security_check(
            lobster=lobster,
            spec=spec,
            user_input=effective_user_prompt,
            output_format_template=output_format_template,
            strategy_intensity=strategy_snapshot,
        )
        if security_result is not None:
            return security_result
        if intensity_mgr is not None:
            daily_count = self._resolve_action_count(spec, action_type, intensity_mgr)
            current_level_name = str(intensity_mgr.current_config.get("name") or f"L{intensity_mgr.current_level}")
            llm_limit = intensity_mgr.get_resource_limits().get("max_llm_calls_per_task")
            meta = spec.meta or {}

            if channel_name and not intensity_mgr.is_channel_allowed(channel_name):
                return self._build_guardrail_result(
                    stop_reason="blocked",
                    message=f"策略强度 {current_level_name} 限制: channel {channel_name} 未开放",
                    output_format_template=output_format_template,
                    strategy_intensity=strategy_snapshot,
                )

            if not intensity_mgr.check_limits(action_type, daily_count):
                return self._build_guardrail_result(
                    stop_reason="blocked",
                    message=f"策略强度 {current_level_name} 限制: {action_type} 已达上限",
                    output_format_template=output_format_template,
                    strategy_intensity=strategy_snapshot,
                )

            try:
                llm_limit_value = int(llm_limit) if llm_limit is not None else None
            except (TypeError, ValueError):
                llm_limit_value = None
            raw_planned_llm_calls = meta.get("planned_llm_calls", meta.get("expected_llm_calls"))
            try:
                planned_llm_calls = int(raw_planned_llm_calls) if raw_planned_llm_calls is not None else None
            except (TypeError, ValueError):
                planned_llm_calls = None
            if planned_llm_calls is None and not spec.tools:
                planned_llm_calls = 1
            if llm_limit_value is not None and planned_llm_calls is not None and planned_llm_calls > llm_limit_value:
                return self._build_guardrail_result(
                    stop_reason="blocked",
                    message=f"策略强度 {current_level_name} 限制: 计划 LLM 调用 {planned_llm_calls} 超过上限 {llm_limit_value}",
                    output_format_template=output_format_template,
                    strategy_intensity=strategy_snapshot,
                )

            autonomy_requires_approval = autonomy_policy.should_require_approval(action_profile, spec.role_id) if autonomy_policy is not None else False
            if (intensity_mgr.requires_approval() or autonomy_requires_approval) and not self._is_task_approved(spec):
                return self._build_guardrail_result(
                    stop_reason="pending_approval",
                    message=(
                        f"策略强度 {current_level_name} 需要人工审批"
                        if intensity_mgr.requires_approval()
                        else "Autonomy policy requires approval for this action"
                    ),
                    output_format_template=output_format_template,
                    strategy_intensity=strategy_snapshot,
                )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": effective_system_prompt},
        ]
        messages.extend(session_history)
        messages.append({"role": "user", "content": effective_user_prompt})

        final_content: str | None = None
        tools_used: list[str] = []
        usage: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0}
        error: str | None = None
        stop_reason = "completed"
        step_summary: dict[str, Any] | None = None

        _call_hook_extension(hook, "on_start", spec.role_id, task_id=task_id or None)
        try:
            from lobster_registry_manager import record_heartbeat, update_lobster_status

            update_lobster_status(spec.role_id, "busy")
            record_heartbeat(spec.role_id)
        except Exception:
            pass
        self._update_working_started(
            lobster,
            task_id=task_id or f"{spec.role_id}_{int(time.time())}",
            task_description=task_description,
        )
        _call_hook_extension(
            hook,
            "on_step",
            spec.role_id,
            "load_system_prompt",
            activity_type="side_system",
            input_data="",
            output_data=f"loaded system prompt ({len(spec.system_prompt)})",
            duration_ms=0,
        )
        await self._emit_step_event(
            spec=spec,
            action_type="load_system_prompt",
            why="加载当前龙虾的系统提示和运行规则",
            result_preview=f"system prompt loaded ({len(spec.system_prompt)})",
            round_index=0,
        )
        _call_hook_extension(
            hook,
            "on_step",
            spec.role_id,
            "load_user_prompt",
            activity_type="side_routing",
            input_data="",
            output_data=f"loaded user prompt ({len(effective_user_prompt)})",
            duration_ms=0,
        )
        await self._emit_step_event(
            spec=spec,
            action_type="load_user_prompt",
            why="解析用户任务并整理本轮输入",
            result_preview=f"user prompt loaded ({len(effective_user_prompt)})",
            round_index=0,
        )

        # ── Simple path: no tools → single LLM call ──
        if not spec.tools:
            ctx = HookContext(role_id=spec.role_id, iteration=0, messages=messages)
            try:
                await hook.before_iteration(ctx)

                llm_started = time.monotonic()
                content = await self._invoke_llm(spec, messages)
                llm_duration = (time.monotonic() - llm_started) * 1000
                final_content = content
                messages.append({"role": "assistant", "content": content})
                _call_hook_extension(
                    hook,
                    "on_step",
                    spec.role_id,
                    "generate_response",
                    activity_type="main_line",
                    input_data=effective_user_prompt,
                    output_data=content,
                    duration_ms=llm_duration,
                    tokens_used=sum(usage.values()),
                )
                await self._emit_step_event(
                    spec=spec,
                    action_type="generate_response",
                    why=effective_user_prompt,
                    result_preview=content,
                    round_index=1,
                )

                ctx.final_content = content
                ctx.stop_reason = "completed"
                await hook.on_llm_response(ctx)
                await hook.after_iteration(ctx)

            except Exception as e:
                error = f"{type(e).__name__}: {e}"
                stop_reason = "blocked" if type(e).__name__ == "PipelineBlockedError" else "error"
                final_content = str(e) if stop_reason == "blocked" else f"Sorry, lobster {spec.role_id} encountered an error."
                ctx.error = error
                ctx.stop_reason = stop_reason
                _call_hook_extension(hook, "on_error", spec.role_id, error=error)
                self._update_working_failed(
                    lobster,
                    task_id=task_id or f"{spec.role_id}_{int(time.time())}",
                    task_description=task_description,
                    error=error,
                )
                try:
                    from lobster_registry_manager import record_error

                    record_error(spec.role_id)
                except Exception:
                    pass
                logger.exception("Lobster %s failed", spec.role_id)

            elapsed = (time.monotonic() - start_time) * 1000
            ctx.elapsed_ms = elapsed
            await hook.on_complete(ctx)
            if error is None:
                self._update_working_completed(
                    lobster,
                    task_id=task_id or f"{spec.role_id}_{int(time.time())}",
                    task_description=task_description,
                )
                try:
                    from lobster_registry_manager import increment_token_usage, record_task_complete

                    record_task_complete(spec.role_id, task_id or f"{spec.role_id}_{int(time.time())}")
                    increment_token_usage(spec.role_id, sum(usage.values()))
                except Exception:
                    pass
            step_summary = _call_hook_extension(hook, "on_end", spec.role_id)
            if step_summary and step_summary.get("steps"):
                try:
                    from lobster_pool_manager import record_step_rewards

                    record_step_rewards(spec.role_id, task_id or None, step_summary["steps"])
                except Exception:
                    pass
            self._persist_session_messages(
                session_context,
                user_prompt=effective_user_prompt,
                final_content=final_content,
                error=error,
            )
            try:
                await self._compress_memory_after_run(
                    spec=spec,
                    messages=messages,
                    usage=usage,
                    final_content=final_content,
                    error=error,
                    stop_reason=stop_reason,
                )
            except Exception as memory_exc:
                logger.warning("Memory compression skipped for %s: %s", spec.role_id, memory_exc)
            try:
                await self._extract_and_store_lobster_experiences(
                    lobster=lobster,
                    spec=spec,
                    messages=messages,
                    final_content=final_content,
                    error=error,
                )
            except Exception as extract_exc:
                logger.warning("Experience extraction skipped for %s: %s", spec.role_id, extract_exc)
            try:
                await self._extract_structured_memories_after_run(
                    spec=spec,
                    messages=messages,
                    final_content=final_content,
                    error=error,
                )
            except Exception as structured_memory_exc:
                logger.warning("Structured memory extraction skipped for %s: %s", spec.role_id, structured_memory_exc)
            try:
                await self._update_temporal_graph_after_run(
                    spec=spec,
                    messages=messages,
                    final_content=final_content,
                    error=error,
                )
            except Exception as temporal_graph_exc:
                logger.warning("Temporal graph update skipped for %s: %s", spec.role_id, temporal_graph_exc)
            if error is None and intensity_mgr is not None:
                strategy_snapshot = intensity_mgr.record_usage(action=action_type, count=1, llm_calls=1)

            result = LobsterRunResult(
                final_content=final_content,
                messages=messages,
                tools_used=tools_used,
                usage=usage,
                stop_reason=stop_reason,
                error=error,
                elapsed_ms=elapsed,
                step_summary=step_summary,
                output_format_template=output_format_template,
                strategy_intensity=strategy_snapshot,
                task_resolution=task_resolution,
            )
            finalized = await self._finalize_with_expects(spec, result)
            try:
                await self._cache_task_resolution_result(
                    spec=spec,
                    result=finalized,
                    task_resolution=task_resolution,
                    prompt_skill_id=prompt_skill_id,
                    tenant_id=tenant_id,
                    task_id=task_id or f"{spec.role_id}_{int(time.time())}",
                )
            except Exception as resolution_cache_exc:  # noqa: BLE001
                logger.warning("Task resolution cache skipped for %s: %s", spec.role_id, resolution_cache_exc)
            try:
                await self._record_activity_stream(
                    spec=spec,
                    result=finalized,
                    task_id=task_id,
                    task_description=task_description,
                )
            except Exception as activity_exc:
                logger.warning("Activity stream record skipped for %s: %s", spec.role_id, activity_exc)
            return finalized

        # ── Tool loop: iterate LLM ↔ tools ──
        for iteration in range(spec.max_iterations):
            ctx = HookContext(
                role_id=spec.role_id,
                iteration=iteration,
                messages=messages,
            )

            try:
                await hook.before_iteration(ctx)

                # Call LLM
                llm_started = time.monotonic()
                content = await self._invoke_llm(spec, messages)
                llm_duration = (time.monotonic() - llm_started) * 1000
                ctx.response = content
                await hook.on_llm_response(ctx)
                _call_hook_extension(
                    hook,
                    "on_step",
                    spec.role_id,
                    f"reasoning_iteration_{iteration + 1}",
                    activity_type="main_line",
                    input_data=effective_user_prompt,
                    output_data=content,
                    duration_ms=llm_duration,
                    tokens_used=sum(usage.values()),
                )
                await self._emit_step_event(
                    spec=spec,
                    action_type=f"reasoning_iteration_{iteration + 1}",
                    why=effective_user_prompt,
                    result_preview=content,
                    round_index=iteration + 1,
                )

                # Parse tool calls from response
                parsed_tools = self._parse_tool_calls(content)

                if not parsed_tools:
                    # No tool calls → final response
                    final_content = content
                    messages.append({"role": "assistant", "content": content})
                    ctx.final_content = content
                    ctx.stop_reason = "completed"
                    await hook.after_iteration(ctx)
                    break

                # Execute tools
                messages.append({"role": "assistant", "content": content})
                ctx.tool_calls = parsed_tools
                tools_used.extend(tc.get("name", "?") for tc in parsed_tools)

                await hook.before_execute_tools(ctx)
                tool_started = time.monotonic()
                tool_results = await self._execute_tools(spec, parsed_tools)
                tool_duration = (time.monotonic() - tool_started) * 1000
                ctx.tool_results = tool_results
                await hook.after_execute_tools(ctx)
                _call_hook_extension(
                    hook,
                    "on_step",
                    spec.role_id,
                    f"execute_tools_iteration_{iteration + 1}",
                    activity_type="side_tool",
                    input_data=", ".join(tc.get("name", "?") for tc in parsed_tools),
                    output_data="; ".join(str(item.get("output", ""))[:80] for item in tool_results),
                    duration_ms=tool_duration,
                )
                await self._emit_step_event(
                    spec=spec,
                    action_type=f"execute_tools_iteration_{iteration + 1}",
                    why=", ".join(tc.get("name", "?") for tc in parsed_tools),
                    result_preview="; ".join(str(item.get("output", ""))[:80] for item in tool_results),
                    round_index=iteration + 1,
                )

                # Append tool results to messages
                for tc, result in zip(parsed_tools, tool_results):
                    safe_output = await self._sanitize_untrusted_block(
                        lobster=lobster,
                        spec=spec,
                        text=str(result.get("output", "")),
                        source=f"tool_result:{tc.get('name', 'unknown')}",
                    )
                    messages.append({
                        "role": "tool",
                        "name": tc.get("name", "unknown"),
                        "content": safe_output,
                    })

                await hook.after_iteration(ctx)

            except Exception as e:
                error = f"{type(e).__name__}: {e}"
                stop_reason = "blocked" if type(e).__name__ == "PipelineBlockedError" else "error"
                final_content = str(e) if stop_reason == "blocked" else f"Lobster {spec.role_id} encountered an error: {e}"
                _call_hook_extension(hook, "on_error", spec.role_id, error=error)
                self._update_working_failed(
                    lobster,
                    task_id=task_id or f"{spec.role_id}_{int(time.time())}",
                    task_description=task_description,
                    error=error,
                )
                try:
                    from lobster_registry_manager import record_error

                    record_error(spec.role_id)
                except Exception:
                    pass
                logger.exception("Lobster %s iteration %d failed", spec.role_id, iteration)
                break
        else:
            stop_reason = "max_iterations"
            final_content = (
                f"Lobster {spec.role_id} reached max iterations ({spec.max_iterations}) "
                "without completing. Consider breaking the task into smaller steps."
            )

        elapsed = (time.monotonic() - start_time) * 1000
        completion_ctx = HookContext(
            role_id=spec.role_id,
            iteration=iteration if 'iteration' in dir() else 0,
            messages=messages,
            final_content=final_content,
            usage=usage,
            error=error,
            stop_reason=stop_reason,
            elapsed_ms=elapsed,
        )
        await hook.on_complete(completion_ctx)
        if error is None:
            self._update_working_completed(
                lobster,
                task_id=task_id or f"{spec.role_id}_{int(time.time())}",
                task_description=task_description,
            )
            try:
                from lobster_registry_manager import increment_token_usage, record_task_complete

                record_task_complete(spec.role_id, task_id or f"{spec.role_id}_{int(time.time())}")
                increment_token_usage(spec.role_id, sum(usage.values()))
            except Exception:
                pass
        step_summary = _call_hook_extension(hook, "on_end", spec.role_id)
        if step_summary and step_summary.get("steps"):
            try:
                from lobster_pool_manager import record_step_rewards

                record_step_rewards(spec.role_id, task_id or None, step_summary["steps"])
            except Exception:
                pass
        self._persist_session_messages(
            session_context,
            user_prompt=effective_user_prompt,
            final_content=final_content,
            error=error,
        )
        await self._record_prompt_experiment_outcome(
            spec=spec,
            final_content=final_content,
            elapsed_ms=elapsed,
        )
        if session_context is not None and bootstrap_incomplete:
            try:
                from lobster_bootstrap import maybe_complete_bootstrap

                completed_bootstrap = await maybe_complete_bootstrap(spec.role_id, session_context.session_id)
                if isinstance(completed_bootstrap, dict):
                    logger.info(
                        "Bootstrap completed for lobster=%s session=%s",
                        spec.role_id,
                        session_context.session_id,
                    )
            except Exception as bootstrap_exc:
                logger.warning("Bootstrap completion skipped for %s: %s", spec.role_id, bootstrap_exc)
        try:
            await self._compress_memory_after_run(
                spec=spec,
                messages=messages,
                usage=usage,
                final_content=final_content,
                error=error,
                stop_reason=stop_reason,
            )
        except Exception as memory_exc:
            logger.warning("Memory compression skipped for %s: %s", spec.role_id, memory_exc)
        try:
            await self._extract_and_store_lobster_experiences(
                lobster=lobster,
                spec=spec,
                messages=messages,
                final_content=final_content,
                error=error,
            )
        except Exception as extract_exc:
            logger.warning("Experience extraction skipped for %s: %s", spec.role_id, extract_exc)
        try:
            await self._extract_structured_memories_after_run(
                spec=spec,
                messages=messages,
                final_content=final_content,
                error=error,
            )
        except Exception as structured_memory_exc:
            logger.warning("Structured memory extraction skipped for %s: %s", spec.role_id, structured_memory_exc)
        try:
            await self._update_temporal_graph_after_run(
                spec=spec,
                messages=messages,
                final_content=final_content,
                error=error,
            )
        except Exception as temporal_graph_exc:
            logger.warning("Temporal graph update skipped for %s: %s", spec.role_id, temporal_graph_exc)
        if error is None and intensity_mgr is not None and stop_reason in {"completed", "max_iterations"}:
            llm_calls_used = spec.max_iterations if stop_reason == "max_iterations" else max(1, iteration + 1)
            strategy_snapshot = intensity_mgr.record_usage(action=action_type, count=1, llm_calls=llm_calls_used)

        result = LobsterRunResult(
            final_content=final_content,
            messages=messages,
            tools_used=tools_used,
            usage=usage,
            stop_reason=stop_reason,
            error=error,
            elapsed_ms=elapsed,
            step_summary=step_summary,
            output_format_template=output_format_template,
            strategy_intensity=strategy_snapshot,
            task_resolution=task_resolution,
        )
        finalized = await self._finalize_with_expects(spec, result)
        try:
            await self._cache_task_resolution_result(
                spec=spec,
                result=finalized,
                task_resolution=task_resolution,
                prompt_skill_id=prompt_skill_id,
                tenant_id=tenant_id,
                task_id=task_id or f"{spec.role_id}_{int(time.time())}",
            )
        except Exception as resolution_cache_exc:  # noqa: BLE001
            logger.warning("Task resolution cache skipped for %s: %s", spec.role_id, resolution_cache_exc)
        try:
            await self._record_activity_stream(
                spec=spec,
                result=finalized,
                task_id=task_id,
                task_description=task_description,
            )
        except Exception as activity_exc:
            logger.warning("Activity stream record skipped for %s: %s", spec.role_id, activity_exc)
        return finalized

    async def _invoke_llm(
        self,
        spec: LobsterRunSpec,
        messages: list[dict[str, Any]],
    ) -> str:
        """
        Invoke the LLM via LLMRouter.

        Currently wraps routed_ainvoke_text; when the LLM supports
        native tool-use API, this should be extended.
        """
        from llm_router import RouteMeta

        # Build RouteMeta from spec
        meta_dict = spec.meta or {}
        meta = RouteMeta(
            critical=bool(meta_dict.get("critical", False)),
            est_tokens=int(meta_dict.get("est_tokens", 0)),
            tenant_tier=str(meta_dict.get("tenant_tier", "basic")),
            user_id=str(meta_dict.get("user_id", "anonymous")),
            tenant_id=str(meta_dict.get("tenant_id", "tenant_main")),
            task_type=str(meta_dict.get("task_type", spec.role_id)),
            force_tier=str(meta_dict.get("force_tier") or spec.force_tier or getattr(spec.lobster, "DEFAULT_TIER", "") or "").strip() or None,
            trace_id=str(meta_dict.get("trace_id") or ""),
            span_id=str(meta_dict.get("span_id") or ""),
        )

        # Extract system and user prompts
        system_parts = []
        user_parts = []
        for msg in messages:
            if msg["role"] == "system":
                system_parts.append(msg["content"])
            elif msg["role"] == "user":
                user_parts.append(msg["content"])
            elif msg["role"] == "assistant":
                user_parts.append(f"[Previous response]: {msg['content'][:500]}")
            elif msg["role"] == "tool":
                user_parts.append(f"[Tool result from {msg.get('name', '?')}]: {msg['content'][:1000]}")

        system_prompt = "\n\n".join(system_parts)
        user_prompt = "\n\n".join(user_parts)

        # Add tool definitions to system prompt if any
        if spec.tools:
            tool_desc = json.dumps(spec.tools, ensure_ascii=False, indent=2)
            system_prompt += (
                f"\n\n## Available Tools\n"
                f"You have access to the following tools. To use a tool, respond with a JSON block:\n"
                f"```tool_call\n"
                f'{{"name": "tool_name", "arguments": {{...}}}}\n'
                f"```\n\n"
                f"Tools:\n{tool_desc}"
            )

        async def _llm_call(next_system_prompt: str, next_user_prompt: str) -> str:
            try:
                return await self.llm_router.routed_ainvoke_text(
                    system_prompt=next_system_prompt,
                    user_prompt=next_user_prompt,
                    meta=meta,
                    temperature=spec.temperature,
                    model_override=spec.model_override,
                    force_tier=spec.force_tier or getattr(spec.lobster, "DEFAULT_TIER", None),
                )
            except TypeError as exc:
                if "unexpected keyword argument" not in str(exc):
                    raise
                return await self.llm_router.routed_ainvoke_text(
                    system_prompt=next_system_prompt,
                    user_prompt=next_user_prompt,
                    meta=meta,
                    temperature=spec.temperature,
                )

        try:
            from lobster_pipeline_middleware import PipelineContext, get_default_pipeline

            ctx = PipelineContext(
                task_id=str(meta_dict.get("task_id") or meta_dict.get("trace_id") or ""),
                lobster_id=spec.role_id,
                tenant_id=str(meta_dict.get("tenant_id") or "tenant_main"),
                system_prompt=system_prompt,
                prompt=user_prompt,
                metadata=dict(meta_dict),
            )
            ctx = await get_default_pipeline().run(ctx, _llm_call)
            return ctx.output
        except Exception as exc:
            if exc.__class__.__name__ == "PipelineBlockedError":
                raise
            return await _llm_call(system_prompt, user_prompt)

    def _parse_tool_calls(self, content: str) -> list[dict[str, Any]]:
        """
        Parse tool calls from LLM response content.

        Looks for ```tool_call blocks with JSON.
        Returns list of {name, arguments} dicts.
        """
        import re

        tool_calls: list[dict[str, Any]] = []
        # Match ```tool_call ... ``` blocks
        pattern = r"```tool_call\s*\n(.*?)\n```"
        matches = re.findall(pattern, content, re.DOTALL)

        for match in matches:
            try:
                parsed = json.loads(match.strip())
                if isinstance(parsed, dict) and "name" in parsed:
                    tool_calls.append({
                        "name": parsed["name"],
                        "arguments": parsed.get("arguments", {}),
                    })
            except (json.JSONDecodeError, KeyError):
                continue

        return tool_calls

    async def _execute_tools(
        self,
        spec: LobsterRunSpec,
        tool_calls: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Execute tool calls, optionally concurrent.

        If spec.tool_executor is provided, uses it.
        Otherwise returns error for each tool.
        """
        if not spec.tool_executor:
            return [
                {"name": tc["name"], "output": f"Error: no tool executor registered", "status": "error"}
                for tc in tool_calls
            ]

        async def _run_one(tc: dict[str, Any]) -> dict[str, Any]:
            try:
                output = await spec.tool_executor(tc["name"], tc.get("arguments", {}))
                return {"name": tc["name"], "output": str(output), "status": "ok"}
            except Exception as e:
                return {"name": tc["name"], "output": f"Error: {e}", "status": "error"}

        if spec.concurrent_tools and len(tool_calls) > 1:
            results = await asyncio.gather(*[_run_one(tc) for tc in tool_calls])
            return list(results)
        else:
            return [await _run_one(tc) for tc in tool_calls]


# ────────────────────────────────────────────────────────────────────
# ★ 新增：run_lobster_with_background_support
# 带后台化支持的龙虾执行（仿 cccback AgentTool Promise.race 热迁移）
# 灵感来源：cccback-master tools/AgentTool/AgentTool.tsx
# ────────────────────────────────────────────────────────────────────

# 前台等待2秒后提示可后台化（仿 cccback 2s background hint）
FOREGROUND_HINT_DELAY_SEC: float = float(
    os.getenv("LOBSTER_FOREGROUND_HINT_SEC", "2.0")
)


async def run_lobster_with_background_support(
    runner: "LobsterRunner",
    spec: "LobsterRunSpec",
    description: str,
    *,
    mode: "LobsterExecutionMode" = LobsterExecutionMode.AUTO,
    notification_queue: "asyncio.Queue | None" = None,
    on_background_hint: "Callable[[str, str], None] | None" = None,
) -> "LobsterRunResult | AsyncLaunchedResult":
    """
    带后台化支持的龙虾执行。

    工作流（仿 cccback AgentTool sync→async 热迁移）：
        1. 注册为前台任务
        2. 同时启动：龙虾执行 + 2s 后台化提示计时器
        3. Promise.race：
           - 龙虾 2s 内完成 → 同步返回 LobsterRunResult（用户无感知）
           - 2s 未完成 → 调用 on_background_hint 提示用户
           - 用户触发后台化 → 立即返回 AsyncLaunchedResult，后台继续
        4. 后台完成 → 推送 TaskNotification 到 notification_queue

    Args:
        runner:               LobsterRunner 实例
        spec:                 LobsterRunSpec（龙虾规格）
        description:          人类可读的任务描述（用于通知）
        mode:                 前台/后台/自动后台化
        notification_queue:   后台完成通知队列（SSE 端点消费）
        on_background_hint:   2s 后调用（参数：run_id, description）

    Returns:
        LobsterRunResult   — 同步完成（2秒内）
        AsyncLaunchedResult — 已后台化，完成后通过 notification_queue 推送
    """
    from lobster_pool_manager import (
        AsyncLaunchedResult,
        ForegroundTask,
        TaskNotification,
        get_foreground_registry,
    )

    run_id = f"run-{uuid.uuid4().hex[:8]}"
    start_ms = int(time.time() * 1000)
    registry = get_foreground_registry()

    # 注册为前台任务
    fg_task: ForegroundTask = registry.register(run_id, spec.role_id, description)

    # 直接后台模式（跳过前台阶段）
    if mode == LobsterExecutionMode.BACKGROUND and fg_task.background_event:
        fg_task.background_event.set()

    # 龙虾执行 coroutine
    lobster_future: asyncio.Task = asyncio.create_task(runner.run(spec))

    # 2s 后触发后台化提示
    async def _background_hint_trigger() -> None:
        await asyncio.sleep(FOREGROUND_HINT_DELAY_SEC)
        if on_background_hint and fg_task.background_event and not fg_task.background_event.is_set():
            try:
                on_background_hint(run_id, description)
            except Exception as e:
                logger.debug("background_hint callback failed: %s", e)
        if mode == LobsterExecutionMode.AUTO and fg_task.background_event and not fg_task.background_event.is_set():
            fg_task.background_event.set()

    hint_task: asyncio.Task = asyncio.create_task(_background_hint_trigger())

    # background_event 等待协程
    async def _wait_background() -> None:
        if fg_task.background_event:
            await fg_task.background_event.wait()

    background_signal: asyncio.Task = asyncio.create_task(_wait_background())

    try:
        # Promise.race：龙虾完成 vs 后台化信号
        done, _ = await asyncio.wait(
            [lobster_future, background_signal],
            return_when=asyncio.FIRST_COMPLETED,
        )

        if lobster_future in done:
            # ── 同步完成（2秒内或后台化前完成）────────────────────
            hint_task.cancel()
            background_signal.cancel()
            registry.unregister(run_id)

            result = lobster_future.result()
            return result

        else:
            if mode == LobsterExecutionMode.FOREGROUND:
                # 前台模式仅提示，不自动后台化；继续同步等待完成
                hint_task.cancel()
                background_signal.cancel()
                result = await lobster_future
                registry.unregister(run_id)
                return result
            # ── 后台化信号触发 → 热迁移到后台 ──────────────────────
            hint_task.cancel()
            background_signal.cancel()

            # 在后台继续执行，完成后推送通知
            async def _background_continuation() -> None:
                try:
                    result = await lobster_future
                    duration = int(time.time() * 1000) - start_ms
                    notification = TaskNotification(
                        task_id=run_id,
                        lobster_id=spec.role_id,
                        status="completed" if not result.error else "failed",
                        summary=(
                            f"{description} 完成（后台）"
                            if not result.error
                            else f"{description} 失败：{result.error}"
                        ),
                        result=result.final_content or "",
                        total_tokens=sum(result.usage.values()),
                        tool_uses=len(result.tools_used),
                        duration_ms=duration,
                    )
                except Exception as e:
                    duration = int(time.time() * 1000) - start_ms
                    notification = TaskNotification(
                        task_id=run_id,
                        lobster_id=spec.role_id,
                        status="failed",
                        summary=f"{description} 异常（后台）：{str(e)[:200]}",
                        result="",
                        total_tokens=0,
                        tool_uses=0,
                        duration_ms=duration,
                    )
                finally:
                    registry.unregister(run_id)

                if notification_queue is not None:
                    await notification_queue.put(notification)

                logger.info(
                    "[Background] 龙虾 %s (%s) 后台完成：status=%s duration=%dms",
                    spec.role_id, run_id, notification.status, notification.duration_ms,
                )

            asyncio.create_task(_background_continuation())

            return AsyncLaunchedResult(
                run_id=run_id,
                lobster_id=spec.role_id,
                description=description,
            )

    except asyncio.CancelledError:
        lobster_future.cancel()
        hint_task.cancel()
        background_signal.cancel()
        registry.unregister(run_id)
        raise


# ────────────────────────────────────────────────────────────────────
# ★ 新增：check_and_compact_messages
# 在 LLM 调用前检查是否需要对话压缩（集成点）
# 灵感来源：cccback-master services/compact/compact.ts
# ────────────────────────────────────────────────────────────────────

# 压缩上下文缓存（每个 session_id 独立维护）
_compaction_contexts: dict[str, dict[str, Any]] = {}


def get_compaction_context(session_id: str) -> dict[str, Any]:
    """获取指定 session 的压缩上下文"""
    if session_id not in _compaction_contexts:
        _compaction_contexts[session_id] = {
            "recent_files": [],
            "current_workflow": None,
            "used_skills": [],
            "account_snapshot": None,
            "compaction_count": 0,
        }
    return _compaction_contexts[session_id]


def update_compaction_context(session_id: str, key: str, value: Any) -> None:
    """更新压缩上下文（龙虾工具调用时自动更新）"""
    ctx = get_compaction_context(session_id)
    ctx[key] = value


def track_file_read(session_id: str, file_path: str, max_files: int = 5) -> None:
    """记录最近读取的文件（压缩时自动恢复）"""
    ctx = get_compaction_context(session_id)
    recent: list[str] = ctx.get("recent_files", [])
    if file_path not in recent:
        recent.insert(0, file_path)
    ctx["recent_files"] = recent[:max_files]


async def check_and_compact_messages(
    messages: list[dict[str, Any]],
    llm_router: Any,
    session_id: str = "default",
    background_lobsters: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """
    检查消息历史是否超过 Token 阈值，超过则自动压缩。
    集成到龙虾执行主循环中，在每次 LLM 调用前调用。

    Args:
        messages:           当前消息历史
        llm_router:         LLMRouter 实例
        session_id:         会话 ID（用于获取压缩上下文）
        background_lobsters: 当前后台运行的龙虾任务列表

    Returns:
        压缩后的消息历史（如果未触发压缩则原样返回）
    """
    try:
        from conversation_compactor_v2 import ConversationCompactorV2
        compactor = ConversationCompactorV2(llm_router=llm_router)
        use_v2 = True
    except ImportError:
        try:
            from conversation_compactor import ConversationCompactor
        except ImportError:
            logger.warning("ConversationCompactor 未找到，跳过压缩检查")
            return messages
        compactor = ConversationCompactor(llm_router=llm_router)
        use_v2 = False

    if hasattr(compactor, "should_compact") and not compactor.should_compact(messages):
        return messages

    # 构建压缩上下文
    ctx = get_compaction_context(session_id)
    compact_context = {
        **ctx,
        "background_lobsters": background_lobsters or [],
    }

    try:
        if use_v2:
            result = await compactor.compact_lobster_session(
                lobster_id=str(compact_context.get("lobster_id") or "session"),
                messages=messages,
                existing_summaries=compact_context.get("existing_summaries", []),
                mode="incremental",
            )
            new_messages = [
                {
                    "role": "user",
                    "content": result.context_for_next_turn,
                    "metadata": {"is_compaction_summary": True, "v2": True},
                }
            ]
            pre_tokens = sum(len(str(item.get("content", ""))) for item in messages) // 4
            post_tokens = len(result.context_for_next_turn) // 4
            will_retrigger = False
            attachment_count = len(result.leaves) + (1 if result.session_summary else 0)
        else:
            result = await compactor.compact(messages, compact_context)
            new_messages = compactor.apply_compaction(result)
            pre_tokens = result.pre_compact_token_count
            post_tokens = result.post_compact_token_count
            will_retrigger = result.will_retrigger
            attachment_count = len(result.attachments)

        # 更新压缩计数
        ctx["compaction_count"] = ctx.get("compaction_count", 0) + 1

        # 写入审计日志
        try:
            from audit_logger import record_audit_log
            await record_audit_log(
                tenant_id="system",
                user_id="compactor",
                action="conversation_compacted",
                category="system",
                summary=(
                    f"Session {session_id} 对话已压缩："
                    f"pre={pre_tokens:,} → "
                    f"post={post_tokens:,} token"
                ),
                detail={
                    "session_id": session_id,
                    "pre_tokens": pre_tokens,
                    "post_tokens": post_tokens,
                    "will_retrigger": will_retrigger,
                    "attachment_count": attachment_count,
                    "compaction_count": ctx["compaction_count"],
                    "compactor_version": "v2" if use_v2 else "v1",
                },
                result="success",
                source="lobster_runner",
            )
        except Exception:
            pass

        logger.info(
            "[Compactor] Session %s 第 %d 次压缩：%d → %d token",
            session_id,
            ctx["compaction_count"],
            pre_tokens,
            post_tokens,
        )
        return new_messages

    except Exception as e:
        logger.error("[Compactor] 压缩失败（session=%s）：%s，使用原始消息继续", session_id, e)
        return messages
