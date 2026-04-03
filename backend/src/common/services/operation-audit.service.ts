import { Injectable } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import * as crypto from 'node:crypto';

export interface OperationLogRecord {
  id: string;
  ts: string;
  tenantId?: string;
  userId?: string;
  username?: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  method: string;
  path: string;
  ipAddress?: string;
  requestBody?: string;
  responseStatus: 'success' | 'failed';
  errorMessage?: string;
  duration: number;
}

export interface OperationLogQuery {
  tenantId?: string;
  userId?: string;
  action?: string;
  resource?: string;
  responseStatus?: 'success' | 'failed';
  page?: number;
  limit?: number;
}

const inMemoryOperationLogs: OperationLogRecord[] = [];

@Injectable()
export class OperationAuditService {
  private readonly listKey = 'security:operation_logs';
  private readonly maxItems = 5000;

  constructor(private readonly redisService: RedisService) {}

  async append(record: Omit<OperationLogRecord, 'id' | 'ts'>): Promise<OperationLogRecord> {
    const row: OperationLogRecord = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      ...record,
    };
    const payload = JSON.stringify(row);
    try {
      const redis = this.redisService.getOrThrow();
      const multi = redis.multi();
      multi.lpush(this.listKey, payload);
      multi.ltrim(this.listKey, 0, this.maxItems - 1);
      await multi.exec();
    } catch {
      inMemoryOperationLogs.unshift(row);
      if (inMemoryOperationLogs.length > this.maxItems) {
        inMemoryOperationLogs.length = this.maxItems;
      }
    }
    return row;
  }

  async query(input: OperationLogQuery): Promise<{ items: OperationLogRecord[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Number(input.page ?? 1) || 1);
    const limit = Math.max(1, Math.min(200, Number(input.limit ?? 50) || 50));
    const windowSize = Math.max(limit * page, 500);
    let items: OperationLogRecord[] = [];
    try {
      const redis = this.redisService.getOrThrow();
      const raw = await redis.lrange(this.listKey, 0, windowSize - 1);
      items = raw
        .map((item) => {
          try {
            return JSON.parse(item) as OperationLogRecord;
          } catch {
            return null;
          }
        })
        .filter((item): item is OperationLogRecord => item !== null);
    } catch {
      items = [...inMemoryOperationLogs];
    }

    if (input.tenantId) items = items.filter((item) => item.tenantId === input.tenantId);
    if (input.userId) items = items.filter((item) => item.userId === input.userId);
    if (input.action) items = items.filter((item) => item.action === input.action);
    if (input.resource) items = items.filter((item) => item.resource === input.resource);
    if (input.responseStatus) items = items.filter((item) => item.responseStatus === input.responseStatus);

    const total = items.length;
    const offset = (page - 1) * limit;
    return {
      items: items.slice(offset, offset + limit),
      total,
      page,
      limit,
    };
  }

  sanitizeBody(body: unknown): string {
    if (!body || typeof body !== 'object') return '';
    const cloned = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    const maskFields = ['password', 'apiKey', 'api_key', 'secret', 'token', 'privateKey', 'clientSecret'];
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map((item) => walk(item));
      if (!value || typeof value !== 'object') return value;
      const row = value as Record<string, unknown>;
      for (const key of Object.keys(row)) {
        if (maskFields.includes(key)) {
          row[key] = '***';
        } else {
          row[key] = walk(row[key]);
        }
      }
      return row;
    };
    return JSON.stringify(walk(cloned)).slice(0, 2000);
  }
}
