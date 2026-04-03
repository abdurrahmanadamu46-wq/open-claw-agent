import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import type { LeadItem } from './lead.types';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';

const LEAD_KEY_PREFIX = 'lead:tenant:';
const LEAD_INDEX_PREFIX = 'lead:index:tenant:';

type ListParams = {
  page: number;
  limit: number;
  intentScoreMin?: number;
};

export type EdgeLeadIngressPayload = {
  tenant_id: string;
  campaign_id: string;
  contact_info: string;
  intention_score: number;
  source_platform?: string;
  user_message?: string;
  captured_at?: string;
  webhook_status?: LeadItem['webhook_status'];
};

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private leadKey(tenantId: string, leadId: string): string {
    return `${LEAD_KEY_PREFIX}${tenantId}:lead:${leadId}`;
  }

  private indexKey(tenantId: string): string {
    return `${LEAD_INDEX_PREFIX}${tenantId}`;
  }

  private toLeadItem(hash: Record<string, string>): LeadItem | null {
    const leadId = hash.lead_id?.trim();
    const tenantId = hash.tenant_id?.trim();
    if (!leadId || !tenantId) {
      return null;
    }

    return {
      lead_id: leadId,
      campaign_id: hash.campaign_id || 'camp-edge-unknown',
      contact_info: hash.contact_info || '',
      real_contact_info: hash.real_contact_info || '',
      intent_score: this.normalizeScore(Number.parseInt(hash.intent_score || '0', 10)),
      source_platform: hash.source_platform || 'other',
      user_message: hash.user_message || '',
      captured_at: hash.captured_at || new Date().toISOString(),
      webhook_status: (hash.webhook_status as LeadItem['webhook_status']) || 'PENDING',
      tenant_id: tenantId,
    };
  }

  async list(
    tenantId: string,
    params: ListParams,
  ): Promise<{ total: number; list: Omit<LeadItem, 'real_contact_info' | 'tenant_id'>[] }> {
    const ids = await redisReadWithFallback(
      this.logger,
      `lead list ids tenant=${tenantId}`,
      async () => this.redis.zrevrange(this.indexKey(tenantId), 0, -1),
      [] as string[],
    );
    if (ids.length === 0) {
      return { total: 0, list: [] };
    }

    const rows: LeadItem[] = [];
    for (const leadId of ids) {
      const hash = await redisReadWithFallback(
        this.logger,
        `lead read leadId=${leadId}`,
        async () => this.redis.hgetall(this.leadKey(tenantId, leadId)),
        {} as Record<string, string>,
      );
      const item = this.toLeadItem(hash);
      if (item) {
        rows.push(item);
      }
    }

    const filtered = rows.filter((item) => {
      if (typeof params.intentScoreMin !== 'number') return true;
      return item.intent_score >= params.intentScoreMin;
    });
    const offset = (params.page - 1) * params.limit;
    const pageList = filtered.slice(offset, offset + params.limit);
    return {
      total: filtered.length,
      list: pageList.map(({ real_contact_info: _hidden, tenant_id: _tenant, ...item }) => item),
    };
  }

  async reveal(tenantId: string, leadId: string): Promise<{ contact_info: string }> {
    const hash = await redisReadWithFallback(
      this.logger,
      `lead reveal leadId=${leadId}`,
      async () => this.redis.hgetall(this.leadKey(tenantId, leadId)),
      {} as Record<string, string>,
    );
    const matched = this.toLeadItem(hash);
    if (!matched?.real_contact_info) {
      return { contact_info: '' };
    }
    return { contact_info: matched.real_contact_info };
  }

  async ingestFromEdge(payload: EdgeLeadIngressPayload): Promise<LeadItem> {
    const tenantId = payload.tenant_id.trim();
    const campaignId = payload.campaign_id.trim();
    const rawContact = payload.contact_info.trim();
    const capturedAt = payload.captured_at?.trim() || new Date().toISOString();
    const leadId = `${tenantId}-lead-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const item: LeadItem = {
      lead_id: leadId,
      campaign_id: campaignId || 'camp-edge-unknown',
      contact_info: this.maskContact(rawContact),
      real_contact_info: rawContact,
      intent_score: this.normalizeScore(payload.intention_score),
      source_platform: payload.source_platform?.trim() || 'other',
      user_message: payload.user_message?.trim() || '',
      captured_at: capturedAt,
      webhook_status: payload.webhook_status || 'PENDING',
      tenant_id: tenantId,
    };

    await redisWriteOrBlock(this.logger, `lead ingest leadId=${leadId}`, async () => {
      await this.redis
        .multi()
        .hset(this.leadKey(tenantId, item.lead_id), {
          lead_id: item.lead_id,
          campaign_id: item.campaign_id,
          contact_info: item.contact_info,
          real_contact_info: item.real_contact_info,
          intent_score: String(item.intent_score),
          source_platform: item.source_platform,
          user_message: item.user_message,
          captured_at: item.captured_at,
          webhook_status: item.webhook_status,
          tenant_id: item.tenant_id,
        })
        .zadd(this.indexKey(tenantId), Date.parse(item.captured_at) || Date.now(), item.lead_id)
        .exec();
      return true;
    });

    return item;
  }

  async seedDemoLead(payload: EdgeLeadIngressPayload): Promise<LeadItem> {
    return this.ingestFromEdge(payload);
  }

  private normalizeScore(input: number): number {
    if (!Number.isFinite(input)) return 0;
    if (input < 0) return 0;
    if (input > 100) return 100;
    return Math.round(input);
  }

  private maskContact(raw: string): string {
    const normalized = raw.trim();
    if (!normalized) return '';

    if (/^\d{11}$/.test(normalized)) {
      return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
    }

    const wx = /^wx:([\w-]{4,})$/i.exec(normalized);
    if (wx) {
      const id = wx[1];
      return `wx:${id.slice(0, 3)}****`;
    }

    if (normalized.length <= 6) {
      return `${normalized.slice(0, 2)}****`;
    }

    return `${normalized.slice(0, 3)}****${normalized.slice(-2)}`;
  }
}
