import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MATRIX_DISPATCH_QUEUE, LEAD_HARVEST_QUEUE } from '../autopilot.constants';
import type { MatrixDispatchJobPayload, LeadHarvestJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
import { AutopilotIdempotencyService } from '../autopilot-idempotency.service';
import { resolveTaskId } from '../autopilot-task-id';
import { classifyAutopilotError } from '../autopilot-error';
import { AutopilotDlqService } from '../autopilot-dlq.service';
import { AutopilotTaskStateService } from '../autopilot-task-state.service';
import { FleetWebSocketGateway } from '../../gateway/fleet-websocket.gateway';
import type { LobsterTaskPayload } from '../../gateway/lobster-sop.types';
import { emitStructuredLog } from '../../common/structured-log';
import { AutopilotMetricsService } from '../autopilot-metrics.service';

@Processor(MATRIX_DISPATCH_QUEUE)
export class MatrixDispatchWorker extends WorkerHost {
  private readonly logger = new Logger(MatrixDispatchWorker.name);

  constructor(
    @InjectQueue(LEAD_HARVEST_QUEUE) private readonly leadHarvestQueue: Queue,
    private readonly circuit: AutopilotCircuitService,
    private readonly idempotency: AutopilotIdempotencyService,
    private readonly dlqService: AutopilotDlqService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly fleetGateway: FleetWebSocketGateway,
    private readonly metricsService: AutopilotMetricsService,
  ) {
    super();
  }

  async process(job: Job<MatrixDispatchJobPayload>): Promise<LeadHarvestJobPayload | void> {
    const { tenantId, videoUrl, script, nodeIds, scheduledAt, jobId, traceId } = job.data;
    const taskId = resolveTaskId(job.data);
    emitStructuredLog(this.logger, 'log', {
      service: MatrixDispatchWorker.name,
      eventType: 'queue.dequeue',
      message: 'matrix dispatch worker dequeued job',
      traceId,
      tenantId,
      campaignId: 'MATRIX_DISPATCH',
      nodeId: 'cloud',
      taskId,
      queueName: MATRIX_DISPATCH_QUEUE,
      queueJobId: String(job.id ?? jobId),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
    this.logger.log(`[traceId=${traceId}] [MatrixDispatch] Processing job ${job.id} tenant=${tenantId} nodes=${nodeIds.length}`);
    const claimed = await this.idempotency.claim({
      tenantId,
      campaignId: 'MATRIX_DISPATCH',
      taskId,
      nodeId: 'cloud',
      stage: 'matrix_dispatch',
    });
    if (!claimed) {
      this.logger.warn(`[traceId=${traceId}] [MatrixDispatch] Duplicate job ignored tenant=${tenantId} jobId=${jobId}`);
      return;
    }
    await this.taskStateService.markRunning({
      taskId,
      traceId,
      stage: 'matrix_dispatch',
      tenantId,
      campaignId: 'MATRIX_DISPATCH',
      sourceQueue: MATRIX_DISPATCH_QUEUE,
      nodeId: 'cloud',
    });

    try {
      const campaignId = `CAMP_${jobId}`;
      await this.dispatchToNodes(tenantId, campaignId, taskId, traceId, nodeIds, { videoUrl, script, scheduledAt });

      this.circuit.recordSuccess(MATRIX_DISPATCH_QUEUE);

      const nextPayload: LeadHarvestJobPayload = {
        tenantId,
        campaignId,
        publishedAt: new Date().toISOString(),
        jobId,
        traceId,
        replay: job.data.replay,
      };
      await this.leadHarvestQueue.add('harvest', nextPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
      emitStructuredLog(this.logger, 'log', {
        service: MatrixDispatchWorker.name,
        eventType: 'queue.enqueue',
        message: 'matrix dispatch worker enqueued lead harvest job',
        traceId,
        tenantId,
        campaignId,
        nodeId: 'cloud',
        taskId: resolveTaskId(nextPayload),
        queueName: LEAD_HARVEST_QUEUE,
        queueJobId: String(job.id ?? jobId),
      });
      await this.taskStateService.markSuccess({
        taskId,
        traceId,
        stage: 'matrix_dispatch',
        tenantId,
        campaignId,
        sourceQueue: MATRIX_DISPATCH_QUEUE,
        nodeId: 'cloud',
      });
      await this.taskStateService.markQueued({
        taskId: resolveTaskId(nextPayload),
        traceId,
        stage: 'lead_harvest',
        tenantId,
        campaignId,
        sourceQueue: LEAD_HARVEST_QUEUE,
        nodeId: 'cloud',
      });
      this.logger.log(`[traceId=${traceId}] [MatrixDispatch] Job ${job.id} done, enqueued lead_harvest`);
      emitStructuredLog(this.logger, 'log', {
        service: MatrixDispatchWorker.name,
        eventType: 'queue.process.success',
        message: 'matrix dispatch worker processed job successfully',
        traceId,
        tenantId,
        campaignId,
        nodeId: 'cloud',
        taskId,
        queueName: MATRIX_DISPATCH_QUEUE,
        queueJobId: String(job.id ?? jobId),
      });
      return nextPayload;
    } catch (err) {
      this.logger.warn(`[traceId=${traceId}] [MatrixDispatch] Job ${job.id} failed`, err);
      this.circuit.recordFailure(MATRIX_DISPATCH_QUEUE);
      const classification = classifyAutopilotError(err);
      const maxAttempts = job.opts.attempts ?? 1;
      const attemptsMade = job.attemptsMade + 1;
      const terminal = !classification.retryable || attemptsMade >= maxAttempts;
      await this.metricsService.recordQueueProcessFail({ tenantId, queueName: MATRIX_DISPATCH_QUEUE });
      emitStructuredLog(this.logger, classification.retryable ? 'warn' : 'error', {
        service: MatrixDispatchWorker.name,
        eventType: 'queue.process.fail',
        message: 'matrix dispatch worker failed to process job',
        traceId,
        tenantId,
        campaignId: `CAMP_${jobId}`,
        nodeId: 'cloud',
        taskId,
        queueName: MATRIX_DISPATCH_QUEUE,
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
          stage: 'matrix_dispatch',
          tenantId,
          campaignId: `CAMP_${jobId}`,
          sourceQueue: MATRIX_DISPATCH_QUEUE,
          nodeId: 'cloud',
          errorCode: classification.code,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        await this.dlqService.enqueue(MATRIX_DISPATCH_QUEUE, {
          sourceQueue: MATRIX_DISPATCH_QUEUE,
          sourceJobId: String(job.id ?? jobId),
          tenantId,
          traceId,
          campaignId: `CAMP_${jobId}`,
          taskId,
          nodeId: 'cloud',
          stage: 'matrix_dispatch',
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

  private async dispatchToNodes(
    tenantId: string,
    campaignId: string,
    taskId: string,
    traceId: string,
    nodeIds: string[],
    payload: { videoUrl: string; script: string; scheduledAt?: string },
  ): Promise<void> {
    for (const nodeId of nodeIds) {
      const nodeClaimed = await this.idempotency.claim({
        tenantId,
        campaignId,
        taskId,
        nodeId,
        stage: 'matrix_dispatch_node',
      });
      if (!nodeClaimed) {
        this.logger.warn(`[traceId=${traceId}] [MatrixDispatch] Duplicate node dispatch ignored node=${nodeId} taskId=${taskId}`);
        continue;
      }
      const wsPayload: LobsterTaskPayload = {
        taskId,
        traceId,
        campaignId,
        actionType: 'UPLOAD_VIDEO',
        params: {
          file_url: payload.videoUrl,
          description: payload.script,
          ...(payload.scheduledAt ? { scheduledAt: payload.scheduledAt } : {}),
        },
        createdAt: new Date().toISOString(),
      };
      this.fleetGateway.dispatchTask(nodeId, wsPayload);
      await new Promise((r) => setTimeout(r, 150));
      this.logger.log(`[traceId=${traceId}] [MatrixDispatch] Dispatched to node=${nodeId}: ${payload.videoUrl}`);
    }
  }
}
