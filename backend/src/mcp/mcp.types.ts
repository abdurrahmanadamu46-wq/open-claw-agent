/**
 * MCP (Model Context Protocol) over WebSocket — JSON-RPC 2.0 消息类型
 * 中心端 NestJS 通过 Socket.io 向边缘 Tauri 节点发送 MCP 格式指令
 */

/** JSON-RPC 2.0 请求（中心 → 边缘） */
export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

/** JSON-RPC 2.0 成功响应（边缘 → 中心） */
export interface McpJsonRpcResult {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

/** JSON-RPC 2.0 错误响应 */
export interface McpJsonRpcError {
  jsonrpc: '2.0';
  id: string | number;
  error: { code: number; message: string };
}

export type McpJsonRpcResponse = McpJsonRpcResult | McpJsonRpcError;

/** Socket 事件名：中心发往边缘的 MCP 请求 */
export const MCP_SOCKET_EVENT_REQUEST = 'mcp_call';

/** Socket 事件名：边缘回传中心的 MCP 响应 */
export const MCP_SOCKET_EVENT_RESPONSE = 'mcp_response';

/** 边缘端注册的 Tool 名称 */
export const MCP_TOOL_PUBLISH_VIDEO = 'publish_video';
export const MCP_TOOL_READ_SCREEN_CONTEXT = 'read_screen_context';
