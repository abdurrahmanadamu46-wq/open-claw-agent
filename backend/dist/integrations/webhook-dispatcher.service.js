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
exports.WebhookDispatcherService = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const uuid_1 = require("uuid");
const integrations_service_1 = require("./integrations.service");
const webhook_queue_const_1 = require("./webhook-queue.const");
let WebhookDispatcherService = class WebhookDispatcherService {
    constructor(integrationsService, webhookQueue) {
        this.integrationsService = integrationsService;
        this.webhookQueue = webhookQueue;
    }
    async getWebhookUrl(tenantId) {
        const integrations = await this.integrationsService.getIntegrations(tenantId);
        const webhook = integrations.webhook;
        if (!webhook?.enabled || !webhook.leadCaptureUrl?.trim())
            return null;
        return webhook.leadCaptureUrl.trim();
    }
    async enqueueLead(payload) {
        const url = await this.getWebhookUrl(payload.tenantId);
        if (!url) {
            return { ok: false, error: 'Webhook 未配置或未启用 (leadCaptureUrl)' };
        }
        const job = await this.webhookQueue.add('dispatch', { payload }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 500 },
        });
        return { ok: true, jobId: job.id ?? '' };
    }
    async fireWebhook(payload) {
        const result = await this.enqueueLead(payload);
        if (result.ok)
            return { ok: true, jobId: result.jobId };
        return { ok: false, error: result.error };
    }
    async fireTestWebhook(tenantId) {
        const payload = {
            eventId: (0, uuid_1.v4)(),
            timestamp: new Date().toISOString(),
            tenantId,
            source: 'douyin',
            leadDetails: {
                username: '[测试] 小明',
                profileUrl: 'https://example.com/profile/test',
                content: '这个怎么卖？',
                sourceVideoUrl: 'https://example.com/video/123',
            },
        };
        return this.fireWebhook(payload);
    }
};
exports.WebhookDispatcherService = WebhookDispatcherService;
exports.WebhookDispatcherService = WebhookDispatcherService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, bullmq_1.InjectQueue)(webhook_queue_const_1.WEBHOOK_DISPATCH_QUEUE)),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService,
        bullmq_2.Queue])
], WebhookDispatcherService);
//# sourceMappingURL=webhook-dispatcher.service.js.map