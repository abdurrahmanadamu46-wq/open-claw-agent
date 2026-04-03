import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import type { BehaviorBiasPolicyRecord, BehaviorBiasWeights } from './types';

const BIAS_POLICY_KEY_PREFIX = 'behavior:bias-policy:';

const DEFAULT_WEIGHTS: BehaviorBiasWeights = {
  intentWeight: 0.45,
  memoryWeight: 0.35,
  personaWeight: 0.2,
  aggressivenessBoost: 0.05,
};

export type BehaviorBiasPolicyScope = {
  tenant_id?: string;
  template_id?: string;
};

export type BehaviorBiasPolicyUpsertInput = {
  tenant_id: string;
  template_id?: string;
  weights: Partial<BehaviorBiasWeights>;
};

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

@Injectable()
export class BehaviorBiasPolicyService {
  private readonly logger = new Logger(BehaviorBiasPolicyService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private keyFor(scope: BehaviorBiasPolicyScope): string | undefined {
    const tenantId = scope.tenant_id?.trim();
    const templateId = scope.template_id?.trim();
    if (!tenantId) return undefined;
    if (!templateId) return `${BIAS_POLICY_KEY_PREFIX}tenant:${tenantId}`;
    return `${BIAS_POLICY_KEY_PREFIX}tenant:${tenantId}:template:${templateId}`;
  }

  private normalizeWeights(
    weights: Partial<BehaviorBiasWeights> | undefined,
    fallback: BehaviorBiasWeights,
  ): BehaviorBiasWeights {
    const intent = clamp01(weights?.intentWeight ?? fallback.intentWeight, fallback.intentWeight);
    const memory = clamp01(weights?.memoryWeight ?? fallback.memoryWeight, fallback.memoryWeight);
    const persona = clamp01(weights?.personaWeight ?? fallback.personaWeight, fallback.personaWeight);
    const total = intent + memory + persona;
    const normalizedTotal = total > 0 ? total : 1;

    return {
      intentWeight: intent / normalizedTotal,
      memoryWeight: memory / normalizedTotal,
      personaWeight: persona / normalizedTotal,
      aggressivenessBoost: clamp01(
        weights?.aggressivenessBoost ?? fallback.aggressivenessBoost,
        fallback.aggressivenessBoost,
      ),
    };
  }

  private buildRecord(
    scope: BehaviorBiasPolicyScope,
    source: BehaviorBiasPolicyRecord['source'],
    weights: Partial<BehaviorBiasWeights> | undefined,
  ): BehaviorBiasPolicyRecord {
    return {
      tenant_id: scope.tenant_id?.trim() || undefined,
      template_id: scope.template_id?.trim() || undefined,
      source,
      updated_at: new Date().toISOString(),
      weights: this.normalizeWeights(weights, DEFAULT_WEIGHTS),
    };
  }

  private parseRecord(raw: string | null): BehaviorBiasPolicyRecord | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<BehaviorBiasPolicyRecord>;
      if (!parsed || typeof parsed !== 'object') return null;
      const source =
        parsed.source === 'tenant_template' || parsed.source === 'tenant' || parsed.source === 'default'
          ? parsed.source
          : 'default';
      return {
        tenant_id: typeof parsed.tenant_id === 'string' ? parsed.tenant_id : undefined,
        template_id: typeof parsed.template_id === 'string' ? parsed.template_id : undefined,
        source,
        updated_at:
          typeof parsed.updated_at === 'string' && parsed.updated_at.trim()
            ? parsed.updated_at
            : new Date().toISOString(),
        weights: this.normalizeWeights(parsed.weights, DEFAULT_WEIGHTS),
      };
    } catch {
      return null;
    }
  }

  async resolvePolicy(scope: BehaviorBiasPolicyScope): Promise<BehaviorBiasPolicyRecord> {
    const tenantId = scope.tenant_id?.trim();
    const templateId = scope.template_id?.trim();

    if (tenantId && templateId) {
      const record = await redisReadWithFallback(
        this.logger,
        `behavior bias policy tenant+template tenant=${tenantId} template=${templateId}`,
        async () => this.parseRecord(await this.redis.get(this.keyFor({ tenant_id: tenantId, template_id: templateId })!)),
        null as BehaviorBiasPolicyRecord | null,
      );
      if (record) return record;
    }

    if (tenantId) {
      const record = await redisReadWithFallback(
        this.logger,
        `behavior bias policy tenant tenant=${tenantId}`,
        async () => this.parseRecord(await this.redis.get(this.keyFor({ tenant_id: tenantId })!)),
        null as BehaviorBiasPolicyRecord | null,
      );
      if (record) return record;
      return this.buildRecord({ tenant_id: tenantId }, 'default', DEFAULT_WEIGHTS);
    }

    return this.buildRecord({}, 'default', DEFAULT_WEIGHTS);
  }

  async upsertPolicy(input: BehaviorBiasPolicyUpsertInput): Promise<BehaviorBiasPolicyRecord> {
    const tenantId = input.tenant_id?.trim();
    const templateId = input.template_id?.trim();
    const source: BehaviorBiasPolicyRecord['source'] = templateId ? 'tenant_template' : 'tenant';
    const current = await this.resolvePolicy({ tenant_id: tenantId, template_id: templateId });
    const next = this.buildRecord(
      { tenant_id: tenantId, template_id: templateId },
      source,
      this.normalizeWeights(input.weights, current.weights),
    );
    const key = this.keyFor({ tenant_id: tenantId, template_id: templateId });
    if (!key) {
      throw new Error('tenant_id is required');
    }
    await redisWriteOrBlock(this.logger, `behavior bias upsert tenant=${tenantId}`, async () => {
      await this.redis.set(key, JSON.stringify(next));
      return true;
    });
    return next;
  }
}
