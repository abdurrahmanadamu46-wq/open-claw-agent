# CODEX TASK: 边缘 MCP 工具服务（Edge Local MCP Server）

**优先级：P2**  
**来源：TOOLHIVE_BORROWING_ANALYSIS.md P2-#3（ToolHive Edge Tool Runtime）**

---

## 背景

我们的边缘层（`edge-runtime`）目前只能接收云端任务并执行（`marionette_executor.py`），但边缘节点无法向龙虾提供"本地工具"。借鉴 ToolHive 边缘工具运行概念：在边缘节点注册本地 MCP 工具（本地文件读取、本地浏览器、本地数据库查询），通过现有 WSS 通道反向代理给云端龙虾调用，龙虾无感知工具在边缘。

---

## 实现

```python
# edge-runtime/edge_mcp_server.py

import asyncio
import json
import logging
import time
from typing import Callable

logger = logging.getLogger(__name__)

# ── 边缘本地工具注册表 ──────────────────────────────────

EDGE_LOCAL_TOOLS: dict[str, Callable] = {}


def edge_tool(name: str, description: str = ""):
    """装饰器：注册一个边缘本地工具"""
    def decorator(func):
        EDGE_LOCAL_TOOLS[name] = {
            "fn": func,
            "description": description,
            "name": name,
        }
        logger.info(f"[EdgeMCP] 注册本地工具: {name}")
        return func
    return decorator


# ── 内置边缘工具 ────────────────────────────────────────

@edge_tool("edge_file_read", "读取边缘节点本地文件（不上传到云端）")
async def edge_file_read(path: str, encoding: str = "utf-8") -> dict:
    """读取本地文件内容"""
    import aiofiles
    try:
        async with aiofiles.open(path, encoding=encoding) as f:
            content = await f.read()
        return {"success": True, "content": content, "path": path}
    except Exception as e:
        return {"success": False, "error": str(e)}


@edge_tool("edge_browser_screenshot", "截取当前浏览器页面截图")
async def edge_browser_screenshot(url: str = None) -> dict:
    """本地浏览器截图"""
    try:
        # 复用已有的 marionette_executor
        from .marionette_executor import take_screenshot
        img_b64 = await take_screenshot(url)
        return {"success": True, "image_base64": img_b64}
    except Exception as e:
        return {"success": False, "error": str(e)}


@edge_tool("edge_local_db_query", "查询边缘节点本地 SQLite 数据库")
async def edge_local_db_query(db_path: str, sql: str) -> dict:
    """本地 SQLite 查询"""
    import aiosqlite
    try:
        async with aiosqlite.connect(db_path) as db:
            async with db.execute(sql) as cursor:
                rows = await cursor.fetchall()
                cols = [d[0] for d in cursor.description] if cursor.description else []
        return {
            "success": True,
            "columns": cols,
            "rows": [dict(zip(cols, r)) for r in rows],
            "count": len(rows),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ── WSS 通道集成（通过现有 wss_receiver.py 的消息协议）──

class EdgeMcpServer:
    """
    边缘 MCP 服务：通过 WSS 反向代理本地工具给云端龙虾调用
    
    协议设计：
      云端 → 边缘：{"type": "mcp_tool_call", "tool": "edge_file_read", "params": {...}, "call_id": "xxx"}
      边缘 → 云端：{"type": "mcp_tool_result", "call_id": "xxx", "result": {...}}
    
    集成到 wss_receiver.py 的消息分发器中
    """

    def __init__(self):
        self.tools = EDGE_LOCAL_TOOLS

    def get_tool_manifest(self) -> list[dict]:
        """返回本节点支持的工具列表（发送给云端注册）"""
        return [
            {"name": t["name"], "description": t["description"]}
            for t in self.tools.values()
        ]

    async def handle_tool_call(self, message: dict) -> dict:
        """处理云端发来的工具调用请求"""
        tool_name = message.get("tool")
        params = message.get("params", {})
        call_id = message.get("call_id", "")

        if tool_name not in self.tools:
            return {
                "type": "mcp_tool_result",
                "call_id": call_id,
                "result": {"success": False, "error": f"未知工具: {tool_name}"},
            }

        start = time.time()
        try:
            result = await self.tools[tool_name]["fn"](**params)
            latency_ms = int((time.time() - start) * 1000)
            logger.info(f"[EdgeMCP] {tool_name} 执行成功 {latency_ms}ms")
        except Exception as e:
            result = {"success": False, "error": str(e)}
            logger.warning(f"[EdgeMCP] {tool_name} 执行失败: {e}")

        return {
            "type": "mcp_tool_result",
            "call_id": call_id,
            "result": result,
        }


# 全局单例（wss_receiver.py 启动时初始化）
edge_mcp_server = EdgeMcpServer()


# ── wss_receiver.py 集成示意 ────────────────────────────
#
# async def handle_message(msg: dict, ws):
#     if msg.get("type") == "mcp_tool_call":
#         response = await edge_mcp_server.handle_tool_call(msg)
#         await ws.send(json.dumps(response))
#     elif msg.get("type") == "get_tool_manifest":
#         manifest = edge_mcp_server.get_tool_manifest()
#         await ws.send(json.dumps({"type": "tool_manifest", "tools": manifest}))
#     else:
#         # 原有消息处理逻辑...
```

---

## 验收标准

- [ ] `@edge_tool` 装饰器：注册边缘本地工具
- [ ] 内置3个工具：`edge_file_read` / `edge_browser_screenshot` / `edge_local_db_query`
- [ ] `EdgeMcpServer.get_tool_manifest()`：返回工具列表（供云端注册）
- [ ] `EdgeMcpServer.handle_tool_call()`：处理云端 `mcp_tool_call` 消息
- [ ] 集成到 `wss_receiver.py` 消息分发器
- [ ] 边缘节点启动时向云端推送 `tool_manifest`
- [ ] 工具调用结果通过 WSS 回传（`mcp_tool_result` 消息类型）
- [ ] 新工具可用 `@edge_tool` 装饰器零代码侵入地注册

---

*Codex Task | 来源：TOOLHIVE_BORROWING_ANALYSIS.md P2-#3 | 2026-04-02*
