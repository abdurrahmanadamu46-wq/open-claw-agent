import { Injectable } from '@nestjs/common';
import { LobsterGateway } from '../gateway/lobster.gateway';
import {
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  MCP_SOCKET_EVENT_REQUEST,
  MCP_SOCKET_EVENT_RESPONSE,
} from './mcp.types';

/**
 * MCP Client：通过 Socket.io 向指定激活码的龙虾节点发送 JSON-RPC 2.0 格式的 MCP 调用
 * LangGraph Agent 需要下发任务时，通过本服务转发到边缘端执行
 */
@Injectable()
export class McpClientService {
  constructor(private readonly lobsterGateway: LobsterGateway) {}

  /**
   * 向指定激活码的节点发送 MCP 工具调用（fire-and-forget，不等待响应）
   */
  sendToolCall(
    activationCode: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): void {
    const request: McpJsonRpcRequest = {
      jsonrpc: '2.0',
      id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };
    this.lobsterGateway.emitToCode(activationCode, MCP_SOCKET_EVENT_REQUEST, request);
  }

  /**
   * 发送 MCP 请求并返回 Promise；需边缘端在约定时间内 emit mcp_response，且前端/边缘需把 id 回传
   * 此处仅封装“发送”，若需同步等待响应，可在 Gateway 层维护 pending 表或改用 request/ack 会话
   */
  sendRequest(activationCode: string, request: McpJsonRpcRequest): void {
    this.lobsterGateway.emitToCode(activationCode, MCP_SOCKET_EVENT_REQUEST, request);
  }

  /** 供 Gateway 转发边缘端响应到等待方（可选：若实现 request-response 配对） */
  handleResponse(_response: McpJsonRpcResponse): void {
    // TODO: 若中心需要同步等待，可在此根据 response.id  resolve 对应 Promise
  }
}
