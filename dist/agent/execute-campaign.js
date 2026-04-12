/**
 * ClawCommerce Agent - 执行单次 Campaign 任务（供后端 RPC 调用）
 * 后端 CampaignProcessor 消费 BullMQ 后调用 agentService.executeCampaignTask(payload)，
 * 即 HTTP POST 到本服务的 /internal/campaign/execute，本模块执行分配→状态机→回收。
 * Agent 零数据落盘权，仅执行并返回结果；线索经后端 API 回传。
 * @module agent/execute-campaign
 */
import { NodeStatusEnum } from '../shared/contracts.js';
import { campaignConfigFromPayload } from './workers/campaign-worker.js';
import { createLogger } from './logger.js';
const logger = createLogger('execute-campaign');
/**
 * 执行单次 Campaign：分配节点 → SCRAPING → GENERATING → PUBLISHING → 释放。
 * 供后端 POST /internal/campaign/execute 调用，与 CampaignProcessor 对接。
 */
export async function executeCampaignTask(payload, options) {
    const { nodeManager, nodePool, executeTask } = options;
    const campaignId = payload.campaign_id;
    const tenantId = payload.tenant_id;
    const campaign = campaignConfigFromPayload(payload);
    const allocation = await nodeManager.allocate(campaign);
    if (!allocation) {
        logger.warn('No node available', { campaignId });
        return { ok: false, campaignId, tenantId, error: 'NO_NODE_AVAILABLE' };
    }
    const { nodeId } = allocation;
    try {
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.SCRAPING);
        if (executeTask) {
            await executeTask({ nodeId, config: payload });
        }
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.GENERATING);
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.PUBLISHING);
        return { ok: true, nodeId, campaignId, tenantId };
    }
    catch (err) {
        logger.error('Campaign task failed', { nodeId, campaignId, error: err });
        await nodePool.setWorkflowState(nodeId, NodeStatusEnum.COOLING);
        return {
            ok: false,
            nodeId,
            campaignId,
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    finally {
        await nodeManager.release(nodeId);
    }
}
//# sourceMappingURL=execute-campaign.js.map