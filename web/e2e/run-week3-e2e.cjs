const { spawn, spawnSync } = require('node:child_process');

const BASE_URL = 'http://127.0.0.1:3001';
const SERVER_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/login`);
      if (res.ok) return;
    } catch {
      // ignore and retry
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for dev server: ${BASE_URL}`);
}

function createChild(command, args, env) {
  return spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function clearPort3001() {
  if (process.platform === 'win32') {
    spawnSync(
      'powershell',
      [
        '-Command',
        "Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', shell: true },
    );
    return;
  }
  spawnSync('bash', ['-lc', "lsof -ti :3001 | xargs -r kill -9"], {
    stdio: 'ignore',
    shell: true,
  });
}

async function main() {
  clearPort3001();
  const env = {
    ...process.env,
    NEXT_PUBLIC_USE_MOCK: 'true',
    NEXT_PUBLIC_RUNTIME_ENV: 'development',
    NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK: 'true',
    NEXT_PUBLIC_API_BASE_URL: '',
  };
  const server = createChild('npm', ['run', 'dev', '--', '-H', '127.0.0.1'], env);

  const shutdown = () => {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', shutdown);

  try {
    await waitForServerReady();
    const testEnv = {
      ...env,
      PW_EXTERNAL_SERVER: '1',
    };
    const test = createChild('npx', ['playwright', 'test', '--reporter=line'], testEnv);
    const code = await new Promise((resolve) => test.on('close', resolve));
    if (code !== 0) {
      process.exit(code ?? 1);
    }
  } finally {
    shutdown();
  }
}

main().catch((err) => {
  console.error('[week3-e2e-runner] failed');
  console.error(err);
  process.exit(1);
});
