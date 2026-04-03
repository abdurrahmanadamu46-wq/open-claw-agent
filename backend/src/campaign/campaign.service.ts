import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import type { CampaignRecord, CampaignStatus } from './campaign.types';

const CAMPAIGN_KEY_PREFIX = 'campaign:';
const CAMPAIGN_INDEX_PREFIX = 'campaign:index:tenant:';

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private campaignKey(campaignId: string): string {
    return `${CAMPAIGN_KEY_PREFIX}${campaignId}`;
  }

  private indexKey(tenantId: string): string {
    return `${CAMPAIGN_INDEX_PREFIX}${tenantId}`;
  }

  private parseNumber(raw: string | undefined, fallback: number): number {
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(value) ? value : fallback;
  }

  private toRecord(hash: Record<string, string>): CampaignRecord | null {
    const campaignId = hash.campaign_id?.trim();
    const tenantId = hash.tenant_id?.trim();
    if (!campaignId || !tenantId) return null;
    let targetUrls: string[] = [];
    try {
      targetUrls = JSON.parse(hash.target_urls || '[]') as string[];
    } catch {
      targetUrls = [];
    }
    return {
      campaign_id: campaignId,
      tenant_id: tenantId,
      industry_template_id: hash.industry_template_id || 'unknown',
      status: (hash.status as CampaignStatus) || 'PENDING',
      daily_publish_limit: this.parseNumber(hash.daily_publish_limit, 10),
      leads_collected: this.parseNumber(hash.leads_collected, 0),
      created_at: hash.created_at || new Date().toISOString(),
      updated_at: hash.updated_at || hash.created_at || new Date().toISOString(),
      target_urls: Array.isArray(targetUrls) ? targetUrls : [],
    };
  }

  async list(tenantId: string, input: {
    page: number;
    limit: number;
    status?: string;
  }): Promise<{ total: number; list: CampaignRecord[] }> {
    const page = Math.max(1, input.page);
    const limit = Math.max(1, Math.min(100, input.limit));
    const ids = await redisReadWithFallback(
      this.logger,
      `campaign list ids tenant=${tenantId}`,
      async () => this.redis.zrevrange(this.indexKey(tenantId), 0, -1),
      [] as string[],
    );
    if (ids.length === 0) return { total: 0, list: [] };

    const rows: CampaignRecord[] = [];
    for (const id of ids) {
      const hash = await redisReadWithFallback(
        this.logger,
        `campaign hgetall id=${id}`,
        async () => this.redis.hgetall(this.campaignKey(id)),
        {} as Record<string, string>,
      );
      const record = this.toRecord(hash);
      if (!record) continue;
      if (input.status && record.status !== input.status) continue;
      rows.push(record);
    }
    const start = (page - 1) * limit;
    const sliced = rows.slice(start, start + limit);
    return { total: rows.length, list: sliced };
  }

  async create(tenantId: string, payload: {
    industry_template_id: string;
    target_urls: string[];
    publish_strategy?: { daily_limit?: number };
  }): Promise<{ campaign_id: string; status: CampaignStatus }> {
    const campaignId = `CAMP_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    const record: CampaignRecord = {
      campaign_id: campaignId,
      tenant_id: tenantId,
      industry_template_id: payload.industry_template_id || 'unknown',
      status: 'PENDING',
      daily_publish_limit: payload.publish_strategy?.daily_limit ?? 10,
      leads_collected: 0,
      created_at: now,
      updated_at: now,
      target_urls: payload.target_urls ?? [],
    };
    await redisWriteOrBlock(this.logger, `campaign create id=${campaignId}`, async () => {
      await this.redis
        .multi()
        .hset(this.campaignKey(campaignId), {
          campaign_id: record.campaign_id,
          tenant_id: record.tenant_id,
          industry_template_id: record.industry_template_id,
          status: record.status,
          daily_publish_limit: String(record.daily_publish_limit),
          leads_collected: String(record.leads_collected),
          created_at: record.created_at,
          updated_at: record.updated_at,
          target_urls: JSON.stringify(record.target_urls),
        })
        .zadd(this.indexKey(tenantId), Date.now(), campaignId)
        .exec();
      return true;
    });
    return { campaign_id: record.campaign_id, status: record.status };
  }

  async terminate(tenantId: string, campaignId: string): Promise<{ ok: boolean }> {
    const key = this.campaignKey(campaignId);
    const existing = await redisReadWithFallback(
      this.logger,
      `campaign terminate read id=${campaignId}`,
      async () => this.redis.hgetall(key),
      {} as Record<string, string>,
    );
    const record = this.toRecord(existing);
    if (!record || record.tenant_id !== tenantId) {
      return { ok: false };
    }
    await redisWriteOrBlock(this.logger, `campaign terminate id=${campaignId}`, async () => {
      await this.redis
        .multi()
        .hset(key, 'status', 'TERMINATED')
        .hset(key, 'updated_at', new Date().toISOString())
        .exec();
      return true;
    });
    return { ok: true };
  }
}

