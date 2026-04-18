const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.resolve(repoRoot, 'backend');
const webRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(webRoot, 'test-results');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(outputRoot, `execution-monitor-real-${timestamp}`);

const WebSocket = require(path.join(backendRoot, 'node_modules', 'ws'));

const DEFAULT_TIMEOUT_MS = Number(process.env.EXEC_MONITOR_REAL_TIMEOUT_MS || 15000);
const CONTRACT = 'execution-logs.v1';
const FORBIDDEN_TENANT_ID = String(process.env.EXEC_MONITOR_FORBIDDEN_TENANT_ID || '__forbidden_tenant__').trim();
const SKIP_AUTH_FAILURE_CHECKS = String(process.env.EXEC_MONITOR_SKIP_AUTH_FAILURES || '').trim() === '1';
const PREFLIGHT_ONLY = process.argv.includes('--preflight') || String(process.env.EXEC_MONITOR_PREFLIGHT || '').trim() === '1';

fs.mkdirSync(artifactDir, { recursive: true });

function redactUrl(input) {
  try {
    const url = new URL(input);
    if (url.searchParams.has('access_token')) {
      url.searchParams.set('access_token', '<redacted>');
    }
    return url.toString();
  } catch {
    return String(input).replace(/(access_token=)[^&]+/i, '$1<redacted>');
  }
}

function buildUrls() {
  const explicitWsUrl = String(process.env.EXEC_MONITOR_WS_URL || '').trim();
  if (explicitWsUrl) {
    const authorized = new URL(explicitWsUrl);
    const unauthorized = new URL(explicitWsUrl);
    unauthorized.searchParams.delete('access_token');
    const forbidden = new URL(explicitWsUrl);
    forbidden.searchParams.set('tenant_id', FORBIDDEN_TENANT_ID);
    return {
      authorized: authorized.toString(),
      unauthorized: unauthorized.toString(),
      forbidden: forbidden.toString(),
      authFailureChecksAvailable: authorized.searchParams.has('access_token'),
    };
  }

  const base = String(process.env.EXEC_MONITOR_BASE_URL || '').trim();
  const token = String(process.env.EXEC_MONITOR_JWT || '').trim();
  const tenantId = String(process.env.EXEC_MONITOR_TENANT_ID || '').trim();
  if (!base || !token) {
    throw new Error('Provide EXEC_MONITOR_WS_URL or EXEC_MONITOR_BASE_URL + EXEC_MONITOR_JWT');
  }
  const normalizedBase = base.replace(/\/+$/, '');
  const authorized = new URL(`${normalizedBase}/ws/execution-logs`);
  authorized.searchParams.set('access_token', token);
  if (tenantId) authorized.searchParams.set('tenant_id', tenantId);

  const unauthorized = new URL(`${normalizedBase}/ws/execution-logs`);
  if (tenantId) unauthorized.searchParams.set('tenant_id', tenantId);

  const forbidden = new URL(`${normalizedBase}/ws/execution-logs`);
  forbidden.searchParams.set('access_token', token);
  forbidden.searchParams.set('tenant_id', FORBIDDEN_TENANT_ID);

  return {
    authorized: authorized.toString(),
    unauthorized: unauthorized.toString(),
    forbidden: forbidden.toString(),
    authFailureChecksAvailable: true,
  };
}

function writeJson(name, data) {
  const target = path.join(artifactDir, name);
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  return target;
}

function getCredentialStatus() {
  const hasWsUrl = Boolean(String(process.env.EXEC_MONITOR_WS_URL || '').trim());
  const hasBaseUrl = Boolean(String(process.env.EXEC_MONITOR_BASE_URL || '').trim());
  const hasJwt = Boolean(String(process.env.EXEC_MONITOR_JWT || '').trim());
  const hasTenantId = Boolean(String(process.env.EXEC_MONITOR_TENANT_ID || '').trim());
  const ready = hasWsUrl || (hasBaseUrl && hasJwt);
  const missing = [];
  if (!ready) {
    missing.push('EXEC_MONITOR_WS_URL or EXEC_MONITOR_BASE_URL + EXEC_MONITOR_JWT');
  }
  if (!hasTenantId) {
    missing.push('EXEC_MONITOR_TENANT_ID is recommended for tenant-scope signoff');
  }
  return {
    ready,
    has_ws_url: hasWsUrl,
    has_base_url: hasBaseUrl,
    has_jwt: hasJwt,
    has_tenant_id: hasTenantId,
    forbidden_tenant_id: FORBIDDEN_TENANT_ID,
    skip_auth_failure_checks: SKIP_AUTH_FAILURE_CHECKS,
    missing,
  };
}

function writePreflightReport(status) {
  const summary = {
    generated_at: new Date().toISOString(),
    mode: 'preflight',
    contract: CONTRACT,
    credential_status: status,
    next_commands: [
      'cd web && npm.cmd run evidence:execution-monitor:real',
    ],
  };
  const summaryPath = writeJson('preflight-summary.json', summary);
  const reportPath = path.join(artifactDir, 'PREFLIGHT.md');
  fs.writeFileSync(
    reportPath,
    [
      '# Execution Monitor Real Environment Preflight',
      '',
      `Generated at: ${summary.generated_at}`,
      `Contract: \`${CONTRACT}\``,
      '',
      '## Credential status',
      '',
      `- ready: ${status.ready ? 'yes' : 'no'}`,
      `- EXEC_MONITOR_WS_URL: ${status.has_ws_url ? 'set' : 'missing'}`,
      `- EXEC_MONITOR_BASE_URL: ${status.has_base_url ? 'set' : 'missing'}`,
      `- EXEC_MONITOR_JWT: ${status.has_jwt ? 'set' : 'missing'}`,
      `- EXEC_MONITOR_TENANT_ID: ${status.has_tenant_id ? 'set' : 'missing'}`,
      `- EXEC_MONITOR_FORBIDDEN_TENANT_ID: ${status.forbidden_tenant_id}`,
      `- EXEC_MONITOR_SKIP_AUTH_FAILURES: ${status.skip_auth_failure_checks ? '1' : '0'}`,
      '',
      '## Missing / recommended',
      '',
      ...(status.missing.length ? status.missing.map((item) => `- ${item}`) : ['- none']),
      '',
      '## Example',
      '',
      '```powershell',
      'set EXEC_MONITOR_BASE_URL=https://your-control-plane.example.com',
      'set EXEC_MONITOR_JWT=your-qa-token',
      'set EXEC_MONITOR_TENANT_ID=tenant_main',
      'npm.cmd run evidence:execution-monitor:real',
      '```',
      '',
      '## Artifacts',
      '',
      `- summary: \`${path.basename(summaryPath)}\``,
    ].join('\n'),
  );
  return { summary, summaryPath, reportPath };
}

async function collectFrames(url) {
  return new Promise((resolve, reject) => {
    const frames = [];
    let open = false;
    let closeInfo = null;
    let settled = false;
    const socket = new WebSocket(url);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      resolve({ open, frames, close: closeInfo });
    }, DEFAULT_TIMEOUT_MS);

    socket.on('open', () => {
      open = true;
    });

    socket.on('message', (data) => {
      try {
        frames.push(JSON.parse(String(data)));
      } catch {
        frames.push({ raw: String(data) });
      }
    });

    socket.on('close', (code, reasonBuffer) => {
      closeInfo = {
        code,
        reason: String(reasonBuffer || ''),
      };
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ open, frames, close: closeInfo });
    });

    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function collectCloseProbe(url) {
  try {
    return await collectFrames(url);
  } catch (error) {
    return {
      open: false,
      frames: [],
      close: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function main() {
  if (PREFLIGHT_ONLY) {
    const status = getCredentialStatus();
    const preflight = writePreflightReport(status);
    console.log(JSON.stringify({
      ok: true,
      ready: status.ready,
      artifact_dir: artifactDir,
      report: preflight.reportPath,
      summary: preflight.summaryPath,
      missing: status.missing,
    }, null, 2));
    return;
  }

  const urls = buildUrls();
  const result = await collectFrames(urls.authorized);
  const unauthorizedResult =
    !SKIP_AUTH_FAILURE_CHECKS && urls.authFailureChecksAvailable
      ? await collectCloseProbe(urls.unauthorized)
      : null;
  const forbiddenResult =
    !SKIP_AUTH_FAILURE_CHECKS && urls.authFailureChecksAvailable
      ? await collectCloseProbe(urls.forbidden)
      : null;

  const hasHello = result.frames.some((frame) => frame.type === 'hello' && frame.contract === CONTRACT);
  const hasExecutionLog = result.frames.some((frame) => frame.type === 'execution_log' && frame.contract === CONTRACT);
  const hasNodeHeartbeat = result.frames.some((frame) => frame.type === 'node_heartbeat' && frame.contract === CONTRACT);
  const hasError = result.frames.some((frame) => frame.type === 'error' && frame.contract === CONTRACT);
  const unauthorizedCloseCode = unauthorizedResult?.close?.code ?? null;
  const forbiddenCloseCode = forbiddenResult?.close?.code ?? null;
  const hasUnauthorized4401 = unauthorizedCloseCode === 4401;
  const hasForbidden4403 = forbiddenCloseCode === 4403;

  const summary = {
    generated_at: new Date().toISOString(),
    ws_url: redactUrl(urls.authorized),
    contract: CONTRACT,
    socket_opened: result.open,
    close: result.close,
    checks: {
      hello: hasHello,
      execution_log: hasExecutionLog,
      node_heartbeat: hasNodeHeartbeat,
      error_frame: hasError,
      unauthorized_4401: hasUnauthorized4401,
      forbidden_4403: hasForbidden4403,
    },
    auth_failure_checks: {
      skipped: SKIP_AUTH_FAILURE_CHECKS || !urls.authFailureChecksAvailable,
      unauthorized: unauthorizedResult
        ? {
            url: redactUrl(urls.unauthorized),
            close: unauthorizedResult.close,
            error: unauthorizedResult.error ?? null,
          }
        : null,
      forbidden: forbiddenResult
        ? {
            url: redactUrl(urls.forbidden),
            close: forbiddenResult.close,
            error: forbiddenResult.error ?? null,
          }
        : null,
    },
    frames_count: result.frames.length,
  };
  const passed =
    summary.socket_opened &&
    summary.checks.hello &&
    summary.checks.execution_log &&
    summary.checks.node_heartbeat &&
    (summary.auth_failure_checks.skipped || (summary.checks.unauthorized_4401 && summary.checks.forbidden_4403));
  summary.passed = passed;

  const framesPath = writeJson('frames.json', result.frames);
  const unauthorizedPath = unauthorizedResult ? writeJson('unauthorized-4401.json', unauthorizedResult) : '';
  const forbiddenPath = forbiddenResult ? writeJson('forbidden-4403.json', forbiddenResult) : '';
  const summaryPath = writeJson('summary.json', summary);
  const reportPath = path.join(artifactDir, 'REPORT.md');
  fs.writeFileSync(
    reportPath,
    [
      '# Execution Monitor Real Environment Evidence',
      '',
      `Generated at: ${summary.generated_at}`,
      `Contract: \`${CONTRACT}\``,
      `WebSocket URL: \`${summary.ws_url}\``,
      '',
      '## Checks',
      '',
      `- overall passed: ${summary.passed ? 'yes' : 'no'}`,
      `- socket opened: ${summary.socket_opened ? 'yes' : 'no'}`,
      `- hello: ${summary.checks.hello ? 'yes' : 'no'}`,
      `- execution_log: ${summary.checks.execution_log ? 'yes' : 'no'}`,
      `- node_heartbeat: ${summary.checks.node_heartbeat ? 'yes' : 'no'}`,
      `- unauthorized 4401: ${summary.checks.unauthorized_4401 ? 'yes' : summary.auth_failure_checks.skipped ? 'skipped' : 'no'}`,
      `- forbidden 4403: ${summary.checks.forbidden_4403 ? 'yes' : summary.auth_failure_checks.skipped ? 'skipped' : 'no'}`,
      `- error frame: ${summary.checks.error_frame ? 'yes' : 'no'}`,
      `- close code: ${summary.close?.code ?? 'n/a'}`,
      '',
      '## Artifacts',
      '',
      `- summary: \`${path.basename(summaryPath)}\``,
      `- frames: \`${path.basename(framesPath)}\``,
      ...(unauthorizedPath ? [`- unauthorized 4401: \`${path.basename(unauthorizedPath)}\``] : []),
      ...(forbiddenPath ? [`- forbidden 4403: \`${path.basename(forbiddenPath)}\``] : []),
    ].join('\n'),
  );

  console.log(JSON.stringify({
    ok: summary.passed,
    artifact_dir: artifactDir,
    report: reportPath,
    summary: summaryPath,
  }, null, 2));

  if (!summary.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
