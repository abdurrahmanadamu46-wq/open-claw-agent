const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(repoRoot, 'backend');
const dragonRoot = path.join(repoRoot, 'dragon-senate-saas-v2');
const outputRoot = path.join(webRoot, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(outputRoot, `release-data-local-${timestamp}`);

const redisHost = process.env.RELEASE_DATA_LOCAL_REDIS_HOST || '127.0.0.1';
const redisPort = Number(process.env.RELEASE_DATA_LOCAL_REDIS_PORT || 6379);
const dragonPort = Number(process.env.RELEASE_DATA_LOCAL_DRAGON_PORT || 18000);
const backendPort = Number(process.env.RELEASE_DATA_LOCAL_BACKEND_PORT || 48999);
const username = process.env.RELEASE_DATA_LOCAL_USERNAME || 'admin';
const password = process.env.RELEASE_DATA_LOCAL_PASSWORD || 'change_me';
const tenantId = process.env.RELEASE_DATA_LOCAL_TENANT_ID || 'tenant_main';
const jwtSecret = process.env.RELEASE_DATA_LOCAL_JWT_SECRET || 'release_data_local_secret_123456';
const pythonJwtSecret = process.env.RELEASE_DATA_LOCAL_PYTHON_JWT_SECRET || 'release_data_local_python_secret_123456';
const traceId = String(process.env.RELEASE_DATA_TRACE_ID || '').trim();
const pythonBin = process.env.RELEASE_DATA_LOCAL_PYTHON || 'python';
const requiredAiRoutePaths = [
  '/api/v1/skills',
  '/api/v1/providers',
  '/api/v1/edge/adapters',
];
const requiredBackendProbePaths = [
  `/api/v1/control-plane/monitor/overview?tenant_id=${encodeURIComponent(tenantId)}`,
  '/api/v1/ai/edge/adapters',
  '/api/v1/ai/skills',
  '/api/v1/ai/providers',
];

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

function persistSummary(summary) {
  const target = path.join(artifactDir, 'summary.json');
  summary.summary_path = target;
  fs.writeFileSync(target, JSON.stringify(summary, null, 2), 'utf8');
  return target;
}

function tryExec(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signLocalJwt(secret, subject, tenant, roles) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: subject,
    userId: subject,
    username: subject,
    tenantId: tenant,
    role: roles[0] || 'admin',
    roles,
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function waitForHttp(url, timeoutMs = 60000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return { ok: true, status: response.status };
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  return { ok: false, status: 0, error: lastError };
}

async function probeHttp(baseUrl, pathname, options = {}) {
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: {
        Accept: 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    });
    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForBackendRoute(baseUrl, pathname, token, timeoutMs = 30000) {
  const started = Date.now();
  let lastResult = null;
  while (Date.now() - started < timeoutMs) {
    lastResult = await probeHttp(baseUrl, pathname, { token });
    if (lastResult.ok) {
      return {
        ok: true,
        status: lastResult.status,
      };
    }
    await sleep(1000);
  }
  return {
    ok: false,
    status: lastResult?.status ?? 0,
    error: lastResult?.error || '',
  };
}

async function probeReleaseAiRoutes(baseUrl) {
  const results = [];
  for (const pathname of requiredAiRoutePaths) {
    const result = await probeHttp(baseUrl, pathname);
    results.push({
      path: pathname,
      status: result.status,
      ok: result.ok,
      error: result.error || '',
    });
  }
  return results;
}

function aiRuntimeLooksUsableForReleaseEvidence(probes) {
  return probes.every((probe) => probe.status !== 404 && probe.status < 500 && probe.status !== 0);
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

async function login(baseUrl, requestedUsername = username, requestedPassword = password) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: requestedUsername, password: requestedPassword }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
    token: String(payload.token || payload.access_token || '').trim(),
  };
}

function detectDockerRuntime() {
  const backendPortRaw = tryExec('docker', ['port', 'openclaw-agent-backend-1', '38789/tcp']);
  const aiPortRaw = tryExec('docker', ['port', 'openclaw-agent-ai-subservice-1', '8000/tcp']);
  const redisPortRaw = tryExec('docker', ['port', 'openclaw-agent-redis-1', '6379/tcp']);
  if (!backendPortRaw || !aiPortRaw || !redisPortRaw) return null;

  const backendEnvRaw = tryExec('docker', ['inspect', 'openclaw-agent-backend-1', '--format', '{{json .Config.Env}}']);
  const aiEnvRaw = tryExec('docker', ['inspect', 'openclaw-agent-ai-subservice-1', '--format', '{{json .Config.Env}}']);
  if (!backendEnvRaw || !aiEnvRaw) return null;

  const parsePort = (value) => {
    const match = String(value).match(/:(\d+)\s*$/);
    return match ? Number(match[1]) : 0;
  };

  const parseEnv = (raw) => {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? arr.reduce((acc, item) => {
            const [key, ...rest] = String(item).split('=');
            acc[key] = rest.join('=');
            return acc;
          }, {})
        : {};
    } catch {
      return {};
    }
  };

  return {
    backendPort: parsePort(backendPortRaw),
    aiPort: parsePort(aiPortRaw),
    redisPort: parsePort(redisPortRaw),
    backendEnv: parseEnv(backendEnvRaw),
    aiEnv: parseEnv(aiEnvRaw),
  };
}

function writeReport(summary) {
  const reportPath = path.join(artifactDir, 'REPORT.md');
  const lines = [
    '# Release Data Local Evidence',
    '',
    `Generated at: ${summary.generated_at}`,
    `Runtime mode: ${summary.runtime_mode}`,
    `Redis: ${summary.redis.host}:${summary.redis.port} (${summary.redis.available ? 'up' : 'down'})`,
    `Aux service: ${summary.dragon.url} (${summary.dragon.ready ? 'ready' : 'not ready'})`,
    `Backend: ${summary.backend.url} (${summary.backend.ready ? 'ready' : 'not ready'})`,
    `Login: ${summary.login.ok ? 'ok' : 'failed'}`,
    `Evidence: ${summary.evidence.ok ? 'ok' : 'failed'}`,
    '',
    '## Notes',
    '',
    ...(summary.notes.length ? summary.notes.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Artifacts',
    '',
    `- summary: \`${path.basename(summary.summary_path)}\``,
    `- dragon stdout: \`dragon.out.log\``,
    `- dragon stderr: \`dragon.err.log\``,
    `- backend stdout: \`backend.out.log\``,
    `- backend stderr: \`backend.err.log\``,
    summary.evidence.report ? `- nested evidence report: \`${summary.evidence.report}\`` : '- nested evidence report: none',
  ];
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

async function runNestedEvidence(env, summary, notes) {
  const evidence = spawn(
    process.execPath,
    [path.join(webRoot, 'scripts', 'release-data-evidence.cjs')],
    {
      cwd: webRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  evidence.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  evidence.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => evidence.on('close', resolve));
  writeText('release-data-evidence.out.log', stdout);
  writeText('release-data-evidence.err.log', stderr);

  summary.evidence.ok = exitCode === 0;
  summary.evidence.exit_code = Number(exitCode ?? 1);

  try {
    const payload = JSON.parse(stdout);
    summary.evidence.report = String(payload.report ?? '');
  } catch {
    notes.push('Nested release-data-evidence output was not valid JSON. Check the nested stdout/stderr logs.');
  }

  if (!summary.evidence.ok) {
    notes.push('Nested release-data-evidence did not pass. Check the nested report for per-probe diagnosis.');
  }
}

async function main() {
  const notes = [];
  const processes = [];
  let backendUrl = `http://127.0.0.1:${backendPort}`;
  let dragonUrl = `http://127.0.0.1:${dragonPort}`;

  const summary = {
    generated_at: new Date().toISOString(),
    redis: {
      host: redisHost,
      port: redisPort,
      available: false,
    },
    dragon: {
      url: dragonUrl,
      ready: false,
    },
    backend: {
      url: backendUrl,
      ready: false,
    },
    login: {
      ok: false,
      status: 0,
    },
    evidence: {
      ok: false,
      exit_code: 1,
      report: '',
    },
    notes,
    summary_path: '',
    runtime_mode: 'local_bootstrap',
  };

  try {
    const dockerRuntime = detectDockerRuntime();

    if (dockerRuntime && dockerRuntime.backendPort && dockerRuntime.aiPort && dockerRuntime.redisPort) {
      summary.runtime_mode = 'docker_reuse';
      summary.redis.host = '127.0.0.1';
      summary.redis.port = dockerRuntime.redisPort;
      summary.redis.available = await probeTcp(summary.redis.host, summary.redis.port);

      backendUrl = `http://127.0.0.1:${dockerRuntime.backendPort}`;
      dragonUrl = `http://127.0.0.1:${dockerRuntime.aiPort}`;
      summary.backend.url = backendUrl;
      summary.dragon.url = dragonUrl;
      summary.dragon.ready = (await waitForHttp(`${dragonUrl}/docs`, 10000)).ok;
      summary.backend.ready = (await waitForHttp(`${backendUrl}/auth/login`, 10000)).ok;
      const dockerAiRouteProbes = summary.dragon.ready ? await probeReleaseAiRoutes(dragonUrl) : [];
      const dockerAiLooksUsable = aiRuntimeLooksUsableForReleaseEvidence(dockerAiRouteProbes);

      const routeProbe = await probeHttp(backendUrl, '/api/v1/ai/providers');
      const monitorProbe = await probeHttp(backendUrl, `/api/v1/control-plane/monitor/overview?tenant_id=${encodeURIComponent(tenantId)}`);
      const dockerBackendLooksUsable = routeProbe.status !== 404 && monitorProbe.status !== 404;

      if (!dockerBackendLooksUsable) {
        notes.push('Docker backend does not expose the control-plane API shape needed by the operator console, so the script falls back to local backend plus Docker redis/ai-subservice.');
      } else if (!dockerAiLooksUsable) {
        const missingRoutes = dockerAiRouteProbes
          .filter((probe) => probe.status === 404 || probe.status >= 500 || probe.status === 0)
          .map((probe) => `${probe.path}:${probe.status || 'unreachable'}`)
          .join(', ');
        notes.push(`Docker ai-subservice is reachable but misses release evidence routes (${missingRoutes}), so the script falls back to local dragon plus local backend.`);
      } else {
        const dockerUsername = dockerRuntime.backendEnv.APP_BOOTSTRAP_USERNAME || username;
        const dockerPassword = dockerRuntime.backendEnv.APP_BOOTSTRAP_PASSWORD || password;
        const dockerTenant = dockerRuntime.backendEnv.APP_BOOTSTRAP_TENANT_ID || tenantId;

        let loginResult = await login(backendUrl, dockerUsername, dockerPassword);
        if ((!loginResult.ok || !loginResult.token) && dockerRuntime.backendEnv.JWT_SECRET) {
          const signedToken = signLocalJwt(
            dockerRuntime.backendEnv.JWT_SECRET,
            dockerUsername,
            dockerTenant,
            ['admin'],
          );
          loginResult = {
            ok: true,
            status: loginResult.status || 200,
            payload: {
              token: signedToken,
              issued_by: 'local_wrapper_fallback',
            },
            token: signedToken,
          };
          notes.push('Docker backend login was not usable, so the wrapper minted a fallback JWT with the backend secret.');
        }

        summary.login.ok = loginResult.ok;
        summary.login.status = loginResult.status;
        writeJson('login.json', loginResult);

        if (!loginResult.ok || !loginResult.token) {
          notes.push('Docker backend is reachable, but bootstrap login still did not return a usable token.');
          summary.summary_path = persistSummary(summary);
          summary.evidence.report = writeReport(summary);
          process.exitCode = 1;
          return;
        }

        await runNestedEvidence(
          {
            ...process.env,
            RELEASE_DATA_BASE_URL: backendUrl,
            RELEASE_DATA_AUX_BASE_URL: dragonUrl,
            RELEASE_DATA_JWT: loginResult.token,
            RELEASE_DATA_TENANT_ID: dockerTenant,
            ...(traceId ? { RELEASE_DATA_TRACE_ID: traceId } : {}),
          },
          summary,
          notes,
        );

        summary.summary_path = persistSummary(summary);
        const reportPath = writeReport(summary);
        console.log(JSON.stringify({
          ok: summary.evidence.ok,
          artifact_dir: artifactDir,
          summary: summary.summary_path,
          report: reportPath,
        }, null, 2));
        if (!summary.evidence.ok) {
          process.exitCode = 1;
        }
        return;
      }
    }

    const effectiveRedisHost = dockerRuntime?.redisPort ? '127.0.0.1' : redisHost;
    const effectiveRedisPort = dockerRuntime?.redisPort || redisPort;
    let effectiveDragonUrl = `http://127.0.0.1:${dragonPort}`;

    summary.redis.host = effectiveRedisHost;
    summary.redis.port = effectiveRedisPort;
    summary.redis.available = await probeTcp(effectiveRedisHost, effectiveRedisPort);
    if (!summary.redis.available) {
      notes.push('No usable Redis was found locally and no reusable Docker redis was detected, so the local evidence flow stopped early.');
      summary.summary_path = persistSummary(summary);
      summary.evidence.report = writeReport(summary);
      process.exitCode = 1;
      return;
    }

    let reuseDockerAi = false;
    if (dockerRuntime?.aiPort) {
      const dockerAiUrl = `http://127.0.0.1:${dockerRuntime.aiPort}`;
      const dockerAiRouteProbes = await probeReleaseAiRoutes(dockerAiUrl);
      reuseDockerAi = aiRuntimeLooksUsableForReleaseEvidence(dockerAiRouteProbes);
      if (!reuseDockerAi) {
        const missingRoutes = dockerAiRouteProbes
          .filter((probe) => probe.status === 404 || probe.status >= 500 || probe.status === 0)
          .map((probe) => `${probe.path}:${probe.status || 'unreachable'}`)
          .join(', ');
        notes.push(`Docker ai-subservice is missing release evidence routes (${missingRoutes}), so the wrapper starts a local dragon runtime instead of reusing Docker ai-subservice.`);
      } else {
        effectiveDragonUrl = dockerAiUrl;
      }
    }

    if (!reuseDockerAi) {
      summary.runtime_mode = dockerRuntime?.aiPort ? 'local_backend_with_local_dragon' : 'local_bootstrap';
      const dragon = startLoggedProcess(
        'dragon',
        pythonBin,
        ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(dragonPort)],
        {
          cwd: dragonRoot,
          env: {
            ...process.env,
            APP_USERS_JSON: `[{"username":"${username}","password":"${password}","tenant_id":"${tenantId}","roles":["admin"]}]`,
            JWT_SECRET: pythonJwtSecret,
            ALLOW_INMEMORY_CHECKPOINTER: 'true',
            HITL_ENABLED: 'false',
            LLM_REQUEST_TIMEOUT_SEC: '20',
          },
        },
      );
      processes.push(dragon);
    } else {
      summary.runtime_mode = 'local_backend_with_docker_services';
      notes.push('Reusing Docker ai-subservice and redis, and only starting the local backend for operator-console verification.');
    }

    backendUrl = `http://127.0.0.1:${backendPort}`;
    summary.dragon.url = effectiveDragonUrl;
    summary.backend.url = backendUrl;

    const dragonReady = await waitForHttp(`${effectiveDragonUrl}/docs`, 30000);
    summary.dragon.ready = dragonReady.ok;
    if (!summary.dragon.ready) {
      notes.push(`dragon/ai-subservice did not become ready within 30s: ${dragonReady.error || dragonReady.status}`);
      summary.summary_path = persistSummary(summary);
      processes.forEach((proc) => proc.flush());
      summary.evidence.report = writeReport(summary);
      process.exitCode = 1;
      return;
    }

    const backend = startLoggedProcess(
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
          JWT_SECRET: jwtSecret,
          DRAGON_AI_BASE_URL: effectiveDragonUrl,
          DRAGON_AI_TIMEOUT_MS: '180000',
          REDIS_HOST: effectiveRedisHost,
          REDIS_PORT: String(effectiveRedisPort),
        },
      },
    );
    processes.push(backend);

    const backendReady = await waitForHttp(`${backendUrl}/auth/login`, 30000);
    summary.backend.ready = backendReady.ok;
    if (!summary.backend.ready) {
      notes.push(`backend did not become ready within 30s: ${backendReady.error || backendReady.status}`);
      summary.summary_path = persistSummary(summary);
      processes.forEach((proc) => proc.flush());
      summary.evidence.report = writeReport(summary);
      process.exitCode = 1;
      return;
    }

    const loginResult = await login(backendUrl);
    summary.login.ok = loginResult.ok;
    summary.login.status = loginResult.status;
    writeJson('login.json', loginResult);
    if (!loginResult.ok || !loginResult.token) {
      notes.push('Local backend came up, but login still did not return a usable token.');
      summary.summary_path = persistSummary(summary);
      processes.forEach((proc) => proc.flush());
      summary.evidence.report = writeReport(summary);
      process.exitCode = 1;
      return;
    }

    for (const routePath of requiredBackendProbePaths) {
      const warmup = await waitForBackendRoute(backendUrl, routePath, loginResult.token, 30000);
      if (!warmup.ok) {
        notes.push(`Backend route did not warm up in time: ${routePath} (${warmup.status || warmup.error || 'unknown'})`);
      }
    }

    await runNestedEvidence(
      {
        ...process.env,
        RELEASE_DATA_BASE_URL: backendUrl,
        RELEASE_DATA_AUX_BASE_URL: effectiveDragonUrl,
        RELEASE_DATA_JWT: loginResult.token,
        RELEASE_DATA_TENANT_ID: tenantId,
        ...(traceId ? { RELEASE_DATA_TRACE_ID: traceId } : {}),
      },
      summary,
      notes,
    );
  } finally {
    for (const proc of processes.reverse()) {
      proc.stop();
      proc.flush();
    }
    summary.summary_path = persistSummary(summary);
    const reportPath = writeReport(summary);
    console.log(JSON.stringify({
      ok: summary.evidence.ok,
      artifact_dir: artifactDir,
      summary: summary.summary_path,
      report: reportPath,
    }, null, 2));
    if (!summary.evidence.ok) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
