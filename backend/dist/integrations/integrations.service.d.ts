import { RedisService } from '@liaoliaots/nestjs-redis';
import type { TenantIntegrations } from './tenant-integrations.types';
export declare class IntegrationsService {
    private readonly redisService;
    constructor(redisService: RedisService);
    private get redis();
    getIntegrations(tenantId: string): Promise<TenantIntegrations>;
    updateIntegrations(tenantId: string, patch: Partial<TenantIntegrations>): Promise<TenantIntegrations>;
}
