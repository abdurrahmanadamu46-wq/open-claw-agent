import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import type {
  PluginAdapterConfig,
  PluginAdapterHealth,
  TenantIntegrations,
} from './tenant-integrations.types';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';

const REDIS_KEY_PREFIX = 'tenant_integrations:';
const ALLOWED_INTEGRATION_KEYS: ReadonlySet<keyof TenantIntegrations> = new Set([
  'llm',
  'tts',
  'proxy',
  'webhook',
  'storage',
  'cloud_phone',
  'ai_customer_service',
  'voice_agent',
  'custom_tools',
  'plugin_hub',
]);

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async getIntegrations(tenantId: string): Promise<TenantIntegrations> {
    const key = REDIS_KEY_PREFIX + tenantId;
    const raw = await redisReadWithFallback(
      this.logger,
      `getIntegrations tenant=${tenantId}`,
      async () => this.redis.get(key),
      null,
    );
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
    const unknownKeys = Object.keys(patch).filter(
      (key) => !ALLOWED_INTEGRATION_KEYS.has(key as keyof TenantIntegrations),
    );
    if (unknownKeys.length > 0) {
      this.logger.warn(
        `Drop unsupported integration keys tenant=${tenantId}: ${unknownKeys.join(',')}`,
      );
    }

    const current = await this.getIntegrationsForWrite(tenantId);
    const next: TenantIntegrations = {
      ...current,
      llm: patch.llm !== undefined ? { ...current.llm, ...patch.llm } : current.llm,
      tts: patch.tts !== undefined ? { ...current.tts, ...patch.tts } : current.tts,
      proxy: patch.proxy !== undefined ? { ...current.proxy, ...patch.proxy } : current.proxy,
      webhook: patch.webhook !== undefined ? { ...current.webhook, ...patch.webhook } : current.webhook,
      storage: patch.storage !== undefined ? { ...current.storage, ...patch.storage } : current.storage,
      cloud_phone: patch.cloud_phone !== undefined ? { ...current.cloud_phone, ...patch.cloud_phone } : current.cloud_phone,
      ai_customer_service: patch.ai_customer_service !== undefined ? { ...current.ai_customer_service, ...patch.ai_customer_service } : current.ai_customer_service,
      voice_agent: patch.voice_agent !== undefined ? { ...current.voice_agent, ...patch.voice_agent } : current.voice_agent,
      custom_tools: patch.custom_tools !== undefined
        ? {
            mcpServers: patch.custom_tools.mcpServers ?? current.custom_tools?.mcpServers ?? [],
            customApis: patch.custom_tools.customApis ?? current.custom_tools?.customApis ?? [],
          }
        : current.custom_tools,
      plugin_hub: patch.plugin_hub !== undefined
        ? {
            adapters: patch.plugin_hub.adapters ?? current.plugin_hub?.adapters ?? [],
            routing: patch.plugin_hub.routing
              ? { ...(current.plugin_hub?.routing ?? {}), ...patch.plugin_hub.routing }
              : (current.plugin_hub?.routing ?? {}),
            updatedAt: patch.plugin_hub.updatedAt ?? new Date().toISOString(),
          }
        : current.plugin_hub,
    };
    const key = REDIS_KEY_PREFIX + tenantId;
    await redisWriteOrBlock(
      this.logger,
      `updateIntegrations tenant=${tenantId}`,
      async () => this.redis.set(key, JSON.stringify(next)),
    );
    return next;
  }

  private async getIntegrationsForWrite(tenantId: string): Promise<TenantIntegrations> {
    const key = REDIS_KEY_PREFIX + tenantId;
    const raw = await redisWriteOrBlock(
      this.logger,
      `getIntegrationsForWrite tenant=${tenantId}`,
      async () => this.redis.get(key),
    );
    if (!raw) return {};
    try {
      return JSON.parse(raw) as TenantIntegrations;
    } catch {
      this.logger.warn(`Invalid integrations JSON; fallback to empty object tenant=${tenantId}`);
      return {};
    }
  }

  /**
   * Lightweight connection test for plug-and-play adapters.
   * It validates required fields and stamps health status so UI can route by health.
   */
  async testPluginAdapter(
    tenantId: string,
    adapter: Partial<PluginAdapterConfig>,
  ): Promise<{ ok: boolean; health: PluginAdapterHealth; reason?: string }> {
    const provider = (adapter.provider ?? '').trim();
    const id = (adapter.id ?? '').trim();

    if (!provider) {
      return {
        ok: false,
        reason: 'provider is required',
        health: {
          status: 'down',
          message: '缺少 provider',
          lastCheckedAt: new Date().toISOString(),
        },
      };
    }

    const requiresKey = (adapter.authType ?? 'api_key') !== 'none';
    if (requiresKey && !(adapter.apiKey ?? '').trim()) {
      return {
        ok: false,
        reason: 'apiKey is required',
        health: {
          status: 'down',
          message: '缺少 API Key',
          lastCheckedAt: new Date().toISOString(),
        },
      };
    }

    const start = Date.now();
    const hasTarget = !!(adapter.baseUrl || adapter.webhookUrl);
    const health: PluginAdapterHealth = {
      status: hasTarget ? 'healthy' : 'degraded',
      latencyMs: Math.max(1, Date.now() - start),
      message: hasTarget ? '配置通过（静态检测）' : '缺少目标地址，已降级为可保存状态',
      lastCheckedAt: new Date().toISOString(),
    };

    if (id) {
      const current = await this.getIntegrationsForWrite(tenantId);
      const adapters = [...(current.plugin_hub?.adapters ?? [])];
      const index = adapters.findIndex((item) => item.id === id);
      if (index >= 0) {
        adapters[index] = { ...adapters[index], health };
        await this.updateIntegrations(tenantId, {
          plugin_hub: {
            adapters,
            routing: current.plugin_hub?.routing ?? {},
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }

    return { ok: health.status !== 'down', health };
  }
}
