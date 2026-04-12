import { LobsterGateway } from '../gateway/lobster.gateway';
import { McpJsonRpcRequest, McpJsonRpcResponse } from './mcp.types';
export declare class McpClientService {
    private readonly lobsterGateway;
    constructor(lobsterGateway: LobsterGateway);
    sendToolCall(activationCode: string, toolName: string, args?: Record<string, unknown>): void;
    sendRequest(activationCode: string, request: McpJsonRpcRequest): void;
    handleResponse(_response: McpJsonRpcResponse): void;
}
