"""
WSS Receiver — Edge Runtime WebSocket Client
Connects to the cloud control plane's Fleet WebSocket Gateway,
receives execute_task / execute_behavior_session commands,
and dispatches them to the local executor pipeline.

Architecture boundary: this module is executor-only.
It NEVER makes strategy decisions or calls LLMs.
"""
import asyncio
import json
import time
import platform
from typing import Any, Callable, Awaitable, Optional


class WSSReceiver:
    """
    WebSocket client that connects to the fleet gateway,
    maintains heartbeat, receives SOP packets, and dispatches
    them to registered handlers.
    """

    def __init__(
        self,
        gateway_url: str,
        node_id: str,
        edge_secret: str,
        tenant_id: str = "",
        heartbeat_interval_sec: float = 15.0,
        reconnect_delay_sec: float = 5.0,
        max_reconnect_delay_sec: float = 60.0,
    ):
        self.gateway_url = gateway_url.rstrip("/")
        self.node_id = node_id
        self.edge_secret = edge_secret
        self.tenant_id = tenant_id
        self.heartbeat_interval_sec = heartbeat_interval_sec
        self.reconnect_delay_sec = reconnect_delay_sec
        self.max_reconnect_delay_sec = max_reconnect_delay_sec

        self._task_handler: Optional[Callable[[dict], Awaitable[dict]]] = None
        self._behavior_handler: Optional[Callable[[dict], Awaitable[dict]]] = None
        self.doctor_status_provider: Optional[Callable[[], dict[str, Any]]] = None
        self._connected = False
        self._should_run = False
        self._current_task_id: Optional[str] = None
        self._stats: dict[str, Any] = {
            "tasks_received": 0,
            "tasks_completed": 0,
            "tasks_failed": 0,
            "reconnects": 0,
            "last_heartbeat_at": None,
            "connected_since": None,
        }

    def on_task(self, handler: Callable[[dict], Awaitable[dict]]) -> None:
        """Register handler for execute_task events."""
        self._task_handler = handler

    def on_behavior_session(self, handler: Callable[[dict], Awaitable[dict]]) -> None:
        """Register handler for execute_behavior_session events."""
        self._behavior_handler = handler

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def stats(self) -> dict[str, Any]:
        return dict(self._stats)

    def _build_ping_payload(self) -> dict[str, Any]:
        """Build node_ping heartbeat payload with system metrics."""
        cpu_percent = 0.0
        memory_percent = 0.0
        try:
            import psutil  # type: ignore[import-untyped]

            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory_percent = psutil.virtual_memory().percent
        except Exception:
            pass

        return {
            "nodeId": self.node_id,
            "tenantId": self.tenant_id,
            "status": "BUSY" if self._current_task_id else "IDLE",
            "currentTaskId": self._current_task_id or "",
            "cpuPercent": round(cpu_percent, 1),
            "memoryPercent": round(memory_percent, 1),
            "platforms": ["xiaohongshu", "douyin"],
            "version": "1.0.0-edge",
            "doctor": self.doctor_status_provider() if self.doctor_status_provider else {},
        }

    async def _send_progress(
        self, ws: Any, task_id: str, progress: float, message: str, step: str = ""
    ) -> None:
        """Send task_progress event to cloud."""
        payload = {
            "taskId": task_id,
            "nodeId": self.node_id,
            "progress": min(100, max(0, progress)),
            "message": message,
            "step": step,
        }
        try:
            await ws.send(json.dumps({"event": "task_progress", "data": payload}))
        except Exception:
            pass

    async def _send_completed(
        self,
        ws: Any,
        task_id: str,
        success: bool,
        result: Optional[dict[str, Any]] = None,
        error: str = "",
    ) -> None:
        """Send task_completed event to cloud."""
        payload = {
            "taskId": task_id,
            "nodeId": self.node_id,
            "success": success,
            "result": result or {},
            "error": error,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        try:
            await ws.send(json.dumps({"event": "task_completed", "data": payload}))
        except Exception:
            pass

    async def _task_heartbeat_loop(
        self, ws: Any, task_id: str, interval_sec: float = 30.0
    ) -> None:
        """Background coroutine: emit task_progress heartbeats while a task runs.

        The cloud-side HeartbeatMonitor marks tasks as *stalled* if no heartbeat
        arrives within its timeout window (default 90 s).  This loop fires every
        `interval_sec` (default 30 s) so the cloud always sees a live signal even
        for long-running publish / browser-SOP tasks.
        """
        elapsed = 0
        while True:
            await asyncio.sleep(interval_sec)
            elapsed += interval_sec
            try:
                await self._send_progress(
                    ws,
                    task_id,
                    progress=min(90, 10 + int(elapsed)),
                    message=f"task alive — {int(elapsed)}s elapsed",
                    step="heartbeat",
                )
            except Exception:
                break  # ws gone; the main handler will catch the real error

    async def _handle_task(self, ws: Any, payload: dict[str, Any]) -> None:
        """Handle incoming execute_task.

        Runs the registered task handler inside a concurrent heartbeat loop so the
        cloud never mistakes a long-running publish job for a stalled/offline edge.
        """
        task_id = str(payload.get("taskId") or payload.get("task_id") or "").strip()
        if not task_id:
            return
        self._current_task_id = task_id
        self._stats["tasks_received"] += 1

        # Start background heartbeat loop (cancelled once handler finishes)
        hb_task = asyncio.ensure_future(
            self._task_heartbeat_loop(ws, task_id, interval_sec=30.0)
        )
        try:
            await self._send_progress(ws, task_id, 10, "Task received, starting execution")
            if self._task_handler:
                result = await self._task_handler(payload)
                await self._send_completed(ws, task_id, True, result)
                self._stats["tasks_completed"] += 1
            else:
                await self._send_completed(
                    ws, task_id, False, error="no_task_handler_registered"
                )
                self._stats["tasks_failed"] += 1
        except Exception as exc:
            await self._send_completed(ws, task_id, False, error=str(exc)[:500])
            self._stats["tasks_failed"] += 1
        finally:
            hb_task.cancel()
            try:
                await hb_task
            except asyncio.CancelledError:
                pass
            self._current_task_id = None

    async def _handle_behavior_session(self, ws: Any, payload: dict[str, Any]) -> None:
        """Handle incoming execute_behavior_session."""
        session_id = str(payload.get("session_id") or "").strip()
        if not session_id:
            return
        self._current_task_id = f"behavior:{session_id}"
        self._stats["tasks_received"] += 1

        try:
            if self._behavior_handler:
                await self._behavior_handler(payload)
                self._stats["tasks_completed"] += 1
            else:
                self._stats["tasks_failed"] += 1
        except Exception:
            self._stats["tasks_failed"] += 1
        finally:
            self._current_task_id = None

    def describe(self) -> dict[str, Any]:
        """Return receiver status for diagnostics."""
        return {
            "gateway_url": self.gateway_url,
            "node_id": self.node_id,
            "connected": self._connected,
            "stats": dict(self._stats),
            "platform": platform.system(),
            "doctor": self.doctor_status_provider() if self.doctor_status_provider else {},
        }
