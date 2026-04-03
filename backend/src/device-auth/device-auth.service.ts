import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { DeviceService } from '../device/device.service';
import { AgentCCGateway } from '../gateway/agent-cc.gateway';

type TicketStatus = 'PENDING' | 'SCANNED' | 'CONFIRMED';

interface TicketPayload {
  machine_code: string;
  status: TicketStatus;
  created_at: number;
}

@Injectable()
export class DeviceAuthService {
  private readonly logger = new Logger(DeviceAuthService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly jwtService: JwtService,
    private readonly deviceService: DeviceService,
    private readonly agentGateway: AgentCCGateway,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async createBindTicket(machineCode: string) {
    if (!machineCode?.trim()) {
      throw new BadRequestException('Machine code is required');
    }

    const ticketId = `TICKET_${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;
    const redisKey = `device_bind:${ticketId}`;

    const ticketPayload: TicketPayload = {
      machine_code: machineCode.trim(),
      status: 'PENDING',
      created_at: Date.now(),
    };

    await this.redis.set(redisKey, JSON.stringify(ticketPayload), 'EX', 300);
    this.logger.log(`[Auth] Bind ticket ${ticketId} for ${machineCode}`);

    return {
      ticket_id: ticketId,
      expires_in: 300,
      ws_room: `auth_room_${ticketId}`,
    };
  }

  async confirmTicketAndBind(tenantId: string, ticketId: string) {
    const redisKey = `device_bind:${ticketId}`;
    const ticketDataStr = await this.redis.get(redisKey);
    if (!ticketDataStr) {
      throw new BadRequestException('ticket expired or invalid, please refresh on client');
    }

    const ticketData = JSON.parse(ticketDataStr) as TicketPayload;
    if (ticketData.status !== 'PENDING') {
      throw new BadRequestException('ticket already consumed');
    }

    await this.deviceService.upsertDevice({
      tenant_id: tenantId,
      machine_code: ticketData.machine_code,
      status: 'ONLINE',
    });

    const accessToken = this.jwtService.sign({
      sub: ticketData.machine_code,
      tenantId,
      role: 'agent_node',
    });

    // Burn after successful bind.
    await this.redis.del(redisKey);

    const wsRoom = `auth_room_${ticketId}`;
    this.agentGateway.emitAuthSuccess(wsRoom, {
      message: 'bind ok',
      access_token: accessToken,
      tenant_id: tenantId,
    });

    this.logger.log(`[Auth] Device ${ticketData.machine_code} bound to tenant ${tenantId} via ${ticketId}`);
    return { success: true, message: 'device bound' };
  }

  async listBoundDevices(tenantId: string, limit = 100) {
    return this.deviceService.listDevices(tenantId, limit);
  }
}
