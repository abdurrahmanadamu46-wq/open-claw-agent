from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator


FINAL_EVENT_TYPES = {"execution_completed", "execution_failed", "execution_cancelled"}


def _format_sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@dataclass
class _ExecutionStreamState:
    history: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=200))
    subscribers: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)
    completed: bool = False
    updated_at: float = field(default_factory=time.time)


class WorkflowRealtimeHub:
    """Lightweight in-memory event hub for workflow execution SSE streams."""

    def __init__(self) -> None:
        self._states: dict[str, _ExecutionStreamState] = {}
        self._lock = asyncio.Lock()

    async def publish(self, execution_id: str, event: dict[str, Any]) -> None:
        normalized = str(execution_id or "").strip()
        if not normalized:
            return
        payload = dict(event or {})
        payload.setdefault("execution_id", normalized)
        payload.setdefault("ts", time.time())

        async with self._lock:
            state = self._states.setdefault(normalized, _ExecutionStreamState())
            state.history.append(payload)
            state.updated_at = time.time()
            if str(payload.get("type") or "") in FINAL_EVENT_TYPES:
                state.completed = True
            subscribers = list(state.subscribers)

        for queue in subscribers:
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                try:
                    _ = queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(payload)
                except asyncio.QueueFull:
                    pass

    async def stream(self, execution_id: str, request: Any) -> AsyncGenerator[str, None]:
        normalized = str(execution_id or "").strip()
        if not normalized:
            return

        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        async with self._lock:
            state = self._states.setdefault(normalized, _ExecutionStreamState())
            snapshot = list(state.history)
            completed = state.completed
            state.subscribers.add(queue)
            state.updated_at = time.time()

        yield _format_sse({"type": "connected", "execution_id": normalized, "ts": time.time()})
        for item in snapshot:
            yield _format_sse(item)
            if str(item.get("type") or "") in FINAL_EVENT_TYPES:
                completed = True

        if completed:
            await self._unsubscribe(normalized, queue)
            return

        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield _format_sse({"type": "heartbeat", "execution_id": normalized, "ts": time.time()})
                    continue
                yield _format_sse(event)
                if str(event.get("type") or "") in FINAL_EVENT_TYPES:
                    break
        finally:
            await self._unsubscribe(normalized, queue)

    async def _unsubscribe(self, execution_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            state = self._states.get(execution_id)
            if state is None:
                return
            state.subscribers.discard(queue)
            if state.completed and not state.subscribers and (time.time() - state.updated_at) > 5:
                self._states.pop(execution_id, None)


_hub: WorkflowRealtimeHub | None = None


def get_workflow_realtime_hub() -> WorkflowRealtimeHub:
    global _hub
    if _hub is None:
        _hub = WorkflowRealtimeHub()
    return _hub
