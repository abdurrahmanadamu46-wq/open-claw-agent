/**
 * ClawCommerce Agent - 执行单次 Campaign 任务（供后端 RPC 调用）
 * 后端 CampaignProcessor 消费 BullMQ 后调用 agentService.executeCampaignTask(payload)，
 * 即 HTTP POST 到本服务的 /internal/campaign/execute，本模块执行分配→状态机→回收。
 * Agent 零数据落盘权，仅执行并返回结果；线索经后端 API 回传。
 * @module agent/execute-campaign
 */
import type { NodeManager } from './node-manager.js';
import type { NodePool } from './node-pool.js';
import type { ICampaignConfig } from '../shared/contracts.js';
export interface ExecuteCampaignOptions {
    nodeManager: NodeManager;
    nodePool: NodePool;
    /** 可选：实际采集/二创/发布逻辑；不传则仅跑状态机占位 */
    executeTask?: (params: {
        nodeId: string;
        config: ICampaignConfig;
    }) => Promise<void>;
}
export interface ExecuteCampaignResult {
    ok: boolean;
    nodeId?: string;
    campaignId: string;
    tenantId: string;
    error?: string;
}
/**
 * 执行单次 Campaign：分配节点 → SCRAPING → GENERATING → PUBLISHING → 释放。
 * 供后端 POST /internal/campaign/execute 调用，与 CampaignProcessor 对接。
 */
export declare function executeCampaignTask(payload: ICampaignConfig, options: ExecuteCampaignOptions): Promise<ExecuteCampaignResult>;
//# sourceMappingURL=execute-campaign.d.ts.map