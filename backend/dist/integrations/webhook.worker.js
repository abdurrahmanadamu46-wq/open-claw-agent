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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookWorker = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const axios_1 = __importDefault(require("axios"));
const integrations_service_1 = require("./integrations.service");
const webhook_queue_const_1 = require("./webhook-queue.const");
const REQUEST_TIMEOUT_MS = 15_000;
let WebhookWorker = class WebhookWorker extends bullmq_1.WorkerHost {
    constructor(integrationsService) {
        super();
        this.integrationsService = integrationsService;
    }
    async process(job) {
        const { payload } = job.data;
        const integrations = await this.integrationsService.getIntegrations(payload.tenantId);
        const webhook = integrations.webhook;
        const url = webhook?.enabled && webhook?.leadCaptureUrl?.trim() ? webhook.leadCaptureUrl.trim() : null;
        if (!url) {
            throw new Error('Webhook 未配置或未启用 (leadCaptureUrl)');
        }
        const res = await axios_1.default.post(url, payload, {
            timeout: REQUEST_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`Webhook HTTP ${res.status}: ${res.statusText}`);
        }
    }
};
exports.WebhookWorker = WebhookWorker;
exports.WebhookWorker = WebhookWorker = __decorate([
    (0, bullmq_1.Processor)(webhook_queue_const_1.WEBHOOK_DISPATCH_QUEUE),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService])
], WebhookWorker);
//# sourceMappingURL=webhook.worker.js.map