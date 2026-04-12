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
exports.IntegrationsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const integrations_service_1 = require("./integrations.service");
const webhook_dispatcher_service_1 = require("./webhook-dispatcher.service");
let IntegrationsController = class IntegrationsController {
    constructor(integrationsService, webhookDispatcher) {
        this.integrationsService = integrationsService;
        this.webhookDispatcher = webhookDispatcher;
    }
    async getIntegrations(req) {
        const data = await this.integrationsService.getIntegrations(req.user.tenantId);
        return { code: 0, data };
    }
    async updateIntegrations(req, body) {
        const data = await this.integrationsService.updateIntegrations(req.user.tenantId, body);
        return { code: 0, data };
    }
    async sendTestWebhook(req) {
        const result = await this.webhookDispatcher.fireTestWebhook(req.user.tenantId);
        if (result.ok) {
            return { code: 0, message: '测试线索已加入推送队列', jobId: result.jobId };
        }
        return { code: 1, message: result.error ?? 'Webhook 未配置或入队失败' };
    }
};
exports.IntegrationsController = IntegrationsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "getIntegrations", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "updateIntegrations", null);
__decorate([
    (0, common_1.Post)('webhook/test'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "sendTestWebhook", null);
exports.IntegrationsController = IntegrationsController = __decorate([
    (0, common_1.Controller)('api/v1/tenant/integrations'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService,
        webhook_dispatcher_service_1.WebhookDispatcherService])
], IntegrationsController);
//# sourceMappingURL=integrations.controller.js.map