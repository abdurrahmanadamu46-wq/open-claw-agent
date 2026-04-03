import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { LEAD_HARVEST_QUEUE } from '../autopilot.constants';
import type { LeadHarvestJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
import { AutopilotIdempotencyService } from '../autopilot-idempotency.service';
import { resolveTaskId } from '../autopilot-task-id';
import { classifyAutopilotError } from '../autopilot-error';
import { AutopilotDlqService } from '../autopilot-dlq.service';
import { AutopilotTaskStateService } from '../autopilot-task-state.service';
import { emitStructuredLog } from '../../common/structured-log';
import { AutopilotMetricsService } from '../autopilot-metrics.service';

/**
 * 线索收割队列 Worker：闭环最后一环，收割评论/私信线索并推送 Webhook
 */
@Processor(LEAD_HARVEST_QUEUE)
export class LeadHarvestWorker extends WorkerHost {
  private readonly logger = new Logger(LeadHarvestWorker.name);

  constructor(
    private readonly circuit: AutopilotCircuitService,
    private readonly idempotency: AutopilotIdempotencyService,
    private readonly dlqService: AutopilotDlqService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly metricsService: AutopilotMetricsService,
  ) {
    super();
  }

  async process(job: Job<LeadHarvestJobPayload>): Promise<void> {
    const { tenantId, campaignId, publishedAt, jobId, traceId } = job.data;
    const taskId = resolveTaskId(job.data);
    emitStructuredLog(this.logger, 'log', {
      service: LeadHarvestWorker.name,
      eventType: 'queue.dequeue',
      message: 'lead harvest worker dequeued job',
      traceId,
      tenantId,
      campaignId,
      nodeId: 'cloud',
      taskId,
      queueName: LEAD_HARVEST_QUEUE,
      queueJobId: String(job.id ?? jobId),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
    this.logger.log(`[traceId=${traceId}] [LeadHarvest] Processing job ${job.id} tenant=${tenantId} campaign=${campaignId}`);
    const claimed = await this.idempotency.claim({
      tenantId,
      campaignId,
      taskId,
      nodeId: 'cloud',
      stage: 'lead_harvest',
    });
    if (!claimed) {
      this.logger.warn(`[traceId=${traceId}] [LeadHarvest] Duplicate job ignored tenant=${tenantId} campaign=${campaignId} jobId=${jobId}`);
      return;
    }
    await this.taskStateService.markRunning({
      taskId,
      traceId,
      stage: 'lead_harvest',
      tenantId,
      campaignId,
      sourceQueue: LEAD_HARVEST_QUEUE,
      nodeId: 'cloud',
    });

    try {
      await this.harvestLeads(tenantId, campaignId, publishedAt);
      this.circuit.recordSuccess(LEAD_HARVEST_QUEUE);
      await this.taskStateService.markSuccess({
        taskId,
        traceId,
        stage: 'lead_harvest',
        tenantId,
        campaignId,
        sourceQueue: LEAD_HARVEST_QUEUE,
        nodeId: 'cloud',
      });
      this.logger.log(`[traceId=${traceId}] [LeadHarvest] Job ${job.id} done`);
      emitStructuredLog(this.logger, 'log', {
        service: LeadHarvestWorker.name,
        eventType: 'queue.process.success',
        message: 'lead harvest worker processed job successfully',
        traceId,
        tenantId,
        campaignId,
        nodeId: 'cloud',
        taskId,
        queueName: LEAD_HARVEST_QUEUE,
        queueJobId: String(job.id ?? jobId),
      });
    } catch (err) {
      this.logger.warn(`[traceId=${traceId}] [LeadHarvest] Job ${job.id} failed`, err);
      this.circuit.recordFailure(LEAD_HARVEST_QUEUE);
      const classification = classifyAutopilotError(err);
      const maxAttempts = job.opts.attempts ?? 1;
      const attemptsMade = job.attemptsMade + 1;
      const terminal = !classification.retryable || attemptsMade >= maxAttempts;
      await this.metricsService.recordQueueProcessFail({ tenantId, queueName: LEAD_HARVEST_QUEUE });
      emitStructuredLog(this.logger, classification.retryable ? 'warn' : 'error', {
        service: LeadHarvestWorker.name,
        eventType: 'queue.process.fail',
        message: 'lead harvest worker failed to process job',
        traceId,
        tenantId,
        campaignId,
        nodeId: 'cloud',
        taskId,
        queueName: LEAD_HARVEST_QUEUE,
        queueJobId: String(job.id ?? jobId),
        errorCode: classification.code,
        retryable: classification.retryable,
        attemptsMade,
        maxAttempts,
        terminal,
      });
      if (terminal) {
        await this.taskStateService.markFailed({
          taskId,
          traceId,
          stage: 'lead_harvest',
          tenantId,
          campaignId,
          sourceQueue: LEAD_HARVEST_QUEUE,
          nodeId: 'cloud',
          errorCode: classification.code,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        await this.dlqService.enqueue(LEAD_HARVEST_QUEUE, {
          sourceQueue: LEAD_HARVEST_QUEUE,
          sourceJobId: String(job.id ?? jobId),
          tenantId,
          traceId,
          campaignId,
          taskId,
          nodeId: 'cloud',
          stage: 'lead_harvest',
          errorCode: classification.code,
          errorMessage: err instanceof Error ? err.message : String(err),
          retryable: classification.retryable,
          attemptsMade,
          maxAttempts,
          originalPayload: job.data,
          failedAt: new Date().toISOString(),
        });
      }
      if (!classification.retryable) {
        throw new UnrecoverableError(classification.code);
      }
      throw err;
    }
  }

  private async harvestLeads(
    tenantId: string,
    campaignId: string,
    publishedAt: string,
  ): Promise<void> {
    // 实际：轮询/订阅各平台评论与私信，高意向线索入 Webhook 队列
    await new Promise((r) => setTimeout(r, 200));
    this.logger.log(`[LeadHarvest] Harvested campaign ${campaignId} at ${publishedAt}`);
  }
}
