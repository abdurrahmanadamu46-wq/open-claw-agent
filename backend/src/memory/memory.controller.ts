/**
 * 弹性记忆 REST — 供 9 大 Agent / 边缘上报 调用
 * 代理到 Python LobsterMemoryEngine 微服务
 */
import { Body, Controller, Get, Post } from '@nestjs/common';
import { LobsterMemoryClientService } from './lobster-memory-client.service';
import type {
  StoreExperiencePayload,
  RetrieveMemoryPayload,
} from './memory.types';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: LobsterMemoryClientService) {}

  @Post('store')
  async store(@Body() body: StoreExperiencePayload) {
    const result = await this.memory.storeExperience(body);
    if (result == null) {
      return { ok: false, message: 'Memory service unavailable' };
    }
    return { ok: true, point_id: result.point_id };
  }

  @Post('retrieve')
  async retrieve(@Body() body: RetrieveMemoryPayload) {
    const memories = await this.memory.retrieveAdaptiveMemory(body);
    return { memories };
  }

  @Get('health')
  async health() {
    const ok = await this.memory.health();
    return { ok, service: 'lobster-memory' };
  }
}
