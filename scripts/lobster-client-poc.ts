/**
 * lobster-client-poc.ts — 龙虾客户端 C&C 连通性 PoC
 *
 * 联调前请安装：
 *   npm install socket.io-client
 *   npm install -D typescript @types/node  （根目录已有 tsx 可省略 ts-node）
 *
 * 运行：
 *   npx tsx scripts/lobster-client-poc.ts
 *
 * 环境变量：
 *   C_AND_C_SERVER_URL  默认 http://localhost:3000/agent-cc
 *   MOCK_JWT_TOKEN      后端签发的测试 JWT（须含 tenantId）
 *   MACHINE_CODE        设备唯一码
 */
import { io, type Socket } from 'socket.io-client';

// ==========================================
// 1. 环境变量与本地队列（断网暂存）
// ==========================================
const C_AND_C_SERVER_URL =
  process.env.C_AND_C_SERVER_URL ?? 'http://localhost:3000/agent-cc';
// 必须替换为后端真实签发的 JWT（payload 含 tenantId）
const MOCK_JWT_TOKEN =
  process.env.MOCK_JWT_TOKEN ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyX3BvYyIsInRlbmFudElkIjoidGVuYW50X3BvYyIsInBsYW5UeXBlIjoiUFJPIiwiZXhwIjo5OTk5OTk5OTk5fQ.SIGNATURE_REPLACE';
const MACHINE_CODE = process.env.MACHINE_CODE ?? 'MAC-POC-LOBSTER-001';

let localLeadQueue: Record<string, unknown>[] = [];
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

console.log(`[Lobster Client] 启动，设备代码: ${MACHINE_CODE}`);
console.log(`[Lobster Client] 连接目标: ${C_AND_C_SERVER_URL}`);

// Socket.io 必须使用 http/https 基址；ws:// 无法完成 Engine.IO 握手
const socket: Socket = io(C_AND_C_SERVER_URL, {
  auth: { token: MOCK_JWT_TOKEN },
  extraHeaders: { 'x-machine-code': MACHINE_CODE },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  transports: ['websocket'],
});

// ==========================================
// 2. 生命周期
// ==========================================

socket.on('connect', () => {
  console.log(`[网络] 已连接 C&C，Socket ID: ${socket.id}`);
  startHeartbeat();
  if (localLeadQueue.length > 0) {
    console.log(`[队列] 积压 ${localLeadQueue.length} 条线索，开始补偿发送...`);
    void flushLeadQueue();
  }
});

socket.on('disconnect', (reason) => {
  console.log(`[网络] 断开: ${reason}`);
  stopHeartbeat();
});

socket.on('connect_error', (err) => {
  console.error(`[鉴权/网络] 连接失败: ${err.message}`);
});

// v1.21 正式事件名 + 兼容旧名
socket.on('server.system.ready', (payload: unknown) => {
  console.log('[握手] server.system.ready', payload);
});
socket.on('system.ready', (payload: unknown) => {
  console.log('[握手] system.ready (兼容)', payload);
});

// ==========================================
// 3. 业务事件
// ==========================================

socket.on('server.task.dispatch', async (payload: Record<string, unknown>) => {
  const campaignId = payload.campaign_id as string;
  console.log(`\n[任务] 收到 dispatch: ${campaignId}`);
  console.log('config:', JSON.stringify(payload.config));

  socket.emit('client.task.ack', {
    campaign_id: campaignId,
    status: 'ACCEPTED',
    timestamp: Date.now(),
  });

  socket.emit('client.node.status', {
    campaign_id: campaignId,
    current_status: 'SCRAPING',
    progress: '正在初始化 Playwright 无头浏览器...',
  });

  setTimeout(() => {
    reportLead({
      tenant_id: 'tenant_poc',
      campaign_id: campaignId,
      contact_info: '13899998888',
      intention_score: 95,
      source_platform: 'douyin',
    });
  }, 3000);
});

// ==========================================
// 4. 线索上报 + 本地队列
// ==========================================

function reportLead(leadData: Record<string, unknown>) {
  if (socket.connected) {
    console.log('[战果] 上报线索...');
    socket.emit('client.lead.report', leadData, (response: { status?: string; continue?: boolean } | undefined) => {
      if (response && response.status === 'ok') {
        console.log(`[计费] 云端确认 continue=${response.continue}`);
        if (response.continue === false) {
          console.warn('[熔断] 余额不足，挂起抓取');
        }
      } else {
        console.error('[计费] 失败，入队重试');
        localLeadQueue.push(leadData);
      }
    });
  } else {
    console.log('[离线] 线索入本地队列');
    localLeadQueue.push(leadData);
  }
}

async function flushLeadQueue() {
  const copy = [...localLeadQueue];
  localLeadQueue = [];
  for (const lead of copy) {
    reportLead(lead);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    socket.emit('client.heartbeat', {
      cpu_usage: Number((Math.random() * 20 + 10).toFixed(2)),
      memory_usage_mb: Math.floor(Math.random() * 200 + 800),
      active_browsers: 1,
    });
    console.log('[心跳] client.heartbeat 已发送');
  }, 15_000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
