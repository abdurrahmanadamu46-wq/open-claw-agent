"""
WSS Receiver — Edge Runtime Socket.IO Client

Connects to the cloud control plane's fleet gateway, receives
execute_task / execute_behavior_session / terminal_* commands,
and dispatches them to the local executor pipeline.

Architecture boundary: executor-only.
It NEVER makes strategy decisions or calls LLMs.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlparse

from backup_manager import EdgeBackupManager
from content_publisher import ContentPublisher
from edge_auth import EdgeAuthManager
from edge_mcp_server import edge_mcp_server
from edge_meta_cache import CachedLobsterConfig, CachedPendingTask, CachedSkillRegistry, get_edge_cache
from edge_scheduler import EdgeScheduler
from publish_scheduler import PublishScheduler
from jobs.log_cleanup_job import make_log_cleanup_job
from jobs.memory_sync_job import make_memory_sync_job
from jobs.task_check_job import make_task_check_job
from memory_store import EdgeMemoryStore
from security_audit import EdgeSecurityAudit
from security_audit import install_dlp_log_filter
from security_audit import report_dlp_alert
from security_audit import scan_text
from terminal_bridge import TerminalBridge
import httpx

try:
    import socketio  # type: ignore[import-untyped]
except Exception:  # noqa: BLE001
    socketio = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class WSSReceiver:
    """Socket.IO client for fleet task, terminal dispatch, and edge cron."""

    def __init__(
        self,
        gateway_url: str,
        node_id: str,
        edge_secret: str,
        tenant_id: str = "",
        heartbeat_interval_sec: float = 15.0,
        reconnect_delay_sec: float = 5.0,
        max_reconnect_delay_sec: float = 60.0,
        memory_store: EdgeMemoryStore | None = None,
    ) -> None:
        self.gateway_url = gateway_url.rstrip("/")
        self.node_id = node_id
        self.edge_secret = edge_secret
        self.tenant_id = tenant_id
        self.auth_manager = EdgeAuthManager(node_id=node_id, secret_key=edge_secret, tenant_id=tenant_id)
        self.heartbeat_interval_sec = heartbeat_interval_sec
        self.reconnect_delay_sec = reconnect_delay_sec
        self.max_reconnect_delay_sec = max_reconnect_delay_sec

        self._task_handler: Optional[Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]] = None
        self._behavior_handler: Optional[Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]] = None
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

        self._client: Any = None
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._terminal_tasks: dict[str, asyncio.Task[None]] = {}
        self._scheduler_initialized = False

        self.memory = memory_store or EdgeMemoryStore()
        self.meta_cache = get_edge_cache()
        self.terminal_bridge = TerminalBridge()
        self.scheduler = EdgeScheduler(edge_node_id=node_id)
        self.content_publisher = ContentPublisher(
            result_reporter=self._report_publish_result,
            quota_reporter=self._report_publish_quota,
        )
        self.publish_scheduler = PublishScheduler(
            publish_handler=self.content_publisher.execute_publish_task,
        )
        self.backup_manager = EdgeBackupManager()
        self.workspace_dir = self.backup_manager.openclaw_home
        self.edge_mcp_server = edge_mcp_server
        self.runtime_params: dict[str, Any] = {
            "max_concurrent_tasks": int(os.getenv("EDGE_MAX_CONCURRENT_TASKS", "3") or 3),
            "log_level": str(os.getenv("EDGE_LOG_LEVEL", "INFO") or "INFO").upper(),
            "feature_flags": {},
        }
        self.scheduler.set_sop_executor(self._execute_sop_payload)
        self.scheduler.set_execution_log_reporter(self.report_execution_logs)
        self.scheduler.set_sync_requester(self._request_sop_sync)
        install_dlp_log_filter()

    def on_task(self, handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]) -> None:
        self._task_handler = handler

    def on_behavior_session(self, handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]) -> None:
        self._behavior_handler = handler

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def stats(self) -> dict[str, Any]:
        return dict(self._stats)

    def is_connected(self) -> bool:
        return self._connected

    @property
    def last_heartbeat_at(self) -> datetime | None:
        raw = self._stats.get("last_heartbeat_at")
        if not raw:
            return None
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return None

    async def run(self) -> None:
        await self.connect()

    async def connect(self) -> None:
        if socketio is None:
            raise RuntimeError("python-socketio is required for WSSReceiver")

        await self._ensure_scheduler_started()
        self._should_run = True
        delay = self.reconnect_delay_sec
        while self._should_run:
            client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
            self._register_handlers(client)
            self._client = client

            try:
                await client.connect(
                    self._normalize_base_url(self.gateway_url),
                    socketio_path=self._resolve_socketio_path(self.gateway_url),
                    transports=["websocket"],
                    auth=self.auth_manager.generate_socket_auth(include_legacy_secret=True),
                )
                delay = self.reconnect_delay_sec
                await client.wait()
            except asyncio.CancelledError:
                self._should_run = False
                if client.connected:
                    await client.disconnect()
                raise
            except Exception:
                self._stats["reconnects"] += 1
                self._connected = False
                await self._stop_all_terminal_sessions()
                if self._heartbeat_task:
                    self._heartbeat_task.cancel()
                    self._heartbeat_task = None
                if not self._should_run:
                    break
                await asyncio.sleep(delay)
                delay = min(self.max_reconnect_delay_sec, delay * 2)
            finally:
                self._connected = False

    async def stop(self) -> None:
        self._should_run = False
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        await self._stop_all_terminal_sessions()
        if self._client and getattr(self._client, "connected", False):
            await self._client.disconnect()
        await self.scheduler.stop()
        await self.publish_scheduler.stop()

    async def send(self, raw_message: str) -> None:
        """Best-effort send compatible with EventReporter."""
        if not self._client or not self._connected:
            return
        try:
            data = json.loads(raw_message)
        except Exception:
            await self._client.emit("edge_message", {"raw": raw_message})
            return

        if "event" in data and "data" in data:
            await self._client.emit(str(data["event"]), data["data"])
            return
        if "type" in data:
            await self._client.emit(str(data["type"]), data.get("payload"))
            return
        await self._client.emit("edge_message", data)

    def _register_handlers(self, client: Any) -> None:
        @client.event
        async def connect() -> None:
            self._connected = True
            self._stats["connected_since"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            await self._emit_node_ping()
            await self._emit_tool_manifest()
            await self._flush_completed_meta_tasks()
            await self._check_restore_complete()
            await self.scheduler.on_reconnect()
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        @client.event
        async def disconnect() -> None:
            self._connected = False
            await self._stop_all_terminal_sessions()
            if self._heartbeat_task:
                self._heartbeat_task.cancel()
                self._heartbeat_task = None

        @client.on("execute_task")
        async def on_execute_task(payload: dict[str, Any]) -> None:
            await self._handle_task(client, payload or {})

        @client.on("server.task.dispatch")
        async def on_legacy_task(payload: dict[str, Any]) -> None:
            mapped = {
                "taskId": payload.get("task_id") or payload.get("job_id"),
                "traceId": payload.get("trace_id"),
                "campaignId": payload.get("campaign_id"),
                "actionType": payload.get("action"),
                "params": payload.get("config") or {},
                "createdAt": payload.get("created_at"),
            }
            await self._handle_task(client, mapped)

        @client.on("execute_behavior_session")
        async def on_behavior_session(payload: dict[str, Any]) -> None:
            await self._handle_behavior_session(client, payload or {})

        @client.on("terminal_start")
        async def on_terminal_start(payload: dict[str, Any]) -> None:
            await self._handle_terminal_start(client, payload or {})

        @client.on("terminal_command")
        async def on_terminal_command(payload: dict[str, Any]) -> None:
            await self._handle_terminal_command(client, payload or {})

        @client.on("terminal_stop")
        async def on_terminal_stop(payload: dict[str, Any]) -> None:
            await self._handle_terminal_stop(client, payload or {})

        @client.on("scheduler_status_request")
        async def on_scheduler_status_request(payload: dict[str, Any]) -> None:
            await self._handle_scheduler_status_request(payload or {})

        @client.on("scheduler_toggle_request")
        async def on_scheduler_toggle_request(payload: dict[str, Any]) -> None:
            await self._handle_scheduler_toggle_request(payload or {})

        @client.on("backup_trigger")
        async def on_backup_trigger(payload: dict[str, Any]) -> None:
            await self._handle_backup_trigger(payload or {})

        @client.on("backup_list")
        async def on_backup_list(payload: dict[str, Any]) -> None:
            await self._handle_backup_list(payload or {})

        @client.on("backup_restore")
        async def on_backup_restore(payload: dict[str, Any]) -> None:
            await self._handle_backup_restore(payload or {})

        @client.on("security_audit_trigger")
        async def on_security_audit_trigger(payload: dict[str, Any]) -> None:
            await self._handle_security_audit_trigger(payload or {})

        @client.on("security_baseline_rebuild")
        async def on_security_baseline_rebuild(payload: dict[str, Any]) -> None:
            await self._handle_security_baseline_rebuild(payload or {})

        @client.on("mcp_tool_call")
        async def on_mcp_tool_call(payload: dict[str, Any]) -> None:
            await self._handle_mcp_tool_call(payload or {})

        @client.on("get_tool_manifest")
        async def on_get_tool_manifest(payload: dict[str, Any]) -> None:
            await self._handle_get_tool_manifest(payload or {})

        @client.on("publish_task")
        async def on_publish_task(payload: dict[str, Any]) -> None:
            await self._handle_publish_task(payload or {})

        @client.on("publish_batch")
        async def on_publish_batch(payload: dict[str, Any]) -> None:
            await self._handle_publish_batch(payload or {})

        @client.on("batch_delivery")
        async def on_batch_delivery(payload: dict[str, Any]) -> None:
            await self._handle_batch_delivery(payload or {})

        @client.on("sop_schedule_sync")
        async def on_sop_schedule_sync(payload: dict[str, Any]) -> None:
            await self._handle_sop_schedule_sync(payload or {})

        @client.on("sop_schedule_remove")
        async def on_sop_schedule_remove(payload: dict[str, Any]) -> None:
            await self._handle_sop_schedule_remove(payload or {})

    def _build_ping_payload(self) -> dict[str, Any]:
        cpu_percent = 0.0
        memory_percent = 0.0
        memory_usage_mb = 0
        try:
            import psutil  # type: ignore[import-untyped]

            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            memory_usage_mb = int(memory.used / (1024 * 1024))
        except Exception:
            pass
        cache_snapshot = self.meta_cache.snapshot()

        return {
            "nodeId": self.node_id,
            "tenantId": self.tenant_id,
            "status": "BUSY" if self._current_task_id else "IDLE",
            "currentTaskId": self._current_task_id or "",
            "cpuPercent": round(cpu_percent, 1),
            "memoryPercent": round(memory_percent, 1),
            "platforms": ["xiaohongshu", "douyin"],
            "version": "1.0.0-edge",
            "lobsterConfigs": cache_snapshot.get("config_versions", {}),
            "skillVersions": cache_snapshot.get("skill_versions", {}),
            "pendingTaskCount": int(cache_snapshot.get("pending_task_count", 0) or 0),
            "runningTaskCount": int(cache_snapshot.get("running_task_count", 0) or 0),
            "maxConcurrentTasks": int(self.runtime_params.get("max_concurrent_tasks", 3) or 3),
            "logLevel": str(self.runtime_params.get("log_level", "INFO") or "INFO"),
            "metaCacheStatus": str(cache_snapshot.get("meta_cache_status", "cold") or "cold"),
            "edgeVersion": "1.0.0-edge",
            "reportedResourceVersion": int(cache_snapshot.get("desired_resource_version") or 0),
            "memoryUsageMb": memory_usage_mb,
            "configVersionSummary": ",".join(
                f"{k}:{v}" for k, v in sorted((cache_snapshot.get("config_versions") or {}).items())
            )[:500],
            "skillVersionSummary": ",".join(
                f"{k}:{v}" for k, v in sorted((cache_snapshot.get("skill_versions") or {}).items())
            )[:500],
            "guardianModules": (
                getattr(self, "guardian_status_provider", lambda: {})().get("modules", {})
                if callable(getattr(self, "guardian_status_provider", None))
                else {}
            ),
        }

    async def _heartbeat_loop(self) -> None:
        try:
            while self._connected and self._client:
                await asyncio.sleep(self.heartbeat_interval_sec)
                await self._emit_node_ping()
        except asyncio.CancelledError:
            return

    async def _emit_node_ping(self) -> None:
        payload = self._build_ping_payload()
        if self._client and self._connected:
            self._stats["last_heartbeat_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            await self._client.emit("node_ping", payload)
        await self._post_http_heartbeat(payload)

    async def _emit_tool_manifest(self, session_id: str = "") -> None:
        if not self._client or not self._connected:
            return
        await self._client.emit(
            "tool_manifest",
            {
                "session_id": session_id,
                "node_id": self.node_id,
                "tenant_id": self.tenant_id,
                "tools": self.edge_mcp_server.get_tool_manifest(),
                "timestamp": _utc_now(),
            },
        )

    async def _emit_terminal_output(
        self,
        session_id: str,
        data: str,
        *,
        command: str | None = None,
    ) -> None:
        if not self._client or not self._connected:
            return
        scan_result = scan_text(data, source="terminal_output")
        if scan_result.has_leakage:
            await report_dlp_alert(scan_result, edge_node_id=self.node_id, tenant_id=self.tenant_id or "tenant_main")
        await self._client.emit(
            "terminal_output",
            {
                "session_id": session_id,
                "node_id": self.node_id,
                "command": command,
                "data": data,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
        )

    async def _emit_terminal_error(self, session_id: str, message: str) -> None:
        if not self._client or not self._connected:
            return
        await self._client.emit(
            "terminal_error",
            {
                "session_id": session_id,
                "node_id": self.node_id,
                "message": message,
            },
        )

    async def _emit_terminal_closed(self, session_id: str, reason: str = "stopped") -> None:
        if not self._client or not self._connected:
            return
        await self._client.emit(
            "terminal_closed",
            {
                "session_id": session_id,
                "node_id": self.node_id,
                "reason": reason,
            },
        )

    async def _send_progress(
        self,
        transport: Any,
        task_id: str,
        progress: float,
        message: str,
        step: str = "",
    ) -> None:
        payload = {
            "taskId": task_id,
            "nodeId": self.node_id,
            "progress": min(100, max(0, progress)),
            "message": message,
            "step": step,
        }
        if self._client and self._connected:
            await self._client.emit("task_progress", payload)
            return
        if transport and hasattr(transport, "send"):
            await transport.send(json.dumps({"event": "task_progress", "data": payload}))

    async def _send_completed(
        self,
        transport: Any,
        task_id: str,
        success: bool,
        result: Optional[dict[str, Any]] = None,
        error: str = "",
    ) -> None:
        payload = {
            "taskId": task_id,
            "nodeId": self.node_id,
            "success": success,
            "result": result or {},
            "error": error,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if self._client and self._connected:
            await self._client.emit("task_completed", payload)
            return
        if transport and hasattr(transport, "send"):
            await transport.send(json.dumps({"event": "task_completed", "data": payload}))

    async def _handle_task(self, transport: Any, payload: dict[str, Any]) -> None:
        task_id = str(payload.get("taskId") or payload.get("task_id") or "").strip()
        if not task_id:
            return
        action_type = str(payload.get("actionType") or payload.get("action") or "").strip().upper()

        if action_type == "SYNC_CONFIG":
            await self._handle_sync_config_task(payload, transport=transport)
            return

        self.meta_cache.enqueue_task(
            CachedPendingTask(
                task_id=task_id,
                workflow_id=str(payload.get("workflowId") or payload.get("workflow_id") or "workflow").strip() or "workflow",
                step_id=str(payload.get("stepId") or payload.get("step_id") or action_type.lower() or "step").strip() or "step",
                lobster_id=str(payload.get("lobsterId") or payload.get("lobster_id") or "edge").strip() or "edge",
                skill_name=str(payload.get("skillName") or payload.get("skill_name") or action_type.lower() or "task").strip() or "task",
                payload_json=json.dumps(payload, ensure_ascii=False),
                priority=int(payload.get("priority") or 5),
            )
        )

        scheduled_at = self._extract_scheduled_at(payload)
        if scheduled_at and self._is_future_schedule(scheduled_at):
            await self._store_scheduled_task(task_id, scheduled_at, payload)
            await self._send_progress(
                transport,
                task_id,
                5,
                f"Task scheduled locally for {scheduled_at}",
                step="scheduled_locally",
            )
            return

        await self._execute_task_payload(payload, transport=transport)

    async def _handle_publish_task(self, payload: dict[str, Any]) -> None:
        task = self.content_publisher.from_payload(payload)
        if task.scheduled_at and self._is_future_schedule(task.scheduled_at):
            await self.publish_scheduler.schedule_publish(task)
            return
        await self.content_publisher.execute_publish_task(task)

    async def _handle_publish_batch(self, payload: dict[str, Any]) -> None:
        raw_tasks = payload.get("tasks") or (payload.get("payload") or {}).get("tasks") or []
        tasks = [self.content_publisher.from_payload(item) for item in raw_tasks if isinstance(item, dict)]
        if not tasks:
            return
        await self.publish_scheduler.schedule_batch(tasks)

    async def _handle_sop_schedule_sync(self, payload: dict[str, Any]) -> None:
        schedule = payload.get("schedule") if isinstance(payload.get("schedule"), dict) else payload
        if not isinstance(schedule, dict):
            return
        await self.scheduler.sync_sop_from_cloud(schedule)

    async def _handle_sop_schedule_remove(self, payload: dict[str, Any]) -> None:
        job_id = str(payload.get("job_id") or payload.get("id") or "").strip()
        if not job_id:
            return
        await self.scheduler.remove_sop(job_id)

    async def _execute_task_payload(self, payload: dict[str, Any], *, transport: Any = None) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or payload.get("task_id") or "").strip()
        if not task_id:
            return {"success": False, "error": "missing_task_id"}

        self._current_task_id = task_id
        self._stats["tasks_received"] += 1
        self.meta_cache.mark_task_running(task_id)

        try:
            await self._send_progress(transport, task_id, 10, "Task received, starting execution")
            if self._task_handler:
                result = await self._task_handler(payload)
                await self._send_completed(transport, task_id, True, result)
                self.meta_cache.mark_task_completed(task_id, result, cloud_synced=bool(self._client and self._connected))
                self._stats["tasks_completed"] += 1
                return {"success": True, "result": result}
            await self._send_completed(transport, task_id, False, error="no_task_handler_registered")
            self.meta_cache.mark_task_failed(
                task_id,
                "no_task_handler_registered",
                cloud_synced=bool(self._client and self._connected),
            )
            self._stats["tasks_failed"] += 1
            return {"success": False, "error": "no_task_handler_registered"}
        except Exception as exc:  # noqa: BLE001
            await self._send_completed(transport, task_id, False, error=str(exc)[:500])
            self.meta_cache.mark_task_failed(
                task_id,
                str(exc)[:500],
                cloud_synced=bool(self._client and self._connected),
            )
            self._stats["tasks_failed"] += 1
            raise
        finally:
            self._current_task_id = None

    async def _execute_scheduled_task(self, task: dict[str, Any]) -> None:
        payload = dict(task.get("payload") or {})
        if "taskId" not in payload and task.get("task_id"):
            payload["taskId"] = task["task_id"]
        await self._execute_task_payload(payload)

    async def _execute_sop_payload(self, payload: dict[str, Any], job_id: str) -> dict[str, Any]:
        packet = dict(payload or {})
        if "taskId" not in packet and "task_id" not in packet:
            packet["taskId"] = job_id
        return await self._execute_task_payload(packet)

    async def _handle_batch_delivery(self, payload: dict[str, Any]) -> None:
        items = payload.get("items") or []
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            outbox_id = str(item.get("outbox_id") or "").strip()
            msg_type = str(item.get("msg_type") or "").strip().lower()
            packet = item.get("payload") or item
            try:
                if msg_type == "publish_batch":
                    await self._handle_publish_batch(packet if isinstance(packet, dict) else {})
                elif msg_type == "publish_task":
                    await self._handle_publish_task(packet if isinstance(packet, dict) else {})
                elif msg_type == "otp_code":
                    await self.memory.remember(
                        tenant_id=self.tenant_id or "tenant_main",
                        lobster_id="edge_runtime",
                        category="otp_code",
                        key=f"otp_{int(time.time())}",
                        value=json.dumps(packet or {}, ensure_ascii=False),
                        metadata={"outbox_id": outbox_id},
                    )
                else:
                    await self._execute_task_payload(packet if isinstance(packet, dict) else {}, transport=None)
            finally:
                if outbox_id:
                    await self._ack_outbox_item(outbox_id)

    async def _handle_behavior_session(self, _client: Any, payload: dict[str, Any]) -> None:
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

    async def _handle_terminal_start(self, _client: Any, payload: dict[str, Any]) -> None:
        session_id = str(payload.get("session_id") or "").strip()
        if not session_id:
            return
        await self.terminal_bridge.stop_session(session_id)
        await self._emit_terminal_output(
            session_id,
            "[INFO] 边缘终端会话已建立，可执行 status / ps / disk / mem / tasks / log\n",
        )

    async def _handle_terminal_command(self, _client: Any, payload: dict[str, Any]) -> None:
        session_id = str(payload.get("session_id") or "").strip()
        command = str(payload.get("command") or "").strip().lower()
        if not session_id or not command:
            return

        if command == "log":
            existing = self._terminal_tasks.get(session_id)
            if existing and not existing.done():
                await self._emit_terminal_output(session_id, "[INFO] 日志流已在跟随中\n", command=command)
                return
            task = asyncio.create_task(self._stream_terminal_logs(session_id))
            self._terminal_tasks[session_id] = task
            await self._emit_terminal_output(session_id, "[INFO] 正在启动实时日志流...\n", command=command)
            return

        output = await self.terminal_bridge.execute_safe_command(command)
        await self._emit_terminal_output(session_id, output, command=command)

    async def _handle_terminal_stop(self, _client: Any, payload: dict[str, Any]) -> None:
        session_id = str(payload.get("session_id") or "").strip()
        if not session_id:
            return
        await self._stop_terminal_session(session_id, reason="stopped")

    async def _handle_scheduler_status_request(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        session_id = str(payload.get("session_id") or "").strip()
        jobs = self.scheduler.get_status()
        heartbeat_next = max(
            0,
            int(
                self.heartbeat_interval_sec
                - (
                    (
                        datetime.now(timezone.utc)
                        - datetime.fromisoformat(self._stats["last_heartbeat_at"].replace("Z", "+00:00"))
                    ).total_seconds()
                    if self._stats["last_heartbeat_at"]
                    else 0
                )
            ),
        )
        jobs.insert(
            0,
            {
                "name": "heartbeat",
                "description": "native node_ping heartbeat",
                "interval_seconds": int(self.heartbeat_interval_sec),
                "enabled": True,
                "running": False,
                "last_run": self._stats["last_heartbeat_at"],
                "run_count": 0,
                "error_count": 0,
                "next_run_in": heartbeat_next,
            },
        )
        scheduled = await self.memory.list_scheduled_tasks(limit=100)
        await self._client.emit(
            "scheduler_status_response",
            {
                "session_id": session_id,
                "jobs": jobs,
                "scheduled_tasks": scheduled,
            },
        )

    async def _handle_scheduler_toggle_request(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        session_id = str(payload.get("session_id") or "").strip()
        job_name = str(payload.get("job_name") or "").strip()
        enabled = bool(payload.get("enabled", True))
        success = False
        message = "unknown job"
        if job_name == "heartbeat":
            success = False
            message = "heartbeat is managed by native WSSReceiver loop"
        elif job_name in self.scheduler.jobs:
            if enabled:
                self.scheduler.enable_job(job_name)
            else:
                self.scheduler.disable_job(job_name)
            success = True
            message = "updated"
        await self._client.emit(
            "scheduler_toggle_response",
            {
                "session_id": session_id,
                "job_name": job_name,
                "enabled": enabled,
                "success": success,
                "message": message,
            },
        )

    async def _handle_backup_trigger(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        session_id = str(payload.get("session_id") or "").strip()
        output_dir = payload.get("output_dir")
        result = await asyncio.to_thread(self.backup_manager.backup, output_dir)
        await self._client.emit(
            "backup_complete",
            {
                "session_id": session_id,
                "success": bool(result.get("success")),
                "archive": result.get("archive"),
                "output": result.get("output"),
                "backup_name": result.get("backup_name"),
                "size_bytes": result.get("size_bytes"),
            },
        )

    async def _handle_backup_list(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        session_id = str(payload.get("session_id") or "").strip()
        directory = payload.get("dir") or payload.get("backup_dir")
        backups = await asyncio.to_thread(self.backup_manager.list_backups, directory, 20)
        await self._client.emit(
            "backup_list_response",
            {
                "session_id": session_id,
                "backups": backups,
            },
        )

    async def _handle_backup_restore(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        session_id = str(payload.get("session_id") or "").strip()
        filename = str(payload.get("filename") or "").strip()
        dry_run = bool(payload.get("dry_run", True))
        result = await asyncio.to_thread(self.backup_manager.restore, filename, dry_run)
        await self._client.emit(
            "backup_restore_response",
            {
                "session_id": session_id,
                "dry_run": dry_run,
                "success": bool(result.get("success")),
                "output": result.get("output"),
                "manifest": result.get("manifest"),
            },
        )

    async def _handle_security_audit_trigger(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        session_id = str(payload.get("session_id") or "").strip()
        result = await self._run_security_audit(session_id=session_id)
        await self._client.emit("security_audit_report", result)

    async def _handle_security_baseline_rebuild(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        session_id = str(payload.get("session_id") or "").strip()
        baseline_type = str(payload.get("baseline_type") or payload.get("type") or "all").strip().lower() or "all"
        audit = self._make_security_audit()
        rebuilt: dict[str, Any] = {"credential": None, "sop": None}
        if baseline_type in {"credential", "all"}:
            rebuilt["credential"] = audit.rebuild_credential_baseline()
        if baseline_type in {"sop", "all"}:
            rebuilt["sop"] = audit.rebuild_sop_baseline()
        await self._client.emit(
            "security_baseline_rebuild_response",
            {
                "session_id": session_id,
                "baseline_type": baseline_type,
                "rebuilt": rebuilt,
                "success": True,
                "timestamp": _utc_now(),
            },
        )

    async def _handle_mcp_tool_call(self, payload: dict[str, Any]) -> None:
        if not self._client or not self._connected:
            return
        response = await self.edge_mcp_server.handle_tool_call(payload)
        response["node_id"] = self.node_id
        response["tenant_id"] = self.tenant_id
        response["timestamp"] = _utc_now()
        await self._client.emit("mcp_tool_result", response)

    async def _handle_get_tool_manifest(self, payload: dict[str, Any]) -> None:
        await self._emit_tool_manifest(str(payload.get("session_id") or "").strip())

    async def _check_restore_complete(self) -> None:
        if not self._client or not self._connected:
            return
        payload = await asyncio.to_thread(self.backup_manager.check_restore_complete)
        if not payload:
            return
        await self._client.emit(
            "restore_complete_report",
            {
                **payload,
                "node_id": self.node_id,
                "tenant_id": self.tenant_id,
            },
        )

    def _make_security_audit(self) -> EdgeSecurityAudit:
        return EdgeSecurityAudit(
            node_id=self.node_id,
            workspace_dir=Path(self.workspace_dir),
            wss_client=self,
            task_queue=None,
            memory_store=self.memory,
        )

    async def _run_security_audit(self, *, session_id: str = "") -> dict[str, Any]:
        audit = self._make_security_audit()
        result = await audit.run_full_audit()
        return {
            **result,
            "type": "security_audit_report",
            "session_id": session_id,
            "node_id": self.node_id,
            "tenant_id": self.tenant_id,
        }

    async def _stream_terminal_logs(self, session_id: str) -> None:
        try:
            async for chunk in self.terminal_bridge.stream_logs(session_id):
                await self._emit_terminal_output(session_id, chunk, command="log")
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            await self._emit_terminal_error(session_id, f"日志流异常: {exc}")

    async def _stop_terminal_session(self, session_id: str, reason: str = "stopped") -> None:
        task = self._terminal_tasks.pop(session_id, None)
        await self.terminal_bridge.stop_session(session_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        await self._emit_terminal_closed(session_id, reason=reason)

    async def _stop_all_terminal_sessions(self) -> None:
        session_ids = list(self._terminal_tasks.keys())
        for session_id in session_ids:
            task = self._terminal_tasks.pop(session_id, None)
            await self.terminal_bridge.stop_session(session_id)
            if task and not task.done():
                task.cancel()
        self._terminal_tasks.clear()

    async def _ensure_scheduler_started(self) -> None:
        if self._scheduler_initialized:
            return
        self._init_scheduler()
        await self.scheduler.start()
        await self.publish_scheduler.start()
        self._scheduler_initialized = True

    def _init_scheduler(self) -> None:
        self.scheduler.register_job(
            name="memory_sync",
            interval_seconds=3600,
            handler=make_memory_sync_job(self.memory, self._sync_memories_to_cloud),
            description="边缘记忆增量同步",
        )
        self.scheduler.register_job(
            name="log_cleanup",
            interval_seconds=86400,
            handler=make_log_cleanup_job(),
            description="清理旧日志文件",
        )
        self.scheduler.register_job(
            name="task_check",
            interval_seconds=60,
            handler=make_task_check_job(self.memory, self._execute_scheduled_task),
            description="检查并执行到期定时任务",
        )
        self.scheduler.register_job(
            name="security_audit",
            interval_seconds=3600,
            handler=self._run_scheduled_security_audit,
            description="每日安全巡检调度器",
        )

    async def _sync_memories_to_cloud(self, memories: list[dict[str, Any]]) -> dict[str, Any]:
        if not self._client or not self._connected:
            return {"success": False, "error": "not_connected"}
        try:
            response = await self._client.call(
                "edge_memory_sync_batch",
                {
                    "node_id": self.node_id,
                    "tenant_id": self.tenant_id,
                    "items": memories,
                },
                timeout=10,
            )
            if isinstance(response, dict):
                if bool(response.get("success", True)):
                    (Path(self.workspace_dir) / ".last_sync_timestamp").write_text(_utc_now(), encoding="utf-8")
                return response
            (Path(self.workspace_dir) / ".last_sync_timestamp").write_text(_utc_now(), encoding="utf-8")
            return {"success": True}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": str(exc)}

    async def _run_scheduled_security_audit(self) -> None:
        marker = Path(self.workspace_dir) / ".last_security_audit_date"
        today = datetime.now().strftime("%Y-%m-%d")
        last_run = marker.read_text(encoding="utf-8").strip() if marker.exists() else ""
        if last_run == today:
            return
        result = await self._run_security_audit()
        if self._client and self._connected:
            await self._client.emit("security_audit_report", result)

    async def _handle_sync_config_task(self, payload: dict[str, Any], *, transport: Any = None) -> dict[str, Any]:
        task_id = str(payload.get("taskId") or payload.get("task_id") or f"sync-{int(time.time())}").strip()
        params = payload.get("params") or payload.get("config") or {}
        twin_sync = params.get("twin_sync") if isinstance(params, dict) else None
        sync_payload = twin_sync if isinstance(twin_sync, dict) else params if isinstance(params, dict) else {}

        self.meta_cache.enqueue_task(
            CachedPendingTask(
                task_id=task_id,
                workflow_id="device_twin",
                step_id="sync_config",
                lobster_id="edge_runtime",
                skill_name="sync_config",
                payload_json=json.dumps(payload, ensure_ascii=False),
                priority=10,
            )
        )
        self.meta_cache.mark_task_running(task_id)

        for update in sync_payload.get("config_updates", []):
            self.meta_cache.save_lobster_config(
                CachedLobsterConfig(
                    lobster_id=str(update.get("lobster_id") or "unknown"),
                    config_version=str(update.get("desired") or update.get("version") or "unknown"),
                    config_json=json.dumps(update.get("config_data") or {}, ensure_ascii=False),
                    synced_at=time.time(),
                )
            )

        for update in sync_payload.get("skill_updates", []):
            self.meta_cache.save_skill_registry(
                CachedSkillRegistry(
                    lobster_id=str(update.get("lobster_id") or "unknown"),
                    registry_version=str(update.get("desired") or update.get("version") or "unknown"),
                    skills_json=json.dumps(update.get("skills") or [], ensure_ascii=False),
                    synced_at=time.time(),
                )
            )

        for key, value in (sync_payload.get("param_updates") or {}).items():
            if key in {"max_concurrent_tasks", "log_level", "feature_flags"}:
                self.runtime_params[key] = value

        if sync_payload.get("resource_version") is not None:
            self.meta_cache.set_sync_meta("desired_resource_version", str(sync_payload.get("resource_version")))

        result = {
            "sync_applied": True,
            "config_updates": len(sync_payload.get("config_updates", [])),
            "skill_updates": len(sync_payload.get("skill_updates", [])),
            "resource_version": sync_payload.get("resource_version"),
        }
        await self._send_completed(transport, task_id, True, result)
        self.meta_cache.mark_task_completed(task_id, result, cloud_synced=bool(self._client and self._connected))
        await self._emit_node_ping()
        return result

    async def _store_scheduled_task(self, task_id: str, scheduled_at: str, payload: dict[str, Any]) -> None:
        packet = payload.get("packet") or payload.get("payload") or payload
        tenant_id = str(
            payload.get("tenant_id")
            or payload.get("tenantId")
            or packet.get("tenant_id")
            or packet.get("tenantId")
            or self.tenant_id
            or "tenant_main"
        ).strip()
        lobster_id = str(
            payload.get("lobster_id")
            or payload.get("lobsterId")
            or packet.get("lobster_id")
            or packet.get("lobsterId")
            or "edge_runtime"
        ).strip()
        await self.memory.schedule_task(
            task_id=task_id,
            tenant_id=tenant_id or "tenant_main",
            lobster_id=lobster_id or "edge_runtime",
            scheduled_at=scheduled_at,
            payload=payload,
        )

    def _extract_scheduled_at(self, payload: dict[str, Any]) -> str | None:
        packet = payload.get("packet") or payload.get("payload") or payload
        candidate = (
            payload.get("scheduledAt")
            or payload.get("scheduled_at")
            or payload.get("publish_time")
            or packet.get("scheduledAt")
            or packet.get("scheduled_at")
            or packet.get("publish_time")
            or packet.get("publishTime")
        )
        normalized = str(candidate or "").strip()
        return normalized or None

    async def _report_publish_result(self, payload: dict[str, Any]) -> None:
        if self._client and self._connected:
            await self._client.emit("publish_result", payload)

    async def _report_publish_quota(self, payload: dict[str, Any]) -> None:
        if self._client and self._connected:
            await self._client.emit("publish_quota_consume", payload)

    async def report_execution_logs(self, logs: list[dict[str, Any]]) -> None:
        if self._client and self._connected and logs:
            await self._client.emit(
                "edge_execution_logs",
                {
                    "node_id": self.node_id,
                    "tenant_id": self.tenant_id,
                    "logs": logs,
                    "timestamp": _utc_now(),
                },
            )

    async def report_execution_snapshot(self, snapshot: dict[str, Any]) -> None:
        payload = {
            **dict(snapshot or {}),
            "node_id": str((snapshot or {}).get("node_id") or self.node_id),
            "tenant_id": str((snapshot or {}).get("tenant_id") or self.tenant_id or "tenant_main"),
            "timestamp": _utc_now(),
        }
        if self._client and self._connected:
            try:
                await self._client.emit("execution_snapshot_report", payload)
            except Exception:
                pass
        await self._post_http_snapshot_report(payload)

    async def _request_sop_sync(self) -> None:
        if self._client and self._connected:
            await self._client.emit(
                "request_sop_sync",
                {
                    "node_id": self.node_id,
                    "tenant_id": self.tenant_id,
                    "timestamp": _utc_now(),
                },
            )

    def _is_future_schedule(self, scheduled_at: str) -> bool:
        try:
            parsed = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        now = datetime.now(parsed.tzinfo or timezone.utc)
        return (parsed - now).total_seconds() > 3

    def describe(self) -> dict[str, Any]:
        return {
            "gateway_url": self.gateway_url,
            "node_id": self.node_id,
            "connected": self._connected,
            "stats": dict(self._stats),
            "platform": platform.system(),
            "scheduler": self.scheduler.get_status(),
        }

    def _normalize_base_url(self, raw_url: str) -> str:
        parsed = urlparse(raw_url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
        return raw_url.rstrip("/")

    def _http_base_url(self) -> str:
        parsed = urlparse(self.gateway_url)
        if not parsed.scheme or not parsed.netloc:
            return ""
        scheme = parsed.scheme
        if scheme == "ws":
            scheme = "http"
        elif scheme == "wss":
            scheme = "https"
        return f"{scheme}://{parsed.netloc}"

    async def _post_http_heartbeat(self, payload: dict[str, Any]) -> None:
        base_url = self._http_base_url()
        if not base_url:
            return
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.post(
                    f"{base_url}/edge/heartbeat",
                    json={
                        "edge_id": self.node_id,
                        "user_id": self.tenant_id or None,
                        "status": str(payload.get("status") or "online").lower(),
                        "cpu_percent": float(payload.get("cpuPercent") or 0.0),
                        "memory_percent": float(payload.get("memoryPercent") or 0.0),
                        "memory_usage_mb": int(payload.get("memoryUsageMb") or 0),
                        "lobster_configs": payload.get("lobsterConfigs") or {},
                        "skill_versions": payload.get("skillVersions") or {},
                        "pending_task_count": int(payload.get("pendingTaskCount") or 0),
                        "running_task_count": int(payload.get("runningTaskCount") or 0),
                        "max_concurrent_tasks": int(payload.get("maxConcurrentTasks") or 0),
                        "log_level": str(payload.get("logLevel") or "INFO"),
                        "meta_cache_status": str(payload.get("metaCacheStatus") or "cold"),
                        "edge_version": str(payload.get("edgeVersion") or "1.0.0-edge"),
                        "reported_resource_version": int(payload.get("reportedResourceVersion") or 0),
                    },
                    headers=self.auth_manager.generate_auth_header(include_legacy_secret=True),
                )
            data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            sync_payload = ((data or {}).get("twin") or {}).get("sync_payload")
            if isinstance(sync_payload, dict) and sync_payload:
                await self._handle_sync_config_task(
                    {
                        "taskId": f"twin-sync-{int(time.time())}",
                        "actionType": "SYNC_CONFIG",
                        "params": {"twin_sync": sync_payload},
                    }
                )
        except Exception:
            return

    async def _ack_outbox_item(self, outbox_id: str) -> None:
        normalized = str(outbox_id or "").strip()
        if not normalized:
            return
        if self._client and self._connected:
            try:
                await self._client.emit(
                    "edge_outbox_ack",
                    {
                        "outbox_id": normalized,
                        "node_id": self.node_id,
                        "tenant_id": self.tenant_id,
                        "timestamp": _utc_now(),
                    },
                )
            except Exception:
                pass
        await self._post_http_outbox_ack(normalized)

    async def _post_http_outbox_ack(self, outbox_id: str) -> None:
        base_url = self._http_base_url()
        if not base_url:
            return
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                await client.post(
                    f"{base_url}/edge/ack/{outbox_id}",
                    json={"edge_id": self.node_id},
                    headers=self.auth_manager.generate_auth_header(include_legacy_secret=True),
                )
        except Exception:
            return

    async def _post_http_snapshot_report(self, payload: dict[str, Any]) -> None:
        base_url = self._http_base_url()
        if not base_url:
            return
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    f"{base_url}/edge/snapshots/report",
                    json=payload,
                    headers=self.auth_manager.generate_auth_header(include_legacy_secret=True),
                )
        except Exception:
            return

    async def _flush_completed_meta_tasks(self) -> None:
        if not self._client or not self._connected:
            return
        for task in self.meta_cache.list_unsynced_finished_tasks(limit=100):
            try:
                result = json.loads(task.result_json or "{}") if task.result_json else {}
                success = task.status == "completed"
                await self._client.emit(
                    "task_completed",
                    {
                        "taskId": task.task_id,
                        "nodeId": self.node_id,
                        "success": success,
                        "result": result if success else {},
                        "error": "" if success else str(result.get("error") or "cached_failure"),
                        "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(task.completed_at or time.time())),
                    },
                )
                self.meta_cache.mark_task_synced(task.task_id)
            except Exception:
                continue

    def _resolve_socketio_path(self, raw_url: str) -> str:
        parsed = urlparse(raw_url)
        path = parsed.path.strip("/")
        if not path:
            return "fleet"
        if path.endswith("socket.io"):
            return path
        return path
