import { expect, test, type Page } from '@playwright/test';

const MOCK_TOKEN = 'mock_jwt_demo';

async function seedDemoAuth(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem('clawcommerce_token', token);
    localStorage.setItem('clawcommerce_demo_mode', '1');
  }, MOCK_TOKEN);
}

async function enterDemo(page: Page, path = '/') {
  await seedDemoAuth(page);
  await page.goto(path);
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('clawcommerce_token')))
    .toBeTruthy();
}

test.describe('Week3 core journeys', () => {
  test('login -> dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('账号').fill('demo');
    await page.getByLabel('密码').fill('demo');
    await page.locator('button[type="submit"]').click();
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('clawcommerce_token')))
      .toBeTruthy();
    await page.goto('/');
    await expect(page.getByText('queue.process.fail')).toBeVisible();
  });

  test('fleet dispatch action opens drawer and submits command', async ({ page }) => {
    await enterDemo(page, '/fleet');
    await expect(page).toHaveURL(/\/fleet$/);

    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();
    const offlineButton = firstRow.getByRole('button').first();
    await expect(offlineButton).toBeVisible();
    await offlineButton.click();
    await expect(firstRow).toBeVisible();
  });

  test('campaign create flow redirects to list', async ({ page }) => {
    await enterDemo(page, '/campaigns/new');
    await expect(page).toHaveURL(/\/campaigns\/new$/);

    await page.locator('textarea').fill('https://v.douyin.com/abc\nhttps://v.douyin.com/def');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/campaigns');
    await expect(page).toHaveURL(/\/campaigns$/);
  });

  test('manual mission launch posts /api/campaigns', async ({ page }) => {
    await enterDemo(page, '/missions/manual-publish');
    await expect(page).toHaveURL(/\/missions\/manual-publish$/);

    const selectableNode = page.locator('li input[type="checkbox"]:not(:disabled)').first();
    await expect(selectableNode).toBeVisible();
    await selectableNode.check();

    const launchButton = page.getByRole('button', { name: /SOP/i });
    await expect(launchButton).toBeVisible();

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/campaigns') &&
        resp.request().method() === 'POST',
    );
    await launchButton.click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
  });
});
