import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import {
  RADAR_SNIFFING_QUEUE,
} from './autopilot.constants';
import type { RadarSniffingJobPayload } from './autopilot.types';
import { AutopilotCircuitService } from './autopilot-circuit.service';

/**
 * 全自动无人值守引擎 — 心脏起搏器
 * 每 6 小时向 radar_sniffing_queue 投递探针任务；
 * 链式调度由各 Worker 完成（radar -> content_forge -> matrix_dispatch -> lead_harvest）
 */
@Injectable()
export class AutopilotCoordinatorService {
  private readonly logger = new Logger(AutopilotCoordinatorService.name);

  constructor(
    @InjectQueue(RADAR_SNIFFING_QUEUE) private readonly radarQueue: Queue,
    private readonly circuit: AutopilotCircuitService,
  ) {}

  /**
   * 永动机心脏：每 6 小时触发一次，向侦察队列投递探针
   * Cron: 0 点、6 点、12 点、18 点
   */
  @Cron('0 */6 * * *')
  async heartbeat(): Promise<void> {
    if (this.circuit.isCircuitOpen()) {
      this.logger.warn('[Autopilot] Circuit open, skip heartbeat');
      return;
    }

    this.logger.log('[Autopilot] Heartbeat: enqueue radar probe');

    const tenantId = process.env.AUTOPILOT_TENANT_ID ?? 'default-tenant';
    const competitorUrl = process.env.AUTOPILOT_COMPETITOR_URL ?? 'https://example.com/competitor';
    const industryKeywords = (process.env.AUTOPILOT_INDUSTRY_KEYWORDS ?? '爆款,带货,种草')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const jobId = uuidv4();
    const payload: RadarSniffingJobPayload = {
      tenantId,
      competitorUrl,
      industryKeywords,
      jobId,
    };

    await this.radarQueue.add('sniff', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    this.logger.log(`[Autopilot] Radar probe enqueued jobId=${jobId}`);
  }

  /**
   * 手动触发单次探针（用于测试或补跑）
   */
  async triggerProbe(overrides?: Partial<RadarSniffingJobPayload>): Promise<string> {
    if (this.circuit.isCircuitOpen()) {
      throw new Error('Autopilot 已熔断，请检查告警并恢复后再试');
    }

    const tenantId = overrides?.tenantId ?? process.env.AUTOPILOT_TENANT_ID ?? 'default-tenant';
    const competitorUrl = overrides?.competitorUrl ?? process.env.AUTOPILOT_COMPETITOR_URL ?? 'https://example.com/competitor';
    const industryKeywords = overrides?.industryKeywords ?? (process.env.AUTOPILOT_INDUSTRY_KEYWORDS ?? '爆款,带货,种草').split(',').map((s) => s.trim()).filter(Boolean);
    const jobId = overrides?.jobId ?? uuidv4();

    const payload: RadarSniffingJobPayload = {
      tenantId,
      competitorUrl,
      industryKeywords,
      jobId,
    };

    const job = await this.radarQueue.add('sniff', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    this.logger.log(`[Autopilot] Manual probe enqueued jobId=${job.id ?? jobId}`);
    return (job.id as string) ?? jobId;
  }

  /** 人工恢复熔断 */
  resetCircuit(): void {
    this.circuit.resetCircuit();
    this.logger.log('[Autopilot] Circuit reset by manual action');
  }
}
