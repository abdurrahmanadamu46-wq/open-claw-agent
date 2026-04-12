/**
 * ClawCommerce Agent - Node pool with in-memory + Redis persistence
 * Manages OpenClaw node lifecycle: register, allocate, release, persist.
 * @module agent/node-pool
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import type { NodeStatus, NodeState, HealthVerdict } from './types.js';
import { NodeStatusEnum } from '../shared/contracts.js';

const REDIS_KEY_PREFIX = 'clawcommerce:node:';
const REDIS_KEY_INDEX = 'clawcommerce:node:index';
const REDIS_KEY_ALL = 'clawcommerce:node:all';

const DEFAULT_TTL_SEC = 86400; // 24h for key TTL

function nowIso(): string {
  return new Date().toISOString();
}

function redisKey(nodeId: string): string {
  return `${REDIS_KEY_PREFIX}${nodeId}`;
}

export interface NodePoolOptions {
  redis: import('ioredis').Redis;
  /** TTL in seconds for Redis keys (default 24h) */
  keyTtlSec?: number;
}

export class NodePool {
  private redis: import('ioredis').Redis;
  private keyTtlSec: number;
  /** In-memory cache for fast lookup; sync from Redis on init and after writes */
  private cache = new Map<string, NodeStatus>();

  constructor(options: NodePoolOptions) {
    this.redis = options.redis;
    this.keyTtlSec = options.keyTtlSec ?? DEFAULT_TTL_SEC;
  }

  /** Load all nodes from Redis into memory (call after connect or on startup) */
  async syncFromRedis(): Promise<void> {
    const ids = await this.redis.smembers(REDIS_KEY_ALL);
    this.cache.clear();
    for (const id of ids) {
      const raw = await this.redis.get(redisKey(id));
      if (raw) {
        try {
          const status = JSON.parse(raw) as NodeStatus;
          this.cache.set(id, status);
        } catch {
          // Skip invalid entries
        }
      }
    }
  }

  /** Persist a single node to Redis and update cache */
  async upsert(status: NodeStatus): Promise<void> {
    const key = redisKey(status.nodeId);
    await this.redis.setex(key, this.keyTtlSec, JSON.stringify(status));
    await this.redis.sadd(REDIS_KEY_ALL, status.nodeId);
    this.cache.set(status.nodeId, status);
  }

  /** Get by ID from cache (fallback Redis) */
  async get(nodeId: string): Promise<NodeStatus | null> {
    const cached = this.cache.get(nodeId);
    if (cached) return cached;
    const raw = await this.redis.get(redisKey(nodeId));
    if (!raw) return null;
    try {
      const status = JSON.parse(raw) as NodeStatus;
      this.cache.set(nodeId, status);
      return status;
    } catch {
      return null;
    }
  }

  /** List all nodes (from cache) */
  getAll(): NodeStatus[] {
    return Array.from(this.cache.values());
  }

  /** List by state */
  getByState(state: NodeState): NodeStatus[] {
    return this.getAll().filter((n) => n.state === state);
  }

  /** Idle nodes available for allocation */
  getIdle(): NodeStatus[] {
    return this.getByState('idle').filter((n) => n.health === 'ok' || n.health === 'unknown');
  }

  /** Update state and optional fields; persist and return updated */
  async update(
    nodeId: string,
    patch: Partial<Pick<NodeStatus, 'state' | 'workflowState' | 'health' | 'campaignId' | 'phoneNumberId' | 'allocatedAt' | 'idleSince' | 'lastHeartbeatAt' | 'cpuUsagePercent' | 'memoryUsageMb' | 'playwrightState' | 'cdpEndpoint' | 'containerId' | 'networkConfig' | 'fingerprintProfile' | 'metadata'>>
  ): Promise<NodeStatus | null> {
    const current = await this.get(nodeId);
    if (!current) return null;
    const updated: NodeStatus = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    await this.upsert(updated);
    return updated;
  }

  /** Register a new node (e.g. after container start)；PM v1.3 工作流初始为 IDLE */
  async register(overrides: Partial<NodeStatus> & { cdpEndpoint?: string; containerId?: string }): Promise<NodeStatus> {
    const nodeId = overrides.nodeId ?? uuidv4();
    const status: NodeStatus = {
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
  async release(nodeId: string): Promise<NodeStatus | null> {
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
  async allocate(
    nodeId: string,
    campaignId: string,
    phoneNumberId?: string
  ): Promise<NodeStatus | null> {
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
  async setWorkflowState(nodeId: string, workflowState: NodeStatusEnum): Promise<NodeStatus | null> {
    const stateMap: Partial<Record<NodeStatusEnum, NodeState>> = {
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
  async setHealth(
    nodeId: string,
    health: HealthVerdict,
    details: Partial<Pick<NodeStatus, 'lastHeartbeatAt' | 'cpuUsagePercent' | 'memoryUsageMb' | 'playwrightState'>>
  ): Promise<NodeStatus | null> {
    return this.update(nodeId, { health, ...details });
  }

  /** Remove node from pool (e.g. scale-in or decommission) */
  async remove(nodeId: string): Promise<boolean> {
    await this.redis.del(redisKey(nodeId));
    await this.redis.srem(REDIS_KEY_ALL, nodeId);
    this.cache.delete(nodeId);
    return true;
  }

  /** Count by state */
  counts(): { total: number; idle: number; allocated: number; unhealthy: number } {
    const all = this.getAll();
    const total = all.length;
    const idle = all.filter((n) => n.state === 'idle').length;
    const allocated = all.filter((n) => n.state === 'allocated' || n.state === 'busy').length;
    const unhealthy = all.filter((n) => n.health === 'unhealthy' || n.state === 'unhealthy').length;
    return { total, idle, allocated, unhealthy };
  }
}
