"""
Failover provider wrapper for multi-provider retries and handoff.

Borrowing notes:
- IronClaw inspired retryable/non-retryable classification and ordered
  provider failover.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

logger = logging.getLogger("failover_provider")

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
NON_RETRYABLE_STATUS_CODES = {400, 401, 403}
RETRYABLE_ERROR_KEYWORDS = (
    "rate limit",
    "ratelimit",
    "too many requests",
    "timeout",
    "timed out",
    "connection reset",
    "service unavailable",
    "overloaded",
    "temporarily unavailable",
)
NON_RETRYABLE_ERROR_KEYWORDS = (
    "invalid api key",
    "unauthorized",
    "forbidden",
    "authentication",
    "invalid_api_key",
)


def classify_error(error: Exception) -> str:
    """Return retryable / non_retryable / unknown for a provider error."""

    message = str(error).lower()
    status = getattr(error, "status_code", None) or getattr(error, "http_status", None)
    try:
        status_code = int(status) if status is not None else None
    except (TypeError, ValueError):
        status_code = None

    if status_code in NON_RETRYABLE_STATUS_CODES:
        return "non_retryable"
    if status_code in RETRYABLE_STATUS_CODES:
        return "retryable"
    if any(keyword in message for keyword in NON_RETRYABLE_ERROR_KEYWORDS):
        return "non_retryable"
    if any(keyword in message for keyword in RETRYABLE_ERROR_KEYWORDS):
        return "retryable"
    return "unknown"


@dataclass
class ProviderHealth:
    provider_name: str
    success_count: int = 0
    failure_count: int = 0
    last_failure_at: float = 0.0
    last_failure_reason: str = ""
    is_suspended: bool = False
    suspend_until: float = 0.0

    @property
    def is_available(self) -> bool:
        if not self.is_suspended:
            return True
        if time.monotonic() > self.suspend_until:
            self.is_suspended = False
            return True
        return False

    def record_success(self) -> None:
        self.success_count += 1
        self.is_suspended = False

    def record_failure(self, reason: str, suspend_seconds: float = 60.0) -> None:
        self.failure_count += 1
        self.last_failure_at = time.monotonic()
        self.last_failure_reason = str(reason)[:300]
        if self.failure_count % 3 == 0:
            self.is_suspended = True
            self.suspend_until = time.monotonic() + suspend_seconds

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider_name": self.provider_name,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "is_available": self.is_available,
            "is_suspended": self.is_suspended,
            "last_failure_reason": self.last_failure_reason or None,
        }


class FailoverProvider:
    """
    Generic ordered provider failover wrapper.

    The wrapper is transport-agnostic: callers may pass provider instances,
    router targets, or any other object, plus an invoke callback.
    """

    def __init__(
        self,
        providers: list[Any],
        *,
        name_resolver: Callable[[Any], str] | None = None,
        invoke_func: Callable[[Any, list[dict[str, Any]], Any], Awaitable[Any]] | None = None,
        max_retries_per_provider: int = 1,
        retry_delay_seconds: float = 1.0,
        suspend_seconds: float = 60.0,
    ) -> None:
        self.providers = list(providers)
        self.name_resolver = name_resolver or self._provider_name
        self.invoke_func = invoke_func
        self.max_retries_per_provider = max(0, int(max_retries_per_provider))
        self.retry_delay_seconds = max(0.0, float(retry_delay_seconds))
        self.suspend_seconds = max(1.0, float(suspend_seconds))
        self._health: dict[str, ProviderHealth] = {
            self.name_resolver(provider): ProviderHealth(self.name_resolver(provider))
            for provider in self.providers
        }

    @staticmethod
    def _provider_name(provider: Any) -> str:
        return str(
            getattr(provider, "provider_name", None)
            or getattr(provider, "name", None)
            or getattr(getattr(provider, "spec", None), "name", None)
            or type(provider).__name__
        )

    def health_report(self) -> list[dict[str, Any]]:
        return [item.to_dict() for item in self._health.values()]

    async def ainvoke(self, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
        last_error: Exception | None = None
        errors: list[str] = []

        for provider in self.providers:
            provider_name = self.name_resolver(provider)
            health = self._health.setdefault(provider_name, ProviderHealth(provider_name))
            if not health.is_available:
                logger.info("[Failover] skip suspended provider: %s", provider_name)
                continue

            for attempt in range(self.max_retries_per_provider + 1):
                try:
                    if attempt > 0:
                        await asyncio.sleep(self.retry_delay_seconds * attempt)
                    result = await self._invoke(provider, messages, **kwargs)
                    health.record_success()
                    logger.info("[Failover] provider=%s success attempt=%d", provider_name, attempt + 1)
                    return result
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    error_type = classify_error(exc)
                    error_text = f"{provider_name}[{attempt + 1}]: {type(exc).__name__}: {exc}"
                    errors.append(error_text)
                    health.record_failure(error_text, suspend_seconds=self.suspend_seconds)
                    logger.warning("[Failover] %s | type=%s", error_text, error_type)
                    if error_type == "non_retryable":
                        break
                    if attempt >= self.max_retries_per_provider:
                        break

        summary = " | ".join(errors)[:1000]
        raise RuntimeError(
            f"All {len(self.providers)} providers failed. "
            f"Last error: {last_error}. Details: {summary}"
        )

    async def _invoke(self, provider: Any, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
        if self.invoke_func is not None:
            return await self.invoke_func(provider, messages, **kwargs)
        if hasattr(provider, "ainvoke"):
            return await provider.ainvoke(messages, **kwargs)
        if hasattr(provider, "invoke"):
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, lambda: provider.invoke(messages, **kwargs))
        if hasattr(provider, "acomplete"):
            return await provider.acomplete(messages, **kwargs)
        raise NotImplementedError(f"Provider {self.name_resolver(provider)} has no invoke interface")
