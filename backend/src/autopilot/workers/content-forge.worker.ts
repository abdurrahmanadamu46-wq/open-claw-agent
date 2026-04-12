import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import type Redis from 'ioredis';
import {
  CONTENT_FORGE_QUEUE,
  MATRIX_DISPATCH_QUEUE,
  DAILY_CONTENT_GENERATION_LIMIT,
} from '../autopilot.constants';
import type { ContentForgeJobPayload, MatrixDispatchJobPayload } from '../autopilot.types';
import { AutopilotCircuitService } from '../autopilot-circuit.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { LlmService } from '../../llm/llm.service';

const REDIS_KEY_DAILY_PREFIX = 'autopilot:content_forge:daily:';

/**
 * 内容熔炼队列 Worker：消耗预算检查 + 大模型生成，完成后入参 matrix_dispatch
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
  ) {
    super();
  }

  private get redis(): Redis {
    return this.redisService.getOrThrow();
  }

  async process(job: Job<ContentForgeJobPayload>): Promise<MatrixDispatchJobPayload | void> {
    const { tenantId, viralText, sourceUrl, jobId } = job.data;
    this.logger.log(`[ContentForge] Processing job ${job.id} tenant=${tenantId}`);

    const dateKey = new Date().toISOString().slice(0, 10);
    const budgetKey = `${REDIS_KEY_DAILY_PREFIX}${tenantId}:${dateKey}`;
    const current = await this.redis.incr(budgetKey);
    if (current === 1) await this.redis.expire(budgetKey, 86400 * 2);
    if (current > DAILY_CONTENT_GENERATION_LIMIT) {
      this.logger.warn(`[ContentForge] Tenant ${tenantId} daily limit exceeded (${current})`);
      throw new Error(`每日生成上限已用完（${DAILY_CONTENT_GENERATION_LIMIT}），请明日再试或联系管理员提升配额`);
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
      };
      await this.matrixDispatchQueue.add('dispatch', nextPayload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
      this.logger.log(`[ContentForge] Job ${job.id} done, enqueued matrix_dispatch`);
      return nextPayload;
    } catch (err) {
      await this.redis.decr(budgetKey);
      this.logger.warn(`[ContentForge] Job ${job.id} failed`, err);
      this.circuit.recordFailure(CONTENT_FORGE_QUEUE);
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
      throw new Error('大模型 API Key 未配置');
    }
    const prompt = `基于以下爆款参考，生成一条短视频脚本（60 字内）及推荐视频封面文案。\n参考：${viralText}\n${sourceUrl ? `来源：${sourceUrl}` : ''}`;
    const res = await this.llmService.chat(
      [{ role: 'user', content: prompt }],
      { max_tokens: 256 },
    );
    const script = res?.choices?.[0]?.message?.content?.trim() ?? '[生成脚本] 模拟文案';
    const videoUrl = `https://cdn.example.com/generated/${Date.now()}.mp4`;
    return { videoUrl, script };
  }

  private async getTenantNodeIds(tenantId: string): Promise<string[]> {
    // 实际从设备/节点服务拉取该租户的龙虾节点列表
    await Promise.resolve(tenantId);
    return ['Node-01', 'Node-02'];
  }
}
