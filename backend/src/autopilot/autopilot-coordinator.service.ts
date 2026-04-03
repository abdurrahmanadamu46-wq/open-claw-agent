import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { RADAR_SNIFFING_QUEUE } from './autopilot.constants';
import type { RadarSniffingJobPayload } from './autopilot.types';
import { AutopilotCircuitService } from './autopilot-circuit.service';
import { resolveTaskId } from './autopilot-task-id';
import { AutopilotTaskStateService } from './autopilot-task-state.service';
import { ensureTraceId } from './autopilot-trace.util';
import { emitStructuredLog } from '../common/structured-log';

@Injectable()
export class AutopilotCoordinatorService {
  private readonly logger = new Logger(AutopilotCoordinatorService.name);

  constructor(
    @InjectQueue(RADAR_SNIFFING_QUEUE) private readonly radarQueue: Queue,
    private readonly circuit: AutopilotCircuitService,
    private readonly taskStateService: AutopilotTaskStateService,
  ) {}

  @Cron('0 */6 * * *')
  async heartbeat(): Promise<void> {
    if (this.circuit.isCircuitOpen()) {
      this.logger.warn('[Autopilot] Circuit open, skip heartbeat');
      return;
    }

    const tenantId = process.env.AUTOPILOT_TENANT_ID ?? 'default-tenant';
    const competitorUrl = process.env.AUTOPILOT_COMPETITOR_URL?.trim();
    if (!competitorUrl) {
      this.logger.warn('[Autopilot] AUTOPILOT_COMPETITOR_URL missing, skip heartbeat enqueue');
      return;
    }
    const industryKeywords = (process.env.AUTOPILOT_INDUSTRY_KEYWORDS ?? '爆款,带货,种草')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const jobId = uuidv4();
    const traceId = ensureTraceId();

    const payload: RadarSniffingJobPayload = {
      tenantId,
      competitorUrl,
      industryKeywords,
      jobId,
      traceId,
    };

    await this.radarQueue.add('sniff', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    emitStructuredLog(this.logger, 'log', {
      service: AutopilotCoordinatorService.name,
      eventType: 'queue.enqueue',
      message: 'autopilot heartbeat enqueued radar job',
      traceId,
      tenantId,
      campaignId: 'RADAR',
      nodeId: 'cloud',
      taskId: resolveTaskId(payload),
      queueName: RADAR_SNIFFING_QUEUE,
      jobName: 'sniff',
      trigger: 'heartbeat',
    });
    await this.taskStateService.markQueued({
      taskId: resolveTaskId(payload),
      traceId,
      stage: 'radar_sniffing',
      tenantId,
      campaignId: 'RADAR',
      sourceQueue: RADAR_SNIFFING_QUEUE,
      nodeId: 'cloud',
      meta: { trigger: 'heartbeat', traceId },
    });
    this.logger.log(`[Autopilot] Heartbeat probe enqueued jobId=${jobId} traceId=${traceId}`);
  }

  async triggerProbe(overrides?: Partial<RadarSniffingJobPayload>): Promise<{ jobId: string; traceId: string }> {
    if (this.circuit.isCircuitOpen()) {
      throw new Error('Autopilot circuit is open. Reset circuit before triggering probe.');
    }

    const tenantId = overrides?.tenantId ?? process.env.AUTOPILOT_TENANT_ID ?? 'default-tenant';
    const competitorUrl = (overrides?.competitorUrl ?? process.env.AUTOPILOT_COMPETITOR_URL ?? '').trim();
    if (!competitorUrl) {
      throw new Error('AUTOPILOT_COMPETITOR_URL is required for triggerProbe');
    }
    const industryKeywords =
      overrides?.industryKeywords ??
      (process.env.AUTOPILOT_INDUSTRY_KEYWORDS ?? '爆款,带货,种草')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const jobId = overrides?.jobId ?? uuidv4();
    const traceId = ensureTraceId(overrides?.traceId);

    const payload: RadarSniffingJobPayload = {
      tenantId,
      competitorUrl,
      industryKeywords,
      jobId,
      traceId,
    };

    const job = await this.radarQueue.add('sniff', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    emitStructuredLog(this.logger, 'log', {
      service: AutopilotCoordinatorService.name,
      eventType: 'queue.enqueue',
      message: 'autopilot manual probe enqueued radar job',
      traceId,
      tenantId,
      campaignId: 'RADAR',
      nodeId: 'cloud',
      taskId: resolveTaskId(payload),
      queueName: RADAR_SNIFFING_QUEUE,
      jobName: 'sniff',
      trigger: 'manual',
    });
    await this.taskStateService.markQueued({
      taskId: resolveTaskId(payload),
      traceId,
      stage: 'radar_sniffing',
      tenantId,
      campaignId: 'RADAR',
      sourceQueue: RADAR_SNIFFING_QUEUE,
      nodeId: 'cloud',
      meta: { trigger: 'manual', traceId },
    });
    const queuedJobId = (job.id as string) ?? jobId;
    this.logger.log(`[Autopilot] Manual probe enqueued jobId=${queuedJobId} traceId=${traceId}`);
    return { jobId: queuedJobId, traceId };
  }

  resetCircuit(): void {
    this.circuit.resetCircuit();
    this.logger.log('[Autopilot] Circuit reset by manual action');
  }
}
