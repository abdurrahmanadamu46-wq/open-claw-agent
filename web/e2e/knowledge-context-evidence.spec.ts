import { expect, test, type Page } from '@playwright/test';

const MOCK_TOKEN = 'mock_jwt_demo';

async function seedDemoAuth(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem('clawcommerce_token', token);
    localStorage.setItem('clawcommerce_demo_mode', '1');
  }, MOCK_TOKEN);
}

test.describe('Knowledge context evidence', () => {
  test('strategy task result surfaces three-layer runtime knowledge evidence', async ({ page }) => {
    await seedDemoAuth(page);
    await page.goto('/operations/strategy');

    await page.getByTestId('strategy-preview-submit').click();
    await expect(page.getByRole('heading', { name: '确认提交' })).toBeVisible();
    await page.getByTestId('strategy-confirm-submit').click();

    await expect(page.getByTestId('knowledge-context-evidence')).toBeVisible();
    await expect(page.getByText('Runtime knowledge evidence')).toBeVisible();
    await expect(page.getByText('Platform common').first()).toBeVisible();
    await expect(page.getByText('Platform industry').first()).toBeVisible();
    await expect(page.getByText('Tenant private').first()).toBeVisible();
    await expect(page.getByText(/tenant_private summaries:\s*3/)).toBeVisible();
    await expect(page.getByText('raw traces')).toBeVisible();
    await expect(page.getByText('excluded')).toBeVisible();
    await expect(page.getByText('summary only')).toBeVisible();
    await expect(page.getByText('platform backflow')).toBeVisible();
    await expect(page.getByText('blocked')).toBeVisible();
  });

  test('workflow board resolves knowledge layers without exposing raw collab bodies', async ({ page }) => {
    await seedDemoAuth(page);
    await page.goto('/operations/workflow-board');

    await expect(page.getByText('Workflow knowledge resolve preview')).toBeVisible();
    await expect(page.getByText('Platform common').first()).toBeVisible();
    await expect(page.getByText('Platform industry').first()).toBeVisible();
    await expect(page.getByText('Tenant private').first()).toBeVisible();
    await expect(page.getByText(/tenant_private summaries:\s*3/)).toBeVisible();
    await expect(page.getByText('raw allowed')).toHaveCount(0);
  });
});
