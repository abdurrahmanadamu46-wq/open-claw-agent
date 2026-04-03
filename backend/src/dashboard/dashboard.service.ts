import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback } from '../common/redis-resilience';
import type { DashboardMetrics } from './dashboard.types';

const CAMPAIGN_KEY_PREFIX = 'campaign:';
const CAMPAIGN_INDEX_PREFIX = 'campaign:index:tenant:';
const FLEET_NODE_KEY_PREFIX = 'fleet:node:';

type CampaignRow = {
  status: string;
  createdAt: string;
  leadsCollected: number;
  videosPublished: number;
};

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private toIsoDay(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private async loadCampaignRows(tenantId: string): Promise<CampaignRow[]> {
    const ids = await redisReadWithFallback(
      this.logger,
      `dashboard campaign ids tenant=${tenantId}`,
      async () => this.redis.zrevrange(`${CAMPAIGN_INDEX_PREFIX}${tenantId}`, 0, -1),
      [] as string[],
    );
    if (ids.length === 0) return [];

    const rows: CampaignRow[] = [];
    for (const campaignId of ids) {
      const hash = await redisReadWithFallback(
        this.logger,
        `dashboard campaign read id=${campaignId}`,
        async () => this.redis.hgetall(`${CAMPAIGN_KEY_PREFIX}${campaignId}`),
        {} as Record<string, string>,
      );
      if (!hash || Object.keys(hash).length === 0) continue;
      rows.push({
        status: hash.status || 'PENDING',
        createdAt: hash.created_at || new Date().toISOString(),
        leadsCollected: Number.parseInt(hash.leads_collected || '0', 10) || 0,
        videosPublished: Number.parseInt(hash.videos_published || '0', 10) || 0,
      });
    }
    return rows;
  }

  private async loadFleetHealth(tenantId: string): Promise<{ total: number; healthy: number }> {
    const stream = this.redis.scanStream({ match: `${FLEET_NODE_KEY_PREFIX}*`, count: 200 });
    const keys: string[] = [];
    for await (const chunk of stream as AsyncIterable<string[]>) {
      keys.push(...chunk);
    }
    if (keys.length === 0) return { total: 0, healthy: 0 };

    let total = 0;
    let healthy = 0;
    for (const key of keys) {
      const hash = await redisReadWithFallback(
        this.logger,
        `dashboard fleet read key=${key}`,
        async () => this.redis.hgetall(key),
        {} as Record<string, string>,
      );
      if (!hash || Object.keys(hash).length === 0) continue;
      if ((hash.tenant_id || '').trim() !== tenantId) continue;
      total += 1;
      if (hash.status === 'ONLINE' || hash.status === 'BUSY') {
        healthy += 1;
      }
    }
    return { total, healthy };
  }

  async getMetrics(tenantId: string): Promise<DashboardMetrics> {
    const campaigns = await this.loadCampaignRows(tenantId);
    const fleet = await this.loadFleetHealth(tenantId);

    const activeCampaigns = campaigns.filter(
      (row) => row.status === 'PENDING' || row.status === 'PUBLISHING',
    ).length;
    const totalLeads = campaigns.reduce((sum, row) => sum + row.leadsCollected, 0);
    const totalVideos = campaigns.reduce((sum, row) => sum + row.videosPublished, 0);

    const trendMap = new Map<string, number>();
    const today = new Date();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - offset);
      trendMap.set(this.toIsoDay(d), 0);
    }
    for (const row of campaigns) {
      const day = row.createdAt.slice(0, 10);
      if (!trendMap.has(day)) continue;
      trendMap.set(day, (trendMap.get(day) ?? 0) + row.leadsCollected);
    }
    const chartData = Array.from(trendMap.entries()).map(([date, leads]) => ({ date, leads }));
    const todayLeads = chartData.at(-1)?.leads ?? 0;
    const yesterdayLeads = chartData.at(-2)?.leads ?? 0;
    const growth =
      yesterdayLeads === 0
        ? todayLeads > 0
          ? 100
          : 0
        : Math.round(((todayLeads - yesterdayLeads) / yesterdayLeads) * 100);

    const nodeHealthRate = fleet.total === 0 ? 0 : Math.round((fleet.healthy / fleet.total) * 100);

    return {
      total_leads_today: todayLeads || totalLeads,
      leads_growth_rate: `${growth}%`,
      active_campaigns: activeCampaigns,
      total_videos_published: totalVideos,
      node_health_rate: `${nodeHealthRate}%`,
      chart_data_7days: chartData,
    };
  }
}

