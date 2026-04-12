/**
 * ClawCommerce Agent - Node pool with in-memory + Redis persistence
 * Manages OpenClaw node lifecycle: register, allocate, release, persist.
 * @module agent/node-pool
 */
import type { NodeStatus, NodeState, HealthVerdict } from './types.js';
import { NodeStatusEnum } from '../shared/contracts.js';
export interface NodePoolOptions {
    redis: import('ioredis').Redis;
    /** TTL in seconds for Redis keys (default 24h) */
    keyTtlSec?: number;
}
export declare class NodePool {
    private redis;
    private keyTtlSec;
    /** In-memory cache for fast lookup; sync from Redis on init and after writes */
    private cache;
    constructor(options: NodePoolOptions);
    /** Load all nodes from Redis into memory (call after connect or on startup) */
    syncFromRedis(): Promise<void>;
    /** Persist a single node to Redis and update cache */
    upsert(status: NodeStatus): Promise<void>;
    /** Get by ID from cache (fallback Redis) */
    get(nodeId: string): Promise<NodeStatus | null>;
    /** List all nodes (from cache) */
    getAll(): NodeStatus[];
    /** List by state */
    getByState(state: NodeState): NodeStatus[];
    /** Idle nodes available for allocation */
    getIdle(): NodeStatus[];
    /** Update state and optional fields; persist and return updated */
    update(nodeId: string, patch: Partial<Pick<NodeStatus, 'state' | 'workflowState' | 'health' | 'campaignId' | 'phoneNumberId' | 'allocatedAt' | 'idleSince' | 'lastHeartbeatAt' | 'cpuUsagePercent' | 'memoryUsageMb' | 'playwrightState' | 'cdpEndpoint' | 'containerId' | 'networkConfig' | 'fingerprintProfile' | 'metadata'>>): Promise<NodeStatus | null>;
    /** Register a new node (e.g. after container start)；PM v1.3 工作流初始为 IDLE */
    register(overrides: Partial<NodeStatus> & {
        cdpEndpoint?: string;
        containerId?: string;
    }): Promise<NodeStatus>;
    /** Mark node idle and clear campaign/phone binding */
    release(nodeId: string): Promise<NodeStatus | null>;
    /** Mark node as allocated to campaign（PM v1.3 工作流：初始为 INIT） */
    allocate(nodeId: string, campaignId: string, phoneNumberId?: string): Promise<NodeStatus | null>;
    /** 设置工作流状态（SCRAPING / GENERATING / PUBLISHING / COOLING / BANNED） */
    setWorkflowState(nodeId: string, workflowState: NodeStatusEnum): Promise<NodeStatus | null>;
    /** Update health fields (from health monitor) */
    setHealth(nodeId: string, health: HealthVerdict, details: Partial<Pick<NodeStatus, 'lastHeartbeatAt' | 'cpuUsagePercent' | 'memoryUsageMb' | 'playwrightState'>>): Promise<NodeStatus | null>;
    /** Remove node from pool (e.g. scale-in or decommission) */
    remove(nodeId: string): Promise<boolean>;
    /** Count by state */
    counts(): {
        total: number;
        idle: number;
        allocated: number;
        unhealthy: number;
    };
}
//# sourceMappingURL=node-pool.d.ts.map