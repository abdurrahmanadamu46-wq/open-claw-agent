import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT || 3001);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const USE_EXTERNAL_SERVER = process.env.PW_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: USE_EXTERNAL_SERVER
    ? undefined
    : {
        command: 'npm run dev -- -H 127.0.0.1',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          NEXT_PUBLIC_USE_MOCK: 'true',
          NEXT_PUBLIC_RUNTIME_ENV: 'development',
          NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK: 'true',
          NEXT_PUBLIC_API_BASE_URL: '',
        },
      },
});
