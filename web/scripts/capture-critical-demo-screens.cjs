const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const webRoot = path.resolve(__dirname, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(webRoot, '.ms-playwright');
process.env.NEXT_DIST_DIR =
  process.env.FRONTEND_SCREENSHOT_DIST_DIR || '.next';

const { chromium } = require('@playwright/test');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = path.join(webRoot, 'test-results', `frontend-critical-screens-${timestamp}`);
const screenshotDir = path.join(artifactDir, 'screenshots');
const port = Number(process.env.FRONTEND_SCREENSHOT_PORT || 3101);
const baseUrl = String(
  process.env.FRONTEND_SCREENSHOT_BASE_URL || `http://127.0.0.1:${port}`,
).replace(/\/+$/, '');
const externalServer = process.env.FRONTEND_SCREENSHOT_EXTERNAL_SERVER === '1';
const requestTimeoutMs = Number(process.env.FRONTEND_SCREENSHOT_TIMEOUT_MS || 45_000);

const TARGETS = [
  { path: '/', slug: 'tenant-growth-control', label: '租户增长总控台' },
  { path: '/agents/cabinet', slug: 'agents-cabinet', label: '主管岗位总览' },
  { path: '/lobsters', slug: 'lobster-supervisor-overview', label: '龙虾主管总览' },
  { path: '/lobsters/strategist', slug: 'lobster-strategist-detail', label: '策略师主管详情' },
  { path: '/campaigns/new', slug: 'campaign-new', label: '起号任务创建' },
  { path: '/knowledge/platform-industries', slug: 'platform-industries', label: '平台行业知识' },
  { path: '/operations/alerts', slug: 'operations-alerts', label: '运营告警中心' },
  { path: '/operations/autopilot', slug: 'autopilot-overview', label: 'Autopilot 总控台' },
  { path: '/operations/autopilot/alerts', slug: 'autopilot-alerts', label: 'Autopilot 告警中心' },
  { path: '/operations/autopilot/approvals', slug: 'autopilot-approvals', label: 'Autopilot 审批中心' },
  { path: '/operations/autopilot/artifacts', slug: 'autopilot-artifacts', label: 'Autopilot Artifact Center' },
  { path: '/operations/autopilot/modes', slug: 'autopilot-modes', label: 'Autopilot 模式预览' },
  { path: '/operations/autopilot/trace', slug: 'autopilot-trace', label: 'Autopilot Trace 复盘' },
  { path: '/operations/calendar', slug: 'operations-calendar', label: '运营日历' },
  { path: '/operations/channels', slug: 'operations-channels', label: '渠道管理' },
  { path: '/operations/channels/feishu', slug: 'operations-channels-feishu', label: 'Feishu 群协作适配器' },
  { path: '/operations/channels/xiaohongshu', slug: 'xhs-channel-supervisor', label: '小红书通道主管台' },
  { path: '/operations/channels/xiaohongshu/events', slug: 'xhs-channel-events', label: '小红书边缘事件流' },
  { path: '/operations/control-panel', slug: 'operations-control-panel', label: '后台资源控制面' },
  { path: '/operations/cost', slug: 'operations-cost', label: '龙虾成本看板' },
  { path: '/operations/delivery-hub', slug: 'operations-delivery-hub', label: '最终交付导航页' },
  { path: '/operations/edge-audit', slug: 'edge-audit', label: '边缘节点审计' },
  { path: '/operations/escalations', slug: 'escalations', label: '人工介入升级队列' },
  { path: '/operations/experiments', slug: 'operations-experiments', label: '实验管理' },
  { path: '/operations/feature-flags', slug: 'operations-feature-flags', label: '功能开关' },
  { path: '/operations/frontend-gaps', slug: 'frontend-gaps', label: '前端联调与 QA 清单' },
  { path: '/operations/kanban', slug: 'operations-kanban', label: '全局任务看板' },
  { path: '/operations/knowledge-base', slug: 'operations-knowledge-base', label: '租户知识库' },
  { path: '/operations/leads', slug: 'operations-leads', label: '线索工作台' },
  { path: '/operations/learning-loop-acceptance', slug: 'operations-learning-loop-acceptance', label: '学习闭环验收说明' },
  { path: '/operations/learning-loop-report', slug: 'operations-learning-loop-report', label: '学习闭环老板汇报' },
  { path: '/operations/lobster-config', slug: 'operations-lobster-config', label: '龙虾配置中心' },
  { path: '/operations/log-audit', slug: 'operations-log-audit', label: '日志审核台' },
  { path: '/operations/mcp', slug: 'operations-mcp', label: 'MCP 网关控制台' },
  { path: '/operations/memory', slug: 'operations-memory', label: '经验记忆中心' },
  { path: '/operations/monitor', slug: 'execution-monitor', label: '执行监控' },
  { path: '/operations/orchestrator', slug: 'operations-orchestrator', label: '全域任务总控' },
  { path: '/operations/patrol', slug: 'operations-patrol', label: '自动巡检策略' },
  { path: '/operations/project-closeout', slug: 'operations-project-closeout', label: '项目总收口页' },
  { path: '/operations/prompts', slug: 'operations-prompts', label: 'Prompt 注册表' },
  { path: '/operations/release-checklist', slug: 'release-checklist', label: '发布检查清单' },
  { path: '/operations/scheduler', slug: 'operations-scheduler', label: '定时任务管理' },
  { path: '/operations/sessions', slug: 'operations-sessions', label: '会话隔离面板' },
  { path: '/operations/skills-improvements', slug: 'skills-improvements', label: '技能改进闭环' },
  { path: '/operations/skills-pool', slug: 'operations-skills-pool', label: '技能池总览' },
  { path: '/operations/strategy', slug: 'operations-strategy', label: '策略总控台' },
  { path: '/operations/strategy/industry', slug: 'operations-strategy-industry', label: '行业工作流接入' },
  { path: '/operations/tenant-cockpit', slug: 'operations-tenant-cockpit', label: '租户 Cockpit' },
  { path: '/operations/traces', slug: 'operations-traces', label: '分布式链路追踪' },
  { path: '/operations/usecases', slug: 'operations-usecases', label: '场景模板市场' },
  { path: '/operations/usecases/tpl_food_growth', slug: 'operations-usecase-detail', label: '场景模板详情' },
  { path: '/operations/workflow-board', slug: 'operations-workflow-board', label: '工作流板' },
  { path: '/operations/workflows', slug: 'operations-workflows', label: '工作流列表' },
  { path: '/operations/workflows/templates', slug: 'operations-workflow-templates', label: '工作流模板画廊' },
  { path: '/operations/workflows/wf_demo_001/edit', slug: 'operations-workflow-edit', label: '工作流配置编辑' },
  { path: '/operations/workflows/wf_demo_001/executions', slug: 'operations-workflow-executions', label: '工作流执行历史' },
  { path: '/operations/workflows/wf_demo_001/triggers', slug: 'operations-workflow-triggers', label: '工作流触发器' },
];

const ERROR_TEXT_PATTERNS = [
  /Application error/i,
  /Unhandled Runtime Error/i,
  /This page could not be found/i,
  /Internal Server Error/i,
  /Hydration failed/i,
];

const MOJIBAKE_PATTERN = /(?:姒瑨|缁夌喐|閻儴|娑撹崵|閸氬海|閸撳秶|閺冨爼|閿泑閵唡閳娑撯偓|鐠噟鐎箌鎼?)/;

fs.mkdirSync(screenshotDir, { recursive: true });

function writeJson(name, value) {
  fs.writeFileSync(path.join(artifactDir, name), JSON.stringify(value, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(serverProcess) {
  const child = serverProcess?.child || serverProcess;
  const startedAt = Date.now();
  let lastError = '';

  while (Date.now() - startedAt < requestTimeoutMs) {
    if (child?.exitCode !== null) {
      throw new Error(`next start exited before becoming ready with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(baseUrl, { method: 'GET' });
      if (response.status < 500) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError || 'no response'}`);
}

function startServer() {
  if (externalServer) return null;

  const serverLog = fs.createWriteStream(path.join(artifactDir, 'next-start.log'), { flags: 'a' });
  const distDir = process.env.NEXT_DIST_DIR || '.next';
  const distRoot = path.join(webRoot, distDir);
  const standaloneRoot = path.join(distRoot, 'standalone');
  const standaloneServer = path.join(standaloneRoot, 'server.js');

  const sharedEnv = {
      ...process.env,
      HOSTNAME: process.env.HOSTNAME || '127.0.0.1',
      PORT: String(port),
      NEXT_PUBLIC_USE_MOCK: process.env.NEXT_PUBLIC_USE_MOCK || 'true',
      NEXT_PUBLIC_RUNTIME_ENV: process.env.NEXT_PUBLIC_RUNTIME_ENV || 'production-screenshot',
    NEXT_PUBLIC_ALLOW_DEMO_MODE: process.env.NEXT_PUBLIC_ALLOW_DEMO_MODE || 'true',
      NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK:
        process.env.NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK || 'true',
      NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || '',
  };

  let child;
  if (fs.existsSync(standaloneServer)) {
    const publicDir = path.join(webRoot, 'public');
    const standalonePublicDir = path.join(standaloneRoot, 'public');
    const distStaticDir = path.join(distRoot, 'static');
    const standaloneStaticDir = path.join(standaloneRoot, '.next', 'static');

    if (fs.existsSync(publicDir)) {
      fs.cpSync(publicDir, standalonePublicDir, { recursive: true, force: true });
    }
    if (fs.existsSync(distStaticDir)) {
      fs.mkdirSync(path.dirname(standaloneStaticDir), { recursive: true });
      fs.cpSync(distStaticDir, standaloneStaticDir, { recursive: true, force: true });
    }

    child = spawn(process.execPath, [standaloneServer], {
      cwd: webRoot,
      env: sharedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    const nextBin = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
    child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: webRoot,
      env: sharedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  child.stdout.pipe(serverLog);
  child.stderr.pipe(serverLog);
  child.on('exit', (code, signal) => {
    serverLog.write(`[process-exit] code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
  });

  return {
    child,
    logStream: serverLog,
  };
}

function stopServer(child) {
  const processHandle = child?.child || child;
  if (processHandle && processHandle.exitCode === null) {
    processHandle.kill('SIGTERM');
  }
  child?.logStream?.end();
}

function isIgnorableResponseError(rawUrl, status) {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname || '';
    if (pathname.startsWith('/_next/static/')) return true;
    if (pathname === '/_next/image' && url.searchParams.get('url') === '/logo.png') return true;
    if (pathname === '/logo.png' && status === 404) return true;
  } catch {
    return false;
  }
  return false;
}

function isIgnorableConsoleError(message) {
  const text = String(message || '');
  return text.startsWith('Failed to load resource:');
}

async function captureTarget(context, target) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const responseErrors = [];
  const url = `${baseUrl}${target.path}`;
  const screenshotPath = path.join(screenshotDir, `${target.slug}.png`);

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !isIgnorableConsoleError(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !isIgnorableResponseError(response.url(), response.status())) {
      responseErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const result = {
    ...target,
    url,
    screenshot: path.relative(artifactDir, screenshotPath).replace(/\\/g, '/'),
    ok: false,
    serverUnavailable: false,
    bodyLength: 0,
    pageErrors,
    consoleErrors,
    responseErrors,
    checks: [],
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: requestTimeoutMs });
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1_200);

    const bodyText = await page.locator('body').innerText({ timeout: 15_000 });
    result.bodyLength = bodyText.trim().length;

    if (result.bodyLength <= 80) {
      result.checks.push(`body too short: ${result.bodyLength}`);
    }

    for (const pattern of ERROR_TEXT_PATTERNS) {
      if (pattern.test(bodyText)) {
        result.checks.push(`matched error text: ${pattern}`);
      }
    }

    if (MOJIBAKE_PATTERN.test(bodyText)) {
      result.checks.push('matched common mojibake text');
    }

    if (pageErrors.length > 0) {
      result.checks.push(`page errors: ${pageErrors.join(' | ')}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.ok = result.checks.length === 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ERR_CONNECTION_REFUSED')) {
      result.serverUnavailable = true;
    }
    result.checks.push(errorMessage);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  } finally {
    await page.close().catch(() => undefined);
  }

  return result;
}

function writeReport(results) {
  const okCount = results.filter((item) => item.ok).length;
  const lines = [
    '# Frontend Critical Screenshot Evidence',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Base URL: \`${baseUrl}\``,
    `Mode: \`${externalServer ? 'external server' : 'managed next start'}\``,
    `Result: ${okCount}/${results.length} pages passed`,
    '',
    '## Pages',
    '',
    ...results.flatMap((item) => [
      `- ${item.ok ? 'PASS' : 'FAIL'} ${item.label} - \`${item.path}\``,
      `  - screenshot: \`${item.screenshot}\``,
      `  - body length: ${item.bodyLength}`,
      `  - checks: ${item.checks.length ? item.checks.join('; ') : 'none'}`,
      `  - page errors: ${item.pageErrors.length ? item.pageErrors.join('; ') : 'none'}`,
      `  - console errors: ${item.consoleErrors.length}`,
      `  - response errors: ${item.responseErrors.length ? item.responseErrors.join('; ') : 'none'}`,
    ]),
    '',
    '## Notes',
    '',
    '- The script runs against production `next start` by default, so it does not use HMR.',
    '- Console errors are counted for triage but do not fail the run; page errors, blank bodies, app error text, and common mojibake do fail.',
  ];

  fs.writeFileSync(path.join(artifactDir, 'REPORT.md'), `\uFEFF${lines.join('\n')}`, 'utf8');
}

async function main() {
  let serverProcess = null;
  let browser = null;
  let serverRestartCount = 0;
  const results = [];

  try {
    serverProcess = startServer();
    await waitForServer(serverProcess);

    browser = await chromium.launch();
    const context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 1,
    });

    await context.addInitScript(() => {
      localStorage.setItem('clawcommerce_token', 'mock_jwt_demo');
      localStorage.setItem('clawcommerce_demo_mode', '1');
    });

    for (const target of TARGETS) {
      let capture = await captureTarget(context, target);

      if (!externalServer && capture.serverUnavailable) {
        stopServer(serverProcess);
        serverProcess = startServer();
        serverRestartCount += 1;
        await waitForServer(serverProcess);
        capture = await captureTarget(context, target);
      }

      results.push(capture);
    }

    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    stopServer(serverProcess);
    writeJson('summary.json', {
      generated_at: new Date().toISOString(),
      base_url: baseUrl,
      artifact_dir: artifactDir,
      server_restart_count: serverRestartCount,
      results,
    });
    writeReport(results);
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`Frontend critical screenshot evidence: ${results.length - failed.length}/${results.length} passed`);
  console.log(`Artifact dir: ${artifactDir}`);

  if (failed.length > 0) {
    for (const item of failed) {
      console.error(`FAIL ${item.path}: ${item.checks.join('; ')}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  writeJson('fatal-error.json', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  console.error(error);
  process.exitCode = 1;
});
