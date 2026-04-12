/**
 * ClawCommerce Agent - Standalone process entry
 * Connects Redis, starts NodeManager + health monitor, keeps process alive.
 * Backend mounts Dashboard API separately.
 */

import Redis from 'ioredis';
import { NodePool, HealthMonitor, PhonePool, NodeManager, createLogger } from './agent/index.js';
import WebSocket from 'ws';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MAX_NODES = parseInt(process.env.MAX_NODES ?? '10', 10);
const IDLE_RELEASE_MINUTES = parseInt(process.env.IDLE_RELEASE_MINUTES ?? '30', 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? String(5 * 60 * 1000), 10);

const logger = createLogger('clawcommerce-agent-run');

async function main(): Promise<void> {
  const RedisClient = Redis as unknown as new (url: string, opts?: { maxRetriesPerRequest?: number }) => import('ioredis').Redis;
  const redis = new RedisClient(REDIS_URL, { maxRetriesPerRequest: 10 });
  redis.on('error', (err: Error) => logger.error('Redis error', err));

  const nodePool = new NodePool({ redis });
  await nodePool.syncFromRedis();

  const healthMonitor = new HealthMonitor({
    nodePool,
    logger,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    checkCdp: async (cdpEndpoint) => {
      return new Promise((resolve) => {
        const ws = new WebSocket(cdpEndpoint);
        const t = setTimeout(() => {
          ws.close();
          resolve({ ok: false, message: 'timeout' });
        }, 5000);
        ws.on('open', () => {
          clearTimeout(t);
          ws.close();
          resolve({ ok: true });
        });
        ws.on('error', (err) => {
          clearTimeout(t);
          resolve({ ok: false, message: (err as Error).message });
        });
      });
    },
    onUnhealthy: async (nodeId, reason) => {
      logger.warn('Node unhealthy, trigger recovery', { nodeId, reason });
      // Orchestrator can implement restart/switch here
    },
  });

  const phonePool = new PhonePool({ adapters: {} });

  const nodeManager = new NodeManager({
    redis,
    maxNodes: MAX_NODES,
    idleReleaseMinutes: IDLE_RELEASE_MINUTES,
    nodePool,
    healthMonitor,
    phonePool,
    onEvent: (e) => logger.info('Node event', e as unknown as Record<string, unknown>),
  });

  await nodeManager.start();
  logger.info('ClawCommerce Agent running', { MAX_NODES, IDLE_RELEASE_MINUTES });

  const shutdown = async () => {
    await nodeManager.stop();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal', err);
  process.exit(1);
});
