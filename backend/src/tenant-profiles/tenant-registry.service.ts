import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import type {
  TenantLeadScoringWords,
  TenantRegistryPatch,
  TenantRegistryRecord,
  TenantWorkflowProgress,
} from './tenant-profiles.types';

const TENANT_REGISTRY_INDEX_KEY = 'tenant_registry:index';
const TENANT_REGISTRY_KEY_PREFIX = 'tenant_registry:';
const DEFAULT_LEAD_SCORING: TenantLeadScoringWords = {
  highIntent: ['怎么买', '多少钱', '可以下单吗', '联系方式'],
  painPoints: ['成本高', '转化低', '复购差'],
};
const DEFAULT_WORKFLOW_PROGRESS: TenantWorkflowProgress = {
  S1: false,
  S2: false,
  S3: false,
  S4: false,
  S5: false,
};

@Injectable()
export class TenantRegistryService {
  private readonly logger = new Logger(TenantRegistryService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private keyOf(tenantId: string): string {
    return `${TENANT_REGISTRY_KEY_PREFIX}${tenantId}`;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  private normalizeLeadScoring(value?: Partial<TenantLeadScoringWords> | null): TenantLeadScoringWords {
    return {
      highIntent: this.normalizeStringArray(value?.highIntent ?? DEFAULT_LEAD_SCORING.highIntent),
      painPoints: this.normalizeStringArray(value?.painPoints ?? DEFAULT_LEAD_SCORING.painPoints),
    };
  }

  private normalizeWorkflowProgress(value?: Partial<TenantWorkflowProgress> | null): TenantWorkflowProgress {
    return {
      S1: !!value?.S1,
      S2: !!value?.S2,
      S3: !!value?.S3,
      S4: !!value?.S4,
      S5: !!value?.S5,
    };
  }

  private parseOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
  }

  private normalizeRegion(value: unknown, fallback = 'cn-shanghai'): string {
    return this.parseOptionalString(value) ?? fallback;
  }

  private normalizeResidency(value: unknown): 'cn-mainland' | 'custom' {
    return value === 'custom' ? 'custom' : 'cn-mainland';
  }

  private normalizeIcpStatus(
    value: unknown,
  ): 'pending' | 'ready' | 'submitted' | 'approved' {
    if (value === 'ready' || value === 'submitted' || value === 'approved') {
      return value;
    }
    return 'pending';
  }

  private normalizeQuota(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 3;
    return Math.floor(parsed);
  }

  private defaultRecord(tenantId: string, seed?: Partial<TenantRegistryRecord>): TenantRegistryRecord {
    const now = new Date().toISOString();
    return {
      id: tenantId,
      name: this.parseOptionalString(seed?.name) ?? tenantId,
      quota: this.normalizeQuota(seed?.quota ?? 3),
      inactive: !!seed?.inactive,
      industryType: this.parseOptionalString(seed?.industryType),
      industryCategoryTag: this.parseOptionalString(seed?.industryCategoryTag),
      businessKeywords: this.normalizeStringArray(seed?.businessKeywords),
      leadScoringWords: this.normalizeLeadScoring(seed?.leadScoringWords),
      nodeWorkflowProgress: this.normalizeWorkflowProgress(seed?.nodeWorkflowProgress),
      deploymentRegion: this.normalizeRegion(seed?.deploymentRegion, 'cn-shanghai'),
      storageRegion: this.normalizeRegion(seed?.storageRegion, 'cn-shanghai'),
      dataResidency: this.normalizeResidency(seed?.dataResidency),
      icpFilingStatus: this.normalizeIcpStatus(seed?.icpFilingStatus),
      createdAt: seed?.createdAt ?? now,
      updatedAt: seed?.updatedAt ?? now,
      archivedAt: this.parseOptionalString(seed?.archivedAt),
    };
  }

  private parseRecord(raw: string | null, tenantId: string): TenantRegistryRecord {
    if (!raw) return this.defaultRecord(tenantId);
    try {
      const parsed = JSON.parse(raw) as Partial<TenantRegistryRecord>;
      return {
        ...this.defaultRecord(tenantId, parsed),
        id: tenantId,
      };
    } catch {
      return this.defaultRecord(tenantId);
    }
  }

  async ensureTenant(
    tenantId: string,
    seed?: Partial<TenantRegistryRecord>,
  ): Promise<TenantRegistryRecord> {
    const normalizedTenantId = tenantId.trim();
    const existing = await redisReadWithFallback(
      this.logger,
      `tenant registry ensure read tenant=${normalizedTenantId}`,
      async () => await this.redis.get(this.keyOf(normalizedTenantId)),
      null,
    );
    if (existing) {
      return this.parseRecord(existing, normalizedTenantId);
    }

    const next = this.defaultRecord(normalizedTenantId, seed);
    await redisWriteOrBlock(
      this.logger,
      `tenant registry ensure write tenant=${normalizedTenantId}`,
      async () => {
        await this.redis.set(this.keyOf(normalizedTenantId), JSON.stringify(next));
        await this.redis.sadd(TENANT_REGISTRY_INDEX_KEY, normalizedTenantId);
      },
    );
    return next;
  }

  async getTenant(tenantId: string): Promise<TenantRegistryRecord> {
    const normalizedTenantId = tenantId.trim();
    const raw = await redisReadWithFallback(
      this.logger,
      `tenant registry get tenant=${normalizedTenantId}`,
      async () => await this.redis.get(this.keyOf(normalizedTenantId)),
      null,
    );
    if (!raw) {
      return this.ensureTenant(normalizedTenantId);
    }
    return this.parseRecord(raw, normalizedTenantId);
  }

  async listTenants(options?: {
    includeInactive?: boolean;
    tenantScope?: string;
    adminView?: boolean;
  }): Promise<TenantRegistryRecord[]> {
    const tenantScope = this.parseOptionalString(options?.tenantScope);
    const includeInactive = options?.includeInactive !== false;
    const adminView = options?.adminView === true;

    if (!adminView && tenantScope) {
      const record = await this.ensureTenant(tenantScope);
      if (!includeInactive && record.inactive) return [];
      return [record];
    }

    const tenantIds = await redisReadWithFallback(
      this.logger,
      'tenant registry list index',
      async () => await this.redis.smembers(TENANT_REGISTRY_INDEX_KEY),
      tenantScope ? [tenantScope] : [],
    );

    if (tenantScope && !tenantIds.includes(tenantScope)) {
      await this.ensureTenant(tenantScope);
      tenantIds.push(tenantScope);
    }

    const uniqueTenantIds = Array.from(new Set(tenantIds.map((item) => item.trim()).filter(Boolean)));
    const rows = await Promise.all(uniqueTenantIds.map((tenantId) => this.getTenant(tenantId)));
    return rows
      .filter((item) => (includeInactive ? !item.archivedAt : !item.inactive && !item.archivedAt))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async createTenant(seed?: Partial<TenantRegistryRecord>): Promise<TenantRegistryRecord> {
    const candidateId =
      this.parseOptionalString(seed?.id) ??
      `tenant_${Date.now().toString(36)}`;
    return this.ensureTenant(candidateId, seed);
  }

  async updateTenant(
    tenantId: string,
    patch: TenantRegistryPatch,
  ): Promise<TenantRegistryRecord> {
    const current = await this.getTenant(tenantId);
    const next: TenantRegistryRecord = {
      ...current,
      ...patch,
      id: current.id,
      quota: Object.prototype.hasOwnProperty.call(patch, 'quota')
        ? this.normalizeQuota(patch.quota)
        : current.quota,
      industryType: Object.prototype.hasOwnProperty.call(patch, 'industryType')
        ? this.parseOptionalString(patch.industryType)
        : current.industryType,
      industryCategoryTag: Object.prototype.hasOwnProperty.call(patch, 'industryCategoryTag')
        ? this.parseOptionalString(patch.industryCategoryTag)
        : current.industryCategoryTag,
      businessKeywords: Object.prototype.hasOwnProperty.call(patch, 'businessKeywords')
        ? this.normalizeStringArray(patch.businessKeywords)
        : current.businessKeywords,
      leadScoringWords: Object.prototype.hasOwnProperty.call(patch, 'leadScoringWords')
        ? this.normalizeLeadScoring(patch.leadScoringWords)
        : current.leadScoringWords,
      nodeWorkflowProgress: Object.prototype.hasOwnProperty.call(patch, 'nodeWorkflowProgress')
        ? this.normalizeWorkflowProgress({
            ...current.nodeWorkflowProgress,
            ...patch.nodeWorkflowProgress,
          })
        : current.nodeWorkflowProgress,
      deploymentRegion: Object.prototype.hasOwnProperty.call(patch, 'deploymentRegion')
        ? this.normalizeRegion(patch.deploymentRegion, current.deploymentRegion)
        : current.deploymentRegion,
      storageRegion: Object.prototype.hasOwnProperty.call(patch, 'storageRegion')
        ? this.normalizeRegion(patch.storageRegion, current.storageRegion)
        : current.storageRegion,
      dataResidency: Object.prototype.hasOwnProperty.call(patch, 'dataResidency')
        ? this.normalizeResidency(patch.dataResidency)
        : current.dataResidency,
      icpFilingStatus: Object.prototype.hasOwnProperty.call(patch, 'icpFilingStatus')
        ? this.normalizeIcpStatus(patch.icpFilingStatus)
        : current.icpFilingStatus,
      updatedAt: new Date().toISOString(),
      archivedAt: current.archivedAt,
    };

    await redisWriteOrBlock(
      this.logger,
      `tenant registry update tenant=${tenantId}`,
      async () => {
        await this.redis.set(this.keyOf(tenantId), JSON.stringify(next));
        await this.redis.sadd(TENANT_REGISTRY_INDEX_KEY, tenantId);
      },
    );
    return next;
  }

  async archiveTenant(tenantId: string): Promise<TenantRegistryRecord> {
    const current = await this.getTenant(tenantId);
    const next: TenantRegistryRecord = {
      ...current,
      inactive: true,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await redisWriteOrBlock(
      this.logger,
      `tenant registry archive tenant=${tenantId}`,
      async () => {
        await this.redis.set(this.keyOf(tenantId), JSON.stringify(next));
        await this.redis.sadd(TENANT_REGISTRY_INDEX_KEY, tenantId);
      },
    );
    return next;
  }
}
