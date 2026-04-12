/**
 * ClawCommerce Agent - Example backend: GET /api/agent/nodes/status + WebSocket
 * Mounts getNodesStatusHandler and broadcasts NodeManager.onEvent to WS clients.
 * Run: node dist/server/agent-dashboard-server.js (after npm run build)
 * @module server/agent-dashboard-server
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import {
  HealthMonitor,
  PhonePool,
  NodeManager,
  NodePool,
  createLogger,
  getNodesStatusHandler,
  getIndustryCatalogHandler,
  compileIndustryWorkflowHandler,
} from '../agent/index.js';
import type { NodePoolEvent, NodeStatus } from '../agent/types.js';
import type { ICampaignConfig } from '../shared/contracts.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PORT = parseInt(process.env.PORT ?? '38789', 10);
const INTERNAL_API_SHARED_SECRET = process.env.INTERNAL_API_SHARED_SECRET?.trim();
const INTERNAL_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;
const logger = createLogger('agent-dashboard-server');

if (!INTERNAL_API_SHARED_SECRET) {
  throw new Error('Missing required environment variable: INTERNAL_API_SHARED_SECRET');
}

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname === '/api/agent/nodes/events') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  logger.info('Dashboard WebSocket client connected');
  ws.on('close', () => logger.info('Dashboard WebSocket client disconnected'));
});

function createAgentStack(): {
  nodeManager: NodeManager;
  redis: import('ioredis').Redis;
} {
  const redis = new (Redis as unknown as new (url: string, opts?: object) => import('ioredis').Redis)(REDIS_URL, { maxRetriesPerRequest: 10 });
  const nodePool = new NodePool({ redis });
  const healthMonitor = new HealthMonitor({
    nodePool,
    logger,
    intervalMs: 60_000,
    checkCdp: async () => ({ ok: true }),
  });
  const phonePool = new PhonePool({ adapters: {} });
  const nodeManager = new NodeManager({
    redis,
    maxNodes: parseInt(process.env.MAX_NODES ?? '10', 10),
    idleReleaseMinutes: parseInt(process.env.IDLE_RELEASE_MINUTES ?? '30', 10),
    nodePool,
    healthMonitor,
    phonePool,
    onEvent: (event: NodePoolEvent) => {
      const payload = JSON.stringify(event);
      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(payload);
      });
    },
  });
  return { nodeManager, redis };
}

let agentStack: ReturnType<typeof createAgentStack> | null = null;

async function ensureAgentStack(): Promise<ReturnType<typeof createAgentStack>> {
  if (!agentStack) {
    agentStack = createAgentStack();
    await agentStack.nodeManager.start();
  }
  return agentStack;
}

function buildInternalSignature(method: string, path: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', INTERNAL_API_SHARED_SECRET as string)
    .update(`${method}\n${path}\n${timestamp}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyInternalRequest(
  req: InstanceType<typeof http.IncomingMessage>,
  res: InstanceType<typeof http.ServerResponse>,
  path: string
): boolean {
  const timestamp = String(req.headers['x-internal-timestamp'] ?? '').trim();
  const signature = String(req.headers['x-internal-signature'] ?? '').trim().toLowerCase();

  if (!timestamp || !signature) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 401, message: 'Missing internal signature headers' }));
    return false;
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 401, message: 'Invalid internal timestamp' }));
    return false;
  }

  if (Math.abs(Date.now() - ts) > INTERNAL_SIGNATURE_MAX_SKEW_MS) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 401, message: 'Expired internal timestamp' }));
    return false;
  }

  const expected = buildInternalSignature(req.method ?? 'GET', path, timestamp);
  if (!safeEqualHex(signature, expected)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 401, message: 'Invalid internal signature' }));
    return false;
  }

  return true;
}

/** 供后端 CampaignProcessor 调用的内部 API：执行单次 Campaign 任务 */
async function handleInternalCampaignExecute(
  req: InstanceType<typeof http.IncomingMessage>,
  res: InstanceType<typeof http.ServerResponse>
): Promise<void> {
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload: ICampaignConfig;
  try {
    payload = JSON.parse(body || '{}') as ICampaignConfig;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 400, message: 'Invalid JSON body' }));
    return;
  }
  if (!payload.campaign_id || !payload.tenant_id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 400, message: 'Missing campaign_id or tenant_id' }));
    return;
  }
  try {
    const { nodeManager } = await ensureAgentStack();
    const result = await nodeManager.runCampaignTask(payload);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    logger.error('Internal campaign execute failed', err as Error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        campaignId: payload.campaign_id,
        tenantId: payload.tenant_id,
        error: (err as Error).message,
      })
    );
  }
}

/** 供后端「强制终止任务」调用：释放该 campaign 下所有已分配节点 */
async function handleInternalCampaignTerminate(
  req: InstanceType<typeof http.IncomingMessage>,
  res: InstanceType<typeof http.ServerResponse>
): Promise<void> {
  let body = '';
  for await (const chunk of req) body += chunk;
  let data: { campaign_id?: string };
  try {
    data = JSON.parse(body || '{}') as { campaign_id?: string };
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 400, message: 'Invalid JSON body' }));
    return;
  }
  if (!data.campaign_id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 400, message: 'Missing campaign_id' }));
    return;
  }
  try {
    const { nodeManager } = await ensureAgentStack();
    const result = await nodeManager.releaseByCampaignId(data.campaign_id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, released: result.released }));
  } catch (err) {
    logger.error('Internal campaign terminate failed', err as Error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
  }
}

/** 供后端代理：更新节点专属网络 + 指纹浏览器配置 */
async function handleInternalNodeConfig(
  nodeId: string,
  req: InstanceType<typeof http.IncomingMessage>,
  res: InstanceType<typeof http.ServerResponse>
): Promise<void> {
  let body = '';
  for await (const chunk of req) body += chunk;
  let data: { networkConfig?: { proxyUrl?: string; region?: string; label?: string }; fingerprintProfile?: { profileId?: string; strategy?: string; poolId?: string } };
  try {
    data = JSON.parse(body || '{}') as typeof data;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 400, message: 'Invalid JSON body' }));
    return;
  }
  try {
    const { nodeManager } = await ensureAgentStack();
    const updated = await nodeManager.updateNodeConfig(nodeId, {
      networkConfig: data.networkConfig,
      fingerprintProfile: data.fingerprintProfile as NodeStatus['fingerprintProfile'],
    });
    if (!updated) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 404, message: 'Node not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    logger.error('Internal node config failed', err as Error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
}

server.on('request', async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  const parsedUrl = new URL(url, `http://${req.headers.host ?? 'localhost'}`);
  const path = parsedUrl.pathname;
  const isInternalPath = path.startsWith('/internal/');
  if (isInternalPath && !verifyInternalRequest(req, res, path)) {
    return;
  }

  const nodeConfigMatch = method === 'PATCH' && /^\/internal\/nodes\/([^/]+)\/config\/?$/.exec(path);
  if (nodeConfigMatch) {
    await handleInternalNodeConfig(nodeConfigMatch[1]!, req, res);
    return;
  }

  if (method === 'GET' && path === '/api/agent/nodes/status') {
    try {
      const { nodeManager } = await ensureAgentStack();
      const handler = getNodesStatusHandler(nodeManager);
      await handler(req, res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (method === 'POST' && path === '/internal/campaign/execute') {
    await handleInternalCampaignExecute(req, res);
    return;
  }

  if (method === 'POST' && path === '/internal/campaign/terminate') {
    await handleInternalCampaignTerminate(req, res);
    return;
  }

  // ── Industry Preview API (runtime-owned stable handlers) ──
  if (method === 'GET' && path === '/api/agent/industry/catalog') {
    try {
      const handler = getIndustryCatalogHandler();
      await handler(req, res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (method === 'POST' && path === '/api/agent/industry/compile') {
    try {
      const handler = compileIndustryWorkflowHandler();
      await handler(req, res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  logger.info('Agent dashboard server listening', {
    port: PORT,
    status: 'GET /api/agent/nodes/status',
    execute: 'POST /internal/campaign/execute',
    terminate: 'POST /internal/campaign/terminate',
    ws: 'WS /api/agent/nodes/events',
  });
});

process.on('SIGTERM', async () => {
  if (agentStack) await agentStack.nodeManager.stop();
  server.close();
  process.exit(0);
});
