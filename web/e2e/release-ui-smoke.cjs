const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const localBrowsers = path.join(root, '.ms-playwright');
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || localBrowsers;

const { chromium } = require('@playwright/test');
const port = Number(process.env.RELEASE_UI_PORT || 3101);
const baseURL = process.env.RELEASE_UI_BASE_URL || `http://127.0.0.1:${port}`;
const shouldStartServer = !process.env.RELEASE_UI_BASE_URL;
const serverReadyTimeoutMs = Number(process.env.RELEASE_UI_SERVER_READY_TIMEOUT_MS || 90000);
const serverMode = String(process.env.RELEASE_UI_SERVER_MODE || 'prod-start').trim().toLowerCase();
const artifactRoot = path.join(root, 'test-results');

const routes = [
  '/',
  '/operations/delivery-hub',
  '/operations/release-checklist',
  '/operations/tenant-cockpit',
  '/operations/project-closeout',
  '/operations/learning-loop-report',
  '/operations/monitor',
  '/operations/log-audit',
  '/operations/autopilot/trace',
  '/operations/skills-pool',
  '/operations/channels',
  '/settings/model-providers',
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeSmokeArtifacts(results, failures) {
  ensureDir(artifactRoot);
  const artifactDir = path.join(artifactRoot, `release-ui-smoke-${timestamp()}`);
  ensureDir(artifactDir);

  const summaryPath = path.join(artifactDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ ...results, failures }, null, 2), 'utf8');

  const passedRoutes = results.routeResults.filter((item) => item.ok).length;
  const passedInteractions = results.interactions.filter((item) => item.ok).length;
  const lines = [
    '# Release UI Smoke Report',
    '',
    `- Base URL: ${results.baseURL}`,
    `- Checked at: ${results.checkedAt}`,
    `- Routes: ${passedRoutes}/${results.routeResults.length} passed`,
    `- Interactions: ${passedInteractions}/${results.interactions.length} passed`,
    `- Failures: ${failures.length}`,
    '',
    '## Route Results',
    '',
    ...results.routeResults.map((item) => [
      `### ${item.route}`,
      `- status: ${item.status ?? 'n/a'}`,
      `- ok: ${item.ok ? 'yes' : 'no'}`,
      `- title: ${item.title || '-'}`,
      `- page errors: ${item.pageErrors.length}`,
      `- console errors: ${item.consoleErrors.length}`,
      `- response errors: ${item.responseErrors.length}`,
      item.fatal ? `- fatal: ${item.fatal}` : null,
    ].filter(Boolean).join('\n')),
    '',
    '## Interaction Results',
    '',
    ...results.interactions.map((item) => [
      `### ${item.route}`,
      `- status: ${item.status ?? 'n/a'}`,
      `- ok: ${item.ok ? 'yes' : 'no'}`,
      'persisted' in item ? `- persisted: ${item.persisted}` : null,
      'copiedReport' in item ? `- copied report: ${item.copiedReport ? 'yes' : 'no'}` : null,
      `- page errors: ${item.pageErrors.length}`,
      `- console errors: ${item.consoleErrors.length}`,
      `- response errors: ${item.responseErrors.length}`,
    ].filter(Boolean).join('\n')),
  ];
  fs.writeFileSync(path.join(artifactDir, 'REPORT.md'), lines.join('\n'), 'utf8');
  return {
    artifactDir,
    summaryPath,
    reportPath: path.join(artifactDir, 'REPORT.md'),
  };
}

function waitForServer(url, timeoutMs = serverReadyTimeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server not ready after ${timeoutMs}ms: ${url}`));
          return;
        }
        setTimeout(tick, 1000);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

function shouldSuppressServerLog(label, text) {
  if (label !== 'next') return false;
  return (
    text.includes('"next start" does not work with "output: standalone" configuration')
    || text.includes("'sharp' is required to be installed in standalone mode")
  );
}

function createLoggedProcess(label, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk.toString()}`));
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (shouldSuppressServerLog(label, text)) return;
    process.stderr.write(`[${label}:err] ${text}`);
  });
  return child;
}

async function runBuildIfNeeded() {
  const buildIdPath = path.join(root, '.next', 'BUILD_ID');
  if (fs.existsSync(buildIdPath)) return;
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('npm_execpath is missing; cannot run release-ui build bootstrap');
  }
  const build = createLoggedProcess('build', [npmCli, 'run', 'build']);
  const exitCode = await new Promise((resolve) => build.on('close', resolve));
  if (Number(exitCode ?? 1) !== 0) {
    throw new Error(`release-ui build bootstrap failed with exit code ${exitCode}`);
  }
}

async function startServer() {
  if (serverMode.startsWith('prod')) {
    await runBuildIfNeeded();
  }
  const standaloneCandidates = [
    path.join(root, '.next-codex-build', 'standalone', 'server.js'),
    path.join(root, '.next', 'standalone', 'server.js'),
  ];
  const standaloneServer = standaloneCandidates.find((candidate) => fs.existsSync(candidate));
  if (serverMode === 'prod-standalone' && standaloneServer) {
    return createLoggedProcess('standalone', [standaloneServer], {
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
    });
  }
  const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  const command = serverMode === 'dev' ? 'dev' : 'start';
  return createLoggedProcess('next', [nextBin, command, '-p', String(port)]);
}

async function collectRuntimeIssues(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const responseErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Failed to load resource')) return;
    if (text.includes('/_next/static/')) return;
    consoleErrors.push(text);
  });
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 500 && !url.includes('/_next/')) {
      responseErrors.push(`${response.status()} ${url}`);
    }
  });

  return { pageErrors, consoleErrors, responseErrors };
}

async function gotoWithRetry(page, url, options = {}) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        ...options,
      });
      lastResponse = response;
      if (!response || response.status() < 400) return response;
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(1500);
  }
  if (lastError) throw lastError;
  return lastResponse;
}

async function auditRoutes(context) {
  const results = [];

  for (const route of routes) {
    const page = await context.newPage();
    const issues = await collectRuntimeIssues(page);
    let status = null;
    let title = '';
    let fatal = '';

    try {
      const response = await gotoWithRetry(page, `${baseURL}${route}`);
      status = response ? response.status() : null;
      await page.waitForTimeout(1500);
      title = await page.locator('h1').first().textContent({ timeout: 3000 }).catch(() => '');
    } catch (error) {
      fatal = error instanceof Error ? error.message : String(error);
    }

    const ok =
      !fatal &&
      (status === null || status < 400) &&
      issues.pageErrors.length === 0 &&
      issues.consoleErrors.length === 0 &&
      issues.responseErrors.length === 0;

    results.push({
      route,
      status,
      title,
      fatal,
      ok,
      ...issues,
    });

    console.log(
      `${ok ? 'OK' : 'FAIL'} ${route} status=${status ?? 'n/a'} ` +
      `pageErrors=${issues.pageErrors.length} consoleErrors=${issues.consoleErrors.length} responseErrors=${issues.responseErrors.length}`,
    );
    await page.close();
  }

  return results;
}

async function smokeChecklist(context) {
  const page = await context.newPage();
  const issues = await collectRuntimeIssues(page);
  const response = await gotoWithRetry(page, `${baseURL}/operations/release-checklist`);
  await page.waitForTimeout(1500);
  await page.getByText('发版前稳定性检查清单').first().waitFor({ timeout: 10000 });

  const firstCard = page
    .locator('article')
    .filter({ hasText: '执行监控实时流与快照 fallback' })
    .first();
  await firstCard.getByRole('button', { name: '已通过' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const persisted = await page
    .locator('article')
    .filter({ hasText: '执行监控实时流与快照 fallback' })
    .first()
    .getByText('已通过')
    .count();

  await page.getByRole('button', { name: '复制联调报告' }).click();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  await page.close();

  const ok =
    response &&
    response.status() < 400 &&
    persisted > 0 &&
    clipboardText.includes('OpenClaw 前端收尾联调报告') &&
    issues.pageErrors.length === 0 &&
    issues.consoleErrors.length === 0 &&
    issues.responseErrors.length === 0;

  return {
    route: '/operations/release-checklist',
    ok: Boolean(ok),
    status: response ? response.status() : null,
    persisted,
    copiedReport: clipboardText.includes('OpenClaw 前端收尾联调报告'),
    ...issues,
  };
}

async function smokeTraceLoopback(context) {
  const page = await context.newPage();
  const issues = await collectRuntimeIssues(page);
  const url =
    `${baseURL}/operations/autopilot/trace?` +
    new URLSearchParams({
      traceId: 'smoke_trace',
      validationTraceId: 'smoke_trace',
      validationTaskId: 'task_smoke',
      validationNodeId: 'node_smoke',
      validationStatus: 'executed',
      monitorValidationCode: 'recovered',
      logValidationCode: 'recovered',
    }).toString();
  const response = await gotoWithRetry(page, url);
  await page.waitForTimeout(1500);
  await page.getByText('Validation Loopback').first().waitFor({ timeout: 10000 });
  await page.getByText('闭环完成').first().waitFor({ timeout: 10000 });
  await page.getByText('Closeout Receipt').first().waitFor({ timeout: 10000 });
  await page.close();

  return {
    route: '/operations/autopilot/trace',
    ok:
      Boolean(response && response.status() < 400) &&
      issues.pageErrors.length === 0 &&
      issues.consoleErrors.length === 0 &&
      issues.responseErrors.length === 0,
    status: response ? response.status() : null,
    ...issues,
  };
}

async function smokeDeliveryHubCopy(context) {
  const page = await context.newPage();
  const issues = await collectRuntimeIssues(page);
  const response = await gotoWithRetry(page, `${baseURL}/operations/delivery-hub`);
  await page.waitForTimeout(1500);
  await page.getByText('最终交付导航页').first().waitFor({ timeout: 10000 });
  await page.getByTestId('delivery-hub-copy-engineer-handoff').click();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  await page.close();

  return {
    route: '/operations/delivery-hub',
    ok:
      Boolean(response && response.status() < 400) &&
      clipboardText.includes('总工程师交接摘要') &&
      clipboardText.includes('verify:release-gate:local') &&
      issues.pageErrors.length === 0 &&
      issues.consoleErrors.length === 0 &&
      issues.responseErrors.length === 0,
    status: response ? response.status() : null,
    copiedEngineerHandoff: clipboardText.includes('总工程师交接摘要'),
    ...issues,
  };
}

async function main() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || localBrowsers;
  let server = null;

  try {
    if (shouldStartServer) {
      server = await startServer();
      await waitForServer(`${baseURL}/operations/release-checklist`);
    } else {
      await waitForServer(`${baseURL}/operations/release-checklist`);
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      colorScheme: 'dark',
      permissions: ['clipboard-read', 'clipboard-write'],
    });

    const checklist = await smokeChecklist(context);
    const trace = await smokeTraceLoopback(context);
    const deliveryHub = await smokeDeliveryHubCopy(context);
    const routeResults = await auditRoutes(context);
    await browser.close();

    const results = {
      baseURL,
      checkedAt: new Date().toISOString(),
      routeResults,
      interactions: [checklist, trace, deliveryHub],
    };
    const failures = [
      ...routeResults.filter((item) => !item.ok),
      checklist.ok ? null : checklist,
      trace.ok ? null : trace,
    ].filter(Boolean);
    const artifacts = writeSmokeArtifacts(results, failures);

    console.log('RELEASE_UI_SMOKE_RESULTS=' + JSON.stringify(results, null, 2));
    console.log('RELEASE_UI_SMOKE_ARTIFACTS=' + JSON.stringify({
      artifactDir: artifacts.artifactDir,
      summary: artifacts.summaryPath,
      report: artifacts.reportPath,
    }, null, 2));
    if (failures.length > 0) {
      console.error('RELEASE_UI_SMOKE_FAILURES=' + JSON.stringify(failures, null, 2));
    }
    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (server) {
      server.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
