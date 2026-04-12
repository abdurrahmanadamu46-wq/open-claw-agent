export interface McpJsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: {
        name?: string;
        arguments?: Record<string, unknown>;
    };
}
export interface McpJsonRpcResult {
    jsonrpc: '2.0';
    id: string | number;
    result: unknown;
}
export interface McpJsonRpcError {
    jsonrpc: '2.0';
    id: string | number;
    error: {
        code: number;
        message: string;
    };
}
export type McpJsonRpcResponse = McpJsonRpcResult | McpJsonRpcError;
export declare const MCP_SOCKET_EVENT_REQUEST = "mcp_call";
export declare const MCP_SOCKET_EVENT_RESPONSE = "mcp_response";
export declare const MCP_TOOL_PUBLISH_VIDEO = "publish_video";
export declare const MCP_TOOL_READ_SCREEN_CONTEXT = "read_screen_context";
