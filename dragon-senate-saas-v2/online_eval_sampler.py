"""
Online evaluation sampler for production lobster runs.
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Any

from dynamic_config import get_dynamic_config
from experiment_registry import get_experiment_registry
from llm_quality_judge import get_quality_judge


logger = logging.getLogger("online_eval_sampler")


class OnlineEvalSampler:
    """Sample a subset of lobster runs and write them into experiments."""

    def __init__(self) -> None:
        self._cfg = get_dynamic_config()

    def is_enabled(self, tenant_id: str = "__global__") -> bool:
        return self._cfg.get_bool("online_eval_enabled", False, tenant_id)

    def sampling_rate(self, tenant_id: str = "__global__") -> float:
        value = float(self._cfg.get_float("online_eval_sampling_rate", 0.1, tenant_id))
        return max(0.0, min(1.0, value))

    def metric_names(self, tenant_id: str = "__global__") -> list[str]:
        raw = self._cfg.get_json("online_eval_metrics", ["task_completion", "hallucination"], tenant_id)
        if isinstance(raw, list):
            items = [str(item).strip() for item in raw if str(item).strip()]
            return items or ["task_completion", "hallucination"]
        return ["task_completion", "hallucination"]

    def should_sample(self, tenant_id: str = "__global__") -> bool:
        if not self.is_enabled(tenant_id):
            return False
        return random.random() < self.sampling_rate(tenant_id)

    def schedule(
        self,
        *,
        lobster_name: str,
        input_text: str,
        output_text: str,
        tenant_id: str = "tenant_main",
        context: dict[str, Any] | None = None,
        prompt_name: str = "",
        prompt_version: str = "",
        model: str = "",
        gen_id: str = "",
        latency_ms: int = 0,
        tokens_used: int = 0,
        cost_usd: float = 0.0,
    ) -> bool:
        if not str(output_text or "").strip():
            return False
        if not self.should_sample(tenant_id):
            return False
        asyncio.create_task(
            self._evaluate_and_record(
                lobster_name=lobster_name,
                input_text=input_text,
                output_text=output_text,
                tenant_id=tenant_id,
                context=context or {},
                prompt_name=prompt_name,
                prompt_version=prompt_version,
                model=model,
                gen_id=gen_id,
                latency_ms=latency_ms,
                tokens_used=tokens_used,
                cost_usd=cost_usd,
            )
        )
        return True

    async def _evaluate_and_record(
        self,
        *,
        lobster_name: str,
        input_text: str,
        output_text: str,
        tenant_id: str,
        context: dict[str, Any],
        prompt_name: str,
        prompt_version: str,
        model: str,
        gen_id: str,
        latency_ms: int,
        tokens_used: int,
        cost_usd: float,
    ) -> None:
        try:
            judge = get_quality_judge()
            scores = await judge.evaluate_async(
                lobster_name=lobster_name,
                input_text=input_text,
                output_text=output_text,
                context=context,
                metrics=self.metric_names(tenant_id),
                tenant_id=tenant_id,
                gen_id=gen_id,
            )
            get_experiment_registry().append_online_result(
                lobster_name=lobster_name,
                tenant_id=tenant_id,
                input_payload={
                    "input_text": input_text,
                    "lobster_name": lobster_name,
                },
                output_text=output_text,
                scores=scores,
                gen_id=gen_id,
                latency_ms=latency_ms,
                tokens_used=tokens_used,
                cost_usd=cost_usd,
                context_snapshot=context,
                prompt_name=prompt_name,
                prompt_version=prompt_version,
                model=model,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[OnlineEval] failed for %s tenant=%s: %s",
                lobster_name,
                tenant_id,
                exc,
            )


_default_sampler: OnlineEvalSampler | None = None


def get_online_eval_sampler() -> OnlineEvalSampler:
    global _default_sampler
    if _default_sampler is None:
        _default_sampler = OnlineEvalSampler()
    return _default_sampler
