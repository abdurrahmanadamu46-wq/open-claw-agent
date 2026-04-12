import { Injectable } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import type { TenantIntegrations } from './tenant-integrations.types';

const REDIS_KEY_PREFIX = 'tenant_integrations:';

@Injectable()
export class IntegrationsService {
  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async getIntegrations(tenantId: string): Promise<TenantIntegrations> {
    const key = REDIS_KEY_PREFIX + tenantId;
    const raw = await this.redis.get(key);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as TenantIntegrations;
    } catch {
      return {};
    }
  }

  async updateIntegrations(
    tenantId: string,
    patch: Partial<TenantIntegrations>,
  ): Promise<TenantIntegrations> {
    const current = await this.getIntegrations(tenantId);
    const next: TenantIntegrations = {
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
}
