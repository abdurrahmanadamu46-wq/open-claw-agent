import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotEnv } from 'dotenv';
import Redis from 'ioredis';

import type { ICampaignConfig } from '../../shared/contracts.js';
import { executeCampaignTask } from '../execute-campaign.js';
import { HealthMonitor } from '../health-monitor.js';
import { createLogger } from '../logger.js';
import { NodeManager } from '../node-manager.js';
import { NodePool } from '../node-pool.js';
import { PhonePool } from '../phone-pool.js';
import type { NodeStatus } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function findNearestEnv(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

const nearestEnvPath = findNearestEnv(__dirname);

if (nearestEnvPath) {
  loadDotEnv({ path: nearestEnvPath, override: false });
}

const logger = createLogger('execute-campaign-runtime');

export interface ExecuteCampaignRuntimeConfig {
  redisUrl: string;
  redisSource: 'REDIS_URL' | 'REDIS_HOST_PORT' | 'default';
  maxNodes: number;
  idleReleaseMinutes: number;
  autoRegisterNode: boolean;
}

export interface ExecuteCampaignRuntimeContext {
  config: ExecuteCampaignRuntimeConfig;
  redis: import('ioredis').Redis;
  nodePool: NodePool;
  healthMonitor: HealthMonitor;
  phonePool: PhonePool;
  nodeManager: NodeManager;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveExecuteCampaignRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ExecuteCampaignRuntimeConfig {
  const maxNodes = parseInteger(env.MAX_NODES, 10);
  const idleReleaseMinutes = parseInteger(env.IDLE_RELEASE_MINUTES, 30);
  const autoRegisterNode = env.LOBSTER_RUNTIME_AUTO_REGISTER_EXECUTE_CAMPAIGN_NODE === 'true';

  if (env.REDIS_URL) {
    return {
      redisUrl: env.REDIS_URL,
      redisSource: 'REDIS_URL',
      maxNodes,
      idleReleaseMinutes,
      autoRegisterNode,
    };
  }

  if (env.REDIS_HOST_PORT) {
    return {
      redisUrl: `redis://127.0.0.1:${env.REDIS_HOST_PORT}`,
      redisSource: 'REDIS_HOST_PORT',
      maxNodes,
      idleReleaseMinutes,
      autoRegisterNode,
    };
  }

  return {
    redisUrl: 'redis://127.0.0.1:6379',
    redisSource: 'default',
    maxNodes,
    idleReleaseMinutes,
    autoRegisterNode,
  };
}

function buildSyntheticNode(overrides: Partial<NodeStatus> = {}): Partial<NodeStatus> & {
  cdpEndpoint?: string;
  containerId?: string;
} {
  const now = new Date().toISOString();
  const metadata = {
    source: 'lobster-runtime-auto-node',
    created_at: now,
    ...((overrides.metadata as Record<string, unknown> | undefined) ?? {}),
  };

  return {
    cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/lobster-runtime',
    containerId: 'lobster-runtime-synthetic-node',
    health: 'ok',
    playwrightState: 'connected',
    idleSince: now,
    metadata,
    ...overrides,
  };
}

export async function createExecuteCampaignRuntimeContext(
  overrides: Partial<ExecuteCampaignRuntimeConfig> = {},
): Promise<ExecuteCampaignRuntimeContext> {
  const resolved = {
    ...resolveExecuteCampaignRuntimeConfig(),
    ...overrides,
  };
  const RedisClient = Redis as unknown as new (
    url: string,
    opts?: { maxRetriesPerRequest?: number },
  ) => import('ioredis').Redis;
  const redis = new RedisClient(resolved.redisUrl, { maxRetriesPerRequest: 10 });
  const nodePool = new NodePool({ redis });
  await nodePool.syncFromRedis();

  const healthMonitor = new HealthMonitor({
    nodePool,
    logger,
    intervalMs: 5 * 60 * 1000,
    checkCdp: async () => ({ ok: true }),
    onUnhealthy: async () => undefined,
  });
  const phonePool = new PhonePool({ adapters: {} });
  const nodeManager = new NodeManager({
    redis,
    maxNodes: resolved.maxNodes,
    idleReleaseMinutes: resolved.idleReleaseMinutes,
    nodePool,
    healthMonitor,
    phonePool,
    spawnNode: resolved.autoRegisterNode
      ? async () => {
          const node = await nodePool.register(buildSyntheticNode());
          logger.info('Synthetic execute-campaign node registered via spawn', {
            nodeId: node.nodeId,
          });
          return node;
        }
      : undefined,
    onEvent: (event) => {
      logger.info('Execute campaign runtime node event', {
        type: event.type,
        nodeId: event.nodeId,
      });
    },
  });

  return {
    config: resolved,
    redis,
    nodePool,
    healthMonitor,
    phonePool,
    nodeManager,
  };
}

export async function ensureExecuteCampaignRuntimeNode(
  context: ExecuteCampaignRuntimeContext,
  overrides: Partial<NodeStatus> = {},
): Promise<NodeStatus> {
  const existingIdle = context.nodePool.getIdle()[0];
  if (existingIdle) {
    return existingIdle;
  }

  const node = await context.nodePool.register(buildSyntheticNode(overrides));
  logger.info('Synthetic execute-campaign node ensured', { nodeId: node.nodeId });
  return node;
}

export async function closeExecuteCampaignRuntimeContext(
  context: ExecuteCampaignRuntimeContext,
): Promise<void> {
  await context.nodeManager.stop();
  await context.redis.quit();
}

export async function runExecuteCampaignWithRuntime(
  payload: ICampaignConfig,
  options: {
    context?: ExecuteCampaignRuntimeContext;
    ensureNode?: boolean;
    executeTask?: (params: { nodeId: string; config: ICampaignConfig }) => Promise<unknown>;
  } = {},
) {
  const ownContext = !options.context;
  const context = options.context ?? (await createExecuteCampaignRuntimeContext());

  try {
    if (options.ensureNode ?? context.config.autoRegisterNode) {
      await ensureExecuteCampaignRuntimeNode(context);
    }

    return await executeCampaignTask(payload, {
      nodeManager: context.nodeManager,
      nodePool: context.nodePool,
      executeTask: options.executeTask,
    });
  } finally {
    if (ownContext) {
      await closeExecuteCampaignRuntimeContext(context);
    }
  }
}
