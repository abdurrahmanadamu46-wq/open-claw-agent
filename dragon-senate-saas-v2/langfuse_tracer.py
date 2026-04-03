"""
Trace / Span helpers backed by the existing LLMCallLogger store.
"""

from __future__ import annotations

from typing import Any

from llm_call_logger import get_llm_call_logger


class LangfuseTracer:
    """Langfuse-style tracing wrapper implemented on top of llm_call_logger."""

    @staticmethod
    def start_workflow_trace(
        workflow_id: str,
        workflow_name: str,
        tenant_id: str,
        input_summary: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> str:
        logger = get_llm_call_logger()
        return logger.start_trace(
            workflow_run_id=workflow_id,
            workflow_name=workflow_name,
            tenant_id=tenant_id,
            name=f"workflow:{workflow_name}",
            tags=["workflow", tenant_id],
            meta={
                "input_summary": input_summary,
                **(metadata or {}),
            },
        )

    @staticmethod
    def start_lobster_span(
        trace_id: str,
        *,
        lobster_name: str,
        skill_name: str,
        lobster_id: str,
        input_data: dict[str, Any],
        edge_node_id: str | None = None,
        tenant_id: str = "tenant_main",
        step_index: int | None = None,
    ) -> str:
        logger = get_llm_call_logger()
        return logger.start_span(
            trace_id=trace_id,
            lobster=lobster_name or lobster_id,
            skill=skill_name,
            step_index=step_index,
            tenant_id=tenant_id,
            meta={
                "lobster_id": lobster_id,
                "lobster_name": lobster_name or lobster_id,
                "skill_name": skill_name,
                "edge_node_id": edge_node_id or "cloud",
                "input": input_data,
            },
        )

    @staticmethod
    def end_lobster_span(
        span_id: str,
        *,
        output: dict[str, Any],
        quality_score: float | None = None,
        error: str | None = None,
    ) -> None:
        logger = get_llm_call_logger()
        logger.end_span(
            span_id=span_id,
            status="error" if error else "completed",
            latency_ms=0,
        )
        if quality_score is not None:
            try:
                meta = output or {}
                generation_id = str(meta.get("gen_id") or "")
                if generation_id:
                    logger.add_score(
                        gen_id=generation_id,
                        name="quality_score",
                        value=float(quality_score),
                        scorer="workflow-tracer",
                        comment="workflow_span_complete",
                    )
            except Exception:
                pass

    @staticmethod
    def end_workflow_trace(
        trace_id: str,
        *,
        status: str = "completed",
        output: dict[str, Any] | None = None,
    ) -> None:
        logger = get_llm_call_logger()
        logger.end_trace(trace_id, status=status)
        if output:
            try:
                logger.add_score(
                    gen_id="",
                    trace_id=trace_id,
                    name="workflow_steps_completed",
                    value=float(output.get("steps_completed") or 0),
                    scorer="workflow-tracer",
                    comment="workflow_complete",
                )
            except Exception:
                pass

    @staticmethod
    def record_llm_generation(
        *,
        trace_id: str,
        span_id: str | None,
        tenant_id: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        duration_ms: int,
        input_prompt: str,
        output_text: str,
        quality_score: float | None = None,
        provider: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        logger = get_llm_call_logger()
        gen_id = logger.record_generation(
            trace_id=trace_id,
            span_id=span_id,
            tenant_id=tenant_id,
            model=model,
            provider=provider,
            input_text=input_prompt,
            output_text=output_text,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=duration_ms,
            meta=metadata or {},
        )
        if quality_score is not None:
            logger.add_score(
                gen_id=gen_id,
                name="quality_score",
                value=float(quality_score),
                scorer="workflow-tracer",
                comment="llm_generation_quality",
            )
        return gen_id
