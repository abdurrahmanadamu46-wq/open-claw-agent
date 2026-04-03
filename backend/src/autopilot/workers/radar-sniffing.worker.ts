import { Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  RADAR_SNIFFING_QUEUE,
  CONTENT_FORGE_QUEUE,
} from '../autopilot.constants';
import type { RadarSniffingJobPayload } from '../autopilot.types';
import type { ContentForgeJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
import { AutopilotIdempotencyService } from '../autopilot-idempotency.service';
import { resolveTaskId } from '../autopilot-task-id';
import { classifyAutopilotError } from '../autopilot-error';
import { AutopilotDlqService } from '../autopilot-dlq.service';
import { AutopilotTaskStateService } from '../autopilot-task-state.service';
import { emitStructuredLog } from '../../common/structured-log';
import { AutopilotMetricsService } from '../autopilot-metrics.service';

/**
 * Radar queue worker:
 * fetches competitor content and forwards a normalized payload to content_forge.
 */
@Processor(RADAR_SNIFFING_QUEUE)
export class RadarSniffingWorker extends WorkerHost {
  private readonly logger = new Logger(RadarSniffingWorker.name);

  constructor(
    @InjectQueue(CONTENT_FORGE_QUEUE) private readonly contentForgeQueue: Queue,
    private readonly circuit: AutopilotCircuitService,
    private readonly idempotency: AutopilotIdempotencyService,
    private readonly dlqService: AutopilotDlqService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly metricsService: AutopilotMetricsService,
  ) {
    super();
  }

  async process(job: Job<RadarSniffingJobPayload>): Promise<ContentForgeJobPayload | void> {
    const { tenantId, competitorUrl, industryKeywords, jobId, traceId } = job.data;
    const taskId = resolveTaskId(job.data);
    emitStructuredLog(this.logger, 'log', {
      service: RadarSniffingWorker.name,
      eventType: 'queue.dequeue',
      message: 'radar worker dequeued job',
      traceId,
      tenantId,
      campaignId: 'RADAR',
      nodeId: 'cloud',
      taskId,
      queueName: RADAR_SNIFFING_QUEUE,
      queueJobId: String(job.id ?? jobId),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });
    this.logger.log(`[traceId=${traceId}] [Radar] Processing job ${job.id} tenant=${tenantId} url=${competitorUrl}`);
    const claimed = await this.idempotency.claim({
      tenantId,
      campaignId: 'RADAR',
      taskId,
      nodeId: 'cloud',
      stage: 'radar_sniffing',
    });
    if (!claimed) {
      this.logger.warn(`[traceId=${traceId}] [Radar] Duplicate job ignored tenant=${tenantId} jobId=${jobId}`);
      return;
    }
    await this.taskStateService.markRunning({
      taskId,
      traceId,
      stage: 'radar_sniffing',
      tenantId,
      campaignId: 'RADAR',
      sourceQueue: RADAR_SNIFFING_QUEUE,
      nodeId: 'cloud',
    });

    try {
      const viralText = await this.sniffViralContent(competitorUrl, industryKeywords);

      this.circuit.recordSuccess(RADAR_SNIFFING_QUEUE);

      const nextPayload: ContentForgeJobPayload = {
        tenantId,
        viralText,
        sourceUrl: competitorUrl,
        jobId,
        traceId,
        replay: job.data.replay,
      };
      await this.contentForgeQueue.add('forge', nextPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
      emitStructuredLog(this.logger, 'log', {
        service: RadarSniffingWorker.name,
        eventType: 'queue.enqueue',
        message: 'radar worker enqueued content forge job',
        traceId,
        tenantId,
        campaignId: 'CONTENT_FORGE',
        nodeId: 'cloud',
        taskId: resolveTaskId(nextPayload),
        queueName: CONTENT_FORGE_QUEUE,
        queueJobId: String(job.id ?? jobId),
      });
      await this.taskStateService.markSuccess({
        taskId,
        traceId,
        stage: 'radar_sniffing',
        tenantId,
        campaignId: 'RADAR',
        sourceQueue: RADAR_SNIFFING_QUEUE,
        nodeId: 'cloud',
      });
      await this.taskStateService.markQueued({
        taskId: resolveTaskId(nextPayload),
        traceId,
        stage: 'content_forge',
        tenantId,
        campaignId: 'CONTENT_FORGE',
        sourceQueue: CONTENT_FORGE_QUEUE,
        nodeId: 'cloud',
      });
      this.logger.log(`[traceId=${traceId}] [Radar] Job ${job.id} done, enqueued content_forge`);
      emitStructuredLog(this.logger, 'log', {
        service: RadarSniffingWorker.name,
        eventType: 'queue.process.success',
        message: 'radar worker processed job successfully',
        traceId,
        tenantId,
        campaignId: 'RADAR',
        nodeId: 'cloud',
        taskId,
        queueName: RADAR_SNIFFING_QUEUE,
        queueJobId: String(job.id ?? jobId),
      });
      return nextPayload;
    } catch (err) {
      this.logger.warn(`[traceId=${traceId}] [Radar] Job ${job.id} failed`, err);
      this.circuit.recordFailure(RADAR_SNIFFING_QUEUE);
      const classification = classifyAutopilotError(err);
      const maxAttempts = job.opts.attempts ?? 1;
      const attemptsMade = job.attemptsMade + 1;
      const terminal = !classification.retryable || attemptsMade >= maxAttempts;
      await this.metricsService.recordQueueProcessFail({ tenantId, queueName: RADAR_SNIFFING_QUEUE });
      emitStructuredLog(this.logger, classification.retryable ? 'warn' : 'error', {
        service: RadarSniffingWorker.name,
        eventType: 'queue.process.fail',
        message: 'radar worker failed to process job',
        traceId,
        tenantId,
        campaignId: 'RADAR',
        nodeId: 'cloud',
        taskId,
        queueName: RADAR_SNIFFING_QUEUE,
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
          stage: 'radar_sniffing',
          tenantId,
          campaignId: 'RADAR',
          sourceQueue: RADAR_SNIFFING_QUEUE,
          nodeId: 'cloud',
          errorCode: classification.code,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        await this.dlqService.enqueue(RADAR_SNIFFING_QUEUE, {
          sourceQueue: RADAR_SNIFFING_QUEUE,
          sourceJobId: String(job.id ?? jobId),
          tenantId,
          traceId,
          campaignId: 'RADAR',
          taskId,
          nodeId: 'cloud',
          stage: 'radar_sniffing',
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

  private async sniffViralContent(url: string, keywords: string[]): Promise<string> {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) {
      throw new Error('competitorUrl is required');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(normalizedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DragonSenateRadar/1.0)',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`radar fetch failed with status=${response.status}`);
      }

      const html = await response.text();
      const plain = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (plain.length < 60) {
        throw new Error('radar fetch content too short');
      }

      const keywordText = keywords.filter(Boolean).join('、');
      return `来源: ${normalizedUrl}\n关键词: ${keywordText}\n内容摘要: ${plain.slice(0, 1200)}`;
    } finally {
      clearTimeout(timeout);
    }
  }
}

