/**
 * Fleet protocol PoC client.
 * Run: npm run poc:lobster
 */
import { io, type Socket } from 'socket.io-client';

type UnifiedTask = {
  taskId: string;
  campaignId: string;
  traceId?: string;
};

const RAW_URL = process.env.C_AND_C_SERVER_URL ?? 'http://localhost:3000';
const SOCKET_PATH = process.env.SOCKETIO_PATH ?? '/fleet';
const TOKEN =
  process.env.MOCK_JWT_TOKEN ??
  process.env.CLIENT_DEVICE_TOKEN ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwb2NfdXNlciIsInRlbmFudElkIjoidGVuYW50X3BvYyIsInJvbGUiOiJhZ2VudF9ub2RlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.sig_replace';
const NODE_ID = process.env.NODE_ID ?? process.env.MACHINE_CODE ?? 'NODE-POC-001';
const TENANT_ID = process.env.TENANT_ID ?? 'tenant_poc';

const socket: Socket = io(RAW_URL, {
  path: SOCKET_PATH,
  auth: {
    token: TOKEN,
    nodeId: NODE_ID,
    tenantId: TENANT_ID,
  },
  extraHeaders: {
    'x-machine-code': NODE_ID,
  },
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
});

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let currentTaskId = '';

function rand(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function sendNodePing(status: 'IDLE' | 'BUSY') {
  socket.emit('node_ping', {
    nodeId: NODE_ID,
    tenantId: TENANT_ID,
    status,
    clientId: NODE_ID,
    clientName: NODE_ID,
    cpuPercent: rand(10, 45),
    memoryPercent: rand(22, 65),
    currentTaskId: currentTaskId || undefined,
    platforms: ['douyin', 'xiaohongshu'],
  });
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!socket.connected) return;
    sendNodePing(currentTaskId ? 'BUSY' : 'IDLE');
    socket.emit('client.heartbeat', {
      node_id: NODE_ID,
      tenant_id: TENANT_ID,
      status: currentTaskId ? 'BUSY' : 'IDLE',
      cpu_usage: rand(10, 45),
      memory_usage_mb: Math.round(rand(750, 1900)),
      active_browsers: currentTaskId ? 1 : 0,
    });
  }, 15_000);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function toUnifiedTask(payload: Record<string, unknown>): UnifiedTask {
  const taskId = String(payload.taskId ?? payload.task_id ?? payload.job_id ?? '').trim() || `task_${Date.now()}`;
  const campaignId = String(payload.campaignId ?? payload.campaign_id ?? '').trim() || 'campaign_unknown';
  const traceId = String(payload.traceId ?? payload.trace_id ?? '').trim() || undefined;
  return { taskId, campaignId, traceId };
}

async function executeTask(task: UnifiedTask): Promise<void> {
  currentTaskId = task.taskId;
  sendNodePing('BUSY');

  socket.emit('client.task.ack', {
    task_id: task.taskId,
    campaign_id: task.campaignId,
    trace_id: task.traceId,
    status: 'ACCEPTED',
    node_id: NODE_ID,
    timestamp: Date.now(),
  });

  socket.emit('task_progress', {
    taskId: task.taskId,
    nodeId: NODE_ID,
    traceId: task.traceId,
    progress: 25,
    step: 'INIT',
    message: 'started',
  });
  await new Promise((r) => setTimeout(r, 600));
  socket.emit('task_progress', {
    taskId: task.taskId,
    nodeId: NODE_ID,
    traceId: task.traceId,
    progress: 60,
    step: 'GENERATING',
    message: 'generating content',
  });
  await new Promise((r) => setTimeout(r, 700));
  socket.emit('task_progress', {
    taskId: task.taskId,
    nodeId: NODE_ID,
    traceId: task.traceId,
    progress: 90,
    step: 'PUBLISHING',
    message: 'publishing',
  });
  await new Promise((r) => setTimeout(r, 800));
  socket.emit('task_completed', {
    taskId: task.taskId,
    nodeId: NODE_ID,
    traceId: task.traceId,
    success: true,
    completedAt: new Date().toISOString(),
    result: { campaignId: task.campaignId },
  });

  socket.emit('client.lead.report', {
    tenant_id: TENANT_ID,
    campaign_id: task.campaignId,
    trace_id: task.traceId,
    node_id: NODE_ID,
    contact_info: `138${String(Date.now()).slice(-8)}`,
    intention_score: 88,
    source_platform: 'douyin',
    user_message: '怎么购买，发我链接',
    captured_at: new Date().toISOString(),
    webhook_status: 'PENDING',
  });

  currentTaskId = '';
  sendNodePing('IDLE');
}

socket.on('connect', () => {
  console.log(`[fleet-poc] connected socket=${socket.id} nodeId=${NODE_ID}`);
  sendNodePing('IDLE');
  startHeartbeat();
});

socket.on('disconnect', (reason) => {
  console.log(`[fleet-poc] disconnected reason=${reason}`);
  stopHeartbeat();
});

socket.on('connect_error', (err) => {
  console.error(`[fleet-poc] connect_error=${err.message}`);
});

socket.on('server.kicked', (payload: unknown) => {
  console.error(`[fleet-poc] kicked payload=${JSON.stringify(payload)}`);
});

socket.on('execute_task', async (payload: Record<string, unknown>) => {
  const task = toUnifiedTask(payload);
  console.log(`[fleet-poc] execute_task taskId=${task.taskId} campaign=${task.campaignId}`);
  await executeTask(task);
});

socket.on('server.task.dispatch', async (payload: Record<string, unknown>) => {
  const task = toUnifiedTask(payload);
  console.log(`[fleet-poc] legacy dispatch taskId=${task.taskId} campaign=${task.campaignId}`);
  await executeTask(task);
});

console.log(`[fleet-poc] connecting url=${RAW_URL} path=${SOCKET_PATH} nodeId=${NODE_ID}`);
