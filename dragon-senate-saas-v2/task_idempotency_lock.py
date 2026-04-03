from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger("task_idempotency_lock")

_owned_lock_counts: ContextVar[dict[str, int] | None] = ContextVar(
    "lobster_task_idempotency_owned_lock_counts",
    default=None,
)


class TaskAlreadyRunningError(RuntimeError):
    """Raised when another execution already holds the same task lock."""

    def __init__(
        self,
        task_id: str,
        *,
        tenant_id: str = "tenant_main",
        started_at: float | None = None,
    ) -> None:
        self.task_id = str(task_id or "").strip()
        self.tenant_id = str(tenant_id or "tenant_main").strip() or "tenant_main"
        self.started_at = started_at
        detail = (
            f"任务 {self.task_id} 已在执行中"
            if started_at is None
            else f"任务 {self.task_id} 已在执行中（started_at={started_at:.0f}）"
        )
        super().__init__(f"{detail}；tenant={self.tenant_id}")


@dataclass(slots=True)
class LockInfo:
    task_id: str
    lobster_id: str
    tenant_id: str
    acquired_at: float
    ttl_seconds: int = 300

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class TaskIdempotencyLock:
    """
    Prevent duplicate lobster executions for the same tenant/task pair.

    Backend:
    - ``memory``: single-process guard
    - ``redis``: distributed guard with local re-entrancy support
    """

    def __init__(
        self,
        *,
        backend: str | None = None,
        redis_url: str | None = None,
    ) -> None:
        backend_raw = str(
            backend
            or os.getenv("LOBSTER_TASK_LOCK_BACKEND", "memory")
        ).strip().lower()
        self._backend = backend_raw if backend_raw in {"memory", "redis"} else "memory"
        self._redis_url = str(
            redis_url or os.getenv("LOBSTER_TASK_LOCK_REDIS_URL", "redis://127.0.0.1:6379/0")
        ).strip()
        self._memory_locks: dict[str, LockInfo] = {}
        self._memory_guard = asyncio.Lock()
        self._redis = None

    @staticmethod
    def _lock_key(task_id: str, tenant_id: str) -> str:
        return f"lobster_task_lock:{tenant_id}:{task_id}"

    @staticmethod
    def _normalize_task_id(task_id: str) -> str:
        return str(task_id or "").strip()

    @staticmethod
    def _normalize_tenant_id(tenant_id: str) -> str:
        return str(tenant_id or "tenant_main").strip() or "tenant_main"

    def _get_owned_counts(self) -> dict[str, int]:
        current = _owned_lock_counts.get()
        return dict(current or {})

    def _own_lock(self, lock_key: str) -> None:
        current = self._get_owned_counts()
        current[lock_key] = current.get(lock_key, 0) + 1
        _owned_lock_counts.set(current)

    def _release_owned_lock(self, lock_key: str) -> None:
        current = self._get_owned_counts()
        remaining = max(0, int(current.get(lock_key, 0)) - 1)
        if remaining <= 0:
            current.pop(lock_key, None)
        else:
            current[lock_key] = remaining
        _owned_lock_counts.set(current)

    def _is_owned_by_current_context(self, lock_key: str) -> bool:
        return int(self._get_owned_counts().get(lock_key, 0)) > 0

    async def _get_redis(self):  # pragma: no cover - depends on optional package/runtime
        if self._redis is not None:
            return self._redis
        try:
            import redis.asyncio as redis_async

            self._redis = redis_async.from_url(
                self._redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        except ImportError:
            logger.warning("[IdempotencyLock] redis package missing, fallback to memory")
            self._backend = "memory"
            return None
        except Exception as exc:  # noqa: BLE001
            logger.warning("[IdempotencyLock] redis init failed, fallback to memory: %s", exc)
            self._backend = "memory"
            return None
        return self._redis

    async def _cleanup_expired_memory_locks(self, *, now: float | None = None) -> None:
        current_ts = now if now is not None else time.time()
        expired_keys = [
            key
            for key, info in self._memory_locks.items()
            if (current_ts - float(info.acquired_at)) > max(1, int(info.ttl_seconds))
        ]
        for key in expired_keys:
            info = self._memory_locks.pop(key, None)
            if info is not None:
                logger.warning(
                    "[IdempotencyLock] cleared expired lock tenant=%s task=%s",
                    info.tenant_id,
                    info.task_id,
                )

    async def _acquire_memory(self, lock_key: str, info: LockInfo) -> bool:
        async with self._memory_guard:
            await self._cleanup_expired_memory_locks(now=time.time())
            if lock_key in self._memory_locks:
                return False
            self._memory_locks[lock_key] = info
            return True

    async def _acquire_redis(self, lock_key: str, info: LockInfo) -> bool:
        redis = await self._get_redis()
        if redis is None or self._backend != "redis":
            return await self._acquire_memory(lock_key, info)
        payload = json.dumps(info.to_dict(), ensure_ascii=False)
        try:
            result = await redis.set(lock_key, payload, nx=True, ex=max(1, int(info.ttl_seconds)))
        except Exception as exc:  # noqa: BLE001
            logger.warning("[IdempotencyLock] redis acquire failed, fallback to memory: %s", exc)
            self._backend = "memory"
            return await self._acquire_memory(lock_key, info)
        return bool(result)

    async def _release_backend_lock(self, lock_key: str) -> None:
        if self._backend == "redis":
            redis = await self._get_redis()
            if redis is not None and self._backend == "redis":
                try:
                    await redis.delete(lock_key)
                    return
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[IdempotencyLock] redis release failed, fallback to memory: %s", exc)
                    self._backend = "memory"
        async with self._memory_guard:
            self._memory_locks.pop(lock_key, None)

    async def describe_lock(self, task_id: str, tenant_id: str = "tenant_main") -> LockInfo | None:
        normalized_task_id = self._normalize_task_id(task_id)
        if not normalized_task_id:
            return None
        normalized_tenant_id = self._normalize_tenant_id(tenant_id)
        lock_key = self._lock_key(normalized_task_id, normalized_tenant_id)

        async with self._memory_guard:
            await self._cleanup_expired_memory_locks(now=time.time())
            info = self._memory_locks.get(lock_key)
            if info is not None:
                return info

        if self._backend == "redis":
            redis = await self._get_redis()
            if redis is not None and self._backend == "redis":
                try:
                    payload = await redis.get(lock_key)
                    if payload:
                        data = json.loads(str(payload))
                        return LockInfo(
                            task_id=str(data.get("task_id") or normalized_task_id),
                            lobster_id=str(data.get("lobster_id") or ""),
                            tenant_id=str(data.get("tenant_id") or normalized_tenant_id),
                            acquired_at=float(data.get("acquired_at") or time.time()),
                            ttl_seconds=int(data.get("ttl_seconds") or 300),
                        )
                except Exception:
                    return None
        return None

    async def is_locked(self, task_id: str, tenant_id: str = "tenant_main") -> bool:
        normalized_task_id = self._normalize_task_id(task_id)
        if not normalized_task_id:
            return False
        normalized_tenant_id = self._normalize_tenant_id(tenant_id)
        lock_key = self._lock_key(normalized_task_id, normalized_tenant_id)
        if self._is_owned_by_current_context(lock_key):
            return True
        return await self.describe_lock(normalized_task_id, normalized_tenant_id) is not None

    @asynccontextmanager
    async def acquire(
        self,
        task_id: str,
        lobster_id: str,
        tenant_id: str,
        ttl_seconds: int = 300,
    ):
        normalized_task_id = self._normalize_task_id(task_id)
        normalized_tenant_id = self._normalize_tenant_id(tenant_id)
        if not normalized_task_id:
            yield
            return

        lock_key = self._lock_key(normalized_task_id, normalized_tenant_id)
        if self._is_owned_by_current_context(lock_key):
            self._own_lock(lock_key)
            try:
                yield
            finally:
                self._release_owned_lock(lock_key)
            return

        info = LockInfo(
            task_id=normalized_task_id,
            lobster_id=str(lobster_id or "").strip(),
            tenant_id=normalized_tenant_id,
            acquired_at=time.time(),
            ttl_seconds=max(1, int(ttl_seconds or 300)),
        )
        acquired = False
        try:
            if self._backend == "redis":
                acquired = await self._acquire_redis(lock_key, info)
            else:
                acquired = await self._acquire_memory(lock_key, info)
            if not acquired:
                existing = await self.describe_lock(normalized_task_id, normalized_tenant_id)
                raise TaskAlreadyRunningError(
                    normalized_task_id,
                    tenant_id=normalized_tenant_id,
                    started_at=existing.acquired_at if existing is not None else None,
                )
            self._own_lock(lock_key)
            logger.info(
                "[IdempotencyLock] acquired tenant=%s task=%s lobster=%s",
                normalized_tenant_id,
                normalized_task_id,
                info.lobster_id,
            )
            yield
        finally:
            if acquired:
                self._release_owned_lock(lock_key)
                await self._release_backend_lock(lock_key)
                logger.info(
                    "[IdempotencyLock] released tenant=%s task=%s",
                    normalized_tenant_id,
                    normalized_task_id,
                )


_global_lock: TaskIdempotencyLock | None = None


def get_idempotency_lock() -> TaskIdempotencyLock:
    global _global_lock
    if _global_lock is None:
        _global_lock = TaskIdempotencyLock()
    return _global_lock
