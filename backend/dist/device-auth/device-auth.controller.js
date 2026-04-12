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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceAuthController = void 0;
const common_1 = require("@nestjs/common");
const device_auth_service_1 = require("./device-auth.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const agent_cc_gateway_1 = require("../gateway/agent-cc.gateway");
let DeviceAuthController = class DeviceAuthController {
    constructor(deviceAuthService, agentGateway) {
        this.deviceAuthService = deviceAuthService;
        this.agentGateway = agentGateway;
    }
    async requestBindTicket(body) {
        return this.deviceAuthService.createBindTicket(body.machine_code);
    }
    async confirmDeviceBind(req, body) {
        if (!body?.ticket_id) {
            return { success: false, message: 'ticket_id required' };
        }
        return this.deviceAuthService.confirmTicketAndBind(req.user.tenantId, body.ticket_id);
    }
    async testDispatch() {
        const payload = {
            job_id: 'JOB_TEST_' + Date.now(),
            campaign_id: 'CAMP_VIP_TEST',
            action: 'EXECUTE_CAMPAIGN',
            config: { test: true },
        };
        this.agentGateway.server.emit('server.task.dispatch', payload);
        return { ok: true, message: '已向所有已连接客户端下发测试任务', payload };
    }
};
exports.DeviceAuthController = DeviceAuthController;
__decorate([
    (0, common_1.Post)('bind-ticket'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeviceAuthController.prototype, "requestBindTicket", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('confirm-bind'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DeviceAuthController.prototype, "confirmDeviceBind", null);
__decorate([
    (0, common_1.Post)('test-dispatch'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], DeviceAuthController.prototype, "testDispatch", null);
exports.DeviceAuthController = DeviceAuthController = __decorate([
    (0, common_1.Controller)('api/v1/devices'),
    __metadata("design:paramtypes", [device_auth_service_1.DeviceAuthService,
        agent_cc_gateway_1.AgentCCGateway])
], DeviceAuthController);
//# sourceMappingURL=device-auth.controller.js.map