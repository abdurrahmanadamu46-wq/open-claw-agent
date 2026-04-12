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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AgentCCGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentCCGateway = void 0;
const common_1 = require("@nestjs/common");
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
let AgentCCGateway = AgentCCGateway_1 = class AgentCCGateway {
    constructor() {
        this.logger = new common_1.Logger(AgentCCGateway_1.name);
    }
    afterInit() {
        this.logger.log('AgentCCGateway initialized at /agent-cc');
    }
    handleAuthListen(client, payload) {
        if (!payload?.ticket_id)
            return;
        const roomName = `auth_room_${payload.ticket_id}`;
        client.join(roomName);
        this.logger.log(`[WS] Client ${client.id} joined ${roomName} (waiting for scan)`);
    }
    emitAuthSuccess(roomName, data) {
        this.server.to(roomName).emit('server.auth.success', data);
    }
};
exports.AgentCCGateway = AgentCCGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], AgentCCGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('client.auth.listen'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], AgentCCGateway.prototype, "handleAuthListen", null);
exports.AgentCCGateway = AgentCCGateway = AgentCCGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        path: '/agent-cc',
        cors: { origin: true },
    })
], AgentCCGateway);
//# sourceMappingURL=agent-cc.gateway.js.map