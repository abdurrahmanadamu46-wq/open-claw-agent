"""
EventWatcher — 边缘客户端事件监控器
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Awaitable, Callable


@dataclass(slots=True)
class EdgeEvent:
    """边缘上报事件的统一格式"""

    event_type: str
    platform: str
    account_id: str
    timestamp: float = 0.0
    data: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.time()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


class EventWatcher:
    """
    事件监控器 — 在边缘客户端运行
    """

    def __init__(self, on_event: Callable[[EdgeEvent], Awaitable[None]] | None = None) -> None:
        self._watches: list[dict[str, Any]] = []
        self._running: bool = False
        self._on_event = on_event
        self._snapshots: dict[str, Any] = {}

    def add_watch(
        self,
        platform: str,
        account_id: str,
        *,
        watch_type: str = "comments",
        interval: int = 30,
        page_url: str = "",
    ) -> None:
        """添加一个监控项"""
        self._watches.append(
            {
                "platform": platform,
                "account_id": account_id,
                "watch_type": watch_type,
                "interval": interval,
                "page_url": page_url,
                "last_check": 0.0,
            }
        )

    def remove_watch(self, platform: str, account_id: str, watch_type: str = "") -> int:
        """移除监控项，返回移除的数量"""
        before = len(self._watches)
        self._watches = [
            w
            for w in self._watches
            if not (
                w["platform"] == platform
                and w["account_id"] == account_id
                and (not watch_type or w["watch_type"] == watch_type)
            )
        ]
        return before - len(self._watches)

    async def start(self) -> None:
        """启动监控循环"""
        self._running = True
        print(f"[event_watcher] 启动监控，{len(self._watches)} 个监控项")
        while self._running:
            now = time.time()
            for watch in self._watches:
                if now - watch["last_check"] >= watch["interval"]:
                    watch["last_check"] = now
                    try:
                        await self._check_watch(watch)
                    except Exception as exc:  # noqa: BLE001
                        print(f"[event_watcher] 检查失败 {watch['platform']}/{watch['watch_type']}: {exc}")
            await asyncio.sleep(1)

    def stop(self) -> None:
        """停止监控"""
        self._running = False
        print("[event_watcher] 停止监控")

    async def _check_watch(self, watch: dict[str, Any]) -> None:
        """检查单个监控项（框架预留，具体检查逻辑由 Marionette Executor 执行）"""
        _ = f"{watch['platform']}:{watch['account_id']}:{watch['watch_type']}"
        # 实际页面解析逻辑后续通过 context_navigator + marionette_executor 实现。
        if self._on_event and False:
            await self._on_event(
                EdgeEvent(
                    event_type=f"{watch['watch_type']}_event",
                    platform=watch["platform"],
                    account_id=watch["account_id"],
                    data={},
                )
            )

    def describe(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "watches": len(self._watches),
            "details": [
                {
                    "platform": w["platform"],
                    "account": w["account_id"],
                    "type": w["watch_type"],
                    "interval": w["interval"],
                }
                for w in self._watches
            ],
        }
