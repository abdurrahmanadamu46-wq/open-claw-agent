import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';

const DEVICE_KEY_PREFIX = 'device:tenant:';
const DEVICE_INDEX_PREFIX = 'device:index:tenant:';

export interface UpsertDeviceInput {
  tenant_id: string;
  machine_code: string;
  status: string;
}

export interface DeviceRecord extends UpsertDeviceInput {
  created_at: string;
  updated_at: string;
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(private readonly redisService: RedisService) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  private deviceKey(tenantId: string, machineCode: string): string {
    return `${DEVICE_KEY_PREFIX}${tenantId}:machine:${machineCode}`;
  }

  private indexKey(tenantId: string): string {
    return `${DEVICE_INDEX_PREFIX}${tenantId}`;
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<void> {
    const tenantId = input.tenant_id.trim();
    const machineCode = input.machine_code.trim();
    const status = input.status.trim() || 'ONLINE';
    if (!tenantId || !machineCode) return;

    const now = new Date().toISOString();
    const key = this.deviceKey(tenantId, machineCode);
    const createdAt = (await this.redis.hget(key, 'created_at')) ?? now;

    await this.redis
      .multi()
      .hset(key, {
        tenant_id: tenantId,
        machine_code: machineCode,
        status,
        created_at: createdAt,
        updated_at: now,
      })
      .zadd(this.indexKey(tenantId), Date.now(), machineCode)
      .exec();
    this.logger.log(`[Device] upsert tenant=${tenantId} machine=${machineCode} status=${status}`);
  }

  async listDevices(tenantId: string, limit = 100): Promise<DeviceRecord[]> {
    const normalizedTenant = tenantId.trim();
    if (!normalizedTenant) return [];
    const boundedLimit = Math.max(1, Math.min(500, limit));
    const machineCodes = await this.redis.zrevrange(this.indexKey(normalizedTenant), 0, boundedLimit - 1);
    if (!machineCodes.length) return [];

    const items: DeviceRecord[] = [];
    for (const machineCode of machineCodes) {
      const hash = await this.redis.hgetall(this.deviceKey(normalizedTenant, machineCode));
      if (!hash || Object.keys(hash).length === 0) continue;
      items.push({
        tenant_id: hash.tenant_id || normalizedTenant,
        machine_code: hash.machine_code || machineCode,
        status: hash.status || 'UNKNOWN',
        created_at: hash.created_at || new Date().toISOString(),
        updated_at: hash.updated_at || hash.created_at || new Date().toISOString(),
      });
    }
    return items;
  }
}
