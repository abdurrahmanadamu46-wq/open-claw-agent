import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Queue, UnrecoverableError, type Job } from 'bullmq';
import type Redis from 'ioredis';
import {
  CONTENT_FORGE_QUEUE,
  DAILY_CONTENT_GENERATION_LIMIT,
  MATRIX_DISPATCH_QUEUE,
} from '../autopilot.constants';
import type { ContentForgeJobPayload, MatrixDispatchJobPayload } from '../autopilot.types';
import { IntegrationsService } from '../../integrations/integrations.service';
import { LlmService } from '../../llm/llm.service';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
import { AutopilotIdempotencyService } from '../autopilot-idempotency.service';
import { AutopilotDlqService } from '../autopilot-dlq.service';
import { AutopilotTaskStateService } from '../autopilot-task-state.service';
import { AutopilotMetricsService } from '../autopilot-metrics.service';
import { classifyAutopilotError } from '../autopilot-error';
import { resolveTaskId } from '../autopilot-task-id';
import { redisWriteOrBlock } from '../../common/redis-resilience';
import { emitStructuredLog } from '../../common/structured-log';

const REDIS_KEY_DAILY_PREFIX = 'autopilot:content_forge:daily:';

/**
 * Content forge worker:
 * - enforces daily generation limits
 * - calls tenant LLM provider to produce script
 * - emits matrix_dispatch job to online edge nodes
 */
@Processor(CONTENT_FORGE_QUEUE)
export class ContentForgeWorker extends WorkerHost {
  private readonly logger = new Logger(ContentForgeWorker.name);

  constructor(
    @InjectQueue(MATRIX_DISPATCH_QUEUE) private readonly matrixDispatchQueue: Queue,
    private readonly circuit: AutopilotCircuitService,
    private readonly redisService: RedisService,
    private readonly integrationsService: IntegrationsService,
    private readonly llmService: LlmService,
    private readonly idempotency: AutopilotIdempotencyService,
    private readonly dlqService: AutopilotDlqService,
    private readonly taskStateService: AutopilotTaskStateService,
    private readonly metricsService: AutopilotMetricsService,
  ) {
    super();
  }

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async process(job: Job<ContentForgeJobPayload>): Promise<MatrixDispatchJobPayload | void> {
    const { tenantId, viralText, sourceUrl, jobId, traceId } = job.data;
    const taskId = resolveTaskId(job.data);

    emitStructuredLog(this.logger, 'log', {
      service: ContentForgeWorker.name,
      eventType: 'queue.dequeue',
      message: 'content forge worker dequeued job',
      traceId,
      tenantId,
      campaignId: 'CONTENT_FORGE',
      nodeId: 'cloud',
      taskId,
      queueName: CONTENT_FORGE_QUEUE,
      queueJobId: String(job.id ?? jobId),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
    });

    const claimed = await this.idempotency.claim({
      tenantId,
      campaignId: 'CONTENT_FORGE',
      taskId,
      nodeId: 'cloud',
      stage: 'content_forge',
    });
    if (!claimed) {
      this.logger.warn(`[traceId=${traceId}] duplicate content_forge task skipped taskId=${taskId}`);
      return;
    }

    await this.taskStateService.markRunning({
      taskId,
      traceId,
      stage: 'content_forge',
      tenantId,
      campaignId: 'CONTENT_FORGE',
      sourceQueue: CONTENT_FORGE_QUEUE,
      nodeId: 'cloud',
    });

    const dateKey = new Date().toISOString().slice(0, 10);
    const budgetKey = `${REDIS_KEY_DAILY_PREFIX}${tenantId}:${dateKey}`;

    const current = await redisWriteOrBlock(
      this.logger,
      `content-forge budget incr tenant=${tenantId}`,
      async () => this.redis.incr(budgetKey),
    );

    if (current === 1) {
      await redisWriteOrBlock(
        this.logger,
        `content-forge budget expire tenant=${tenantId}`,
        async () => this.redis.expire(budgetKey, 86400 * 2),
      );
    }

    if (current > DAILY_CONTENT_GENERATION_LIMIT) {
      throw new UnrecoverableError(
        `daily content limit exceeded: tenant=${tenantId}, limit=${DAILY_CONTENT_GENERATION_LIMIT}`,
      );
    }

    try {
      const { videoUrl, script } = await this.forgeContent(tenantId, viralText, sourceUrl);
      const nodeIds = await this.getTenantNodeIds(tenantId);

      this.circuit.recordSuccess(CONTENT_FORGE_QUEUE);

      const nextPayload: MatrixDispatchJobPayload = {
        tenantId,
        videoUrl,
        script,
        nodeIds,
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        jobId,
        traceId,
        replay: job.data.replay,
      };

      await this.matrixDispatchQueue.add('dispatch', nextPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });

      emitStructuredLog(this.logger, 'log', {
        service: ContentForgeWorker.name,
        eventType: 'queue.enqueue',
        message: 'content forge worker enqueued matrix dispatch job',
        traceId,
        tenantId,
        campaignId: 'MATRIX_DISPATCH',
        nodeId: 'cloud',
        taskId: resolveTaskId(nextPayload),
        queueName: MATRIX_DISPATCH_QUEUE,
        queueJobId: String(job.id ?? jobId),
      });

      await this.taskStateService.markSuccess({
        taskId,
        traceId,
        stage: 'content_forge',
        tenantId,
        campaignId: 'CONTENT_FORGE',
        sourceQueue: CONTENT_FORGE_QUEUE,
        nodeId: 'cloud',
      });

      await this.taskStateService.markQueued({
        taskId: resolveTaskId(nextPayload),
        traceId,
        stage: 'matrix_dispatch',
        tenantId,
        campaignId: 'MATRIX_DISPATCH',
        sourceQueue: MATRIX_DISPATCH_QUEUE,
        nodeId: 'cloud',
      });

      emitStructuredLog(this.logger, 'log', {
        service: ContentForgeWorker.name,
        eventType: 'queue.process.success',
        message: 'content forge worker processed job successfully',
        traceId,
        tenantId,
        campaignId: 'CONTENT_FORGE',
        nodeId: 'cloud',
        taskId,
        queueName: CONTENT_FORGE_QUEUE,
        queueJobId: String(job.id ?? jobId),
      });

      return nextPayload;
    } catch (err) {
      await redisWriteOrBlock(
        this.logger,
        `content-forge budget decr tenant=${tenantId}`,
        async () => this.redis.decr(budgetKey),
      );

      this.circuit.recordFailure(CONTENT_FORGE_QUEUE);
      const classification = classifyAutopilotError(err);
      const maxAttempts = job.opts.attempts ?? 1;
      const attemptsMade = job.attemptsMade + 1;
      const terminal = !classification.retryable || attemptsMade >= maxAttempts;

      await this.metricsService.recordQueueProcessFail({
        tenantId,
        queueName: CONTENT_FORGE_QUEUE,
      });

      emitStructuredLog(this.logger, classification.retryable ? 'warn' : 'error', {
        service: ContentForgeWorker.name,
        eventType: 'queue.process.fail',
        message: 'content forge worker failed to process job',
        traceId,
        tenantId,
        campaignId: 'CONTENT_FORGE',
        nodeId: 'cloud',
        taskId,
        queueName: CONTENT_FORGE_QUEUE,
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
          stage: 'content_forge',
          tenantId,
          campaignId: 'CONTENT_FORGE',
          sourceQueue: CONTENT_FORGE_QUEUE,
          nodeId: 'cloud',
          errorCode: classification.code,
          errorMessage: err instanceof Error ? err.message : String(err),
        });

        await this.dlqService.enqueue(CONTENT_FORGE_QUEUE, {
          sourceQueue: CONTENT_FORGE_QUEUE,
          sourceJobId: String(job.id ?? jobId),
          tenantId,
          traceId,
          campaignId: 'CONTENT_FORGE',
          taskId,
          nodeId: 'cloud',
          stage: 'content_forge',
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

  private async forgeContent(
    tenantId: string,
    viralText: string,
    sourceUrl?: string,
  ): Promise<{ videoUrl: string; script: string }> {
    const integrations = await this.integrationsService.getIntegrations(tenantId);
    if (!integrations.llm?.apiKey) {
      throw new Error('LLM API key is not configured for tenant');
    }

    const prompt = [
      'Generate one short-form commerce script in Chinese (<=120 words).',
      `Reference:\n${viralText}`,
      sourceUrl ? `Source: ${sourceUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const result = await this.llmService.chat([{ role: 'user', content: prompt }], {
      max_tokens: 256,
    });

    const script = result?.choices?.[0]?.message?.content?.trim();
    if (!script) {
      throw new Error('LLM returned empty script');
    }

    const videoBaseUrl = String(process.env.CONTENT_FORGE_VIDEO_BASE_URL ?? '').trim();
    if (!videoBaseUrl) {
      throw new Error('CONTENT_FORGE_VIDEO_BASE_URL is not configured');
    }

    const base = videoBaseUrl.replace(/\/+$/, '');
    const safeTenant = encodeURIComponent(tenantId);
    const stamp = Date.now();
    const videoUrl = `${base}/generated/${safeTenant}/${stamp}.mp4`;

    return { videoUrl, script };
  }

  private async getTenantNodeIds(tenantId: string): Promise<string[]> {
    const keys = await redisWriteOrBlock(
      this.logger,
      `content-forge scan fleet nodes tenant=${tenantId}`,
      async () => this.redis.keys('fleet:node:*'),
    );

    const ids: string[] = [];
    for (const key of keys) {
      const hash = await redisWriteOrBlock(
        this.logger,
        `content-forge load node hash key=${key}`,
        async () => this.redis.hgetall(key),
      );

      const scope = String(hash.tenant_id ?? '').trim();
      const status = String(hash.status ?? '').trim().toUpperCase();
      if (scope !== tenantId) continue;
      if (!status || status === 'OFFLINE') continue;

      const nodeId = key.replace(/^fleet:node:/, '').trim();
      if (nodeId) ids.push(nodeId);
    }

    if (ids.length === 0) {
      throw new Error(`no online edge nodes available for tenant=${tenantId}`);
    }
    return ids;
  }
}
