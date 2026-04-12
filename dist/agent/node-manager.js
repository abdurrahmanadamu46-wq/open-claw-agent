/**
 * ClawCommerce Agent - OpenClaw node management core engine
 * Dynamic allocation (campaign -> node + phone), idle release, health-driven recovery.
 * Concurrency protected by Redis/distributed lock.
 * @module agent/node-manager
 */
import { createLogger } from './logger.js';
import { demoLogBullMQ, demoLogPlaywright, demoLogLLMEngine } from './demo-logger.js';
import { NodeStatusEnum } from '../shared/contracts.js';
import { campaignConfigFromPayload } from './workers/campaign-worker.js';
const LOCK_KEY = 'clawcommerce:node-manager:lock';
const LOCK_TTL_MS = 15000;
const IDLE_RELEASE_DEFAULT_MINUTES = 30;
/** Simple distributed lock (Redis SET NX PX) */
async function withLock(redis, fn) {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const acquired = await redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired)
        throw new Error('NodeManager: failed to acquire lock');
    try {
        return await fn();
    }
    finally {
        const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `;
        await redis.eval(script, 1, LOCK_KEY, token);
    }
}
export class NodeManager {
    redis;
    maxNodes;
    idleReleaseMinutes;
    nodePool;
    healthMonitor;
    phonePool;
    spawnNode;
    onEvent;
    logger = createLogger('node-manager');
    running = false;
    idleCheckTimer = null;
    constructor(options) {
        this.redis = options.redis;
        this.maxNodes = options.maxNodes;
        this.idleReleaseMinutes = options.idleReleaseMinutes ?? IDLE_RELEASE_DEFAULT_MINUTES;
        this.nodePool = options.nodePool;
        this.healthMonitor = options.healthMonitor;
        this.phonePool = options.phonePool;
        this.spawnNode = options.spawnNode;
        this.onEvent = options.onEvent;
    }
    /** Initialize: sync pool from Redis, start health monitor and idle release loop */
    async start() {
        if (this.running)
            return;
        await this.nodePool.syncFromRedis();
        this.healthMonitor.start();
        this.startIdleReleaseLoop();
        this.running = true;
        this.logger.info('NodeManager started', { maxNodes: this.maxNodes });
    }
    /** Stop health monitor and timers */
    async stop() {
        this.running = false;
        this.healthMonitor.stop();
        if (this.idleCheckTimer) {
            clearInterval(this.idleCheckTimer);
            this.idleCheckTimer = null;
        }
        this.logger.info('NodeManager stopped');
    }
    /** Allocate one OpenClaw node (+ optional phone) for campaign; with lock */
    async allocate(campaign) {
        return withLock(this.redis, async () => {
            const idle = this.nodePool.getIdle();
            let node = idle[0] ?? null;
            if (!node && this.spawnNode && this.nodePool.getAll().length < this.maxNodes) {
                node = await this.spawnNode();
                if (node)
                    await this.nodePool.upsert(node);
            }
            if (!node) {
                this.logger.warn('No node available for allocation', { campaignId: campaign.campaignId });
                return null;
            }
            const requirePhone = campaign.rule.requirePhone !== false;
            let phoneNumberId;
            let phoneNumber;
            if (requirePhone) {
                const available = this.phonePool.getAvailable();
                const slot = available[0];
                if (slot) {
                    this.phonePool.allocate(slot.id, node.nodeId);
                    phoneNumberId = slot.id;
                    phoneNumber = slot.number; // or mask per config
                }
            }
            const releaseMinutes = campaign.idleReleaseMinutes ?? this.idleReleaseMinutes;
            const expiresAt = new Date(Date.now() + releaseMinutes * 60 * 1000).toISOString();
            await this.nodePool.allocate(node.nodeId, campaign.campaignId, phoneNumberId);
            const updated = await this.nodePool.get(node.nodeId);
            if (!updated)
                return null;
            this.emit({ type: 'node_allocated', nodeId: node.nodeId, payload: updated, at: new Date().toISOString() });
            return {
                nodeId: updated.nodeId,
                nodeStatus: updated,
                phoneNumberId,
                phoneNumber,
                expiresAt,
            };
        });
    }
    /** Release node (and phone) back to pool */
    async release(nodeId) {
        return withLock(this.redis, async () => {
            const node = await this.nodePool.get(nodeId);
            if (!node)
                return false;
            if (node.phoneNumberId) {
                this.phonePool.release(node.phoneNumberId, true);
            }
            const updated = await this.nodePool.release(nodeId);
            if (updated) {
                this.emit({ type: 'node_released', nodeId, payload: updated, at: new Date().toISOString() });
            }
            return !!updated;
        });
    }
    /**
     * 强制释放某任务下所有已分配节点（供后端 POST /internal/campaign/terminate 调用）。
     * 商家终止任务时，后端调此接口，Agent 立即回收节点，不再继续该 campaign 的执行。
     */
    async releaseByCampaignId(campaignId) {
        return withLock(this.redis, async () => {
            const nodes = this.nodePool.getByState('allocated').concat(this.nodePool.getByState('busy'));
            const forCampaign = nodes.filter((n) => n.campaignId === campaignId);
            const released = [];
            for (const node of forCampaign) {
                if (node.phoneNumberId)
                    this.phonePool.release(node.phoneNumberId, true);
                const updated = await this.nodePool.release(node.nodeId);
                if (updated) {
                    released.push(node.nodeId);
                    this.emit({ type: 'node_released', nodeId: node.nodeId, payload: updated, at: new Date().toISOString() });
                }
            }
            this.logger.info('Released nodes by campaign', { campaignId, released });
            return { released };
        });
    }
    /** Release nodes idle longer than configured minutes (cost optimization) */
    startIdleReleaseLoop() {
        const intervalMs = Math.min(this.idleReleaseMinutes * 60 * 1000, 5 * 60 * 1000); // at most every 5 min
        this.idleCheckTimer = setInterval(() => {
            this.releaseIdleNodes().catch((err) => this.logger.error('Idle release failed', err));
        }, intervalMs);
    }
    async releaseIdleNodes() {
        const now = Date.now();
        const threshold = now - this.idleReleaseMinutes * 60 * 1000;
        const allocated = this.nodePool.getByState('allocated').concat(this.nodePool.getByState('busy'));
        for (const node of allocated) {
            const allocatedAt = node.allocatedAt ? new Date(node.allocatedAt).getTime() : 0;
            if (allocatedAt > 0 && allocatedAt < threshold) {
                await this.release(node.nodeId);
            }
        }
        this.phonePool.expireOld();
    }
    /** Dashboard: get nodes status (for GET /api/agent/nodes/status) */
    async getNodesStatus() {
        await this.nodePool.syncFromRedis();
        const nodes = this.nodePool.getAll();
        const counts = this.nodePool.counts();
        return {
            nodes,
            total: counts.total,
            idle: counts.idle,
            allocated: counts.allocated,
            unhealthy: counts.unhealthy,
            at: new Date().toISOString(),
        };
    }
    /** Register a new node (e.g. after container start); call from orchestrator */
    async registerNode(overrides) {
        return this.nodePool.register(overrides);
    }
    /** 更新节点配置：专属网络、指纹浏览器（供后台/运维调用） */
    async updateNodeConfig(nodeId, patch) {
        return this.nodePool.update(nodeId, patch);
    }
    /** Mark node unhealthy and optionally trigger restart (called by health monitor) */
    async markUnhealthy(nodeId, reason) {
        await this.nodePool.update(nodeId, { state: 'unhealthy', health: 'unhealthy' });
        this.emit({ type: 'node_unhealthy', nodeId, payload: { state: 'unhealthy' }, at: new Date().toISOString() });
        this.logger.warn('Node marked unhealthy', { nodeId, reason });
    }
    /**
     * 执行单次 Campaign 任务（供后端 RPC 调用）。
     * 后端 CampaignProcessor 消费 BullMQ 后 POST 到 /internal/campaign/execute，本方法执行分配→状态机→回收。
     */
    async runCampaignTask(payload, executeTask) {
        const campaign = campaignConfigFromPayload(payload);
        const allocation = await this.allocate(campaign);
        if (!allocation) {
            return { ok: false, campaignId: payload.campaign_id, tenantId: payload.tenant_id, error: 'NO_NODE_AVAILABLE' };
        }
        const { nodeId } = allocation;
        demoLogBullMQ(payload.campaign_id);
        try {
            await this.nodePool.setWorkflowState(nodeId, NodeStatusEnum.SCRAPING);
            demoLogPlaywright();
            if (executeTask)
                await executeTask({ nodeId, config: payload });
            await this.nodePool.setWorkflowState(nodeId, NodeStatusEnum.GENERATING);
            demoLogLLMEngine(7);
            await this.nodePool.setWorkflowState(nodeId, NodeStatusEnum.PUBLISHING);
            return { ok: true, nodeId, campaignId: payload.campaign_id, tenantId: payload.tenant_id };
        }
        catch (err) {
            await this.nodePool.setWorkflowState(nodeId, NodeStatusEnum.COOLING);
            return {
                ok: false,
                nodeId,
                campaignId: payload.campaign_id,
                tenantId: payload.tenant_id,
                error: err instanceof Error ? err.message : String(err),
            };
        }
        finally {
            await this.release(nodeId);
        }
    }
    emit(event) {
        try {
            this.onEvent?.(event);
        }
        catch {
            // ignore
        }
    }
}
//# sourceMappingURL=node-manager.js.map