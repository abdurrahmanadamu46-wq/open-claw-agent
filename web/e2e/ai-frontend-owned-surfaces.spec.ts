import { expect, test, type Page } from '@playwright/test';

const MOCK_TOKEN = 'mock_jwt_demo';

const OWNED_SURFACES = [
  { path: '/collab', label: 'collab overview' },
  { path: '/collab/reports', label: 'collab reports' },
  { path: '/collab/approvals', label: 'collab approvals' },
  { path: '/lobsters/strategist/capabilities', label: 'strategist capability tree' },
  { path: '/operations/frontend-gaps', label: 'frontend QA checklist' },
];

async function seedDemoAuth(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem('clawcommerce_token', token);
    localStorage.setItem('clawcommerce_demo_mode', '1');
  }, MOCK_TOKEN);
}

test.describe('AI frontend owned surfaces smoke', () => {
  for (const surface of OWNED_SURFACES) {
    test(`${surface.label} renders a non-blank shell`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      await seedDemoAuth(page);
      await page.goto(surface.path, { waitUntil: 'domcontentloaded' });

      await expect(page).toHaveURL(new RegExp(`${surface.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\?)`));
      await expect(page.locator('body')).toBeVisible();

      const bodyText = await page.locator('body').innerText({ timeout: 15_000 });
      expect(bodyText.trim().length, `${surface.label} should not render a blank body`).toBeGreaterThan(40);
      expect(bodyText).not.toContain('Application error');
      expect(bodyText).not.toContain('Unhandled Runtime Error');
      expect(bodyText).not.toContain('This page could not be found');
      expect(pageErrors, `${surface.label} should not throw page errors`).toEqual([]);
    });
  }
});
