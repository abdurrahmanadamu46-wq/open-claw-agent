import { Injectable, Logger } from '@nestjs/common';

export interface UpsertDeviceInput {
  tenant_id: string;
  machine_code: string;
  status: string;
}

/**
 * 设备持久化：此处为内存占位，生产替换为 TypeORM/Prisma ClientDevice 表
 */
@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);
  private readonly store = new Map<string, UpsertDeviceInput>();

  async upsertDevice(input: UpsertDeviceInput): Promise<void> {
    const key = `${input.tenant_id}:${input.machine_code}`;
    this.store.set(key, input);
    this.logger.log(`[Device] upsert ${key} status=${input.status}`);
  }
}
