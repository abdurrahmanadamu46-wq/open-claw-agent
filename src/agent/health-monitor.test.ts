/**
 * ClawCommerce Agent - HealthMonitor unit tests
 */

import Redis from 'ioredis';
import { NodePool } from './node-pool.js';
import { HealthMonitor } from './health-monitor.js';
import { createMockLogger } from './logger.js';

const REDIS_TEST_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('HealthMonitor', () => {
  let redis: Redis;
  let nodePool: NodePool;
  let logger: ReturnType<typeof createMockLogger>;
  let unhealthyCalls: { nodeId: string; reason: string }[];

  beforeAll(async () => {
    redis = new Redis(REDIS_TEST_URL, { maxRetriesPerRequest: 3 });
    nodePool = new NodePool({ redis });
    await nodePool.syncFromRedis();
    logger = createMockLogger();
    unhealthyCalls = [];
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    const keys = await redis.keys('clawcommerce:*');
    if (keys.length) await redis.del(...keys);
    await nodePool.syncFromRedis();
    unhealthyCalls = [];
  });

  it('runPass updates node health from CDP check', async () => {
    await nodePool.register({
      nodeId: 'h1',
      cdpEndpoint: 'ws://127.0.0.1:9222',
      state: 'idle',
      health: 'unknown',
    });
    const monitor = new HealthMonitor({
      nodePool,
      logger,
      intervalMs: 999999,
      checkCdp: async () => ({ ok: true }),
      onUnhealthy: async (nodeId, reason) => {
        unhealthyCalls.push({ nodeId, reason });
      },
    });
    const results = await monitor.runPass();
    expect(results.length).toBe(1);
    expect(results[0].nodeId).toBe('h1');
    expect(results[0].verdict).toBe('ok');
    expect(results[0].cdpReachable).toBe(true);
    expect(unhealthyCalls.length).toBe(0);
    const node = await nodePool.get('h1');
    expect(node?.health).toBe('ok');
    expect(node?.lastHeartbeatAt).toBeDefined();
  });

  it('runPass marks node unhealthy when CDP fails and calls onUnhealthy', async () => {
    await nodePool.register({
      nodeId: 'h2',
      cdpEndpoint: 'ws://127.0.0.1:9999',
      state: 'allocated',
      health: 'ok',
    });
    const monitor = new HealthMonitor({
      nodePool,
      logger,
      intervalMs: 999999,
      checkCdp: async () => ({ ok: false, message: 'Connection refused' }),
      onUnhealthy: async (nodeId, reason) => {
        unhealthyCalls.push({ nodeId, reason });
      },
    });
    const results = await monitor.runPass();
    expect(results[0].verdict).toBe('unhealthy');
    expect(unhealthyCalls.length).toBe(1);
    expect(unhealthyCalls[0].nodeId).toBe('h2');
  });

  it('start and stop do not throw', () => {
    const monitor = new HealthMonitor({
      nodePool,
      logger,
      intervalMs: 100,
      checkCdp: async () => ({ ok: true }),
    });
    monitor.start();
    monitor.stop();
  });
});
