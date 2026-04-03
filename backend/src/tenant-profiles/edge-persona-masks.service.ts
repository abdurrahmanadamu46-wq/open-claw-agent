import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { redisReadWithFallback, redisWriteOrBlock } from '../common/redis-resilience';
import {
  EDGE_PERSONA_MASKS_TABLE,
  type EdgePersonaMaskProfile,
  type EdgePersonaMasksDocument,
  type EdgePersonaMasksPatch,
} from './tenant-profiles.types';

const EDGE_PERSONA_MASKS_KEY_PREFIX = `${EDGE_PERSONA_MASKS_TABLE}:`;

@Injectable()
export class EdgePersonaMasksService {
  private readonly logger = new Logger(EdgePersonaMasksService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private keyOf(tenantId: string): string {
    return `${EDGE_PERSONA_MASKS_KEY_PREFIX}${tenantId}`;
  }

  private defaultDocument(tenantId: string): EdgePersonaMasksDocument {
    return {
      table: EDGE_PERSONA_MASKS_TABLE,
      tenantId,
      version: 1,
      updatedAt: new Date().toISOString(),
      masks: {},
      nodeAssignments: {},
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const normalized = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return Array.from(new Set(normalized));
  }

  private normalizeMaskPatch(
    patch: Partial<EdgePersonaMaskProfile> | undefined,
    fallback: EdgePersonaMaskProfile | undefined,
  ): EdgePersonaMaskProfile {
    const base: EdgePersonaMaskProfile = fallback ?? { name: 'Unnamed mask' };
    const nextInterests =
      patch && Object.prototype.hasOwnProperty.call(patch, 'interests')
        ? this.normalizeStringArray(patch.interests)
        : this.normalizeStringArray(base.interests);
    const nextWindows =
      patch && Object.prototype.hasOwnProperty.call(patch, 'activityWindows')
        ? this.normalizeStringArray(patch.activityWindows)
        : this.normalizeStringArray(base.activityWindows);
    return {
      ...base,
      ...patch,
      name: typeof patch?.name === 'string' && patch.name.trim() ? patch.name.trim() : base.name,
      interests: nextInterests,
      activityWindows: nextWindows,
      updatedAt: new Date().toISOString(),
    };
  }

  private normalizeNodeAssignments(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object') return {};
    const raw = value as Record<string, unknown>;
    const normalized: Record<string, string[]> = {};
    for (const [nodeId, maskIds] of Object.entries(raw)) {
      normalized[nodeId] = this.normalizeStringArray(maskIds);
    }
    return normalized;
  }

  private parseDocument(raw: string | null, tenantId: string): EdgePersonaMasksDocument {
    if (!raw) return this.defaultDocument(tenantId);
    try {
      const parsed = JSON.parse(raw) as Partial<EdgePersonaMasksDocument>;
      const masks: Record<string, EdgePersonaMaskProfile> = {};
      for (const [maskId, maskPatch] of Object.entries(parsed.masks ?? {})) {
        masks[maskId] = this.normalizeMaskPatch(maskPatch, undefined);
      }
      return {
        table: EDGE_PERSONA_MASKS_TABLE,
        tenantId,
        version: Number.isFinite(parsed.version) ? Number(parsed.version) : 1,
        updatedAt:
          typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim()
            ? parsed.updatedAt
            : new Date().toISOString(),
        masks,
        nodeAssignments: this.normalizeNodeAssignments(parsed.nodeAssignments),
      };
    } catch {
      return this.defaultDocument(tenantId);
    }
  }

  async getMasks(tenantId: string): Promise<EdgePersonaMasksDocument> {
    const key = this.keyOf(tenantId);
    return redisReadWithFallback(
      this.logger,
      `edge persona masks get tenant=${tenantId}`,
      async () => this.parseDocument(await this.redis.get(key), tenantId),
      this.defaultDocument(tenantId),
    );
  }

  private async getMasksForWrite(tenantId: string): Promise<EdgePersonaMasksDocument> {
    const key = this.keyOf(tenantId);
    const raw = await redisWriteOrBlock(
      this.logger,
      `edge persona masks get-for-write tenant=${tenantId}`,
      async () => this.redis.get(key),
    );
    return this.parseDocument(raw, tenantId);
  }

  async updateMasks(
    tenantId: string,
    patch: EdgePersonaMasksPatch,
  ): Promise<EdgePersonaMasksDocument> {
    const current = await this.getMasksForWrite(tenantId);
    const mergedMasks: Record<string, EdgePersonaMaskProfile> = { ...current.masks };
    for (const [maskId, maskPatch] of Object.entries(patch.masks ?? {})) {
      const previous = mergedMasks[maskId];
      mergedMasks[maskId] = this.normalizeMaskPatch(maskPatch, previous);
    }

    const mergedAssignments = Object.prototype.hasOwnProperty.call(patch, 'nodeAssignments')
      ? this.normalizeNodeAssignments(patch.nodeAssignments)
      : current.nodeAssignments;

    const next: EdgePersonaMasksDocument = {
      ...current,
      version: Number.isFinite(patch.version) ? Number(patch.version) : current.version,
      masks: mergedMasks,
      nodeAssignments: mergedAssignments,
      updatedAt: new Date().toISOString(),
    };

    await redisWriteOrBlock(
      this.logger,
      `edge persona masks update tenant=${tenantId}`,
      async () => this.redis.set(this.keyOf(tenantId), JSON.stringify(next)),
    );
    return next;
  }
}
