"""
Fleet-style class-based background job registry.
"""

from __future__ import annotations

import inspect
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("job_registry")


@dataclass(slots=True)
class JobResult:
    success: bool
    message: str = ""
    output: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "message": self.message,
            "output": dict(self.output),
        }


class BaseJob(ABC):
    @classmethod
    @abstractmethod
    def job_name(cls) -> str:
        raise NotImplementedError

    @classmethod
    def max_retries(cls) -> int:
        return 3

    @classmethod
    def retry_delay_seconds(cls) -> float:
        return 60.0

    @abstractmethod
    async def run(self, payload: dict[str, Any]) -> JobResult:
        raise NotImplementedError


class SendMessageJob(BaseJob):
    @classmethod
    def job_name(cls) -> str:
        return "send_message"

    async def run(self, payload: dict[str, Any]) -> JobResult:
        return JobResult(success=True, message="message queued", output={"payload": payload})


class ExtractMemoryJob(BaseJob):
    @classmethod
    def job_name(cls) -> str:
        return "extract_memory"

    @classmethod
    def max_retries(cls) -> int:
        return 1

    async def run(self, payload: dict[str, Any]) -> JobResult:
        return JobResult(success=True, message="memory extraction queued", output={"payload": payload})


class EvaluateLabelsJob(BaseJob):
    @classmethod
    def job_name(cls) -> str:
        return "evaluate_labels"

    async def run(self, payload: dict[str, Any]) -> JobResult:
        return JobResult(success=True, message="dynamic labels evaluated", output={"payload": payload})


class WebhookDeliveryJob(BaseJob):
    @classmethod
    def job_name(cls) -> str:
        return "webhook_delivery"

    @classmethod
    def max_retries(cls) -> int:
        return 5

    @classmethod
    def retry_delay_seconds(cls) -> float:
        return 30.0

    async def run(self, payload: dict[str, Any]) -> JobResult:
        return JobResult(success=True, message="webhook delivery queued", output={"payload": payload})


class JobRegistry:
    def __init__(self) -> None:
        self._jobs: dict[str, type[BaseJob]] = {}

    def register(self, job_cls: type[BaseJob]) -> None:
        self._jobs[job_cls.job_name()] = job_cls

    def get(self, job_name: str) -> type[BaseJob] | None:
        return self._jobs.get(str(job_name or "").strip())

    def list_jobs(self) -> list[str]:
        return sorted(self._jobs.keys())

    async def run(self, job_name: str, payload: dict[str, Any]) -> JobResult:
        job_cls = self.get(job_name)
        if job_cls is None:
            raise KeyError(f"unknown job type: {job_name}")
        result = await job_cls().run(payload)
        if isinstance(result, JobResult):
            return result
        if isinstance(result, dict):
            return JobResult(
                success=bool(result.get("success", True)),
                message=str(result.get("message") or ""),
                output=dict(result),
            )
        return JobResult(success=True, message=str(result))

    def dispatch(
        self,
        *,
        queue: Any,
        job_name: str,
        payload: dict[str, Any],
        tenant_id: str = "",
        priority: int | str = 50,
        delay_seconds: int = 0,
        max_attempts: int | None = None,
    ) -> str:
        job_cls = self.get(job_name)
        if job_cls is None:
            raise KeyError(f"unknown job type: {job_name}")
        attempts = int(max_attempts if max_attempts is not None else job_cls.max_retries())
        return queue.enqueue(
            task_type=job_name,
            payload=payload,
            tenant_id=tenant_id,
            priority=priority,
            delay_seconds=delay_seconds,
            max_attempts=attempts,
        )


def _register_defaults(registry: JobRegistry) -> None:
    for job_cls in (SendMessageJob, ExtractMemoryJob, EvaluateLabelsJob, WebhookDeliveryJob):
        registry.register(job_cls)


_registry: JobRegistry | None = None


def get_job_registry() -> JobRegistry:
    global _registry
    if _registry is None:
        _registry = JobRegistry()
        _register_defaults(_registry)
    return _registry


async def maybe_run_registered_job(job_name: str, payload: dict[str, Any]) -> JobResult | None:
    registry = get_job_registry()
    job_cls = registry.get(job_name)
    if job_cls is None:
        return None
    result = job_cls().run(payload)
    if inspect.isawaitable(result):
        return await result
    if isinstance(result, JobResult):
        return result
    if isinstance(result, dict):
        return JobResult(success=bool(result.get("success", True)), message=str(result.get("message") or ""), output=dict(result))
    return JobResult(success=True, message=str(result))
