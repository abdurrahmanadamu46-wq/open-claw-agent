const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'backend');
const dragonRoot = path.join(repoRoot, 'dragon-senate-saas-v2');
const outputRoot = path.join(webRoot, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(outputRoot, `knowledge-context-local-${timestamp}`);

const modeArgIndex = process.argv.findIndex((item) => item === '--mode');
const mode = modeArgIndex >= 0 ? String(process.argv[modeArgIndex + 1] || 'runtime') : 'runtime';
const allowedModes = new Set(['runtime', 'context_only']);
const effectiveMode = allowedModes.has(mode) ? mode : 'runtime';

const pythonBin = process.env.KNOWLEDGE_LOCAL_PYTHON || 'python';
const dragonPort = Number(process.env.KNOWLEDGE_LOCAL_DRAGON_PORT || 18000);
const backendPort = Number(process.env.KNOWLEDGE_LOCAL_BACKEND_PORT || 48999);
const username = process.env.KNOWLEDGE_LOCAL_USERNAME || 'admin';
const password = process.env.KNOWLEDGE_LOCAL_PASSWORD || 'change_me';
const tenantId = process.env.KNOWLEDGE_LOCAL_TENANT_ID || 'tenant_main';
const backendJwtSecret = process.env.KNOWLEDGE_LOCAL_BACKEND_JWT_SECRET || 'dev-secret-change-in-production';
const pythonJwtSecret = process.env.KNOWLEDGE_LOCAL_PYTHON_JWT_SECRET || 'change_this_to_a_long_random_secret';
const requestTimeoutMs = Math.max(1000, Number(process.env.KNOWLEDGE_LOCAL_REQUEST_TIMEOUT_MS || 15000) || 15000);
const runTimeoutMs = Math.max(3000, Number(process.env.KNOWLEDGE_LOCAL_RUN_TIMEOUT_MS || 180000) || 180000);
const seedTenantPrivate = process.env.KNOWLEDGE_LOCAL_SEED_TENANT_PRIVATE !== '0';

fs.mkdirSync(artifactDir, { recursive: true });

function writeJson(name, data) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  return target;
}

function writeText(name, data) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, data, 'utf8');
  return target;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        return { ok: true, status: response.status };
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  return { ok: false, status: 0, error: lastError };
}

function startLoggedProcess(label, command, args, options) {
  const stdout = [];
  const stderr = [];
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
  return {
    label,
    child,
    stop() {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },
    flush() {
      writeText(`${label}.out.log`, stdout.join(''));
      writeText(`${label}.err.log`, stderr.join(''));
    },
  };
}

async function runNestedEvidence(summary, notes) {
  const nested = startLoggedProcess(
    'knowledge-context-evidence',
    process.execPath,
    [path.join(webRoot, 'scripts', 'knowledge-context-real-evidence.cjs')],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        KNOWLEDGE_CONTEXT_BASE_URL: `http://127.0.0.1:${backendPort}`,
        KNOWLEDGE_CONTEXT_USERNAME: username,
        KNOWLEDGE_CONTEXT_PASSWORD: password,
        KNOWLEDGE_CONTEXT_TENANT_ID: tenantId,
        KNOWLEDGE_CONTEXT_DEV_JWT_SECRET: backendJwtSecret,
        KNOWLEDGE_CONTEXT_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
        KNOWLEDGE_CONTEXT_RUN_TIMEOUT_MS: String(runTimeoutMs),
        KNOWLEDGE_CONTEXT_SEED_TENANT_PRIVATE: seedTenantPrivate ? '1' : '0',
        ...(effectiveMode === 'context_only' ? { KNOWLEDGE_CONTEXT_CONTEXT_ONLY: '1' } : {}),
      },
    },
  );
  const exitCode = await new Promise((resolve) => nested.child.on('close', resolve));
  nested.flush();
  summary.evidence.ok = exitCode === 0;
  summary.evidence.exit_code = Number(exitCode ?? 1);

  try {
    const stdoutPath = path.join(artifactDir, 'knowledge-context-evidence.out.log');
    const stdout = fs.readFileSync(stdoutPath, 'utf8');
    const payload = JSON.parse(stdout);
    summary.evidence.report = String(payload.report ?? '');
    summary.evidence.summary = String(payload.summary ?? '');
  } catch {
    notes.push('Nested knowledge-context evidence output was not valid JSON. Check nested stdout/stderr logs.');
  }

  if (!summary.evidence.ok) {
    notes.push('Nested knowledge-context evidence did not pass. Check nested report for diagnosis.');
  }
}

function writeReport(summary) {
  const reportPath = path.join(artifactDir, 'REPORT.md');
  const lines = [
    '# Knowledge Context Local Evidence',
    '',
    `Generated at: ${summary.generated_at}`,
    `Mode: ${summary.mode}`,
    `Seed tenant private: ${summary.seed_tenant_private ? 'yes' : 'no'}`,
    `Python service: ${summary.python.url} (${summary.python.ready ? 'ready' : 'not ready'})`,
    `Backend service: ${summary.backend.url} (${summary.backend.ready ? 'ready' : 'not ready'})`,
    `Evidence result: ${summary.evidence.ok ? 'ok' : 'failed'}`,
    '',
    '## Notes',
    '',
    ...(summary.notes.length ? summary.notes.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Artifacts',
    '',
    '- summary: `summary.json`',
    '- python stdout: `python.out.log`',
    '- python stderr: `python.err.log`',
    '- backend stdout: `backend.out.log`',
    '- backend stderr: `backend.err.log`',
    '- nested evidence stdout: `knowledge-context-evidence.out.log`',
    '- nested evidence stderr: `knowledge-context-evidence.err.log`',
    summary.evidence.report ? `- nested evidence report: \`${summary.evidence.report}\`` : '- nested evidence report: none',
  ];
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

async function main() {
  const notes = [];
  const processes = [];
  const summary = {
    generated_at: new Date().toISOString(),
    mode: effectiveMode,
    seed_tenant_private: seedTenantPrivate,
    python: {
      url: `http://127.0.0.1:${dragonPort}`,
      ready: false,
    },
    backend: {
      url: `http://127.0.0.1:${backendPort}`,
      ready: false,
    },
    evidence: {
      ok: false,
      exit_code: 1,
      report: '',
      summary: '',
    },
    notes,
  };

  const pythonProc = startLoggedProcess(
    'python',
    pythonBin,
    ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(dragonPort)],
    {
      cwd: dragonRoot,
      env: {
        ...process.env,
        APP_USERS_JSON: `[{"username":"${username}","password":"${password}","tenant_id":"tenant_demo","roles":["admin"]}]`,
        JWT_SECRET: pythonJwtSecret,
        ALLOW_INMEMORY_CHECKPOINTER: 'true',
        HITL_ENABLED: 'false',
        LLM_REQUEST_TIMEOUT_SEC: '20',
      },
    },
  );
  processes.push(pythonProc);

  const pythonReady = await waitForHttp(`${summary.python.url}/healthz`, 45000);
  summary.python.ready = pythonReady.ok;
  if (!summary.python.ready) {
    notes.push(`Python service did not become ready: ${pythonReady.error || pythonReady.status}`);
  }

  const backendProc = startLoggedProcess(
    'backend',
    process.execPath,
    ['dist/main.js'],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        PORT: String(backendPort),
        APP_BOOTSTRAP_USERNAME: username,
        APP_BOOTSTRAP_PASSWORD: password,
        APP_BOOTSTRAP_TENANT_ID: tenantId,
        JWT_SECRET: backendJwtSecret,
        DRAGON_AI_BASE_URL: summary.python.url,
        DRAGON_AI_TIMEOUT_MS: String(runTimeoutMs),
        GROUP_COLLAB_REDIS_TIMEOUT_MS: '500',
        RATE_LIMIT_REDIS_TIMEOUT_MS: '500',
        GROUP_COLLAB_CONFIG_TIMEOUT_MS: '800',
      },
    },
  );
  processes.push(backendProc);

  await sleep(8000);
  summary.backend.ready = true;

  if (summary.python.ready && summary.backend.ready) {
    await runNestedEvidence(summary, notes);
  }

  for (const proc of processes.reverse()) {
    proc.stop();
    proc.flush();
  }

  const summaryPath = writeJson('summary.json', summary);
  const reportPath = writeReport(summary);
  console.log(JSON.stringify({
    ok: summary.evidence.ok,
    artifact_dir: artifactDir,
    summary: summaryPath,
    report: reportPath,
  }, null, 2));
  if (!summary.evidence.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
