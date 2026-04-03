"""
Edge local MCP server over the existing fleet websocket channel.
"""

from __future__ import annotations

import asyncio
import base64
import inspect
import io
import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any
from typing import Awaitable
from typing import Callable


logger = logging.getLogger("edge_mcp_server")

EDGE_LOCAL_TOOLS: dict[str, dict[str, Any]] = {}


def edge_tool(name: str, description: str = "") -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        EDGE_LOCAL_TOOLS[name] = {
            "fn": func,
            "description": description,
            "name": name,
        }
        return func
    return decorator


def _schema_from_signature(fn: Callable[..., Any]) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    required: list[str] = []
    signature = inspect.signature(fn)
    for name, parameter in signature.parameters.items():
        properties[name] = {"type": "string"}
        if parameter.default is inspect._empty:
            required.append(name)
    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


@edge_tool("edge_file_read", "读取边缘节点本地文件")
async def edge_file_read(path: str, encoding: str = "utf-8", max_chars: int = 50000) -> dict[str, Any]:
    file_path = Path(path).expanduser()
    if not file_path.exists():
        return {"success": False, "error": f"file_not_found: {file_path}"}

    def _read() -> str:
        return file_path.read_text(encoding=encoding, errors="replace")

    content = await asyncio.to_thread(_read)
    return {"success": True, "path": str(file_path), "content": content[:max_chars]}


@edge_tool("edge_local_db_query", "查询边缘节点本地 SQLite 数据库")
async def edge_local_db_query(db_path: str, sql: str, limit: int = 200) -> dict[str, Any]:
    db_file = Path(db_path).expanduser()
    if not db_file.exists():
        return {"success": False, "error": f"db_not_found: {db_file}"}

    def _query() -> dict[str, Any]:
        conn = sqlite3.connect(str(db_file))
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.execute(sql)
            rows = cursor.fetchmany(max(1, min(limit, 500)))
            columns = [description[0] for description in cursor.description] if cursor.description else []
            return {
                "success": True,
                "columns": columns,
                "rows": [dict(row) for row in rows],
                "count": len(rows),
            }
        finally:
            conn.close()

    return await asyncio.to_thread(_query)


@edge_tool("edge_browser_screenshot", "抓取边缘节点屏幕截图或浏览器可见截图")
async def edge_browser_screenshot() -> dict[str, Any]:
    try:
        from PIL import ImageGrab  # type: ignore

        def _capture() -> str:
            image = ImageGrab.grab()
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return base64.b64encode(buffer.getvalue()).decode("utf-8")

        encoded = await asyncio.to_thread(_capture)
        return {"success": True, "image_base64": encoded}
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": f"screenshot_unavailable: {exc}"}


class EdgeMcpServer:
    def __init__(self) -> None:
        self.tools = EDGE_LOCAL_TOOLS

    def get_tool_manifest(self) -> list[dict[str, Any]]:
        manifest: list[dict[str, Any]] = []
        for tool in self.tools.values():
            manifest.append(
                {
                    "name": tool["name"],
                    "description": tool["description"],
                    "input_schema": _schema_from_signature(tool["fn"]),
                }
            )
        return manifest

    async def handle_tool_call(self, message: dict[str, Any]) -> dict[str, Any]:
        tool_name = str(message.get("tool") or "").strip()
        params = message.get("params") or {}
        call_id = str(message.get("call_id") or "").strip()
        start = time.time()
        if tool_name not in self.tools:
            return {
                "type": "mcp_tool_result",
                "call_id": call_id,
                "result": {"success": False, "error": f"unknown_tool: {tool_name}"},
            }

        fn = self.tools[tool_name]["fn"]
        try:
            if inspect.iscoroutinefunction(fn):
                result = await fn(**params)
            else:
                result = await asyncio.to_thread(fn, **params)
            latency_ms = int((time.time() - start) * 1000)
            logger.info("[EdgeMCP] tool=%s latency=%sms", tool_name, latency_ms)
            return {
                "type": "mcp_tool_result",
                "call_id": call_id,
                "tool": tool_name,
                "latency_ms": latency_ms,
                "result": result,
            }
        except Exception as exc:  # noqa: BLE001
            latency_ms = int((time.time() - start) * 1000)
            logger.warning("[EdgeMCP] tool=%s failed latency=%sms err=%s", tool_name, latency_ms, exc)
            return {
                "type": "mcp_tool_result",
                "call_id": call_id,
                "tool": tool_name,
                "latency_ms": latency_ms,
                "result": {"success": False, "error": str(exc)},
            }


edge_mcp_server = EdgeMcpServer()
