const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const localBrowsers = path.join(root, '.playwright-browsers');
const playwrightCli = require.resolve('@playwright/test/cli');
const cleanScript = path.join(root, 'scripts', 'clean-next-artifacts.cjs');

const cleanResult = spawnSync(process.execPath, [cleanScript], {
  cwd: root,
  stdio: 'inherit',
});

if (cleanResult.status !== 0) {
  console.error('[owned-surfaces-smoke] failed to clean Next artifacts before smoke run');
  process.exit(cleanResult.status ?? 1);
}

const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', 'e2e/ai-frontend-owned-surfaces.spec.ts', '--reporter=line'],
  {
    cwd: root,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || localBrowsers,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error('[owned-surfaces-smoke] failed to start Playwright:', result.error.message);
}

if (result.signal) {
  console.error(`[owned-surfaces-smoke] Playwright exited via signal ${result.signal}`);
}

process.exit(result.status ?? 1);
