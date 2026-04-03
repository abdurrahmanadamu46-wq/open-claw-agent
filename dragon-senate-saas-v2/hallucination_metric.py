"""
Context-aware hallucination metric for lobster outputs.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any
from typing import Callable


HALLUCINATION_JUDGE_PROMPT = """
你是一名严格的 AI 输出审查员。

请基于用户任务、可用上下文、以及模型最终输出，判断输出是否包含“上下文里不存在、却被当成事实写出来”的幻觉信息。

【用户任务】
{input_text}

【可用上下文】
{context_text}

【模型输出】
{output_text}

评分规则：
- 0.0：完全基于上下文，没有明显捏造
- 0.3：有少量合理推断，但不影响关键事实
- 0.6：有明显捏造，关键事实与上下文不符
- 1.0：严重幻觉，大量关键事实无法在上下文中找到依据

只输出 JSON：
{{"score": 0.0, "reason": "一句话说明"}}
""".strip()


@dataclass(slots=True)
class HallucinationScore:
    value: float
    reason: str
    passed: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "reason": self.reason,
            "passed": self.passed,
        }


class HallucinationMetric:
    """LLM-as-judge hallucination scorer."""

    METRIC_NAME = "hallucination"

    def __init__(
        self,
        judge_callable: Callable[[str], dict[str, Any] | None],
        *,
        threshold: float = 0.3,
    ) -> None:
        self._judge_callable = judge_callable
        self.threshold = threshold

    @staticmethod
    def _normalize_context(context: str | list[str] | dict[str, Any] | None) -> str:
        if context is None:
            return ""
        if isinstance(context, str):
            return context
        if isinstance(context, list):
            parts = [str(item).strip() for item in context if str(item).strip()]
            return "\n---\n".join(parts)
        if isinstance(context, dict):
            lines: list[str] = []
            for key, value in context.items():
                text = str(value).strip()
                if text:
                    lines.append(f"{key}: {text}")
            return "\n".join(lines)
        return str(context)

    def score(
        self,
        *,
        input_text: str,
        output_text: str,
        context: str | list[str] | dict[str, Any] | None,
    ) -> HallucinationScore:
        context_text = self._normalize_context(context)[:4000]
        prompt = HALLUCINATION_JUDGE_PROMPT.format(
            input_text=str(input_text or "")[:2000],
            output_text=str(output_text or "")[:3000],
            context_text=context_text or "(无可用上下文)",
        )
        try:
            result = self._judge_callable(prompt) or {}
            value = float(result.get("score", 0.5))
            reason = str(result.get("reason", "") or "").strip() or "judge returned no reason"
        except Exception as exc:  # noqa: BLE001
            value = 0.5
            reason = f"hallucination_judge_failed: {exc}"
        value = max(0.0, min(1.0, round(value, 3)))
        return HallucinationScore(
            value=value,
            reason=reason,
            passed=value < self.threshold,
        )

    async def score_async(
        self,
        *,
        input_text: str,
        output_text: str,
        context: str | list[str] | dict[str, Any] | None,
    ) -> HallucinationScore:
        return await asyncio.to_thread(
            self.score,
            input_text=input_text,
            output_text=output_text,
            context=context,
        )
