/**
 * VIP edge node runtime (single-customer build).
 * - Connects to fleet gateway by default: /fleet
 * - Supports legacy dispatch event: server.task.dispatch
 * - Emits unified telemetry: node_ping / task_progress / task_completed / client.lead.report
 */
const fs = require('fs');
const path = require('path');
const { createHash, createVerify } = require('node:crypto');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

function resolveEnv() {
  const localCandidates = [
    path.join(__dirname, '.env.vip'),
    path.join(process.cwd(), '.env.vip'),
    path.join(__dirname, 'env.vip'),
    path.join(process.cwd(), 'env.vip'),
  ];
  for (const candidate of localCandidates) {
    if (loadEnvFile(candidate)) break;
  }
}

function decodeJwtTenantId(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return String(payload.tenantId || payload.tenant_id || '').trim();
  } catch {
    return '';
  }
}

function normalizeServerTarget(rawUrl, explicitPath) {
  const raw = String(rawUrl || '').trim() || 'http://127.0.0.1:3000';
  if (explicitPath && explicitPath.trim()) {
    return { baseUrl: raw.replace(/\/+$/, ''), socketPath: explicitPath.trim() };
  }
  // migration: old samples may use /agent-cc or /lobster, force unified /fleet path.
  if (/\/fleet\/?$/i.test(raw)) return { baseUrl: raw.replace(/\/fleet\/?$/i, ''), socketPath: '/fleet' };
  if (/\/agent-cc\/?$/i.test(raw)) return { baseUrl: raw.replace(/\/agent-cc\/?$/i, ''), socketPath: '/fleet' };
  if (/\/lobster\/?$/i.test(raw)) return { baseUrl: raw.replace(/\/lobster\/?$/i, ''), socketPath: '/fleet' };
  return { baseUrl: raw.replace(/\/+$/, ''), socketPath: '/fleet' };
}

resolveEnv();

const rawServerUrl = process.env.C_AND_C_SERVER_URL || process.env.C_AND_C_URL || 'http://127.0.0.1:3000';
const token = process.env.CLIENT_DEVICE_TOKEN || process.env.MOCK_JWT_TOKEN || '';
const machineCode = process.env.MACHINE_CODE || 'VIP-CLIENT-001';
const tenantId = process.env.TENANT_ID || decodeJwtTenantId(token) || 'tenant_demo';
const nodeId = process.env.NODE_ID || machineCode;
const appVersion = process.env.APP_VERSION || '0.1.0';
const autoUpdateManifestUrl = process.env.AUTO_UPDATE_MANIFEST_URL || '';
const autoUpdateDownload = ['1', 'true', 'yes'].includes(String(process.env.AUTO_UPDATE_DOWNLOAD || '').toLowerCase());
const updateCheckOnly = ['1', 'true', 'yes'].includes(String(process.env.UPDATE_CHECK_ONLY || '').toLowerCase());
const autoUpdateRequireSignature = ['1', 'true', 'yes'].includes(
  String(process.env.AUTO_UPDATE_REQUIRE_SIGNATURE || '').toLowerCase(),
);
const autoUpdateDefaultKeyId = String(process.env.AUTO_UPDATE_DEFAULT_KEY_ID || 'default').trim();
const autoUpdatePublicKey = String(process.env.AUTO_UPDATE_PUBLIC_KEY || '').trim();
const autoUpdatePublicKeyPath = String(process.env.AUTO_UPDATE_PUBLIC_KEY_PATH || '').trim();
const autoUpdatePublicKeysJson = String(process.env.AUTO_UPDATE_PUBLIC_KEYS_JSON || '').trim();
const autoUpdatePublicKeysPath = String(process.env.AUTO_UPDATE_PUBLIC_KEYS_PATH || '').trim();
const explicitSocketPath = process.env.SOCKETIO_PATH || '';
const { baseUrl, socketPath } = normalizeServerTarget(rawServerUrl, explicitSocketPath);

if (!token && !updateCheckOnly) {
  console.error('Missing CLIENT_DEVICE_TOKEN (or MOCK_JWT_TOKEN).');
  process.exit(1);
}

function createSocketClient(baseUrl, socketPath, options) {
  const { io } = require('socket.io-client');
  return io(baseUrl, {
    path: socketPath,
    ...options,
  });
}

const socket = updateCheckOnly
  ? null
  : createSocketClient(baseUrl, socketPath, {
      auth: {
        token,
        nodeId,
        tenantId,
        activationCode: process.env.ACTIVATION_CODE || undefined,
      },
      extraHeaders: {
        'x-machine-code': machineCode,
      },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    });

let heartbeatTimer = null;
let currentTaskId = '';

function parseSemver(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || '',
  };
}

function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) return 0;
  if (av.major !== bv.major) return av.major > bv.major ? 1 : -1;
  if (av.minor !== bv.minor) return av.minor > bv.minor ? 1 : -1;
  if (av.patch !== bv.patch) return av.patch > bv.patch ? 1 : -1;
  if (!av.pre && bv.pre) return 1;
  if (av.pre && !bv.pre) return -1;
  if (av.pre === bv.pre) return 0;
  return av.pre > bv.pre ? 1 : -1;
}

function safeReadText(filePath) {
  if (!filePath) return '';
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  try {
    return fs.readFileSync(absolute, 'utf8').trim();
  } catch (err) {
    console.warn(`[update] failed to read file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

function parseKeyMap(raw) {
  const map = new Map();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return map;
    for (const [keyId, key] of Object.entries(parsed)) {
      const normalizedKeyId = String(keyId || '').trim();
      const normalizedKey = String(key || '').trim();
      if (!normalizedKeyId || !normalizedKey) continue;
      map.set(normalizedKeyId, normalizedKey);
    }
  } catch (err) {
    console.warn(`[update] invalid key map JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return map;
}

function resolveUpdatePublicKeys() {
  const map = new Map();

  const fromInlineMap = parseKeyMap(autoUpdatePublicKeysJson);
  for (const [k, v] of fromInlineMap.entries()) map.set(k, v);

  const fromFileMap = parseKeyMap(safeReadText(autoUpdatePublicKeysPath));
  for (const [k, v] of fromFileMap.entries()) map.set(k, v);

  const legacyInline = autoUpdatePublicKey;
  const legacyPath = safeReadText(autoUpdatePublicKeyPath);
  if (legacyInline) map.set(autoUpdateDefaultKeyId, legacyInline);
  if (legacyPath) map.set(autoUpdateDefaultKeyId, legacyPath);

  return map;
}

const resolvedUpdatePublicKeys = resolveUpdatePublicKeys();

function isValidSha256Hex(raw) {
  return /^[0-9a-f]{64}$/i.test(String(raw || '').trim());
}

function buildReleaseSignaturePayload(release, channel) {
  return [
    `platform=${String(release.platform || '').trim()}`,
    `channel=${String(channel || 'stable').trim()}`,
    `version=${String(release.version || '').trim()}`,
    `downloadUrl=${String(release.downloadUrl || '').trim()}`,
    `sha256=${String(release.sha256 || '').trim().toLowerCase()}`,
    `minRequiredVersion=${String(release.minRequiredVersion || '').trim()}`,
    `signatureKeyId=${String(release.signatureKeyId || autoUpdateDefaultKeyId).trim()}`,
  ].join('\n');
}

function verifyReleaseSignature(release, channel) {
  const keyId = String(release?.signatureKeyId || autoUpdateDefaultKeyId).trim();
  const signatureBase64 = String(release?.signature || '').trim();
  if (!signatureBase64) {
    if (autoUpdateRequireSignature) {
      console.warn('[update] release signature is missing while AUTO_UPDATE_REQUIRE_SIGNATURE=true');
      return false;
    }
    return true;
  }
  const publicKey = resolvedUpdatePublicKeys.get(keyId);
  if (!publicKey) {
    console.warn(`[update] release signature exists but no public key configured for keyId=${keyId}`);
    return false;
  }
  try {
    const signature = Buffer.from(signatureBase64, 'base64');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(buildReleaseSignaturePayload(release, channel), 'utf8');
    verifier.end();
    const ok = verifier.verify(publicKey, signature);
    if (!ok) {
      console.warn('[update] signature verification failed');
    }
    return ok;
  } catch (err) {
    console.warn(`[update] signature verification error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function maybeDownloadUpdate(downloadUrl, version, expectedSha256) {
  if (!autoUpdateDownload) return;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status}`);
  }
  const fileNameFromUrl = (() => {
    try {
      const url = new URL(downloadUrl);
      const candidate = path.basename(url.pathname || '').trim();
      return candidate || `vip-lobster-${version}.exe`;
    } catch {
      return `vip-lobster-${version}.exe`;
    }
  })();
  const updatesDir = path.join(process.cwd(), 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const targetFile = path.join(updatesDir, fileNameFromUrl);
  const data = Buffer.from(await response.arrayBuffer());
  const downloadedSha = createHash('sha256').update(data).digest('hex');
  if (downloadedSha !== expectedSha256) {
    throw new Error(`sha256 mismatch: expected=${expectedSha256} actual=${downloadedSha}`);
  }
  fs.writeFileSync(targetFile, data);
  console.log(`[update] downloaded to ${targetFile} (sha256 verified)`);
}

async function checkForUpdate() {
  if (!autoUpdateManifestUrl) return;
  try {
    const separator = autoUpdateManifestUrl.includes('?') ? '&' : '?';
    const qs = new URLSearchParams();
    qs.set('currentVersion', appVersion);
    if (tenantId) qs.set('tenantId', tenantId);
    if (nodeId) qs.set('nodeId', nodeId);
    const checkUrl = `${autoUpdateManifestUrl}${separator}${qs.toString()}`;
    const response = await fetch(checkUrl, { method: 'GET' });
    if (!response.ok) {
      console.warn(`[update] check failed status=${response.status}`);
      return;
    }
    const payload = await response.json();
    const data = payload?.data || payload;
    const release = data?.release;
    if (!data?.hasUpdate || !release?.version || !release?.downloadUrl) {
      console.log('[update] no newer release');
      return;
    }
    if (compareSemver(release.version, appVersion) <= 0) {
      console.log('[update] no newer release');
      return;
    }
    const expectedSha256 = String(release.sha256 || '').trim().toLowerCase();
    if (!isValidSha256Hex(expectedSha256)) {
      console.warn('[update] blocked: release sha256 missing or invalid');
      return;
    }
    if (!verifyReleaseSignature(release, data.channel || 'stable')) {
      console.warn('[update] blocked: release signature verification failed');
      return;
    }
    console.log(`[update] new release available: ${appVersion} -> ${release.version}`);
    console.log(`[update] download: ${release.downloadUrl}`);
    console.log(`[update] sha256: ${expectedSha256}`);
    if (release.notes) console.log(`[update] notes: ${release.notes}`);
    await maybeDownloadUpdate(release.downloadUrl, release.version, expectedSha256);
  } catch (err) {
    console.warn(`[update] check error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function randomPercent(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function sendNodePing(status, override) {
  if (!socket) return;
  socket.emit('node_ping', {
    nodeId,
    tenantId,
    status,
    clientId: machineCode,
    clientName: machineCode,
    cpuPercent: randomPercent(8, 45),
    memoryPercent: randomPercent(20, 68),
    platforms: ['douyin', 'xiaohongshu'],
    currentTaskId: currentTaskId || undefined,
    ...override,
  });
}

function startHeartbeat() {
  if (!socket) return;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!socket.connected) return;
    sendNodePing(currentTaskId ? 'BUSY' : 'IDLE');
    // legacy heartbeat for compatibility consumers
    socket.emit('client.heartbeat', {
      node_id: nodeId,
      tenant_id: tenantId,
      cpu_usage: randomPercent(8, 45),
      memory_usage_mb: Math.round(randomPercent(700, 1800)),
      active_browsers: currentTaskId ? 1 : 0,
      status: currentTaskId ? 'BUSY' : 'IDLE',
    });
  }, 15_000);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function emitTaskProgress(taskId, campaignId, traceId, progress, message, step) {
  if (!socket) return;
  socket.emit('task_progress', {
    taskId,
    nodeId,
    traceId,
    progress,
    message,
    step,
  });
  // legacy status channel
  socket.emit('client.node.status', {
    node_id: nodeId,
    campaign_id: campaignId,
    current_status: step || 'RUNNING',
    progress: message || `progress=${progress}`,
    trace_id: traceId,
  });
}

function emitTaskComplete(taskId, campaignId, traceId) {
  if (!socket) return;
  socket.emit('task_completed', {
    taskId,
    nodeId,
    traceId,
    success: true,
    result: { campaignId, nodeId, status: 'DONE' },
    completedAt: new Date().toISOString(),
  });
}

function emitLead(taskId, campaignId, traceId) {
  if (!socket) return;
  const phone = `138${String(Date.now()).slice(-8)}`;
  socket.emit('client.lead.report', {
    tenant_id: tenantId,
    campaign_id: campaignId,
    trace_id: traceId,
    node_id: nodeId,
    contact_info: phone,
    intention_score: 86,
    source_platform: 'douyin',
    user_message: `task=${taskId} user asks for purchase link and price`,
    captured_at: new Date().toISOString(),
    webhook_status: 'PENDING',
  });
}

function toUnifiedTask(payload) {
  const taskId =
    String(payload?.taskId || payload?.task_id || payload?.job_id || '').trim() ||
    `task_${Date.now()}`;
  const campaignId =
    String(payload?.campaignId || payload?.campaign_id || '').trim() ||
    'campaign_unknown';
  const traceId = String(payload?.traceId || payload?.trace_id || '').trim() || undefined;
  return { taskId, campaignId, traceId, raw: payload };
}

async function executeMockWorkflow(unified) {
  if (!socket) return;
  currentTaskId = unified.taskId;
  sendNodePing('BUSY', { currentTaskId });

  socket.emit('client.task.ack', {
    task_id: unified.taskId,
    campaign_id: unified.campaignId,
    trace_id: unified.traceId,
    status: 'ACCEPTED',
    timestamp: Date.now(),
    node_id: nodeId,
  });

  emitTaskProgress(unified.taskId, unified.campaignId, unified.traceId, 20, 'bootstrap executor runtime', 'INIT');
  await new Promise((r) => setTimeout(r, 800));
  emitTaskProgress(unified.taskId, unified.campaignId, unified.traceId, 55, 'generating content package and operation actions', 'GENERATING');
  await new Promise((r) => setTimeout(r, 900));
  emitTaskProgress(unified.taskId, unified.campaignId, unified.traceId, 85, 'executing publish actions', 'PUBLISHING');
  await new Promise((r) => setTimeout(r, 900));
  emitTaskComplete(unified.taskId, unified.campaignId, unified.traceId);
  emitLead(unified.taskId, unified.campaignId, unified.traceId);

  currentTaskId = '';
  sendNodePing('IDLE');
}

if (updateCheckOnly) {
  void (async () => {
    await checkForUpdate();
    console.log('[update] check-only mode completed');
    process.exit(0);
  })().catch((err) => {
    console.error(`[update] check-only mode failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
} else {
  socket.on('connect', () => {
    console.log('');
    console.log('Connected to cloud C&C.');
    console.log(`nodeId=${nodeId} tenantId=${tenantId} version=${appVersion} path=${socketPath} base=${baseUrl}`);
    console.log('Waiting for task dispatch...');
    console.log('');
    sendNodePing('IDLE');
    startHeartbeat();
    void checkForUpdate();
  });

  socket.on('disconnect', (reason) => {
    console.log(`Disconnected: ${reason}`);
    stopHeartbeat();
  });

  socket.on('connect_error', (err) => {
    console.error(`Connect failed: ${err && err.message ? err.message : err}`);
  });

  socket.on('server.kicked', (payload) => {
    console.error(`Kicked by server: ${JSON.stringify(payload || {})}`);
  });

  socket.on('execute_task', async (payload) => {
    const task = toUnifiedTask(payload);
    console.log(`[dispatch] execute_task taskId=${task.taskId} campaign=${task.campaignId}`);
    await executeMockWorkflow(task);
  });

  socket.on('server.task.dispatch', async (payload) => {
    const task = toUnifiedTask(payload);
    console.log(`[dispatch] legacy server.task.dispatch taskId=${task.taskId} campaign=${task.campaignId}`);
    await executeMockWorkflow(task);
  });

  console.log(`Connecting to ${baseUrl} with socket path ${socketPath} ...`);
}
