/**
 * VIP 一号客户特供版 — 硬编码鉴权 + 极简黑框
 * 不扫码、无大盘；连接成功即打印绿条，等待 server.task.dispatch。
 *
 * 开发运行（在仓库根目录）：
 *   set CLIENT_DEVICE_TOKEN=... & set MACHINE_CODE=... & node scripts/vip-build/vip-lobster-entry.cjs
 * 或复制 .env.vip.example 为 .env.vip 后：
 *   node scripts/vip-build/vip-lobster-entry.cjs
 *
 * 打包 exe（需已 npm install，且本机能连总控）：
 *   npx pkg scripts/vip-build/vip-lobster-entry.cjs --targets node18-win-x64 --output dist/vip-lobster.exe
 * 打包时把 .env.vip 与 exe 同目录发放，或提前把 token 写进脚本（仅一号客户临时用）。
 */
const path = require('path');
const fs = require('fs');

// 加载 .env.vip：先找脚本同目录，再找当前工作目录
function loadEnvVip(filepath) {
  if (!fs.existsSync(filepath)) return false;
  const text = fs.readFileSync(filepath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return true;
}
const tried1 = path.join(__dirname, '.env.vip');
const tried2 = path.join(process.cwd(), '.env.vip');
const tried3 = path.join(__dirname, 'env.vip');
const tried4 = path.join(process.cwd(), 'env.vip');
if (!loadEnvVip(tried1)) loadEnvVip(tried2);
if (!process.env.CLIENT_DEVICE_TOKEN && !process.env.MOCK_JWT_TOKEN) {
  loadEnvVip(tried3) || loadEnvVip(tried4);
}

const { io } = require('socket.io-client');

// 总控 Nest 使用 path: '/agent-cc'，即 Engine.IO 挂在 /agent-cc；客户端连 base URL（不含 /agent-cc）+ path /agent-cc
const rawUrl = process.env.C_AND_C_SERVER_URL || process.env.C_AND_C_URL || 'http://127.0.0.1:3000';
const hasAgentCc = rawUrl.indexOf('/agent-cc') !== -1;
const C_AND_C_SERVER_URL = hasAgentCc ? rawUrl.replace(/\/agent-cc\/?$/, '') : rawUrl;
const SOCKET_PATH = process.env.SOCKETIO_PATH || (hasAgentCc ? '/agent-cc' : '/socket.io');
const CLIENT_DEVICE_TOKEN = process.env.CLIENT_DEVICE_TOKEN || process.env.MOCK_JWT_TOKEN || '';
const MACHINE_CODE =
  process.env.MACHINE_CODE || process.env.DEVICE_ID || 'VIP-CLIENT-001';

if (!CLIENT_DEVICE_TOKEN) {
  console.error('❌ 缺少 CLIENT_DEVICE_TOKEN（或 MOCK_JWT_TOKEN），请在本程序同目录放置 .env.vip 并填写 CLIENT_DEVICE_TOKEN=...');
  console.error('   已查找: ' + tried1 + ', ' + tried2 + ', env.vip');
  process.exit(1);
}

// 与 Nest adapter 一致：namespace 在 url 里则整段作为 base
// 先试 polling 再升级 websocket，避免部分隧道（如 localtunnel）直连 ws 失败
const socket = io(C_AND_C_SERVER_URL, {
  path: SOCKET_PATH,
  auth: { token: CLIENT_DEVICE_TOKEN },
  extraHeaders: { 'x-machine-code': MACHINE_CODE },
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 3000,
});

function greenLine() {
  console.log('');
  console.log('🟢 龙虾节点已连接云端，等待任务下发...');
  console.log('   设备: ' + MACHINE_CODE);
  console.log('');
}

socket.on('connect', () => {
  greenLine();
});

socket.on('disconnect', (reason) => {
  console.log('⚪ 已断开: ' + reason + '，正在重连...');
});

socket.on('connect_error', (err) => {
  console.error('❌ 连接失败: ' + (err && err.message ? err.message : err));
});

socket.on('server.system.ready', () => {});
socket.on('system.ready', () => {});

// 收到任务即 Ack，并打一条假线索便于「第一条线索」验收（可删）
socket.on('server.task.dispatch', (payload) => {
  const campaignId = (payload && payload.campaign_id) || (payload && payload.campaignId) || 'unknown';
  const jobId = (payload && payload.job_id) || campaignId;
  console.log('[任务] 收到 dispatch campaign=' + campaignId);
  socket.emit('client.task.ack', {
    job_id: jobId,
    campaign_id: campaignId,
    status: 'ACCEPTED',
    timestamp: Date.now(),
  });
  // 极简验收：立即上报一条测试线索（生产可改为真实 Playwright 结果）
  setTimeout(() => {
    socket.emit('client.lead.report', {
      campaign_id: campaignId,
      contact_info: 'VIP_FIRST_LEAD_' + Date.now(),
      intention_score: 80,
      source_platform: 'vip_build',
    });
    console.log('[线索] 已上报 client.lead.report（验收用）');
  }, 1500);
});

console.log('[VIP] 正在连接 ' + C_AND_C_SERVER_URL + ' ...');
