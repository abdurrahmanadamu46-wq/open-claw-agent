"""
MCP Gateway for lobster runtime.

Supports stdio and HTTP/SSE-style MCP servers, server registration,
tool discovery, tool invocation, audit logging, and health tracking.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from mcp_tool_monitor import get_mcp_tool_monitor
from mcp_tool_policy import tool_policy_enforcer

logger = logging.getLogger("mcp_gateway")

REPO_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = REPO_ROOT / "config" / "mcp_servers.json"
DB_PATH = REPO_ROOT / "data" / "mcp_gateway.sqlite"
TOOLS_CACHE_TTL_SEC = 300.0
HEALTH_CHECK_INTERVAL_SEC = 60.0


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask_env(env: dict[str, str]) -> dict[str, str]:
    masked: dict[str, str] = {}
    for key, value in env.items():
        text = str(value or "")
        masked[key] = f"{text[:3]}****{text[-3:]}" if len(text) > 8 else "****"
    return masked


def _safe_json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)


@dataclass
class MCPServerConfig:
    id: str
    name: str
    transport: str
    command: str | None = None
    url: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    enabled: bool = True
    created_at: str = field(default_factory=_utc_now)
    last_ping: str | None = None
    status: str = "unknown"
    allowed_lobsters: list[str] = field(default_factory=list)
    edge_node_id: str | None = None

    def to_dict(self, *, redact_env: bool = False) -> dict[str, Any]:
        payload = asdict(self)
        payload["env"] = _mask_env(self.env) if redact_env else dict(self.env)
        return payload


@dataclass
class MCPToolSchema:
    server_id: str
    tool_name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class MCPGateway:
    _instance: "MCPGateway | None" = None

    def __init__(self) -> None:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._servers: dict[str, MCPServerConfig] = {}
        self._tool_cache: dict[str, tuple[float, list[MCPToolSchema]]] = {}
        self._stdio_sessions: dict[str, dict[str, Any]] = {}
        self._health_task: asyncio.Task[None] | None = None
        self._running = False
        self._tool_monitor = get_mcp_tool_monitor()
        self._load_servers()
        self._ensure_schema()

    @classmethod
    def get_instance(cls) -> "MCPGateway":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def start(self) -> None:
        if self._health_task is None or self._health_task.done():
            self._running = True
            self._health_task = asyncio.create_task(self._health_loop(), name="mcp-gateway-health")

    async def stop(self) -> None:
        self._running = False
        if self._health_task and not self._health_task.done():
            self._health_task.cancel()
            try:
                await self._health_task
            except asyncio.CancelledError:
                pass
        self._health_task = None
        for server_id in list(self._stdio_sessions.keys()):
            await self._close_stdio_session(server_id)

    def _ensure_schema(self) -> None:
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mcp_call_history (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL DEFAULT 'tenant_main',
                    lobster_id TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    args_summary TEXT NOT NULL,
                    result_summary TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            cols = {str(row[1]) for row in conn.execute("PRAGMA table_info(mcp_call_history)").fetchall()}
            if "tenant_id" not in cols:
                conn.execute("ALTER TABLE mcp_call_history ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_main'")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_mcp_history_created ON mcp_call_history(created_at DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_mcp_history_tenant_created ON mcp_call_history(tenant_id, created_at DESC)"
            )
            conn.commit()
        finally:
            conn.close()

    def _load_servers(self) -> None:
        if not CONFIG_PATH.exists():
            self._servers = {}
            return
        payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
        self._servers = {}
        for item in list(payload.get("servers") or []):
            try:
                config = MCPServerConfig(**item)
            except TypeError:
                continue
            self._servers[config.id] = config

    def _persist_servers(self) -> None:
        CONFIG_PATH.write_text(
            _safe_json_dumps({"servers": [server.to_dict() for server in self._servers.values()]}),
            encoding="utf-8",
        )

    def register_server(self, config: MCPServerConfig) -> None:
        self._servers[config.id] = config
        self._persist_servers()
        self._tool_cache.pop(config.id, None)

    def unregister_server(self, server_id: str) -> None:
        self._servers.pop(server_id, None)
        self._tool_cache.pop(server_id, None)
        self._persist_servers()

    def update_server(self, server_id: str, patch: dict[str, Any]) -> MCPServerConfig | None:
        server = self._servers.get(server_id)
        if server is None:
            return None
        for key in ("name", "transport", "command", "url", "enabled", "status", "last_ping", "allowed_lobsters", "edge_node_id"):
            if key in patch:
                setattr(server, key, patch[key])
        if "env" in patch and isinstance(patch["env"], dict):
            server.env = {str(k): str(v) for k, v in patch["env"].items()}
        self._persist_servers()
        self._tool_cache.pop(server_id, None)
        return server

    def list_servers(self) -> list[dict[str, Any]]:
        return [server.to_dict(redact_env=True) for server in sorted(self._servers.values(), key=lambda item: item.created_at)]

    async def discover_tools(self, server_id: str) -> list[dict[str, Any]]:
        cached = self._tool_cache.get(server_id)
        if cached and cached[0] > time.time():
            return [tool.to_dict() for tool in cached[1]]

        server = self._servers.get(server_id)
        if server is None:
            return []

        try:
            response = await self._rpc_request(server, "tools/list", {})
            tools = self._normalize_tools(server.id, response)
            self._tool_cache[server_id] = (time.time() + TOOLS_CACHE_TTL_SEC, tools)
            server.status = "healthy"
            server.last_ping = _utc_now()
            self._persist_servers()
            return [tool.to_dict() for tool in tools]
        except Exception as exc:  # noqa: BLE001
            logger.warning("MCP discover_tools failed for %s: %s", server_id, exc)
            server.status = "unavailable"
            server.last_ping = _utc_now()
            self._persist_servers()
            return []

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        args: dict[str, Any],
        lobster_id: str,
        tenant_id: str = "tenant_main",
        session_id: str = "",
    ) -> dict[str, Any]:
        server = self._servers.get(server_id)
        if server is None:
            return {"ok": False, "error": {"code": "server_not_found", "message": f"MCP server {server_id} not found"}}
        if not server.enabled:
            return {"ok": False, "error": {"code": "server_disabled", "message": f"MCP server {server_id} is disabled"}}
        if server.allowed_lobsters and lobster_id not in server.allowed_lobsters and lobster_id not in {"admin", "system", "manual_test"}:
            return {"ok": False, "error": {"code": "forbidden", "message": f"{lobster_id} cannot call {server_id}"}}

        allowed, deny_reason = tool_policy_enforcer.check(
            lobster_name=lobster_id,
            tool_name=tool_name,
            tenant_id=tenant_id,
            session_id=session_id,
        )
        if not allowed:
            self._tool_monitor.record_denied_call(
                lobster_name=lobster_id,
                tool_name=tool_name,
                tenant_id=tenant_id,
                server_id=server_id,
                reason=deny_reason,
            )
            await self._record_call(
                tenant_id=tenant_id,
                lobster_id=lobster_id,
                server_id=server_id,
                tool_name=tool_name,
                args=args,
                result={"ok": False, "error": {"code": "tool_call_denied", "message": deny_reason}},
                duration_ms=0,
                status="denied",
                error_message=deny_reason,
            )
            return {"ok": False, "error": {"code": "tool_call_denied", "message": deny_reason}}

        started = time.monotonic()
        status = "success"
        result_payload: Any = {}
        error_message = ""
        token = self._tool_monitor.start_call(lobster_id, tool_name, tenant_id, server_id=server_id)
        try:
            result_payload = await self._rpc_request(
                server,
                "tools/call",
                {"name": tool_name, "arguments": args},
            )
            server.status = "healthy"
        except Exception as exc:  # noqa: BLE001
            status = "error"
            error_message = str(exc)
            result_payload = {"ok": False, "error": {"code": "mcp_call_failed", "message": str(exc)}}
            server.status = "unavailable"
        finally:
            self._tool_monitor.end_call(
                token,
                success=status == "success",
                error=error_message or None,
                params_hash=hashlib.sha1(_safe_json_dumps(args).encode("utf-8")).hexdigest()[:12],
            )

        server.last_ping = _utc_now()
        self._persist_servers()
        duration_ms = int((time.monotonic() - started) * 1000)
        await self._record_call(
            tenant_id=tenant_id,
            lobster_id=lobster_id,
            server_id=server_id,
            tool_name=tool_name,
            args=args,
            result=result_payload,
            duration_ms=duration_ms,
            status=status,
            error_message=error_message,
        )
        if status == "error":
            return result_payload
        return {"ok": True, "result": result_payload}

    async def health_check(self, server_id: str) -> bool:
        server = self._servers.get(server_id)
        if server is None:
            return False
        try:
            await self._rpc_request(server, "tools/list", {})
            server.status = "healthy"
            server.last_ping = _utc_now()
            self._persist_servers()
            return True
        except Exception:
            server.status = "unavailable"
            server.last_ping = _utc_now()
            self._persist_servers()
            return False

    def list_call_history(self, limit: int = 100, tenant_id: str | None = None) -> list[dict[str, Any]]:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            if tenant_id:
                rows = conn.execute(
                    "SELECT * FROM mcp_call_history WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?",
                    (tenant_id, max(1, min(int(limit), 500))),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM mcp_call_history ORDER BY created_at DESC LIMIT ?",
                    (max(1, min(int(limit), 500)),),
                ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_monitor_top_tools(self, limit: int = 10, tenant_id: str | None = None) -> list[dict[str, Any]]:
        return self._tool_monitor.get_top_tools(limit=limit, tenant_id=tenant_id)

    def get_monitor_heatmap(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        return self._tool_monitor.get_lobster_heatmap(tenant_id=tenant_id)

    def get_monitor_failures(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        return self._tool_monitor.get_failure_rates(tenant_id=tenant_id)

    def get_monitor_recent(self, limit: int = 50, tenant_id: str | None = None) -> list[dict[str, Any]]:
        return self._tool_monitor.get_recent_calls(limit=limit, tenant_id=tenant_id)

    async def _health_loop(self) -> None:
        while self._running:
            try:
                for server_id, server in list(self._servers.items()):
                    if not server.enabled:
                        continue
                    await self.health_check(server_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("MCP health loop error: %s", exc)
            await asyncio.sleep(HEALTH_CHECK_INTERVAL_SEC)

    async def _record_call(
        self,
        *,
        tenant_id: str,
        lobster_id: str,
        server_id: str,
        tool_name: str,
        args: dict[str, Any],
        result: Any,
        duration_ms: int,
        status: str,
        error_message: str = "",
    ) -> None:
        record_id = f"mcp_{uuid.uuid4().hex[:12]}"
        args_summary = _safe_json_dumps(args)[:500]
        result_summary = _safe_json_dumps(result)[:500]

        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                """
                INSERT INTO mcp_call_history (
                    id, tenant_id, lobster_id, server_id, tool_name, args_summary,
                    result_summary, duration_ms, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record_id,
                    tenant_id,
                    lobster_id,
                    server_id,
                    tool_name,
                    args_summary,
                    result_summary,
                    duration_ms,
                    status,
                    _utc_now(),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        try:
            from audit_logger import record_audit_log

            await record_audit_log(
                tenant_id=tenant_id,
                user_id=lobster_id,
                operator=lobster_id,
                action="mcp_tool_call_denied" if status == "denied" else "mcp_tool_call",
                category="tooling",
                resource_type="mcp_server",
                resource_id=server_id,
                summary=f"{lobster_id} -> {server_id}.{tool_name}",
                detail={
                    "tool_name": tool_name,
                    "args_summary": args_summary,
                    "result_summary": result_summary,
                    "duration_ms": duration_ms,
                    "status": status,
                },
                result=status,
                error_message=error_message or None,
                source="mcp_gateway",
                trace_id=record_id,
            )
        except Exception:
            pass

        try:
            from llm_call_logger import get_llm_call_logger

            logger_client = get_llm_call_logger()
            trace_id = logger_client.start_trace(
                workflow_run_id=record_id,
                workflow_name="mcp_tool_call",
                tenant_id=tenant_id,
                meta={"lobster_id": lobster_id, "server_id": server_id, "tool_name": tool_name},
            )
            span_id = logger_client.start_span(
                trace_id=trace_id,
                lobster=lobster_id,
                skill=f"mcp:{server_id}",
                tenant_id=tenant_id,
            )
            logger_client.record_generation(
                trace_id=trace_id,
                span_id=span_id,
                tenant_id=tenant_id,
                model=f"mcp:{server_id}/{tool_name}",
                provider="mcp",
                input_text=args_summary,
                output_text=result_summary,
                latency_ms=duration_ms,
                status=status,
                error_message=error_message,
            )
            logger_client.end_span(span_id, status=status, latency_ms=duration_ms)
            logger_client.end_trace(trace_id, status=status)
        except Exception:
            pass

    async def _rpc_request(self, server: MCPServerConfig, method: str, params: dict[str, Any]) -> Any:
        if server.transport == "stdio":
            return await self._stdio_request(server, method, params)
        if server.transport == "sse":
            return await self._http_request(server, method, params)
        raise RuntimeError(f"unsupported transport: {server.transport}")

    async def _http_request(self, server: MCPServerConfig, method: str, params: dict[str, Any]) -> Any:
        if not server.url:
            raise RuntimeError("missing server url")
        payload = {"jsonrpc": "2.0", "id": uuid.uuid4().hex, "method": method, "params": params}
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(server.url, json=payload, headers=server.env or {})
            response.raise_for_status()
            data = response.json()
        if "error" in data:
            raise RuntimeError(str(data["error"]))
        return data.get("result", data)

    async def _stdio_request(self, server: MCPServerConfig, method: str, params: dict[str, Any]) -> Any:
        session = await self._ensure_stdio_session(server)
        lock: asyncio.Lock = session["lock"]
        async with lock:
            if not session["initialized"]:
                await self._initialize_stdio_session(server, session)
            request_id = uuid.uuid4().hex
            await self._write_framed_json(session["process"].stdin, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            response = await self._read_framed_json(session["process"].stdout)
            if "error" in response:
                raise RuntimeError(str(response["error"]))
            return response.get("result", response)

    async def _ensure_stdio_session(self, server: MCPServerConfig) -> dict[str, Any]:
        current = self._stdio_sessions.get(server.id)
        if current and current["process"].returncode is None:
            return current
        if not server.command:
            raise RuntimeError("missing stdio command")
        process = await asyncio.create_subprocess_shell(
            server.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, **server.env},
        )
        session = {"process": process, "initialized": False, "lock": asyncio.Lock()}
        self._stdio_sessions[server.id] = session
        return session

    async def _initialize_stdio_session(self, server: MCPServerConfig, session: dict[str, Any]) -> None:
        init_id = uuid.uuid4().hex
        await self._write_framed_json(
            session["process"].stdin,
            {
                "jsonrpc": "2.0",
                "id": init_id,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "lobsterpit-mcp-gateway", "version": "1.0.0"},
                },
            },
        )
        response = await self._read_framed_json(session["process"].stdout)
        if "error" in response:
            raise RuntimeError(str(response["error"]))
        await self._write_framed_json(
            session["process"].stdin,
            {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        )
        session["initialized"] = True

    async def _close_stdio_session(self, server_id: str) -> None:
        session = self._stdio_sessions.pop(server_id, None)
        if not session:
            return
        process = session.get("process")
        if process and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=3.0)
            except Exception:
                process.kill()

    async def _write_framed_json(self, stream: asyncio.StreamWriter | Any, payload: dict[str, Any]) -> None:
        body = _safe_json_dumps(payload).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("utf-8")
        stream.write(header + body)
        await stream.drain()

    async def _read_framed_json(self, stream: Any) -> dict[str, Any]:
        headers = b""
        while b"\r\n\r\n" not in headers:
            chunk = await stream.read(1)
            if not chunk:
                raise RuntimeError("stdio stream closed")
            headers += chunk
        header_text = headers.decode("utf-8", errors="replace")
        content_length = 0
        for line in header_text.split("\r\n"):
            if line.lower().startswith("content-length:"):
                content_length = int(line.split(":", 1)[1].strip())
                break
        if content_length <= 0:
            raise RuntimeError("invalid content-length")
        body = await stream.readexactly(content_length)
        return json.loads(body.decode("utf-8"))

    def _normalize_tools(self, server_id: str, payload: Any) -> list[MCPToolSchema]:
        tools_raw = []
        if isinstance(payload, dict):
            tools_raw = list(payload.get("tools") or payload.get("items") or [])
        elif isinstance(payload, list):
            tools_raw = payload
        tools: list[MCPToolSchema] = []
        for item in tools_raw:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("tool_name") or "").strip()
            if not name:
                continue
            tools.append(
                MCPToolSchema(
                    server_id=server_id,
                    tool_name=name,
                    description=str(item.get("description") or ""),
                    input_schema=dict(item.get("inputSchema") or item.get("input_schema") or {}),
                )
            )
        return tools


def get_mcp_gateway() -> MCPGateway:
    return MCPGateway.get_instance()
