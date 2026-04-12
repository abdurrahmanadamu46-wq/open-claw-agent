/**
 * ClawCommerce Agent - BullMQ campaign-queue 消费者
 * 后端通过 campaign-queue 下发任务；Agent 只监听队列执行，不轮询。
 * 流程：收 job → 带锁分配节点 → 状态机 SCRAPING → GENERATING → PUBLISHING → 回收节点
 * @module agent/workers/campaign-worker
 */
import { Worker } from 'bullmq';
/** Redis 连接（BullMQ 与 ioredis 兼容） */
type RedisConnection = {
    host: string;
    port: number;
    password?: string;
} | string;
import type { NodeManager } from '../node-manager.js';
import type { NodePool } from '../node-pool.js';
import type { CampaignJobData, ICampaignConfig } from '../../shared/contracts.js';
import type { CampaignConfig } from '../types.js';
/** 将 ICampaignConfig 转为 Agent 内部 CampaignConfig（Sprint 2：优先用 content_strategy.template_type 作 industry） */
export declare function campaignConfigFromPayload(payload: ICampaignConfig): CampaignConfig;
export interface CampaignWorkerOptions {
    connection: RedisConnection;
    nodeManager: NodeManager;
    nodePool: NodePool;
    /** 处理单任务的执行器（采集→二创→发布 占位，由 browser-orchestrator 等实现） */
    executeTask?: (params: {
        nodeId: string;
        config: ICampaignConfig;
    }) => Promise<void>;
}
export declare function createCampaignWorker(options: CampaignWorkerOptions): Worker<CampaignJobData, void>;
export {};
//# sourceMappingURL=campaign-worker.d.ts.map