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
var FleetWebSocketGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FleetWebSocketGateway = void 0;
const common_1 = require("@nestjs/common");
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const nestjs_redis_1 = require("@liaoliaots/nestjs-redis");
const REDIS_NODE_PREFIX = 'fleet:node:';
const REDIS_TASK_PREFIX = 'fleet:task:';
const NODE_TTL_SEC = 60;
const TASK_TTL_SEC = 86400 * 7;
let FleetWebSocketGateway = FleetWebSocketGateway_1 = class FleetWebSocketGateway {
    constructor(redisService) {
        this.redisService = redisService;
        this.logger = new common_1.Logger(FleetWebSocketGateway_1.name);
        this.nodeToSocket = new Map();
        this.socketToNode = new Map();
    }
    get redis() {
        return this.redisService.getOrThrow();
    }
    afterInit() {
        this.logger.log('FleetWebSocketGateway initialized at /fleet');
    }
    handleConnection(client) {
        const nodeId = (client.handshake.auth?.nodeId ?? client.handshake.query?.nodeId ?? '').trim();
        if (!nodeId) {
            this.logger.warn('[Fleet] Reject: missing nodeId');
            client.disconnect();
            return;
        }
        const existingSocketId = this.nodeToSocket.get(nodeId);
        if (existingSocketId && existingSocketId !== client.id) {
            const old = this.server.sockets.sockets.get(existingSocketId);
            if (old?.connected) {
                old.emit('server.kicked', { reason: 'SAME_NODE_ELSEWHERE' });
                old.disconnect(true);
            }
            this.nodeToSocket.delete(nodeId);
            this.socketToNode.delete(existingSocketId);
        }
        this.nodeToSocket.set(nodeId, client.id);
        this.socketToNode.set(client.id, nodeId);
        client.join(`node:${nodeId}`);
        this.logger.log(`[Fleet] Node connected: nodeId=${nodeId}, socketId=${client.id}`);
    }
    async handleDisconnect(client) {
        const nodeId = this.socketToNode.get(client.id);
        if (nodeId) {
            this.nodeToSocket.delete(nodeId);
            this.socketToNode.delete(client.id);
            await this.setNodeStatus(nodeId, 'OFFLINE');
        }
        this.logger.log(`[Fleet] Node disconnected: socketId=${client.id}, nodeId=${nodeId ?? '—'}`);
    }
    async setNodeStatus(nodeId, status) {
        const key = `${REDIS_NODE_PREFIX}${nodeId}`;
        const lastSeen = Date.now();
        await this.redis
            .multi()
            .hset(key, 'last_seen', String(lastSeen))
            .hset(key, 'status', status)
            .expire(key, NODE_TTL_SEC)
            .exec();
    }
    async handleNodePing(payload, client) {
        const nodeId = payload?.nodeId ?? this.socketToNode.get(client.id);
        if (!nodeId)
            return;
        const key = `${REDIS_NODE_PREFIX}${nodeId}`;
        const lastSeen = Date.now();
        await this.redis
            .multi()
            .hset(key, 'last_seen', String(lastSeen))
            .hset(key, 'status', payload.status ?? 'IDLE')
            .hset(key, 'current_task_id', payload.currentTaskId ?? '')
            .expire(key, NODE_TTL_SEC)
            .exec();
        this.server.to('fleet:report').emit('node_heartbeat', { nodeId, status: payload.status, lastSeen });
    }
    async handleTaskProgress(payload) {
        if (!payload?.taskId)
            return;
        const key = `${REDIS_TASK_PREFIX}${payload.taskId}`;
        const multi = this.redis.multi();
        multi.hset(key, 'progress', String(payload.progress));
        multi.hset(key, 'message', payload.message ?? '');
        multi.hset(key, 'step', payload.step ?? '');
        multi.hset(key, 'nodeId', payload.nodeId);
        multi.expire(key, TASK_TTL_SEC);
        await multi.exec();
        this.server.to('fleet:report').emit('task_progress', payload);
    }
    async handleTaskCompleted(payload) {
        if (!payload?.taskId)
            return;
        const key = `${REDIS_TASK_PREFIX}${payload.taskId}`;
        const multi = this.redis.multi();
        multi.hset(key, 'completed', '1');
        multi.hset(key, 'success', payload.success ? '1' : '0');
        multi.hset(key, 'error', payload.error ?? '');
        multi.hset(key, 'completedAt', payload.completedAt);
        multi.expire(key, TASK_TTL_SEC);
        await multi.exec();
        this.server.to('fleet:report').emit('task_completed', payload);
    }
    dispatchTask(nodeId, payload) {
        const socketId = this.nodeToSocket.get(nodeId);
        if (!socketId) {
            this.logger.warn(`[Fleet] Dispatch failed: node not connected nodeId=${nodeId}`);
            return false;
        }
        this.server.to(socketId).emit('execute_task', payload);
        this.logger.log(`[Fleet] Dispatched taskId=${payload.taskId} to nodeId=${nodeId}`);
        return true;
    }
    joinReportRoom(client) {
        client.join('fleet:report');
    }
};
exports.FleetWebSocketGateway = FleetWebSocketGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], FleetWebSocketGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('node_ping'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], FleetWebSocketGateway.prototype, "handleNodePing", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('task_progress'),
    __param(0, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FleetWebSocketGateway.prototype, "handleTaskProgress", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('task_completed'),
    __param(0, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FleetWebSocketGateway.prototype, "handleTaskCompleted", null);
exports.FleetWebSocketGateway = FleetWebSocketGateway = FleetWebSocketGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        path: '/fleet',
        cors: { origin: true },
        namespace: '/',
    }),
    __metadata("design:paramtypes", [nestjs_redis_1.RedisService])
], FleetWebSocketGateway);
//# sourceMappingURL=fleet-websocket.gateway.js.map