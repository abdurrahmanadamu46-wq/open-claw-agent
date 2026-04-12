/**
 * ClawCommerce Agent - Node pool with in-memory + Redis persistence
 * Manages OpenClaw node lifecycle: register, allocate, release, persist.
 * @module agent/node-pool
 */
import { v4 as uuidv4 } from 'uuid';
import { NodeStatusEnum } from '../shared/contracts.js';
const REDIS_KEY_PREFIX = 'clawcommerce:node:';
const REDIS_KEY_INDEX = 'clawcommerce:node:index';
const REDIS_KEY_ALL = 'clawcommerce:node:all';
const DEFAULT_TTL_SEC = 86400; // 24h for key TTL
function nowIso() {
    return new Date().toISOString();
}
function redisKey(nodeId) {
    return `${REDIS_KEY_PREFIX}${nodeId}`;
}
export class NodePool {
    redis;
    keyTtlSec;
    /** In-memory cache for fast lookup; sync from Redis on init and after writes */
    cache = new Map();
    constructor(options) {
        this.redis = options.redis;
        this.keyTtlSec = options.keyTtlSec ?? DEFAULT_TTL_SEC;
    }
    /** Load all nodes from Redis into memory (call after connect or on startup) */
    async syncFromRedis() {
        const ids = await this.redis.smembers(REDIS_KEY_ALL);
        this.cache.clear();
        for (const id of ids) {
            const raw = await this.redis.get(redisKey(id));
            if (raw) {
                try {
                    const status = JSON.parse(raw);
                    this.cache.set(id, status);
                }
                catch {
                    // Skip invalid entries
                }
            }
        }
    }
    /** Persist a single node to Redis and update cache */
    async upsert(status) {
        const key = redisKey(status.nodeId);
        await this.redis.setex(key, this.keyTtlSec, JSON.stringify(status));
        await this.redis.sadd(REDIS_KEY_ALL, status.nodeId);
        this.cache.set(status.nodeId, status);
    }
    /** Get by ID from cache (fallback Redis) */
    async get(nodeId) {
        const cached = this.cache.get(nodeId);
        if (cached)
            return cached;
        const raw = await this.redis.get(redisKey(nodeId));
        if (!raw)
            return null;
        try {
            const status = JSON.parse(raw);
            this.cache.set(nodeId, status);
            return status;
        }
        catch {
            return null;
        }
    }
    /** List all nodes (from cache) */
    getAll() {
        return Array.from(this.cache.values());
    }
    /** List by state */
    getByState(state) {
        return this.getAll().filter((n) => n.state === state);
    }
    /** Idle nodes available for allocation */
    getIdle() {
        return this.getByState('idle').filter((n) => n.health === 'ok' || n.health === 'unknown');
    }
    /** Update state and optional fields; persist and return updated */
    async update(nodeId, patch) {
        const current = await this.get(nodeId);
        if (!current)
            return null;
        const updated = {
            ...current,
            ...patch,
            updatedAt: nowIso(),
        };
        await this.upsert(updated);
        return updated;
    }
    /** Register a new node (e.g. after container start)；PM v1.3 工作流初始为 IDLE */
    async register(overrides) {
        const nodeId = overrides.nodeId ?? uuidv4();
        const status = {
            nodeId,
            state: 'idle',
            workflowState: NodeStatusEnum.IDLE,
            health: 'unknown',
            cdpEndpoint: overrides.cdpEndpoint,
            containerId: overrides.containerId,
            updatedAt: nowIso(),
            ...overrides,
        };
        await this.upsert(status);
        return status;
    }
    /** Mark node idle and clear campaign/phone binding */
    async release(nodeId) {
        return this.update(nodeId, {
            state: 'idle',
            workflowState: NodeStatusEnum.IDLE,
            campaignId: undefined,
            phoneNumberId: undefined,
            allocatedAt: undefined,
            idleSince: nowIso(),
        });
    }
    /** Mark node as allocated to campaign（PM v1.3 工作流：初始为 INIT） */
    async allocate(nodeId, campaignId, phoneNumberId) {
        return this.update(nodeId, {
            state: 'allocated',
            workflowState: NodeStatusEnum.INITIALIZING,
            campaignId,
            phoneNumberId,
            allocatedAt: nowIso(),
            idleSince: undefined,
        });
    }
    /** 设置工作流状态（SCRAPING / GENERATING / PUBLISHING / COOLING / BANNED） */
    async setWorkflowState(nodeId, workflowState) {
        const stateMap = {
            [NodeStatusEnum.IDLE]: 'idle',
            [NodeStatusEnum.INITIALIZING]: 'busy',
            [NodeStatusEnum.SCRAPING]: 'busy',
            [NodeStatusEnum.GENERATING]: 'busy',
            [NodeStatusEnum.PUBLISHING]: 'busy',
            [NodeStatusEnum.COOLING]: 'cooling',
            [NodeStatusEnum.BANNED]: 'banned',
        };
        return this.update(nodeId, {
            workflowState,
            state: stateMap[workflowState] ?? 'busy',
        });
    }
    /** Update health fields (from health monitor) */
    async setHealth(nodeId, health, details) {
        return this.update(nodeId, { health, ...details });
    }
    /** Remove node from pool (e.g. scale-in or decommission) */
    async remove(nodeId) {
        await this.redis.del(redisKey(nodeId));
        await this.redis.srem(REDIS_KEY_ALL, nodeId);
        this.cache.delete(nodeId);
        return true;
    }
    /** Count by state */
    counts() {
        const all = this.getAll();
        const total = all.length;
        const idle = all.filter((n) => n.state === 'idle').length;
        const allocated = all.filter((n) => n.state === 'allocated' || n.state === 'busy').length;
        const unhealthy = all.filter((n) => n.health === 'unhealthy' || n.state === 'unhealthy').length;
        return { total, idle, allocated, unhealthy };
    }
}
//# sourceMappingURL=node-pool.js.map