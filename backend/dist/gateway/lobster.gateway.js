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
var LobsterGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LobsterGateway = void 0;
const common_1 = require("@nestjs/common");
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const ACTIVATION_CODE_REGEX = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;
const ALLOWED_CODES = new Set([
    'CLAW-1234-ABCD-5678',
    'CLAW-8A9B-XYZ1-9922',
    'CLAW-0000-0000-0001',
]);
let LobsterGateway = LobsterGateway_1 = class LobsterGateway {
    constructor() {
        this.logger = new common_1.Logger(LobsterGateway_1.name);
        this.socketToCode = new Map();
        this.codeToSocket = new Map();
    }
    afterInit(server) {
        server.use((socket, next) => {
            const code = (socket.handshake.auth?.activationCode ?? '').trim();
            if (!ACTIVATION_CODE_REGEX.test(code)) {
                this.logger.warn(`[Lobster] Reject connection: invalid format (len=${code.length})`);
                return next(new Error('INVALID_ACTIVATION_CODE'));
            }
            if (!ALLOWED_CODES.has(code.toUpperCase())) {
                this.logger.warn(`[Lobster] Reject connection: code not allowed`);
                return next(new Error('ACTIVATION_CODE_NOT_ALLOWED'));
            }
            next();
        });
        this.logger.log('LobsterGateway initialized at /lobster');
    }
    handleConnection(client) {
        const code = (client.handshake.auth?.activationCode ?? '').trim().toUpperCase();
        const existingSocketId = this.codeToSocket.get(code);
        if (existingSocketId && existingSocketId !== client.id) {
            const oldSocket = this.server.sockets.sockets.get(existingSocketId);
            if (oldSocket?.connected) {
                oldSocket.emit('server.kicked', { reason: 'SAME_CODE_LOGGED_IN_ELSEWHERE' });
                oldSocket.disconnect(true);
                this.logger.log(`[Lobster] Kicked previous socket ${existingSocketId} (顶号) for code ${code}`);
            }
            this.socketToCode.delete(existingSocketId);
            this.codeToSocket.delete(code);
        }
        this.socketToCode.set(client.id, code);
        this.codeToSocket.set(code, client.id);
        this.logger.log(`[Lobster] Client connected: socketId=${client.id}, activationCode=${code}`);
    }
    handleDisconnect(client) {
        const code = this.socketToCode.get(client.id);
        if (code && this.codeToSocket.get(code) === client.id) {
            this.codeToSocket.delete(code);
        }
        this.socketToCode.delete(client.id);
        this.logger.log(`[Lobster] Client disconnected: socketId=${client.id}, activationCode=${code ?? '—'}`);
    }
    emitToCode(activationCode, event, payload) {
        const socketId = this.codeToSocket.get(activationCode.toUpperCase());
        if (socketId) {
            this.server.to(socketId).emit(event, payload);
        }
    }
    getOnlineCodes() {
        return Array.from(this.codeToSocket.keys());
    }
};
exports.LobsterGateway = LobsterGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], LobsterGateway.prototype, "server", void 0);
exports.LobsterGateway = LobsterGateway = LobsterGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        path: '/lobster',
        cors: { origin: true },
        namespace: '/',
    })
], LobsterGateway);
//# sourceMappingURL=lobster.gateway.js.map