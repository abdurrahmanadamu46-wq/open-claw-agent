import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import { isLocalEnv } from '../config/env';

const ACTIVATION_CODE_KEY_PREFIX = 'activation:code:';
const ACTIVATION_CODE_INDEX_PREFIX = 'activation:index:tenant:';
const ACTIVATION_CODE_BOOTSTRAP_ENV = 'LOBSTER_ACTIVATION_BOOTSTRAP_CODES';

export type ActivationCodeStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface ActivationCodeValidationResult {
  ok: boolean;
  code: string;
  reason?: 'ACTIVATION_CODE_NOT_FOUND' | 'ACTIVATION_CODE_NOT_ALLOWED' | 'ACTIVATION_CODE_EXPIRED';
  tenantId?: string;
}

export interface ActivationCodeRecord {
  code: string;
  status: ActivationCodeStatus;
  tenantId?: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface CreateActivationCodeInput {
  tenantId: string;
  expiresAt?: string;
  createdBy?: string;
  code?: string;
}

@Injectable()
export class ActivationCodeService {
  private readonly logger = new Logger(ActivationCodeService.name);
  private readonly bootstrapCodes: Set<string>;

  constructor(private readonly redisService: RedisService) {
    this.bootstrapCodes = this.parseBootstrapCodes(process.env[ACTIVATION_CODE_BOOTSTRAP_ENV]);
  }

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private activationKey(code: string): string {
    return ACTIVATION_CODE_KEY_PREFIX + code;
  }

  private indexKey(tenantId: string): string {
    return `${ACTIVATION_CODE_INDEX_PREFIX}${tenantId}`;
  }

  normalizeCode(rawCode: string): string {
    return rawCode.trim().toUpperCase();
  }

  async validateForConnection(rawCode: string): Promise<ActivationCodeValidationResult> {
    const code = this.normalizeCode(rawCode);
    let record: ActivationCodeRecord | null;
    try {
      record = await this.getActivationCodeRecord(code);
    } catch (err) {
      this.logger.error(
        `[ActivationCode] Redis read failed, reject by fail-closed policy code=${code}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, code, reason: 'ACTIVATION_CODE_NOT_ALLOWED' };
    }
    if (!record) {
      if (this.allowLocalBootstrapCode(code)) {
        return { ok: true, code };
      }
      return { ok: false, code, reason: 'ACTIVATION_CODE_NOT_FOUND' };
    }
    if (record.status !== 'ACTIVE') {
      return {
        ok: false,
        code,
        reason: record.status === 'EXPIRED' ? 'ACTIVATION_CODE_EXPIRED' : 'ACTIVATION_CODE_NOT_ALLOWED',
      };
    }
    if (this.isExpired(record.expiresAt)) {
      await this.markCodeExpired(code);
      return { ok: false, code, reason: 'ACTIVATION_CODE_EXPIRED' };
    }
    return { ok: true, code, tenantId: record.tenantId };
  }

  async createCode(input: CreateActivationCodeInput): Promise<ActivationCodeRecord> {
    const tenantId = input.tenantId.trim();
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    const now = new Date().toISOString();
    const createdBy = input.createdBy?.trim() || 'system';
    const expiresAt = input.expiresAt?.trim() || undefined;
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      throw new Error('expiresAt must be a valid ISO datetime');
    }

    let code = input.code?.trim() ? this.normalizeCode(input.code) : '';
    if (!code) {
      code = await this.generateUniqueCode();
    }

    const key = this.activationKey(code);
    const exists = await this.redis.exists(key);
    if (exists) {
      throw new Error(`activation code already exists: ${code}`);
    }

    await this.redis
      .multi()
      .hset(key, {
        code,
        status: 'ACTIVE',
        tenantId,
        expiresAt: expiresAt || '',
        createdAt: now,
        updatedAt: now,
        createdBy,
      })
      .zadd(this.indexKey(tenantId), Date.now(), code)
      .exec();

    return {
      code,
      status: 'ACTIVE',
      tenantId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      createdBy,
    };
  }

  async listCodes(tenantId: string, limit = 100, status?: ActivationCodeStatus): Promise<ActivationCodeRecord[]> {
    const normalizedTenant = tenantId.trim();
    if (!normalizedTenant) return [];
    const boundedLimit = Math.max(1, Math.min(500, limit));
    const codeIds = await this.redis.zrevrange(this.indexKey(normalizedTenant), 0, boundedLimit - 1);
    if (!codeIds.length) return [];

    const rows: ActivationCodeRecord[] = [];
    for (const codeId of codeIds) {
      const record = await this.getActivationCodeRecord(codeId);
      if (!record) continue;
      if (record.tenantId !== normalizedTenant) continue;
      if (status && record.status !== status) continue;
      rows.push(record);
    }
    return rows;
  }

  async setStatus(
    codeInput: string,
    tenantScope: string,
    status: ActivationCodeStatus,
    options?: { expiresAt?: string },
  ): Promise<ActivationCodeRecord> {
    const code = this.normalizeCode(codeInput);
    const record = await this.getActivationCodeRecord(code);
    if (!record) {
      throw new Error('activation code not found');
    }
    if (record.tenantId && record.tenantId !== tenantScope) {
      throw new Error('activation code tenant mismatch');
    }
    const now = new Date().toISOString();
    const expiresAt = options?.expiresAt?.trim() || record.expiresAt || '';
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      throw new Error('expiresAt must be a valid ISO datetime');
    }
    const tenantId = record.tenantId || tenantScope;
    await this.redis
      .multi()
      .hset(this.activationKey(code), {
        status,
        updatedAt: now,
        tenantId,
        expiresAt,
      })
      .zadd(this.indexKey(tenantId), Date.now(), code)
      .exec();

    return {
      ...record,
      status,
      tenantId,
      expiresAt: expiresAt || undefined,
      updatedAt: now,
    };
  }

  private async generateUniqueCode(): Promise<string> {
    for (let i = 0; i < 10; i += 1) {
      const candidate = this.randomCode();
      const exists = await this.redis.exists(this.activationKey(candidate));
      if (!exists) return candidate;
    }
    throw new Error('failed to generate unique activation code');
  }

  private randomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const block = () =>
      Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${block()}-${block()}-${block()}-${block()}`;
  }

  private async getActivationCodeRecord(code: string): Promise<ActivationCodeRecord | null> {
    const key = this.activationKey(code);
    const hash = await this.redis.hgetall(key);
    if (hash && Object.keys(hash).length > 0) {
      return {
        code,
        status: this.normalizeStatus(hash.status),
        tenantId: hash.tenantId || hash.tenant_id || undefined,
        expiresAt: hash.expiresAt || hash.expires_at || undefined,
        createdAt: hash.createdAt || hash.created_at || undefined,
        updatedAt: hash.updatedAt || hash.updated_at || undefined,
        createdBy: hash.createdBy || hash.created_by || undefined,
      };
    }

    const raw = await this.redis.get(key);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as { status?: string; tenantId?: string; expiresAt?: string };
      return {
        code,
        status: this.normalizeStatus(parsed.status),
        tenantId: parsed.tenantId,
        expiresAt: parsed.expiresAt,
      };
    } catch {
      return { code, status: this.normalizeStatus(raw) };
    }
  }

  private normalizeStatus(rawStatus?: string): ActivationCodeStatus {
    const value = (rawStatus ?? 'ACTIVE').toUpperCase();
    if (value === 'REVOKED') return 'REVOKED';
    if (value === 'EXPIRED') return 'EXPIRED';
    return 'ACTIVE';
  }

  private isExpired(expiresAt?: string): boolean {
    if (!expiresAt) return false;
    const at = Date.parse(expiresAt);
    if (!Number.isFinite(at)) return false;
    return at <= Date.now();
  }

  private async markCodeExpired(code: string): Promise<void> {
    const key = this.activationKey(code);
    await this.redis.hset(key, 'status', 'EXPIRED');
  }

  private allowLocalBootstrapCode(code: string): boolean {
    return isLocalEnv() && this.bootstrapCodes.has(code);
  }

  private parseBootstrapCodes(raw?: string): Set<string> {
    if (!raw) return new Set();
    return new Set(
      raw
        .split(',')
        .map((code) => this.normalizeCode(code))
        .filter(Boolean),
    );
  }
}
