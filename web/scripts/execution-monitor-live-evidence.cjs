const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRoot = path.resolve(__dirname, '..');
const backendRoot = path.resolve(repoRoot, 'backend');
const outputRoot = path.resolve(webRoot, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(outputRoot, `execution-monitor-live-${timestamp}`);

const HARNESS_PORT = Number(process.env.EXEC_MONITOR_HARNESS_PORT || 48891);
const FRONTEND_PORT = Number(process.env.EXEC_MONITOR_FRONTEND_PORT || 3010);
const HARNESS_BASE_URL = `http://127.0.0.1:${HARNESS_PORT}`;
const FRONTEND_BASE_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const CONTRACT = 'execution-logs.v1';
const LIVE_NODE_ID = 'node_live_qa';
const LIVE_TASK_ID = 'task_live_001';
const TENANT_ID = 'tenant_main';

const { ExecutionLogsGatewayBridge } = require(path.join(backendRoot, 'dist', 'gateway', 'execution-logs.gateway.js'));
const { JwtService } = require(path.join(backendRoot, 'node_modules', '@nestjs', 'jwt'));
const { chromium } = require(path.join(webRoot, 'node_modules', '@playwright', 'test'));
const WebSocket = require(path.join(backendRoot, 'node_modules', 'ws'));

fs.mkdirSync(artifactDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

async function waitForHttpOk(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function writeJson(name, data) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  return target;
}

function terminateChild(child) {
  if (!child || child.killed) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: true,
      });
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
    });
  }
  child.kill('SIGTERM');
  return Promise.resolve();
}

function createHarness(bridge) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', HARNESS_BASE_URL);
    const allowCors = () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    };
    allowCors();
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const sendJson = (statusCode, body) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/api/v1/ai/execution-monitor/snapshot') {
      sendJson(200, {
        ok: true,
        tenant_id: TENANT_ID,
        nodes: [
          {
            node_id: LIVE_NODE_ID,
            tenant_id: TENANT_ID,
            client_name: 'QA Live Node',
            region: 'test-region',
            status: 'ONLINE',
            load_percent: 27,
            running_task_id: LIVE_TASK_ID,
            last_seen_at: nowIso(),
          },
        ],
        recent_logs: [],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/observability/event-bus/subjects') {
      sendJson(200, {
        ok: true,
        subjects: [
          {
            subject: `task.${TENANT_ID}.content-campaign-14step.step.dispatch.completed`,
            total_count: 12,
            count_last_minute: 1,
            count_last_hour: 5,
            rate_per_min: 1,
            last_published_at: Math.floor(Date.now() / 1000),
          },
        ],
        total_subjects: 1,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/observability/event-bus/prefix-summary') {
      sendJson(200, {
        ok: true,
        prefixes: [
          {
            prefix: `task.${TENANT_ID}.content-campaign-14step`,
            total_count: 12,
            count_last_minute: 1,
            count_last_hour: 5,
            subjects: [],
          },
        ],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/observability/dashboard') {
      sendJson(200, {
        tenant_id: TENANT_ID,
        days: 7,
        total_cost_usd: 1.23,
        total_tokens: 4567,
        total_calls: 12,
        avg_latency_ms: 320,
        by_model: [],
        by_lobster: [],
        daily_trend: [],
        orla_dispatcher: {
          tenant_id: TENANT_ID,
          days: 7,
          dispatcher_total: 12,
          orla_enabled_total: 9,
          success_count: 11,
          shared_state_hit_rate: 0.72,
          by_stage: { dispatch: 7, archive: 5 },
          by_tier: { t1: 6, t2: 3 },
          promotion_triggers: { risk: 2, urgency: 1 },
          latest: null,
        },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/me') {
      sendJson(200, {
        code: 0,
        data: {
          id: 'qa-member',
          name: 'qa-member',
          role: 'merchant',
          roles: ['merchant'],
          tenantId: TENANT_ID,
          tenantName: TENANT_ID,
          isAdmin: false,
        },
      });
      return;
    }

    sendJson(404, {
      message: `Cannot ${req.method} ${url.pathname}`,
      error: 'Not Found',
      statusCode: 404,
    });
  });

  bridge.attach(server);
  return server;
}

function createBridge() {
  const jwtService = new JwtService({
    secret: 'dev-secret-change-in-production',
    signOptions: { expiresIn: '30d' },
  });
  const redisService = {
    getOrThrow() {
      return {
        async hget(key, field) {
          if (key === `fleet:node:${LIVE_NODE_ID}` && field === 'tenant_id') {
            return TENANT_ID;
          }
          return null;
        },
      };
    },
  };

  return {
    bridge: new ExecutionLogsGatewayBridge(jwtService, redisService),
    jwtService,
  };
}

function createToken(jwtService, payload) {
  return jwtService.sign(payload, { expiresIn: '30d' });
}

async function collectWsFrames(url) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let closed = false;
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch {}
      resolve({ frames, close: null });
    }, 8000);

    socket.on('message', (data) => {
      const text = String(data);
      try {
        frames.push(JSON.parse(text));
      } catch {
        frames.push({ raw: text });
      }
    });

    socket.on('close', (code, reasonBuffer) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      resolve({
        frames,
        close: {
          code,
          reason: String(reasonBuffer || ''),
        },
      });
    });

    socket.on('error', (error) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function collectAuthorizedEvidence(bridge, token) {
  return new Promise((resolve, reject) => {
    const url = `${HARNESS_BASE_URL.replace('http', 'ws')}/ws/execution-logs?access_token=${encodeURIComponent(token)}&tenant_id=${TENANT_ID}`;
    const frames = [];
    let settled = false;
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {}
      reject(new Error('Timed out waiting for hello/execution_log/node_heartbeat'));
    }, 10000);

    const maybeFinish = () => {
      const hasHello = frames.some((frame) => frame.type === 'hello');
      const hasExecutionLog = frames.some((frame) => frame.type === 'execution_log');
      const hasNodeHeartbeat = frames.some((frame) => frame.type === 'node_heartbeat');
      if (!hasHello || !hasExecutionLog || !hasNodeHeartbeat || settled === true) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(frames);
    };

    socket.on('message', async (data) => {
      const frame = JSON.parse(String(data));
      frames.push(frame);
      if (frame.type === 'hello') {
        await bridge.emitNodeHeartbeat({
          nodeId: LIVE_NODE_ID,
          tenantId: TENANT_ID,
          status: 'ONLINE',
          currentTaskId: LIVE_TASK_ID,
          cpuPercent: 21,
          memoryPercent: 27,
          platforms: ['douyin'],
        });
        await bridge.emitTaskProgress({
          taskId: LIVE_TASK_ID,
          nodeId: LIVE_NODE_ID,
          progress: 42,
          step: 'dispatch',
          message: 'qa live progress',
        });
      }
      maybeFinish();
    });

    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    socket.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Authorized socket closed before collecting all expected frames'));
      }
    });
  });
}

async function startFrontend() {
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', `npx next dev -p ${FRONTEND_PORT} -H 127.0.0.1`]]
    : ['npx', ['next', 'dev', '-p', String(FRONTEND_PORT), '-H', '127.0.0.1']];

  const child = spawn(command[0], command[1], {
    cwd: webRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_BASE_URL: HARNESS_BASE_URL,
      NEXT_PUBLIC_USE_MOCK: 'false',
      NEXT_PUBLIC_RUNTIME_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logPath = path.join(artifactDir, 'frontend-dev.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  await waitForHttpOk(`${FRONTEND_BASE_URL}/login`, 180000);
  return { child, logPath };
}

async function captureMonitorScreenshot(token, bridge) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript((storedToken) => {
      localStorage.setItem('clawcommerce_token', storedToken);
    }, token);
    await page.goto(`${FRONTEND_BASE_URL}/operations/monitor`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`text=contract: ${CONTRACT}`, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await bridge.emitNodeHeartbeat({
      nodeId: LIVE_NODE_ID,
      tenantId: TENANT_ID,
      status: 'BUSY',
      currentTaskId: LIVE_TASK_ID,
      cpuPercent: 43,
      memoryPercent: 39,
      platforms: ['douyin'],
    });
    await bridge.emitTaskProgress({
      taskId: LIVE_TASK_ID,
      nodeId: LIVE_NODE_ID,
      progress: 68,
      step: 'execution',
      message: 'qa live screenshot evidence',
    });
    try {
      await page.waitForSelector(`text=${LIVE_TASK_ID}`, { timeout: 5000 });
    } catch {}
    try {
      await page.waitForSelector('text=conn:', { timeout: 5000 });
    } catch {}
    const screenshotPath = path.join(artifactDir, 'monitor-live.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } finally {
    await browser.close();
  }
}

async function main() {
  const { bridge, jwtService } = createBridge();
  const server = createHarness(bridge);
  await new Promise((resolve) => server.listen(HARNESS_PORT, '127.0.0.1', resolve));

  const memberToken = createToken(jwtService, {
    sub: 'qa-member',
    tenantId: TENANT_ID,
    role: 'merchant',
    roles: ['merchant'],
  });
  const foreignToken = createToken(jwtService, {
    sub: 'qa-foreign',
    tenantId: 'tenant_other',
    role: 'merchant',
    roles: ['merchant'],
  });

  let frontendProcess = null;

  try {
    const helloFrames = await collectAuthorizedEvidence(bridge, memberToken);
    const helloPath = writeJson('authorized-frames.json', helloFrames);

    const unauthorized = await collectWsFrames(
      `${HARNESS_BASE_URL.replace('http', 'ws')}/ws/execution-logs?tenant_id=${TENANT_ID}`,
    );
    const unauthorizedPath = writeJson('unauthorized-4401.json', unauthorized);

    const forbidden = await collectWsFrames(
      `${HARNESS_BASE_URL.replace('http', 'ws')}/ws/execution-logs?access_token=${encodeURIComponent(foreignToken)}&tenant_id=${TENANT_ID}`,
    );
    const forbiddenPath = writeJson('forbidden-4403.json', forbidden);

    const frontend = await startFrontend();
    frontendProcess = frontend.child;
    const screenshotPath = await captureMonitorScreenshot(memberToken, bridge);

    const summary = {
      generated_at: nowIso(),
      contract: CONTRACT,
      harness_base_url: HARNESS_BASE_URL,
      frontend_base_url: FRONTEND_BASE_URL,
      artifacts: {
        authorized_frames: helloPath,
        unauthorized_4401: unauthorizedPath,
        forbidden_4403: forbiddenPath,
        monitor_screenshot: screenshotPath,
        frontend_log: frontend.logPath,
      },
      checks: {
        hello: helloFrames.find((frame) => frame.type === 'hello') || null,
        execution_log: helloFrames.find((frame) => frame.type === 'execution_log') || null,
        node_heartbeat: helloFrames.find((frame) => frame.type === 'node_heartbeat') || null,
        unauthorized_close: unauthorized.close,
        forbidden_close: forbidden.close,
      },
    };
    const summaryPath = writeJson('summary.json', summary);

    const reportPath = path.join(artifactDir, 'REPORT.md');
    fs.writeFileSync(
      reportPath,
      [
        '# Execution Monitor Live Evidence',
        '',
        `Generated at: ${summary.generated_at}`,
        '',
        `- Contract: \`${CONTRACT}\``,
        `- Harness: \`${HARNESS_BASE_URL}\``,
        `- Frontend: \`${FRONTEND_BASE_URL}\``,
        '',
        '## Evidence',
        '',
        `- Authorized frames: \`${path.basename(helloPath)}\``,
        `- Unauthorized 4401: \`${path.basename(unauthorizedPath)}\``,
        `- Forbidden 4403: \`${path.basename(forbiddenPath)}\``,
        `- Monitor screenshot: \`${path.basename(screenshotPath)}\``,
        `- Frontend dev log: \`${path.basename(frontend.logPath)}\``,
        '',
        '## Key Results',
        '',
        `- hello frame: ${summary.checks.hello ? 'present' : 'missing'}`,
        `- execution_log frame: ${summary.checks.execution_log ? 'present' : 'missing'}`,
        `- node_heartbeat frame: ${summary.checks.node_heartbeat ? 'present' : 'missing'}`,
        `- unauthorized close: ${summary.checks.unauthorized_close ? summary.checks.unauthorized_close.code : 'missing'}`,
        `- forbidden close: ${summary.checks.forbidden_close ? summary.checks.forbidden_close.code : 'missing'}`,
        '',
        `Summary JSON: \`${path.basename(summaryPath)}\``,
      ].join('\n'),
    );

    console.log(JSON.stringify({ ok: true, artifact_dir: artifactDir, report: reportPath, summary: summaryPath }, null, 2));
  } finally {
    await terminateChild(frontendProcess);
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
