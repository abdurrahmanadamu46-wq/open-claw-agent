/**
 * ClawCommerce Agent - OpenClaw node management core engine
 * Dynamic allocation (campaign -> node + phone), idle release, health-driven recovery.
 * Concurrency protected by Redis/distributed lock.
 * @module agent/node-manager
 */
import { NodePool } from './node-pool.js';
import { HealthMonitor } from './health-monitor.js';
import { PhonePool } from './phone-pool.js';
import type { CampaignConfig, AllocationResult, NodeStatus, NodesStatusResponse, NodePoolEvent } from './types.js';
import type { ICampaignConfig } from '../shared/contracts.js';
export interface NodeManagerOptions {
    redis: import('ioredis').Redis;
    /** Max nodes (from env MAX_NODES); used for allocation guard */
    maxNodes: number;
    /** Idle release minutes (env IDLE_RELEASE_MINUTES) */
    idleReleaseMinutes?: number;
    /** Node pool (will sync from Redis on start) */
    nodePool: NodePool;
    /** Health monitor (start/stop managed by manager) */
    healthMonitor: HealthMonitor;
    /** Phone pool for number binding */
    phonePool: PhonePool;
    /** Optional: spawn new container (e.g. call AWS/GCP API); return new NodeStatus */
    spawnNode?: () => Promise<NodeStatus | null>;
    /** Optional: event callback for WebSocket / audit */
    onEvent?: (event: NodePoolEvent) => void;
}
export declare class NodeManager {
    private redis;
    private maxNodes;
    private idleReleaseMinutes;
    private nodePool;
    private healthMonitor;
    private phonePool;
    private spawnNode?;
    private onEvent?;
    private logger;
    private running;
    private idleCheckTimer;
    constructor(options: NodeManagerOptions);
    /** Initialize: sync pool from Redis, start health monitor and idle release loop */
    start(): Promise<void>;
    /** Stop health monitor and timers */
    stop(): Promise<void>;
    /** Allocate one OpenClaw node (+ optional phone) for campaign; with lock */
    allocate(campaign: CampaignConfig): Promise<AllocationResult | null>;
    /** Release node (and phone) back to pool */
    release(nodeId: string): Promise<boolean>;
    /**
     * 强制释放某任务下所有已分配节点（供后端 POST /internal/campaign/terminate 调用）。
     * 商家终止任务时，后端调此接口，Agent 立即回收节点，不再继续该 campaign 的执行。
     */
    releaseByCampaignId(campaignId: string): Promise<{
        released: string[];
    }>;
    /** Release nodes idle longer than configured minutes (cost optimization) */
    private startIdleReleaseLoop;
    private releaseIdleNodes;
    /** Dashboard: get nodes status (for GET /api/agent/nodes/status) */
    getNodesStatus(): Promise<NodesStatusResponse>;
    /** Register a new node (e.g. after container start); call from orchestrator */
    registerNode(overrides: Partial<NodeStatus> & {
        cdpEndpoint?: string;
        containerId?: string;
    }): Promise<NodeStatus>;
    /** 更新节点配置：专属网络、指纹浏览器（供后台/运维调用） */
    updateNodeConfig(nodeId: string, patch: {
        networkConfig?: NodeStatus['networkConfig'];
        fingerprintProfile?: NodeStatus['fingerprintProfile'];
    }): Promise<NodeStatus | null>;
    /** Mark node unhealthy and optionally trigger restart (called by health monitor) */
    markUnhealthy(nodeId: string, reason: string): Promise<void>;
    /**
     * 执行单次 Campaign 任务（供后端 RPC 调用）。
     * 后端 CampaignProcessor 消费 BullMQ 后 POST 到 /internal/campaign/execute，本方法执行分配→状态机→回收。
     */
    runCampaignTask(payload: ICampaignConfig, executeTask?: (params: {
        nodeId: string;
        config: ICampaignConfig;
    }) => Promise<void>): Promise<{
        ok: boolean;
        nodeId?: string;
        campaignId: string;
        tenantId: string;
        error?: string;
    }>;
    private emit;
}
//# sourceMappingURL=node-manager.d.ts.map