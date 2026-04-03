"""
Lobster Event Bus — Redis Streams 消息队列。
"""

from __future__ import annotations

import json
import time
from typing import Any, Awaitable, Callable

try:
    from redis.asyncio import Redis
except ImportError:
    Redis = None  # type: ignore[assignment]


class LobsterEventBus:
    """基于 Redis Streams 的龙虾事件总线。"""

    STREAM_PREFIX = "lobster:events"

    def __init__(self, redis: Any | None = None):
        self._redis: Any | None = redis
        self._consumers: dict[str, list[Callable[[dict[str, Any]], Awaitable[None]]]] = {}
        self._memory_queue: list[dict[str, Any]] = []

    @property
    def has_redis(self) -> bool:
        return self._redis is not None

    def _stream_key(self, tenant_id: str) -> str:
        return f"{self.STREAM_PREFIX}:{tenant_id}"

    async def publish(
        self,
        *,
        tenant_id: str,
        lobster: str,
        action: str,
        trace_id: str,
        user_id: str,
        payload: dict[str, Any],
        event_type: str = "result",
    ) -> str:
        message = {
            "lobster": lobster,
            "action": action,
            "trace_id": trace_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "event_type": event_type,
            "payload": json.dumps(payload, ensure_ascii=False, default=str),
            "ts": str(time.time()),
        }

        if self._redis is not None:
            try:
                msg_id = await self._redis.xadd(
                    self._stream_key(tenant_id),
                    message,
                    maxlen=10000,
                )
                await self._dispatch_to_consumers(message)
                return str(msg_id)
            except Exception as exc:  # noqa: BLE001
                print(f"[event_bus] redis xadd failed, fallback to memory: {exc}")

        fallback_id = f"mem_{int(time.time() * 1000)}"
        message["_id"] = fallback_id
        self._memory_queue.append(message)
        if len(self._memory_queue) > 1000:
            self._memory_queue = self._memory_queue[-1000:]
        await self._dispatch_to_consumers(message)
        return fallback_id

    def register_consumer(
        self,
        group: str,
        callback: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        self._consumers.setdefault(group, []).append(callback)

    async def _dispatch_to_consumers(self, message: dict[str, Any]) -> None:
        for group, callbacks in self._consumers.items():
            for callback in callbacks:
                try:
                    await callback(message)
                except Exception as exc:  # noqa: BLE001
                    print(f"[event_bus] consumer {group} error: {exc}")

    async def read_recent(
        self,
        tenant_id: str,
        count: int = 50,
        since_ms: int | None = None,
    ) -> list[dict[str, Any]]:
        if self._redis is not None:
            try:
                start = f"{since_ms}-0" if since_ms else "-"
                raw = await self._redis.xrevrange(self._stream_key(tenant_id), "+", start, count=count)
                results: list[dict[str, Any]] = []
                for msg_id, fields in raw:
                    entry = dict(fields)
                    entry["_id"] = str(msg_id)
                    if "payload" in entry:
                        try:
                            entry["payload"] = json.loads(entry["payload"])
                        except (json.JSONDecodeError, TypeError):
                            pass
                    results.append(entry)
                return results
            except Exception as exc:  # noqa: BLE001
                print(f"[event_bus] redis xrevrange failed: {exc}")

        filtered = [msg for msg in self._memory_queue if msg.get("tenant_id") == tenant_id]
        filtered.sort(key=lambda x: float(x.get("ts", 0)), reverse=True)
        return filtered[:count]

    def snapshot(self) -> dict[str, Any]:
        return {
            "has_redis": self.has_redis,
            "consumer_groups": {k: len(v) for k, v in self._consumers.items()},
            "memory_queue_size": len(self._memory_queue),
        }


_bus: LobsterEventBus | None = None


def get_event_bus() -> LobsterEventBus:
    """获取全局 LobsterEventBus 单例。"""
    global _bus
    if _bus is None:
        _bus = LobsterEventBus()
    return _bus


def init_event_bus(redis: Any | None = None) -> LobsterEventBus:
    """初始化全局 EventBus。"""
    global _bus
    _bus = LobsterEventBus(redis=redis)
    return _bus
