import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import type {
  AotoCutContractDescriptor,
  AotoCutPackageCreateInput,
  AotoCutPackageRecord,
} from './aoto-cut.types';

const AOTO_CUT_CONTRACT_VERSION = 'aoto-cut.v1';
const AOTO_CUT_PACKAGE_KEY_PREFIX = 'subproject:aoto-cut:package:';
const AOTO_CUT_TENANT_INDEX_PREFIX = 'subproject:aoto-cut:tenant:';

function utcNowIso(): string {
  return new Date().toISOString();
}

@Injectable()
export class AotoCutService {
  private readonly logger = new Logger(AotoCutService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private packageKey(packageId: string): string {
    return `${AOTO_CUT_PACKAGE_KEY_PREFIX}${packageId}`;
  }

  private tenantIndexKey(tenantId: string): string {
    return `${AOTO_CUT_TENANT_INDEX_PREFIX}${tenantId}:packages`;
  }

  getContract(): AotoCutContractDescriptor {
    return {
      subproject: 'Aoto Cut',
      role: 'Lobster Pool content-production subdomain',
      responsibility_mode: 'integration_only',
      owned_modules: [
        'industry_workbench',
        'customer_memory_for_content',
        'template_extraction',
        'topic_generation',
        'script_and_compliance',
        'material_pool',
        'storyboard_package',
        'digital_human_pipeline',
        'final_asset_generation',
        'generated_material_registration',
      ],
      shared_modules: ['publishing_adapter', 'archive_record', 'workflow_context'],
      parent_should_own: [
        'tenant_context',
        'auth',
        'approval_center',
        'lead_scoring',
        'crm',
        'feishu_handoff',
        'global_orchestration',
        'audit_bus',
        'billing',
      ],
      input_objects: [
        'tenant_context',
        'industry_profile',
        'customer_profile',
        'campaign_goal',
        'approval_policy',
        'execution_policy',
      ],
      output_objects: [
        'topic_candidates',
        'script_asset',
        'compliance_report',
        'storyboard_package',
        'material_bundle',
        'media_bundle',
        'archive_record',
        'publish_ready_package',
      ],
      integration_rule:
        'Consume and emit standard objects only. Do not rebuild Aoto Cut content-production pages or duplicate its internal domain models in the parent system.',
      contract_version: AOTO_CUT_CONTRACT_VERSION,
      updated_at: utcNowIso(),
    };
  }

  private summarizePayload(payload: Record<string, unknown>): AotoCutPackageRecord['summary'] {
    const titleCandidates = [
      payload.title,
      payload.name,
      payload.topic_title,
      payload.script_title,
      payload.storyboard_title,
      payload.media_title,
      payload.publish_title,
    ];
    const title =
      titleCandidates.find((item) => typeof item === 'string' && item.trim())?.toString().trim() ||
      'Untitled package';

    const itemCount =
      Object.values(payload).filter((item) => Array.isArray(item)).reduce((acc, item) => acc + item.length, 0) || 1;

    const hasAssets = Object.keys(payload).some((key) =>
      ['asset', 'material', 'media', 'storyboard', 'script'].some((token) => key.includes(token)),
    );

    return {
      title,
      item_count: itemCount,
      has_assets: hasAssets,
    };
  }

  async ingestPackage(input: AotoCutPackageCreateInput): Promise<AotoCutPackageRecord> {
    const packageId = `acpkg_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const now = utcNowIso();
    const record: AotoCutPackageRecord = {
      package_id: packageId,
      tenant_id: input.tenant_id,
      package_type: input.package_type,
      contract_version: input.contract_version?.trim() || AOTO_CUT_CONTRACT_VERSION,
      source: input.source?.trim() || 'aoto-cut',
      trace_id: input.trace_id?.trim() || undefined,
      payload: input.payload,
      summary: this.summarizePayload(input.payload),
      created_by: input.created_by,
      created_at: now,
      updated_at: now,
    };

    await redisWriteOrBlock(this.logger, `aoto-cut ingest package tenant=${input.tenant_id}`, async () => {
      await this.redis.hset(this.packageKey(packageId), {
        tenant_id: record.tenant_id,
        package_type: record.package_type,
        contract_version: record.contract_version,
        source: record.source,
        trace_id: record.trace_id || '',
        payload_json: JSON.stringify(record.payload),
        summary_json: JSON.stringify(record.summary),
        created_by: record.created_by,
        created_at: record.created_at,
        updated_at: record.updated_at,
      });
      await this.redis.zadd(this.tenantIndexKey(record.tenant_id), Date.now(), packageId);
      await this.redis.expire(this.packageKey(packageId), 60 * 60 * 24 * 14);
      await this.redis.expire(this.tenantIndexKey(record.tenant_id), 60 * 60 * 24 * 14);
    });

    return record;
  }

  private fromRedis(packageId: string, row: Record<string, string>): AotoCutPackageRecord {
    const payload = JSON.parse(row.payload_json || '{}');
    const summary = JSON.parse(row.summary_json || '{}');
    return {
      package_id: packageId,
      tenant_id: row.tenant_id || '',
      package_type: row.package_type as AotoCutPackageRecord['package_type'],
      contract_version: row.contract_version || AOTO_CUT_CONTRACT_VERSION,
      source: row.source || 'aoto-cut',
      trace_id: row.trace_id || undefined,
      payload: payload && typeof payload === 'object' ? payload : {},
      summary: summary && typeof summary === 'object'
        ? {
            title: String(summary.title || 'Untitled package'),
            item_count: Number(summary.item_count || 0),
            has_assets: Boolean(summary.has_assets),
          }
        : { title: 'Untitled package', item_count: 0, has_assets: false },
      created_by: row.created_by || '',
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
    };
  }

  async listPackages(input: {
    tenant_id: string;
    package_type?: string;
    limit?: number;
  }): Promise<AotoCutPackageRecord[]> {
    const packageIds = await redisReadWithFallback(
      this.logger,
      `aoto-cut list packages tenant=${input.tenant_id}`,
      async () => await this.redis.zrevrange(this.tenantIndexKey(input.tenant_id), 0, Math.max(0, (input.limit ?? 20) - 1)),
      [],
    );
    const output: AotoCutPackageRecord[] = [];
    for (const packageId of packageIds) {
      const row = await redisReadWithFallback(
        this.logger,
        `aoto-cut read package ${packageId}`,
        async () => await this.redis.hgetall(this.packageKey(packageId)),
        {},
      );
      if (!row || Object.keys(row).length === 0) continue;
      const parsed = this.fromRedis(packageId, row);
      if (input.package_type && parsed.package_type !== input.package_type) continue;
      output.push(parsed);
      if (output.length >= (input.limit ?? 20)) break;
    }
    return output;
  }
}
