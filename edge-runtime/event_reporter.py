"""
EventReporter — 事件上报器
"""

from __future__ import annotations

import json
from collections import deque
from typing import Any

from event_watcher import EdgeEvent


class EventReporter:
    """
    事件上报器
    """

    def __init__(self, wss_send: Any = None, max_queue: int = 1000) -> None:
        self._wss_send = wss_send
        self._queue: deque[EdgeEvent] = deque(maxlen=max_queue)
        self._reported_ids: set[str] = set()
        self._stats = {"sent": 0, "queued": 0, "deduped": 0}

    def set_wss_send(self, wss_send: Any) -> None:
        """设置/更新 WSS 发送函数"""
        self._wss_send = wss_send

    async def report(self, event: EdgeEvent) -> bool:
        """上报一个事件"""
        event_id = f"{event.event_type}:{event.platform}:{event.account_id}:{event.timestamp}"
        if event_id in self._reported_ids:
            self._stats["deduped"] += 1
            return False
        self._reported_ids.add(event_id)

        if len(self._reported_ids) > 5000:
            self._reported_ids = set(list(self._reported_ids)[-2500:])

        if self._wss_send:
            try:
                message = {"type": "edge_event", "payload": event.to_dict()}
                await self._wss_send(json.dumps(message, ensure_ascii=False))
                self._stats["sent"] += 1
                return True
            except Exception:  # noqa: BLE001
                pass

        self._queue.append(event)
        self._stats["queued"] += 1
        return False

    async def flush_queue(self) -> int:
        """批量上报缓存中的事件"""
        if not self._wss_send or not self._queue:
            return 0

        sent = 0
        while self._queue:
            event = self._queue.popleft()
            try:
                message = {"type": "edge_event_batch", "payload": event.to_dict()}
                await self._wss_send(json.dumps(message, ensure_ascii=False))
                sent += 1
            except Exception:  # noqa: BLE001
                self._queue.appendleft(event)
                break

        self._stats["sent"] += sent
        return sent

    def describe(self) -> dict[str, Any]:
        return {
            "queue_size": len(self._queue),
            "stats": dict(self._stats),
            "wss_connected": self._wss_send is not None,
        }
