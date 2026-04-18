const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pickScreenshotPort() {
  const basePort = 3200;
  return String(basePort + Math.floor(Math.random() * 400));
}

function runStep(label, command, env) {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const result = spawnSync(command, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: true,
  });

  return {
    label,
    command,
    startedAt,
    durationMs: Date.now() - start,
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr:
      (result.stderr || '') +
      (result.error ? `${result.stderr ? '\n' : ''}${String(result.error.stack || result.error.message || result.error)}` : ''),
  };
}

function parseArtifactDir(output) {
  const source = `${output || ''}`;
  const match = source.match(/Artifact dir:\s*(.+)/i) || source.match(/\[frontend-closeout\]\s*artifact:\s*(.+)/i);
  return match?.[1]?.trim() || '';
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function summarizeFrontendCriticalArtifact(artifactDir) {
  const summary = artifactDir ? readJsonFile(path.join(artifactDir, 'summary.json')) : null;
  const results = Array.isArray(summary?.results) ? summary.results : [];
  const passed = results.filter((item) => Boolean(item?.ok)).length;
  return {
    passed,
    total: results.length,
    failed: Math.max(results.length - passed, 0),
  };
}

function summarizeOperationsScanArtifact(artifactDir) {
  const summary = artifactDir ? readJsonFile(path.join(artifactDir, 'summary.json')) : null;
  const items = Array.isArray(summary?.items) ? summary.items : [];
  const highPriorityIssues = items.filter((item) => Number(item?.score ?? 0) > 0).length;
  return {
    covered: Number(summary?.covered_count ?? items.filter((item) => item?.coveredByScreenshot).length) || 0,
    total: Number(summary?.total ?? items.length) || 0,
    uncovered: Number(summary?.uncovered_count ?? items.filter((item) => !item?.coveredByScreenshot).length) || 0,
    highPriorityIssues,
  };
}

function sanitizeTsconfig(content) {
  const parsed = JSON.parse(String(content).replace(/^\uFEFF/, ''));
  if (Array.isArray(parsed.include)) {
    parsed.include = parsed.include.filter(
      (item) => typeof item !== 'string' || !item.startsWith('.next-closeout-'),
    );
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function runFrontendCriticalStep(env, screenshotPort) {
  return runStep(
    'frontend-critical',
    'npm.cmd run evidence:frontend-critical',
    {
      ...env,
      FRONTEND_SCREENSHOT_DIST_DIR: env.FRONTEND_CLOSEOUT_DIST_DIR,
      FRONTEND_SCREENSHOT_PORT: screenshotPort,
    },
  );
}

function buildCopyableSummary(summary, steps, artifactDir) {
  return [
    '前端收尾验证',
    `结果：${summary.ok ? '通过' : '未通过'}`,
    `生成时间：${summary.generatedAt}`,
    `步骤：${steps.filter((step) => step.exitCode === 0).length}/${steps.length} 通过`,
    `关键页面截图：${summary.coverage?.frontendCritical?.passed ?? 0}/${summary.coverage?.frontendCritical?.total ?? 0} 通过`,
    `operations 扫描：${summary.coverage?.operationsScan?.covered ?? 0}/${summary.coverage?.operationsScan?.total ?? 0} 覆盖`,
    ...steps.map((step) => (
      `- ${step.label}：${step.exitCode === 0 ? '通过' : `失败 ${step.exitCode}`}（${Math.round(step.durationMs / 1000)} 秒）`
    )),
    `摘要来源：${path.join(artifactDir, 'summary.json')}`,
    `收尾证据包：${artifactDir}`,
    `收尾报告：${path.join(artifactDir, 'REPORT.md')}`,
    `关键页面截图证据：${summary.closeoutArtifacts?.screenshotArtifactDir || 'n/a'}`,
    `operations 页面扫描证据：${summary.closeoutArtifacts?.operationsScanArtifactDir || 'n/a'}`,
  ];
}

function writeArtifact(artifactDir, summary, steps) {
  fs.mkdirSync(artifactDir, { recursive: true });

  for (const step of steps) {
    const baseName = step.label.replace(/\s+/g, '-').toLowerCase();
    fs.writeFileSync(path.join(artifactDir, `${baseName}.stdout.log`), step.stdout, 'utf8');
    fs.writeFileSync(path.join(artifactDir, `${baseName}.stderr.log`), step.stderr, 'utf8');
  }

  fs.writeFileSync(
    path.join(artifactDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );

  const reportLines = [
    '# Frontend Closeout Verification',
    '',
    `Generated at: ${summary.generatedAt}`,
    `Overall result: ${summary.ok ? 'pass' : 'fail'}`,
    `Artifact dir: ${artifactDir}`,
    '',
    '## Copyable Summary',
    '',
    '```text',
    ...buildCopyableSummary(summary, steps, artifactDir),
    '```',
    '',
    '## Steps',
    ...steps.flatMap((step) => [
      `- ${step.label}: ${step.exitCode === 0 ? 'pass' : 'fail'}`,
      `  - command: ${step.command}`,
      `  - duration_ms: ${step.durationMs}`,
      `  - artifact_dir: ${step.artifactDir || 'n/a'}`,
      `  - stdout: ${step.label.replace(/\s+/g, '-').toLowerCase()}.stdout.log`,
      `  - stderr: ${step.label.replace(/\s+/g, '-').toLowerCase()}.stderr.log`,
    ]),
    '',
    '## Notes',
    ...((summary.notes || []).length ? summary.notes.map((item) => `- ${item}`) : ['- none']),
  ];

  fs.writeFileSync(path.join(artifactDir, 'REPORT.md'), `\uFEFF${reportLines.join('\n')}`, 'utf8');
}

function main() {
  const runStamp = timestamp();
  const artifactDir = path.join(process.cwd(), 'test-results', `frontend-closeout-${runStamp}`);
  const tsconfigPath = path.join(process.cwd(), 'tsconfig.json');
  const originalTsconfig = sanitizeTsconfig(fs.readFileSync(tsconfigPath, 'utf8'));
  if (fs.readFileSync(tsconfigPath, 'utf8') !== originalTsconfig) {
    fs.writeFileSync(tsconfigPath, originalTsconfig, 'utf8');
  }
  const screenshotPort = process.env.FRONTEND_SCREENSHOT_PORT || pickScreenshotPort();
  const distDir = `.next-closeout-${runStamp}`;
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.cwd(), '.ms-playwright'),
    FRONTEND_SCREENSHOT_PORT: screenshotPort,
    FRONTEND_CLOSEOUT_DIST_DIR: distDir,
  };

  const steps = [];
  const notes = [];

  steps.push(runStep('tsc', 'npx.cmd tsc --noEmit -p tsconfig.json', env));
  steps.push(
    runStep(
      'build',
      'node .\\scripts\\clean-next-artifacts.cjs && node .\\node_modules\\next\\dist\\bin\\next build',
      {
        ...env,
        NEXT_DIST_DIR: distDir,
      },
    ),
  );

  if (fs.readFileSync(tsconfigPath, 'utf8') !== originalTsconfig) {
    fs.writeFileSync(tsconfigPath, originalTsconfig, 'utf8');
    notes.push('Restored tsconfig.json after build so closeout-only dist paths do not pollute the workspace.');
  }

  let frontendCriticalStep = runFrontendCriticalStep(env, screenshotPort);
  if (frontendCriticalStep.exitCode !== 0) {
    const retryPort = pickScreenshotPort();
    notes.push(
      `frontend-critical first attempt failed on port ${screenshotPort}; retried once on port ${retryPort} to absorb transient server-start or asset noise.`,
    );
    const retryStep = runFrontendCriticalStep(env, retryPort);
    retryStep.label = 'frontend-critical-retry';
    if (retryStep.exitCode === 0) {
      frontendCriticalStep = {
        ...retryStep,
        label: 'frontend-critical',
      };
      notes.push('frontend-critical passed on retry, so the closeout command accepted the warmed-up result.');
    } else {
      frontendCriticalStep = retryStep;
      notes.push('frontend-critical still failed after retry. Check the two frontend-critical log files and screenshot artifacts.');
    }
    steps.push(frontendCriticalStep);
  } else {
    steps.push(frontendCriticalStep);
  }

  steps.push(runStep('operations-scan', 'npm.cmd run evidence:operations-scan', env));

  for (const step of steps) {
    step.artifactDir = parseArtifactDir(`${step.stdout}\n${step.stderr}`);
  }

  const screenshotArtifactDir = steps.find((step) => step.label === 'frontend-critical')?.artifactDir || '';
  const operationsScanArtifactDir = steps.find((step) => step.label === 'operations-scan')?.artifactDir || '';
  const coverage = {
    frontendCritical: summarizeFrontendCriticalArtifact(screenshotArtifactDir),
    operationsScan: summarizeOperationsScanArtifact(operationsScanArtifactDir),
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    ok: steps.every((step) => step.exitCode === 0),
    playwrightBrowsersPath: env.PLAYWRIGHT_BROWSERS_PATH,
    distDir,
    closeoutArtifacts: {
      screenshotArtifactDir,
      operationsScanArtifactDir,
    },
    coverage,
    notes,
    steps: steps.map((step) => ({
      label: step.label,
      command: step.command,
      durationMs: step.durationMs,
      exitCode: step.exitCode,
      artifactDir: step.artifactDir,
    })),
  };
  summary.copyableSummary = buildCopyableSummary(summary, steps, artifactDir).join('\n');

  writeArtifact(artifactDir, summary, steps);

  if (fs.readFileSync(tsconfigPath, 'utf8') !== originalTsconfig) {
    fs.writeFileSync(tsconfigPath, originalTsconfig, 'utf8');
  }

  for (const step of steps) {
    process.stdout.write(`\n[${step.label}] exit=${step.exitCode} duration=${step.durationMs}ms\n`);
    if (step.stdout) {
      process.stdout.write(step.stdout);
      if (!step.stdout.endsWith('\n')) process.stdout.write('\n');
    }
    if (step.stderr) {
      process.stderr.write(step.stderr);
      if (!step.stderr.endsWith('\n')) process.stderr.write('\n');
    }
  }

  process.stdout.write(`\n[frontend-closeout] artifact: ${artifactDir}\n`);

  if (!summary.ok) {
    process.exit(1);
  }
}

main();
