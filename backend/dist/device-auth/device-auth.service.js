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
var DeviceAuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceAuthService = void 0;
const common_1 = require("@nestjs/common");
const nestjs_redis_1 = require("@liaoliaots/nestjs-redis");
const jwt_1 = require("@nestjs/jwt");
const uuid_1 = require("uuid");
const device_service_1 = require("../device/device.service");
const agent_cc_gateway_1 = require("../gateway/agent-cc.gateway");
let DeviceAuthService = DeviceAuthService_1 = class DeviceAuthService {
    constructor(redisService, jwtService, deviceService, agentGateway) {
        this.redisService = redisService;
        this.jwtService = jwtService;
        this.deviceService = deviceService;
        this.agentGateway = agentGateway;
        this.logger = new common_1.Logger(DeviceAuthService_1.name);
    }
    get redis() {
        return this.redisService.getOrThrow();
    }
    async createBindTicket(machineCode) {
        if (!machineCode?.trim()) {
            throw new common_1.BadRequestException('Machine code is required');
        }
        const ticketId = `TICKET_${(0, uuid_1.v4)().replace(/-/g, '').substring(0, 12).toUpperCase()}`;
        const redisKey = `device_bind:${ticketId}`;
        const ticketPayload = {
            machine_code: machineCode.trim(),
            status: 'PENDING',
            created_at: Date.now(),
        };
        await this.redis.set(redisKey, JSON.stringify(ticketPayload), 'EX', 300);
        this.logger.log(`[Auth] Bind ticket ${ticketId} for ${machineCode}`);
        return {
            ticket_id: ticketId,
            expires_in: 300,
            ws_room: `auth_room_${ticketId}`,
        };
    }
    async confirmTicketAndBind(tenantId, ticketId) {
        const redisKey = `device_bind:${ticketId}`;
        const ticketDataStr = await this.redis.get(redisKey);
        if (!ticketDataStr) {
            throw new common_1.BadRequestException('二维码已过期或无效，请在客户端刷新重试');
        }
        const ticketData = JSON.parse(ticketDataStr);
        if (ticketData.status !== 'PENDING') {
            throw new common_1.BadRequestException('该二维码已被处理');
        }
        await this.deviceService.upsertDevice({
            tenant_id: tenantId,
            machine_code: ticketData.machine_code,
            status: 'ONLINE',
        });
        const accessToken = this.jwtService.sign({
            sub: ticketData.machine_code,
            tenantId,
            role: 'agent_node',
        });
        await this.redis.del(redisKey);
        const wsRoom = `auth_room_${ticketId}`;
        this.agentGateway.emitAuthSuccess(wsRoom, {
            message: '授权成功',
            access_token: accessToken,
            tenant_id: tenantId,
        });
        this.logger.log(`[Auth] Device ${ticketData.machine_code} bound to tenant ${tenantId} via ${ticketId}`);
        return { success: true, message: '设备绑定成功' };
    }
};
exports.DeviceAuthService = DeviceAuthService;
exports.DeviceAuthService = DeviceAuthService = DeviceAuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [nestjs_redis_1.RedisService,
        jwt_1.JwtService,
        device_service_1.DeviceService,
        agent_cc_gateway_1.AgentCCGateway])
], DeviceAuthService);
//# sourceMappingURL=device-auth.service.js.map