/**
 * ClawCommerce Agent - BullMQ campaign-queue 消费者
 * 后端通过 campaign-queue 下发任务；Agent 只监听队列执行，不轮询。
 * 流程：收 job → 带锁分配节点 → 状态机 SCRAPING → GENERATING → PUBLISHING → 回收节点
 * @module agent/workers/campaign-worker
 */

import { Worker, Job } from 'bullmq';
/** Redis 连接（BullMQ 与 ioredis 兼容） */
type RedisConnection = { host: string; port: number; password?: string } | string;
import type { NodeManager } from '../node-manager.js';
import type { NodePool } from '../node-pool.js';
import { NodeStatusEnum } from '../../shared/contracts.js';
import type { CampaignJobData, ICampaignConfig } from '../../shared/contracts.js';
import type { CampaignConfig } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('campaign-worker');
const QUEUE_NAME = process.env.CAMPAIGN_QUEUE_NAME ?? 'campaign-queue';

/** 将 ICampaignConfig 转为 Agent 内部 CampaignConfig（Sprint 2：优先用 content_strategy.template_type 作 industry） */
export function campaignConfigFromPayload(payload: ICampaignConfig): CampaignConfig {
  const industry = payload.content_strategy?.template_type ?? payload.industry_template_id;
  return {
    campaignId: payload.campaign_id,
    merchantId: payload.tenant_id,
    rule: {
      industry,
      benchmarkAccountIds: payload.target_urls,
      platforms: ['douyin', 'xiaohongshu', 'kuaishou'],
      requirePhone: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export interface CampaignWorkerOptions {
  connection: RedisConnection;
  nodeManager: NodeManager;
  nodePool: NodePool;
  /** 处理单任务的执行器（采集→二创→发布 占位，由 browser-orchestrator 等实现） */
  executeTask?: (params: { nodeId: string; config: ICampaignConfig }) => Promise<void>;
}

export function createCampaignWorker(options: CampaignWorkerOptions): Worker<CampaignJobData, void> {
  const { connection, nodeManager, nodePool, executeTask } = options;

  const worker = new Worker<CampaignJobData, void>(
    QUEUE_NAME,
    async (job: Job<CampaignJobData, void>) => {
      const { type, payload, jobId, tenantId } = job.data;
      logger.info('Campaign job received', { jobId, type, campaignId: payload.campaign_id });

      const campaign = campaignConfigFromPayload(payload);
      const allocation = await nodeManager.allocate(campaign);
      if (!allocation) {
        logger.warn('No node available, job will retry', { jobId });
        throw new Error('NO_NODE_AVAILABLE');
      }
      const { nodeId, nodeStatus } = allocation;
      try {
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.SCRAPING);
        if (executeTask) {
          await executeTask({ nodeId, config: payload });
        }
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.GENERATING);
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.PUBLISHING);
      } catch (err) {
        logger.error('Campaign task failed', { jobId, nodeId, error: err });
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.COOLING);
        throw err;
      } finally {
        await nodeManager.release(nodeId);
      }
    },
    {
      connection: connection as import('bullmq').ConnectionOptions,
      concurrency: 5,
      removeOnComplete: { count: 1000 },
    }
  );

  worker.on('completed', (job) => logger.info('Campaign job completed', { jobId: job.id }));
  worker.on('failed', (job, err) => logger.error('Campaign job failed', { jobId: job?.id, error: err }));
  return worker;
}
