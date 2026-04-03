"""
lifecycle_manager.py — 边缘节点本地生命周期管理器

跟踪边缘节点自身的运行状态（启动中/在线/忙碌/出错/下线），
配合 edge_heartbeat.py 向云端同步状态，保证任务调度可靠性。

状态机:
    STARTING → ONLINE → BUSY → ONLINE (完成任务)
                      ↘ ERROR → ONLINE (自愈)
    ANY → OFFLINE (关机/网络断开)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

logger = logging.getLogger("edge.lifecycle")


class NodeState(str, Enum):
    STARTING = "starting"   # 初始化中
    ONLINE = "online"       # 空闲，准备接收任务
    BUSY = "busy"           # 任务执行中
    ERROR = "error"         # 出错，等待自愈或人工介入
    OFFLINE = "offline"     # 已下线


@dataclass
class LifecycleEvent:
    """生命周期变更事件（用于审计和上报）"""
    node_id: str
    old_state: str
    new_state: str
    reason: str = ""
    task_id: str = ""
    error: str = ""
    ts: float = field(default_factory=time.time)


class EdgeLifecycleManager:
    """
    边缘节点生命周期状态机。

    - 每次任务开始/结束/出错时更新状态
    - 可注册状态变更回调（用于向云端推送心跳）
    - 线程安全（使用简单的 Python GIL 保证）
    """

    def __init__(self, node_id: str) -> None:
        self.node_id = node_id
        self._state = NodeState.STARTING
        self._generation = 0          # 单调递增，防止过期操作
        self._current_task_id: str | None = None
        self._error_count = 0
        self._run_count = 0
        self._started_at = time.time()
        self._last_transition_at = time.time()
        self._history: list[LifecycleEvent] = []
        self._callbacks: list[Callable[[LifecycleEvent], None]] = []

    # ── 状态读取 ─────────────────────────────────────────────────

    @property
    def state(self) -> NodeState:
        return self._state

    @property
    def generation(self) -> int:
        return self._generation

    @property
    def is_available(self) -> bool:
        return self._state == NodeState.ONLINE

    @property
    def current_task_id(self) -> str | None:
        return self._current_task_id

    def summary(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "state": self._state.value,
            "generation": self._generation,
            "run_count": self._run_count,
            "error_count": self._error_count,
            "current_task_id": self._current_task_id,
            "uptime_seconds": round(time.time() - self._started_at, 1),
            "last_transition_at": self._last_transition_at,
        }

    # ── 状态转换 ─────────────────────────────────────────────────

    def mark_online(self, reason: str = "ready") -> None:
        """节点就绪，可接收任务。"""
        self._transition(NodeState.ONLINE, reason=reason)
        self._current_task_id = None

    def mark_busy(self, task_id: str) -> None:
        """开始执行任务。"""
        if self._state not in (NodeState.ONLINE, NodeState.STARTING):
            logger.warning("[%s] mark_busy called in state %s", self.node_id, self._state)
        self._current_task_id = task_id
        self._run_count += 1
        self._transition(NodeState.BUSY, task_id=task_id, reason="task_started")

    def mark_done(self) -> None:
        """任务完成，回到在线状态。"""
        self._transition(NodeState.ONLINE, task_id=self._current_task_id or "", reason="task_done")
        self._current_task_id = None

    def mark_error(self, error: str, task_id: str = "") -> None:
        """任务出错。"""
        self._error_count += 1
        self._transition(
            NodeState.ERROR,
            task_id=task_id or self._current_task_id or "",
            error=error,
            reason="task_error",
        )

    def recover(self) -> None:
        """从错误中自愈（重试限流后调用）。"""
        if self._state == NodeState.ERROR:
            self._transition(NodeState.ONLINE, reason="recovered")
            self._current_task_id = None

    def mark_offline(self, reason: str = "shutdown") -> None:
        """节点下线。"""
        self._transition(NodeState.OFFLINE, reason=reason)

    # ── 回调注册 ─────────────────────────────────────────────────

    def on_transition(self, callback: Callable[[LifecycleEvent], None]) -> None:
        """注册状态变更回调（用于心跳上报、日志记录等）。"""
        self._callbacks.append(callback)

    # ── 私有辅助 ─────────────────────────────────────────────────

    def _transition(
        self,
        new_state: NodeState,
        reason: str = "",
        task_id: str = "",
        error: str = "",
    ) -> None:
        old_state = self._state
        self._state = new_state
        self._generation += 1
        self._last_transition_at = time.time()

        event = LifecycleEvent(
            node_id=self.node_id,
            old_state=old_state.value,
            new_state=new_state.value,
            reason=reason,
            task_id=task_id,
            error=error,
        )
        self._history.append(event)
        if len(self._history) > 200:
            self._history = self._history[-200:]

        logger.info(
            "[%s] %s → %s (reason=%s, task=%s)",
            self.node_id, old_state.value, new_state.value, reason, task_id or "-",
        )
        if error:
            logger.error("[%s] error: %s", self.node_id, error)

        for cb in self._callbacks:
            try:
                cb(event)
            except Exception as exc:
                logger.warning("Lifecycle callback error: %s", exc)

    def recent_events(self, n: int = 20) -> list[dict[str, Any]]:
        """返回最近 n 条状态变更记录（用于调试/运维面板）。"""
        return [
            {
                "node_id": e.node_id,
                "old_state": e.old_state,
                "new_state": e.new_state,
                "reason": e.reason,
                "task_id": e.task_id,
                "error": e.error,
                "ts": e.ts,
            }
            for e in self._history[-n:]
        ]


# ── 模块级单例 ────────────────────────────────────────────────────

import os as _os

_manager: EdgeLifecycleManager | None = None


def get_lifecycle_manager(node_id: str | None = None) -> EdgeLifecycleManager:
    global _manager
    if _manager is None:
        _nid = node_id or _os.getenv("EDGE_NODE_ID", "edge-local")
        _manager = EdgeLifecycleManager(_nid)
    return _manager
