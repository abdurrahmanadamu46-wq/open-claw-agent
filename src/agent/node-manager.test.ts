/**
 * ClawCommerce Agent - NodeManager unit tests
 */

import Redis from 'ioredis';
import { NodePool } from './node-pool.js';
import { HealthMonitor } from './health-monitor.js';
import { PhonePool } from './phone-pool.js';
import { createMockLogger } from './logger.js';
import { NodeManager } from './node-manager.js';
import type { CampaignConfig, NodeStatus } from './types.js';

const REDIS_TEST_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('NodeManager', () => {
  let redis: Redis;
  let nodePool: NodePool;
  let healthMonitor: HealthMonitor;
  let phonePool: PhonePool;
  let manager: NodeManager;
  const logger = createMockLogger();

  beforeAll(async () => {
    redis = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: 3 });
    nodePool = new NodePool({ redis });
    await nodePool.syncFromRedis();
    healthMonitor = new HealthMonitor({
      nodePool,
      logger,
      intervalMs: 999999,
      checkCdp: async () => ({ ok: true }),
    });
    phonePool = new PhonePool({ adapters: {} });
    manager = new NodeManager({
      redis,
      maxNodes: 10,
      idleReleaseMinutes: 30,
      nodePool,
      healthMonitor,
      phonePool,
    });
  });

  afterAll(async () => {
    await manager.stop();
    await redis.quit();
  });

  beforeEach(async () => {
    const keys = await redis.keys('clawcommerce:*');
    if (keys.length) await redis.del(...keys);
    await nodePool.syncFromRedis();
  });

  describe('getNodesStatus', () => {
    it('returns empty counts when no nodes', async () => {
      const status = await manager.getNodesStatus();
      expect(status.nodes).toEqual([]);
      expect(status.total).toBe(0);
      expect(status.idle).toBe(0);
      expect(status.allocated).toBe(0);
      expect(status.unhealthy).toBe(0);
      expect(status.at).toBeDefined();
    });

    it('returns registered nodes and correct counts', async () => {
      await manager.registerNode({
        nodeId: 'n1',
        cdpEndpoint: 'ws://127.0.0.1:9222',
        state: 'idle',
        health: 'ok',
      });
      const status = await manager.getNodesStatus();
      expect(status.total).toBe(1);
      expect(status.idle).toBe(1);
      expect(status.nodes[0].nodeId).toBe('n1');
    });
  });

  describe('allocate and release', () => {
    it('allocates idle node to campaign and returns result', async () => {
      await manager.registerNode({
        nodeId: 'n2',
        cdpEndpoint: 'ws://127.0.0.1:9223',
        state: 'idle',
        health: 'ok',
      });
      const campaign: CampaignConfig = {
        campaignId: 'c1',
        merchantId: 'm1',
        rule: {
          industry: 'beauty',
          benchmarkAccountIds: ['a1', 'a2'],
          platforms: ['xiaohongshu'],
          requirePhone: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = await manager.allocate(campaign);
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('n2');
      expect(result!.nodeStatus.campaignId).toBe('c1');
      expect(result!.expiresAt).toBeDefined();
      const status = await manager.getNodesStatus();
      expect(status.allocated).toBe(1);
      const released = await manager.release('n2');
      expect(released).toBe(true);
      const after = await manager.getNodesStatus();
      expect(after.idle).toBe(1);
    });

    it('returns null when no idle node and no spawn', async () => {
      const campaign: CampaignConfig = {
        campaignId: 'c2',
        merchantId: 'm1',
        rule: {
          industry: 'fitness',
          benchmarkAccountIds: [],
          platforms: ['douyin'],
          requirePhone: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = await manager.allocate(campaign);
      expect(result).toBeNull();
    });
  });

  describe('registerNode', () => {
    it('registers new node and appears in pool', async () => {
      const status = await manager.registerNode({
        cdpEndpoint: 'ws://127.0.0.1:9224',
        containerId: 'cnt-1',
      });
      expect(status.nodeId).toBeDefined();
      expect(status.state).toBe('idle');
      const list = await manager.getNodesStatus();
      expect(list.nodes.some((n) => n.nodeId === status.nodeId)).toBe(true);
    });
  });
});

describe('NodePool', () => {
  let redis: Redis;
  let pool: NodePool;

  beforeAll(() => {
    redis = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: 3 });
    pool = new NodePool({ redis });
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    const keys = await redis.keys('clawcommerce:*');
    if (keys.length) await redis.del(...keys);
    await pool.syncFromRedis();
  });

  it('upsert and get', async () => {
    const status: NodeStatus = {
      nodeId: 'x1',
      state: 'idle',
      health: 'ok',
      updatedAt: new Date().toISOString(),
    };
    await pool.upsert(status);
    const got = await pool.get('x1');
    expect(got?.nodeId).toBe('x1');
    expect(got?.state).toBe('idle');
  });

  it('allocate and release', async () => {
    await pool.register({ nodeId: 'x2' });
    await pool.allocate('x2', 'camp1', 'phone1');
    const n = await pool.get('x2');
    expect(n?.state).toBe('allocated');
    expect(n?.campaignId).toBe('camp1');
    await pool.release('x2');
    const r = await pool.get('x2');
    expect(r?.state).toBe('idle');
    expect(r?.campaignId).toBeUndefined();
  });

  it('counts', async () => {
    await pool.register({ nodeId: 'c1' });
    await pool.register({ nodeId: 'c2' });
    await pool.allocate('c2', 'camp1');
    const c = pool.counts();
    expect(c.total).toBe(2);
    expect(c.idle).toBe(1);
    expect(c.allocated).toBe(1);
  });
});
