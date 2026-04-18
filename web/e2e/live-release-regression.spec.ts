import { expect, test, type Page, type Response } from '@playwright/test';

const USERNAME = process.env.E2E_LIVE_USERNAME ?? 'admin';
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? 'change_me';
const WAIT_TIMEOUT_MS = 45_000;

function waitForApiResponse(page: Page, matcher: (response: Response) => boolean) {
  return page.waitForResponse(
    (response) => matcher(response),
    { timeout: WAIT_TIMEOUT_MS },
  );
}

async function assertHttpOk(response: Response, label: string) {
  const status = response.status();
  if (status >= 400) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '<unavailable>';
    }
    throw new Error(`${label} failed with status=${status} body=${body.slice(0, 400)}`);
  }
}

test.describe('Live release regression (real chain)', () => {
  test('login -> dashboard -> campaign create -> fleet dispatch -> leads reveal', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    const loginRespPromise = waitForApiResponse(
      page,
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/auth/login'),
    );
    await page.getByTestId('login-submit').click();
    const loginResp = await loginRespPromise;
    await assertHttpOk(loginResp, 'POST /auth/login');

    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('clawcommerce_token')), {
        timeout: WAIT_TIMEOUT_MS,
      })
      .not.toBeNull();
    await page.goto('/');
    await expect(page).toHaveURL(/\/($|\?)/);

    const dashboardResp = await waitForApiResponse(
      page,
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/v1/dashboard/metrics'),
    );
    await assertHttpOk(dashboardResp, 'GET /api/v1/dashboard/metrics');
    await expect(page.getByTestId('dashboard-root')).toBeVisible();

    await page.goto('/campaigns/new');
    await page.getByTestId('campaign-new-account-name').fill('直播主号');
    await page.getByTestId('campaign-new-target-niche').fill('同城餐饮');
    await page.getByTestId('campaign-new-notes').fill('live regression flow');
    const createCampaignRespPromise = waitForApiResponse(
      page,
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/v1/campaigns'),
    );
    await page.getByTestId('campaign-new-submit').click();
    const createCampaignResp = await createCampaignRespPromise;
    await assertHttpOk(createCampaignResp, 'POST /api/v1/campaigns');
    await page.waitForURL('**/campaigns');
    await expect(page.getByTestId('campaigns-table')).toBeVisible();

    await page.goto('/fleet');
    const fleetNodesResp = await waitForApiResponse(
      page,
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/v1/fleet/nodes'),
    );
    await assertHttpOk(fleetNodesResp, 'GET /api/v1/fleet/nodes');
    await expect(page.getByTestId('fleet-table')).toBeVisible();
    const dispatchButton = page.locator('[data-testid^="fleet-dispatch-"]:not([disabled])').first();
    await expect(dispatchButton).toBeVisible();
    const dispatchRespPromise = waitForApiResponse(
      page,
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/v1/fleet/commands'),
    );
    await dispatchButton.click();
    const dispatchResp = await dispatchRespPromise;
    await assertHttpOk(dispatchResp, 'POST /api/v1/fleet/commands');

    await page.goto('/leads');
    const leadsResp = await waitForApiResponse(
      page,
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/v1/leads'),
    );
    await assertHttpOk(leadsResp, 'GET /api/v1/leads');
    await expect(page.getByTestId('leads-table')).toBeVisible();
    const detailButton = page.locator('[data-testid^="lead-detail-"]').first();
    await expect(detailButton).toBeVisible();
    await detailButton.click();
    await expect(page.getByTestId('lead-detail-sheet')).toBeVisible();

    const revealRespPromise = waitForApiResponse(
      page,
      (response) =>
        response.request().method() === 'GET' &&
        /\/api\/v1\/leads\/.+\/reveal/.test(response.url()),
    );
    await page.getByTestId('lead-reveal-button').click();
    const revealResp = await revealRespPromise;
    await assertHttpOk(revealResp, 'GET /api/v1/leads/:leadId/reveal');
  });
});
