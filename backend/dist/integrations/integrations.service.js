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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsService = void 0;
const common_1 = require("@nestjs/common");
const nestjs_redis_1 = require("@liaoliaots/nestjs-redis");
const REDIS_KEY_PREFIX = 'tenant_integrations:';
let IntegrationsService = class IntegrationsService {
    constructor(redisService) {
        this.redisService = redisService;
    }
    get redis() {
        return this.redisService.getOrThrow();
    }
    async getIntegrations(tenantId) {
        const key = REDIS_KEY_PREFIX + tenantId;
        const raw = await this.redis.get(key);
        if (!raw)
            return {};
        try {
            return JSON.parse(raw);
        }
        catch {
            return {};
        }
    }
    async updateIntegrations(tenantId, patch) {
        const current = await this.getIntegrations(tenantId);
        const next = {
            ...current,
            ...patch,
            llm: patch.llm !== undefined ? { ...current.llm, ...patch.llm } : current.llm,
            tts: patch.tts !== undefined ? { ...current.tts, ...patch.tts } : current.tts,
            proxy: patch.proxy !== undefined ? { ...current.proxy, ...patch.proxy } : current.proxy,
            webhook: patch.webhook !== undefined ? { ...current.webhook, ...patch.webhook } : current.webhook,
            storage: patch.storage !== undefined ? { ...current.storage, ...patch.storage } : current.storage,
            cloud_phone: patch.cloud_phone !== undefined ? { ...current.cloud_phone, ...patch.cloud_phone } : current.cloud_phone,
            ai_customer_service: patch.ai_customer_service !== undefined ? { ...current.ai_customer_service, ...patch.ai_customer_service } : current.ai_customer_service,
            custom_tools: patch.custom_tools !== undefined
                ? {
                    mcpServers: patch.custom_tools.mcpServers ?? current.custom_tools?.mcpServers ?? [],
                    customApis: patch.custom_tools.customApis ?? current.custom_tools?.customApis ?? [],
                }
                : current.custom_tools,
        };
        const key = REDIS_KEY_PREFIX + tenantId;
        await this.redis.set(key, JSON.stringify(next));
        return next;
    }
};
exports.IntegrationsService = IntegrationsService;
exports.IntegrationsService = IntegrationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [nestjs_redis_1.RedisService])
], IntegrationsService);
//# sourceMappingURL=integrations.service.js.map