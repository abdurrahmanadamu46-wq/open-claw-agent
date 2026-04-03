"""Tests for MCP gateway."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import mcp_gateway  # noqa: E402


class MCPGatewayTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.config_path = Path(self.tmpdir.name) / "mcp_servers.json"
        self.db_path = Path(self.tmpdir.name) / "mcp.sqlite"
        mcp_gateway.CONFIG_PATH = self.config_path
        mcp_gateway.DB_PATH = self.db_path
        self.gateway = mcp_gateway.MCPGateway()
        self.gateway._servers = {}
        self.gateway._tool_cache = {}
        self.gateway._stdio_sessions = {}
        self.gateway._ensure_schema()

    async def test_register_list_update_server(self) -> None:
        config = mcp_gateway.MCPServerConfig(
            id="mcp-search",
            name="Search",
            transport="sse",
            url="http://localhost:8123/mcp",
        )
        self.gateway.register_server(config)
        self.assertEqual(len(self.gateway.list_servers()), 1)
        updated = self.gateway.update_server("mcp-search", {"enabled": False, "status": "healthy"})
        self.assertIsNotNone(updated)
        assert updated is not None
        self.assertFalse(updated.enabled)

    async def test_discover_and_call_tool(self) -> None:
        self.gateway.register_server(
            mcp_gateway.MCPServerConfig(
                id="mcp-search",
                name="Search",
                transport="sse",
                url="http://localhost:8123/mcp",
                allowed_lobsters=["radar"],
            )
        )
        with patch.object(
            mcp_gateway.MCPGateway,
            "_rpc_request",
            new=AsyncMock(side_effect=[{"tools": [{"name": "web_search", "description": "search", "inputSchema": {"type": "object"}}]}, {"content": "ok"}]),
        ):
            tools = await self.gateway.discover_tools("mcp-search")
            self.assertEqual(len(tools), 1)
            result = await self.gateway.call_tool("mcp-search", "web_search", {"query": "test"}, "radar")
            self.assertTrue(result["ok"])
            history = self.gateway.list_call_history()
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["tool_name"], "web_search")

    async def test_forbidden_lobster_is_blocked(self) -> None:
        self.gateway.register_server(
            mcp_gateway.MCPServerConfig(
                id="mcp-crm",
                name="CRM",
                transport="sse",
                url="http://localhost:8123/mcp",
                allowed_lobsters=["catcher"],
            )
        )
        result = await self.gateway.call_tool("mcp-crm", "write", {}, "radar")
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
