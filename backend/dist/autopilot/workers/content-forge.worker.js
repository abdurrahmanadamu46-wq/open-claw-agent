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
var ContentForgeWorker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentForgeWorker = void 0;
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("@nestjs/bullmq");
const bullmq_3 = require("bullmq");
const common_1 = require("@nestjs/common");
const nestjs_redis_1 = require("@liaoliaots/nestjs-redis");
const autopilot_constants_1 = require("../autopilot.constants");
const autopilot_circuit_service_1 = require("../autopilot-circuit.service");
const integrations_service_1 = require("../../integrations/integrations.service");
const llm_service_1 = require("../../llm/llm.service");
const REDIS_KEY_DAILY_PREFIX = 'autopilot:content_forge:daily:';
let ContentForgeWorker = ContentForgeWorker_1 = class ContentForgeWorker extends bullmq_1.WorkerHost {
    constructor(matrixDispatchQueue, circuit, redisService, integrationsService, llmService) {
        super();
        this.matrixDispatchQueue = matrixDispatchQueue;
        this.circuit = circuit;
        this.redisService = redisService;
        this.integrationsService = integrationsService;
        this.llmService = llmService;
        this.logger = new common_1.Logger(ContentForgeWorker_1.name);
    }
    get redis() {
        return this.redisService.getOrThrow();
    }
    async process(job) {
        const { tenantId, viralText, sourceUrl, jobId } = job.data;
        this.logger.log(`[ContentForge] Processing job ${job.id} tenant=${tenantId}`);
        const dateKey = new Date().toISOString().slice(0, 10);
        const budgetKey = `${REDIS_KEY_DAILY_PREFIX}${tenantId}:${dateKey}`;
        const current = await this.redis.incr(budgetKey);
        if (current === 1)
            await this.redis.expire(budgetKey, 86400 * 2);
        if (current > autopilot_constants_1.DAILY_CONTENT_GENERATION_LIMIT) {
            this.logger.warn(`[ContentForge] Tenant ${tenantId} daily limit exceeded (${current})`);
            throw new Error(`每日生成上限已用完（${autopilot_constants_1.DAILY_CONTENT_GENERATION_LIMIT}），请明日再试或联系管理员提升配额`);
        }
        try {
            const { videoUrl, script } = await this.forgeContent(tenantId, viralText, sourceUrl);
            const nodeIds = await this.getTenantNodeIds(tenantId);
            this.circuit.recordSuccess(autopilot_constants_1.CONTENT_FORGE_QUEUE);
            const nextPayload = {
                tenantId,
                videoUrl,
                script,
                nodeIds,
                scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                jobId,
            };
            await this.matrixDispatchQueue.add('dispatch', nextPayload, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
            });
            this.logger.log(`[ContentForge] Job ${job.id} done, enqueued matrix_dispatch`);
            return nextPayload;
        }
        catch (err) {
            await this.redis.decr(budgetKey);
            this.logger.warn(`[ContentForge] Job ${job.id} failed`, err);
            this.circuit.recordFailure(autopilot_constants_1.CONTENT_FORGE_QUEUE);
            throw err;
        }
    }
    async forgeContent(tenantId, viralText, sourceUrl) {
        const integrations = await this.integrationsService.getIntegrations(tenantId);
        if (!integrations.llm?.apiKey) {
            throw new Error('大模型 API Key 未配置');
        }
        const prompt = `基于以下爆款参考，生成一条短视频脚本（60 字内）及推荐视频封面文案。\n参考：${viralText}\n${sourceUrl ? `来源：${sourceUrl}` : ''}`;
        const res = await this.llmService.chat([{ role: 'user', content: prompt }], { max_tokens: 256 });
        const script = res?.choices?.[0]?.message?.content?.trim() ?? '[生成脚本] 模拟文案';
        const videoUrl = `https://cdn.example.com/generated/${Date.now()}.mp4`;
        return { videoUrl, script };
    }
    async getTenantNodeIds(tenantId) {
        await Promise.resolve(tenantId);
        return ['Node-01', 'Node-02'];
    }
};
exports.ContentForgeWorker = ContentForgeWorker;
exports.ContentForgeWorker = ContentForgeWorker = ContentForgeWorker_1 = __decorate([
    (0, bullmq_1.Processor)(autopilot_constants_1.CONTENT_FORGE_QUEUE),
    __param(0, (0, bullmq_2.InjectQueue)(autopilot_constants_1.MATRIX_DISPATCH_QUEUE)),
    __metadata("design:paramtypes", [bullmq_3.Queue,
        autopilot_circuit_service_1.AutopilotCircuitService,
        nestjs_redis_1.RedisService,
        integrations_service_1.IntegrationsService,
        llm_service_1.LlmService])
], ContentForgeWorker);
//# sourceMappingURL=content-forge.worker.js.map