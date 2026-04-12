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
var RadarSniffingWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RadarSniffingWorker = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("@nestjs/bullmq");
const bullmq_3 = require("bullmq");
const common_1 = require("@nestjs/common");
const autopilot_constants_1 = require("../autopilot.constants");
const autopilot_circuit_service_1 = require("../autopilot-circuit.service");
let RadarSniffingWorker = RadarSniffingWorker_1 = class RadarSniffingWorker extends bullmq_1.WorkerHost {
    constructor(contentForgeQueue, circuit) {
        super();
        this.contentForgeQueue = contentForgeQueue;
        this.circuit = circuit;
        this.logger = new common_1.Logger(RadarSniffingWorker_1.name);
    }
    async process(job) {
        const { tenantId, competitorUrl, industryKeywords, jobId } = job.data;
        this.logger.log(`[Radar] Processing job ${job.id} tenant=${tenantId} url=${competitorUrl}`);
        try {
            const viralText = await this.sniffViralContent(competitorUrl, industryKeywords);
            this.circuit.recordSuccess(autopilot_constants_1.RADAR_SNIFFING_QUEUE);
            const nextPayload = {
                tenantId,
                viralText,
                sourceUrl: competitorUrl,
                jobId,
            };
            await this.contentForgeQueue.add('forge', nextPayload, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
            });
            this.logger.log(`[Radar] Job ${job.id} done, enqueued content_forge`);
            return nextPayload;
        }
        catch (err) {
            this.logger.warn(`[Radar] Job ${job.id} failed`, err);
            this.circuit.recordFailure(autopilot_constants_1.RADAR_SNIFFING_QUEUE);
            throw err;
        }
    }
    async sniffViralContent(url, keywords) {
        await new Promise((r) => setTimeout(r, 500));
        return `[爆款文本] 来源: ${url}，关键词: ${keywords.join('、')}。这是一段模拟抓取的爆款文案，用于驱动内容熔炼队列。`;
    }
};
exports.RadarSniffingWorker = RadarSniffingWorker;
exports.RadarSniffingWorker = RadarSniffingWorker = RadarSniffingWorker_1 = __decorate([
    (0, bullmq_1.Processor)(autopilot_constants_1.RADAR_SNIFFING_QUEUE),
    __param(0, (0, bullmq_2.InjectQueue)(autopilot_constants_1.CONTENT_FORGE_QUEUE)),
    __metadata("design:paramtypes", [bullmq_3.Queue,
        autopilot_circuit_service_1.AutopilotCircuitService])
], RadarSniffingWorker);
//# sourceMappingURL=radar-sniffing.worker.js.map