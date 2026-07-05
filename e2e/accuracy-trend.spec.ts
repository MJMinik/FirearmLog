import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Phase 2 — the Speed & Accuracy TREND in Progress. Two USPSA matches with a hit
// breakdown are enough to draw the accuracy line; the section stays hidden below that.
// (The "consistently clean" trend remark's 3-match logic is covered by unit tests.)

async function cleanMatch(page: import('@playwright/test').Page, alphas: number) {
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await page.getByLabel('What this match is called').fill(`Trend ${alphas}`);
  await page.getByRole('button', { name: '+ Add Stage' }).click();
  const b = page.locator('.drill-edit').first();
  await b.getByRole('button', { name: '+ Add hit breakdown (A/C/D/miss)' }).click();
  await b.getByLabel('Alphas (A)', { exact: true }).fill(String(alphas));
  await page.getByRole('button', { name: 'Save match' }).click();
  await expect(page.getByRole('heading', { name: `Trend ${alphas}` })).toBeVisible();
}

test.describe('Speed & Accuracy trend (Progress)', () => {
  test('USPSA matches with a breakdown render the accuracy trend in Progress', async ({ page }) => {
    await seedDemo(page);
    await cleanMatch(page, 10);
    await cleanMatch(page, 12);

    await gotoTab(page, 'Progress');
    await expect(page.getByRole('heading', { name: 'Accuracy across matches' })).toBeVisible();
    await expect(page.getByText(/Points kept —/)).toBeVisible();
  });
});
