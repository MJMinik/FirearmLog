import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// App 3b — the dedicated Malfunctions list: it lists logged malfunctions, can be
// filtered, and each row drills into the session it happened in. Demo data ships
// with a handful of malfunctions, so there are rows to work with.

test.describe('Malfunctions list (App 3b)', () => {
  test('lists malfunctions, filters by type, and a row opens its session', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Malfunctions');

    await expect(page.getByRole('heading', { name: 'Malfunctions' }).first()).toBeVisible();
    const rows = page.getByRole('main').locator('.row-tap');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();

    // Narrow by the first available type.
    await page.getByRole('button', { name: /Search & Filter/ }).click();
    const typeSelect = page.locator('label', { hasText: 'Type' }).locator('select');
    const firstType = await typeSelect.locator('option').nth(1).getAttribute('value');
    await typeSelect.selectOption(firstType!);
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByText(/Showing \d+ of \d+/)).toBeVisible();
    const narrowed = await page.getByRole('main').locator('.row-tap').count();
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThanOrEqual(total);

    // Clear the filter, then tap a row — it opens that session for editing.
    await page.getByRole('button', { name: 'Clear' }).first().click();
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
  });
});
