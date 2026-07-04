import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// The Home headline tiles get a rolling range (All time / 12 mo / 6 mo) that scopes
// the "Live-fire rounds" and "Sessions" tiles. The caption gains a "· N mo" suffix when
// a window is chosen, and clears back on "All time".

test.describe('Home stat range', () => {
  test('the range toggle scopes the Live-fire rounds & Sessions tiles', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Home');

    // Default: all time — no suffix.
    await expect(page.getByText('Live-fire rounds', { exact: true })).toBeVisible();
    await expect(page.getByText('Live-fire rounds · 12 mo')).toHaveCount(0);

    // Choose a 12-month window.
    await page.getByLabel('Rounds & sessions').selectOption('12');
    await expect(page.getByText('Live-fire rounds · 12 mo')).toBeVisible();
    await expect(page.getByText('Sessions · 12 mo')).toBeVisible();

    // Back to all time — the suffix clears.
    await page.getByLabel('Rounds & sessions').selectOption('all');
    await expect(page.getByText('Live-fire rounds · 12 mo')).toHaveCount(0);
    await expect(page.getByText('Live-fire rounds', { exact: true })).toBeVisible();
  });
});
