"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpClientService = void 0;
const common_1 = require("@nestjs/common");
const lobster_gateway_1 = require("../gateway/lobster.gateway");
const mcp_types_1 = require("./mcp.types");
let McpClientService = class McpClientService {
    constructor(lobsterGateway) {
        this.lobsterGateway = lobsterGateway;
    }
    sendToolCall(activationCode, toolName, args = {}) {
        const request = {
            jsonrpc: '2.0',
            id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            method: 'tools/call',
            params: { name: toolName, arguments: args },
        };
        this.lobsterGateway.emitToCode(activationCode, mcp_types_1.MCP_SOCKET_EVENT_REQUEST, request);
    }
    sendRequest(activationCode, request) {
        this.lobsterGateway.emitToCode(activationCode, mcp_types_1.MCP_SOCKET_EVENT_REQUEST, request);
    }
    handleResponse(_response) {
    }
};
exports.McpClientService = McpClientService;
exports.McpClientService = McpClientService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [lobster_gateway_1.LobsterGateway])
], McpClientService);
//# sourceMappingURL=mcp-client.service.js.map