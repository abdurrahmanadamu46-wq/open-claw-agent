const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const WEB_PORT = Number.parseInt(process.env.E2E_WEB_PORT || '3001', 10);
const BACKEND_PORT = Number.parseInt(process.env.E2E_BACKEND_PORT || '38789', 10);
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.resolve(REPO_ROOT, 'backend');
let webPort = WEB_PORT;
let WEB_BASE_URL = `http://127.0.0.1:${webPort}`;
let backendPort = BACKEND_PORT;
let BACKEND_BASE_URL = `http://127.0.0.1:${backendPort}`;
const START_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;
const LOG_FILE = path.resolve(__dirname, 'live-release-e2e.log');

const managedChildren = [];

function log(message) {
  const line = `[${new Date().toISOString()}] [live-release-e2e] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killProcessTree(child, name) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: true,
    });
  } else {
    child.kill('SIGTERM');
  }
  log(`${name} stopped`);
}

function wireChildLogs(name, child) {
  const onChunk = (type) => (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      log(`[${name}][${type}] ${line}`);
    }
  };
  if (child.stdout) child.stdout.on('data', onChunk('stdout'));
  if (child.stderr) child.stderr.on('data', onChunk('stderr'));
  child.on('exit', (code, signal) => {
    log(`${name} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  child.on('error', (error) => {
    log(`${name} spawn error: ${error.message}`);
  });
}

function createChild(cwd, command, args, env, name) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  managedChildren.push({ child, name });
  wireChildLogs(name, child);
  return child;
}

function clearPort(port) {
  if (process.platform === 'win32') {
    spawnSync(
      'powershell',
      [
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'ignore', shell: true },
    );
    return;
  }
  spawnSync('bash', ['-lc', `lsof -ti :${port} | xargs -r kill -9`], {
    stdio: 'ignore',
    shell: true,
  });
}

async function isTcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function resolveAvailablePort(preferredPort) {
  const preferredOpen = await isTcpOpen('127.0.0.1', preferredPort, 800);
  if (!preferredOpen) return preferredPort;

  for (let candidate = preferredPort + 1; candidate <= preferredPort + 50; candidate += 1) {
    // eslint-disable-next-line no-await-in-loop
    const inUse = await isTcpOpen('127.0.0.1', candidate, 800);
    if (!inUse) return candidate;
  }
  throw new Error(`No available backend port around ${preferredPort}`);
}

async function waitForTcpOpen(host, port, timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const open = await isTcpOpen(host, port);
    if (open) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting TCP ${host}:${port}`);
}

async function waitForChildClose(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true, code: null, signal: null }), timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, signal });
    });
  });
}

async function startRedisWith(command, args, processName) {
  const redis = createChild(REPO_ROOT, command, args, process.env, processName);
  const result = await Promise.race([
    waitForTcpOpen(REDIS_HOST, REDIS_PORT, 20_000).then(() => ({ status: 'ready' })),
    waitForChildClose(redis, 20_000).then((close) => ({ status: 'closed', close })),
  ]);

  if (result.status === 'ready') {
    log(`${processName} ready at ${REDIS_HOST}:${REDIS_PORT}`);
    return redis;
  }

  killProcessTree(redis, processName);
  const close = result.close || { code: null, signal: null, timedOut: false };
  throw new Error(
    `${processName} failed before Redis ready (code=${close.code}, signal=${close.signal}, timedOut=${close.timedOut})`,
  );
}

async function ensureRedisReady() {
  const alreadyOpen = await isTcpOpen(REDIS_HOST, REDIS_PORT);
  if (alreadyOpen) {
    log(`Redis already available at ${REDIS_HOST}:${REDIS_PORT}`);
    return { child: null, containerName: null };
  }

  if ((process.env.E2E_AUTO_REDIS || 'true').toLowerCase() === 'false') {
    throw new Error(`Redis is not available at ${REDIS_HOST}:${REDIS_PORT}`);
  }

  const containerName = `openclaw-e2e-redis-${process.pid}`;
  log(`Redis not found, trying Docker container ${containerName}`);
  try {
    const child = await startRedisWith(
      'docker',
      ['run', '--rm', '--name', containerName, '-p', `${REDIS_PORT}:6379`, 'redis:7-alpine'],
      'redis-docker',
    );
    return { child, containerName };
  } catch (dockerError) {
    log(`Docker Redis unavailable: ${dockerError.message}`);
  }

  log('Trying local redis-server fallback');
  try {
    const child = await startRedisWith(
      'redis-server',
      ['--save', '', '--appendonly', 'no', '--port', String(REDIS_PORT)],
      'redis-local',
    );
    return { child, containerName: null };
  } catch (localError) {
    throw new Error(
      `No Redis runtime available. Start Docker Desktop or install redis-server. Detail: ${localError.message}`,
    );
  }
}

async function waitForHttp(url, matcher) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url);
      if (!matcher || matcher(response)) return;
    } catch {
      // ignore and retry
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForBackendLoginReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`${BACKEND_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: process.env.E2E_LIVE_USERNAME || 'admin',
          password: process.env.E2E_LIVE_PASSWORD || 'change_me',
        }),
      });
      if (response.ok) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      const body = await response.text();
      log(`backend login readiness status=${response.status} body=${body.slice(0, 200)}`);
    } catch {
      // ignore and retry
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for backend login endpoint');
}

function runBuild(cwd) {
  log(`building in ${cwd}`);
  const result = spawnSync('npm', ['run', 'build'], {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Build failed in ${cwd}`);
  }
}

async function runAndWait(cwd, command, args, env, name) {
  const child = createChild(cwd, command, args, env, name);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
}

function shutdown(extra = {}) {
  for (const { child, name } of managedChildren.reverse()) {
    if (extra.skipNames && extra.skipNames.includes(name)) continue;
    killProcessTree(child, name);
  }
  if (extra.redisContainerName) {
    spawnSync('docker', ['rm', '-f', extra.redisContainerName], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
  }
}

async function main() {
  fs.writeFileSync(LOG_FILE, '', 'utf8');
  log('preparing ports and dependencies');
  clearPort(WEB_PORT);
  clearPort(BACKEND_PORT);
  webPort = await resolveAvailablePort(WEB_PORT);
  WEB_BASE_URL = `http://127.0.0.1:${webPort}`;
  backendPort = await resolveAvailablePort(BACKEND_PORT);
  BACKEND_BASE_URL = `http://127.0.0.1:${backendPort}`;
  log(`selected web port=${webPort}`);
  log(`selected backend port=${backendPort}`);

  runBuild(BACKEND_DIR);
  const redisContext = await ensureRedisReady();

  const backendEnv = {
    ...process.env,
    PORT: String(backendPort),
    REDIS_HOST,
    REDIS_PORT: String(REDIS_PORT),
    E2E_SEED_FLEET_NODE: 'true',
    E2E_SEED_TENANT_ID: 'tenant_demo',
    JWT_SECRET: process.env.JWT_SECRET || 'e2e_release_secret_1234567890',
    NEW_API_BASE_URL: process.env.NEW_API_BASE_URL || 'http://127.0.0.1:39999',
    APP_USERS_JSON:
      process.env.APP_USERS_JSON ||
      '[{"username":"admin","password":"change_me","tenant_id":"tenant_demo","roles":["admin"]}]',
  };

  log('starting backend');
  createChild(BACKEND_DIR, 'node', ['dist/main.js'], backendEnv, 'backend');

  const webEnv = {
    ...process.env,
    NEXT_PUBLIC_USE_MOCK: 'false',
    NEXT_PUBLIC_RUNTIME_ENV: 'development',
    NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK: 'false',
    NEXT_PUBLIC_API_BASE_URL: BACKEND_BASE_URL,
  };
  log('starting web dev server');
  createChild(WEB_DIR, 'npm', ['run', 'dev', '--', '-H', '127.0.0.1', '-p', String(webPort)], webEnv, 'web');

  try {
    log('waiting backend login endpoint');
    await waitForBackendLoginReady();
    log('waiting web login page');
    await waitForHttp(`${WEB_BASE_URL}/login`, (response) => response.ok);

    const testEnv = {
      ...process.env,
      PW_BASE_URL: WEB_BASE_URL,
      PW_WEB_PORT: String(webPort),
      E2E_LIVE_USERNAME: process.env.E2E_LIVE_USERNAME || 'admin',
      E2E_LIVE_PASSWORD: process.env.E2E_LIVE_PASSWORD || 'change_me',
    };
    log('running playwright live regression');
    const exitCode = await runAndWait(
      WEB_DIR,
      'npx',
      [
        'playwright',
        'test',
        '-c',
        'playwright.live.config.ts',
        '--reporter=line',
        'e2e/live-release-regression.spec.ts',
      ],
      testEnv,
      'playwright',
    );
    log(`playwright exit code=${exitCode}`);
    if (exitCode !== 0) {
      process.exit(exitCode || 1);
    }
  } finally {
    shutdown({ redisContainerName: redisContext.containerName });
  }
}

main().catch((error) => {
  log(`failed: ${error?.stack || error?.message || String(error)}`);
  shutdown();
  process.exit(1);
});
