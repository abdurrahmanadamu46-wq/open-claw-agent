const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'src', 'app');
const OUTPUT_ROOT = path.join(ROOT, 'test-results');

const EXACT_ROUTE_SAMPLES = {
  '/dashboard/lobster-pool/[id]': '/dashboard/lobster-pool/strategist',
  '/dashboard/lobster-skills/[lobsterId]': '/dashboard/lobster-skills/strategist',
  '/lobsters/[id]': '/lobsters/strategist',
  '/operations/usecases/[id]': '/operations/usecases/demo',
  '/operations/workflows/[id]/edit': '/operations/workflows/content-campaign/edit',
  '/operations/workflows/[id]/executions': '/operations/workflows/content-campaign/executions',
  '/operations/workflows/[id]/triggers': '/operations/workflows/content-campaign/triggers',
};

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function sanitizeSegment(segment) {
  if (segment.startsWith('(') && segment.endsWith(')')) return null;
  return segment;
}

function buildRouteFromFile(filePath) {
  const relative = path.relative(APP_DIR, filePath);
  const parts = relative.split(path.sep);
  parts.pop();
  const routeParts = parts.map(sanitizeSegment).filter(Boolean);
  const route = `/${routeParts.join('/')}`.replace(/\/+/g, '/');
  return route === '/' ? '/' : route.replace(/\/$/, '') || '/';
}

function resolveDynamicRoute(route) {
  if (EXACT_ROUTE_SAMPLES[route]) return EXACT_ROUTE_SAMPLES[route];
  return route.replace(/\[(.+?)\]/g, (_, param) => {
    const normalized = String(param).toLowerCase();
    if (normalized.includes('lobster')) return 'strategist';
    if (normalized === 'id') return 'demo';
    return 'demo';
  });
}

function collectRoutes(dir, routes = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'api') continue;
      collectRoutes(nextPath, routes);
      continue;
    }
    if (entry.isFile() && entry.name === 'page.tsx') {
      routes.push(buildRouteFromFile(nextPath));
    }
  }
  return routes;
}

function toScreenshotName(route) {
  if (route === '/') return 'root.png';
  return `${route.replace(/^\//, '').replace(/[\/[\]]+/g, '_')}.png`;
}

function isIgnorableRuntimeAsset(url) {
  return url.includes('/_next/static/');
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function waitForSettle(page) {
  await page.waitForTimeout(1500);
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // Some pages poll continuously; a short settle window is enough for screenshots.
  }
  await page.waitForTimeout(500);
}

async function main() {
  const baseURL = process.env.ROUTE_AUDIT_BASE_URL || 'http://127.0.0.1:3101';
  const runId = `route-audit-${timestamp()}`;
  const outputDir = path.join(OUTPUT_ROOT, runId);
  const screenshotsDir = path.join(outputDir, 'screenshots');
  await ensureDir(screenshotsDir);

  const collected = Array.from(new Set(collectRoutes(APP_DIR))).sort((a, b) => a.localeCompare(b));
  const startIndex = Math.max(0, Number(process.env.ROUTE_AUDIT_START || 0));
  const batchSize = Math.max(0, Number(process.env.ROUTE_AUDIT_LIMIT || 0));
  const sliced = batchSize > 0 ? collected.slice(startIndex, startIndex + batchSize) : collected.slice(startIndex);
  const routes = sliced.map((route) => ({
    route,
    visitPath: resolveDynamicRoute(route),
  }));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: 'dark',
  });

  const results = [];
  let index = 0;

  for (const item of routes) {
    index += 1;
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    const failedResponses = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        if (text.startsWith('Failed to load resource: the server responded with a status of 404')) {
          return;
        }
        if (text.includes('/_next/static/')) {
          return;
        }
        consoleErrors.push(text);
      }
    });
    page.on('requestfailed', (request) => {
      const errorText = request.failure()?.errorText || 'requestfailed';
      const url = request.url();
      if (
        (errorText === 'net::ERR_ABORTED' && url.includes('_rsc=')) ||
        url.includes('webpack.hot-update.json') ||
        isIgnorableRuntimeAsset(url)
      ) {
        return;
      }
      failedRequests.push(`${request.method()} ${url} :: ${errorText}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (response.status() >= 400 && !url.includes('webpack.hot-update.json') && !isIgnorableRuntimeAsset(url)) {
        failedResponses.push(`${response.status()} ${url}`);
      }
    });

    const targetURL = `${baseURL}${item.visitPath}`;
    let httpStatus = null;
    let finalURL = targetURL;
    let fatalError = null;

    try {
      const response = await page.goto(targetURL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      httpStatus = response ? response.status() : null;
      await waitForSettle(page);
      finalURL = page.url();
    } catch (error) {
      fatalError = error instanceof Error ? error.message : String(error);
    }

    const screenshotPath = path.join(screenshotsDir, toScreenshotName(item.route));
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (error) {
      if (!fatalError) {
        fatalError = `screenshot_failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const ok =
      !fatalError &&
      errors.length === 0 &&
      consoleErrors.length === 0 &&
      failedRequests.length === 0 &&
      failedResponses.length === 0 &&
      (httpStatus === null || httpStatus < 400);

    results.push({
      index,
      route: item.route,
      visitPath: item.visitPath,
      targetURL,
      finalURL,
      httpStatus,
      ok,
      fatalError,
      pageErrors: errors,
      consoleErrors,
      failedRequests,
      failedResponses,
      screenshot: path.relative(ROOT, screenshotPath),
    });

    console.log(
      `[${index}/${routes.length}] ${ok ? 'OK' : 'FAIL'} ${item.visitPath} ` +
        `(status=${httpStatus ?? 'n/a'}, pageErrors=${errors.length}, consoleErrors=${consoleErrors.length}, requestFailed=${failedRequests.length}, responseErrors=${failedResponses.length})`,
    );

    await page.close();
  }

  await browser.close();

  const summary = {
    baseURL,
    scannedAt: new Date().toISOString(),
    totalRoutes: results.length,
    startIndex,
    batchSize: batchSize > 0 ? batchSize : null,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    outputDir: path.relative(ROOT, outputDir),
  };

  await fs.promises.writeFile(
    path.join(outputDir, 'summary.json'),
    JSON.stringify({ summary, results }, null, 2),
    'utf8',
  );

  const lines = [
    `# Route Audit Report`,
    ``,
    `- Base URL: ${baseURL}`,
    `- Total routes: ${summary.totalRoutes}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Screenshots: ${path.relative(ROOT, screenshotsDir)}`,
    ``,
    `## Failures`,
  ];

  const failures = results.filter((item) => !item.ok);
  if (failures.length === 0) {
    lines.push('', `No failures recorded.`);
  } else {
    for (const failure of failures) {
      lines.push(
        '',
        `### ${failure.visitPath}`,
        `- HTTP: ${failure.httpStatus ?? 'n/a'}`,
        `- Screenshot: ${failure.screenshot}`,
      );
      if (failure.fatalError) lines.push(`- Fatal: ${failure.fatalError}`);
      if (failure.pageErrors.length) lines.push(`- Page errors: ${failure.pageErrors.join(' | ')}`);
      if (failure.consoleErrors.length) lines.push(`- Console errors: ${failure.consoleErrors.slice(0, 5).join(' | ')}`);
      if (failure.failedRequests.length) lines.push(`- Request failures: ${failure.failedRequests.slice(0, 5).join(' | ')}`);
      if (failure.failedResponses.length) lines.push(`- Response failures: ${failure.failedResponses.slice(0, 5).join(' | ')}`);
    }
  }

  await fs.promises.writeFile(path.join(outputDir, 'REPORT.md'), lines.join('\n'), 'utf8');

  console.log(`REPORT_DIR=${path.relative(ROOT, outputDir)}`);
  console.log(`TOTAL_ROUTES=${summary.totalRoutes}`);
  console.log(`PASSED=${summary.passed}`);
  console.log(`FAILED=${summary.failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
