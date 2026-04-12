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
var AutopilotCoordinatorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutopilotCoordinatorService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const uuid_1 = require("uuid");
const autopilot_constants_1 = require("./autopilot.constants");
const autopilot_circuit_service_1 = require("./autopilot-circuit.service");
let AutopilotCoordinatorService = AutopilotCoordinatorService_1 = class AutopilotCoordinatorService {
    constructor(radarQueue, circuit) {
        this.radarQueue = radarQueue;
        this.circuit = circuit;
        this.logger = new common_1.Logger(AutopilotCoordinatorService_1.name);
    }
    async heartbeat() {
        if (this.circuit.isCircuitOpen()) {
            this.logger.warn('[Autopilot] Circuit open, skip heartbeat');
            return;
        }
        this.logger.log('[Autopilot] Heartbeat: enqueue radar probe');
        const tenantId = process.env.AUTOPILOT_TENANT_ID ?? 'default-tenant';
        const competitorUrl = process.env.AUTOPILOT_COMPETITOR_URL ?? 'https://example.com/competitor';
        const industryKeywords = (process.env.AUTOPILOT_INDUSTRY_KEYWORDS ?? '爆款,带货,种草')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const jobId = (0, uuid_1.v4)();
        const payload = {
            tenantId,
            competitorUrl,
            industryKeywords,
            jobId,
        };
        await this.radarQueue.add('sniff', payload, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
        });
        this.logger.log(`[Autopilot] Radar probe enqueued jobId=${jobId}`);
    }
    async triggerProbe(overrides) {
        if (this.circuit.isCircuitOpen()) {
            throw new Error('Autopilot 已熔断，请检查告警并恢复后再试');
        }
        const tenantId = overrides?.tenantId ?? process.env.AUTOPILOT_TENANT_ID ?? 'default-tenant';
        const competitorUrl = overrides?.competitorUrl ?? process.env.AUTOPILOT_COMPETITOR_URL ?? 'https://example.com/competitor';
        const industryKeywords = overrides?.industryKeywords ?? (process.env.AUTOPILOT_INDUSTRY_KEYWORDS ?? '爆款,带货,种草').split(',').map((s) => s.trim()).filter(Boolean);
        const jobId = overrides?.jobId ?? (0, uuid_1.v4)();
        const payload = {
            tenantId,
            competitorUrl,
            industryKeywords,
            jobId,
        };
        const job = await this.radarQueue.add('sniff', payload, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
        });
        this.logger.log(`[Autopilot] Manual probe enqueued jobId=${job.id ?? jobId}`);
        return job.id ?? jobId;
    }
    resetCircuit() {
        this.circuit.resetCircuit();
        this.logger.log('[Autopilot] Circuit reset by manual action');
    }
};
exports.AutopilotCoordinatorService = AutopilotCoordinatorService;
__decorate([
    (0, schedule_1.Cron)('0 */6 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AutopilotCoordinatorService.prototype, "heartbeat", null);
exports.AutopilotCoordinatorService = AutopilotCoordinatorService = AutopilotCoordinatorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bullmq_1.InjectQueue)(autopilot_constants_1.RADAR_SNIFFING_QUEUE)),
    __metadata("design:paramtypes", [bullmq_2.Queue,
        autopilot_circuit_service_1.AutopilotCircuitService])
], AutopilotCoordinatorService);
//# sourceMappingURL=autopilot-coordinator.service.js.map