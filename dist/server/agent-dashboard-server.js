/**
 * ClawCommerce Agent - Example backend: GET /api/agent/nodes/status + WebSocket
 * Mounts getNodesStatusHandler and broadcasts NodeManager.onEvent to WS clients.
 * Run: node dist/server/agent-dashboard-server.js (after npm run build)
 * @module server/agent-dashboard-server
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import Redis from 'ioredis';
import { HealthMonitor, PhonePool, NodeManager, NodePool, createLogger, getNodesStatusHandler, } from '../agent/index.js';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const PORT = parseInt(process.env.PORT ?? '38789', 10);
const logger = createLogger('agent-dashboard-server');
const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (url.pathname === '/api/agent/nodes/events') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    }
    else {
        socket.destroy();
    }
});
wss.on('connection', (ws) => {
    logger.info('Dashboard WebSocket client connected');
    ws.on('close', () => logger.info('Dashboard WebSocket client disconnected'));
});
function createAgentStack() {
    const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 10 });
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
        onEvent: (event) => {
            const payload = JSON.stringify(event);
            wss.clients.forEach((client) => {
                if (client.readyState === 1)
                    client.send(payload);
            });
        },
    });
    return { nodeManager, redis };
}
let agentStack = null;
async function ensureAgentStack() {
    if (!agentStack) {
        agentStack = createAgentStack();
        await agentStack.nodeManager.start();
    }
    return agentStack;
}
/** 供后端 CampaignProcessor 调用的内部 API：执行单次 Campaign 任务 */
async function handleInternalCampaignExecute(req, res) {
    let body = '';
    for await (const chunk of req)
        body += chunk;
    let payload;
    try {
        payload = JSON.parse(body || '{}');
    }
    catch {
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
    }
    catch (err) {
        logger.error('Internal campaign execute failed', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: false,
            campaignId: payload.campaign_id,
            tenantId: payload.tenant_id,
            error: err.message,
        }));
    }
}
/** 供后端「强制终止任务」调用：释放该 campaign 下所有已分配节点 */
async function handleInternalCampaignTerminate(req, res) {
    let body = '';
    for await (const chunk of req)
        body += chunk;
    let data;
    try {
        data = JSON.parse(body || '{}');
    }
    catch {
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
    }
    catch (err) {
        logger.error('Internal campaign terminate failed', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
    }
}
/** 供后端代理：更新节点专属网络 + 指纹浏览器配置 */
async function handleInternalNodeConfig(nodeId, req, res) {
    let body = '';
    for await (const chunk of req)
        body += chunk;
    let data;
    try {
        data = JSON.parse(body || '{}');
    }
    catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 400, message: 'Invalid JSON body' }));
        return;
    }
    try {
        const { nodeManager } = await ensureAgentStack();
        const updated = await nodeManager.updateNodeConfig(nodeId, {
            networkConfig: data.networkConfig,
            fingerprintProfile: data.fingerprintProfile,
        });
        if (!updated) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 404, message: 'Node not found' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updated));
    }
    catch (err) {
        logger.error('Internal node config failed', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    }
}
server.on('request', async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';
    const nodeConfigMatch = method === 'PATCH' && /^\/internal\/nodes\/([^/]+)\/config\/?$/.exec(url);
    if (nodeConfigMatch) {
        await handleInternalNodeConfig(nodeConfigMatch[1], req, res);
        return;
    }
    if (method === 'GET' && url === '/api/agent/nodes/status') {
        try {
            const { nodeManager } = await ensureAgentStack();
            const handler = getNodesStatusHandler(nodeManager);
            await handler(req, res);
        }
        catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }
    if (method === 'POST' && url === '/internal/campaign/execute') {
        await handleInternalCampaignExecute(req, res);
        return;
    }
    if (method === 'POST' && url === '/internal/campaign/terminate') {
        await handleInternalCampaignTerminate(req, res);
        return;
    }
    if (method === 'GET' && url === '/health') {
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
    if (agentStack)
        await agentStack.nodeManager.stop();
    server.close();
    process.exit(0);
});
//# sourceMappingURL=agent-dashboard-server.js.map