"""
Lightweight workflow contract engine inspired by memU workflow semantics.

This is a small contract layer for requires/produces validation so lobster
pipelines can be composed with clearer expectations.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass(slots=True)
class WorkflowStep:
    step_id: str
    requires: list[str] = field(default_factory=list)
    produces: list[str] = field(default_factory=list)
    handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None


class WorkflowEngine:
    def __init__(self) -> None:
        self._steps: dict[str, WorkflowStep] = {}

    def register_step(self, step: WorkflowStep) -> None:
        self._steps[step.step_id] = step

    def validate_requires(self, step_id: str, state: dict[str, Any]) -> list[str]:
        step = self._steps.get(step_id)
        if step is None:
            raise KeyError(f"Unknown workflow step: {step_id}")
        return [field for field in step.requires if state.get(field) in (None, "", [], {})]

    async def run_step(self, step_id: str, state: dict[str, Any]) -> dict[str, Any]:
        missing = self.validate_requires(step_id, state)
        if missing:
            raise ValueError(f"Missing required fields for {step_id}: {', '.join(missing)}")
        step = self._steps[step_id]
        if step.handler is None:
            return {}
        output = await step.handler(state)
        if not isinstance(output, dict):
            raise TypeError(f"Workflow step {step_id} must return a dict")
        for field in step.produces:
            if field not in output:
                raise ValueError(f"Workflow step {step_id} did not produce required field: {field}")
        return output
