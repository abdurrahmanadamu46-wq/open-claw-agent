import { Body, Controller, Get, Post } from '@nestjs/common';
import { AutopilotCoordinatorService } from './autopilot-coordinator.service';
import { AutopilotCircuitService } from './autopilot-circuit.service';
import type { RadarSniffingJobPayload } from './autopilot.types';

@Controller('autopilot')
export class AutopilotController {
  constructor(
    private readonly coordinator: AutopilotCoordinatorService,
    private readonly circuit: AutopilotCircuitService,
  ) {}

  /**
   * 熔断状态（供前端展示）
   */
  @Get('status')
  status(): { circuitOpen: boolean } {
    return { circuitOpen: this.circuit.isCircuitOpen() };
  }

  /**
   * 手动触发一次探针（用于测试或补跑）
   */
  @Post('trigger-probe')
  async triggerProbe(
    @Body() body?: Partial<RadarSniffingJobPayload>,
  ): Promise<{ jobId: string }> {
    const jobId = await this.coordinator.triggerProbe(body);
    return { jobId };
  }

  /**
   * 人工恢复熔断
   */
  @Post('reset-circuit')
  resetCircuit(): { ok: boolean } {
    this.coordinator.resetCircuit();
    return { ok: true };
  }
}
