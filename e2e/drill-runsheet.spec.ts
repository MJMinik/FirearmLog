import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// App 1 — the "Print Drills" run-sheet. A planned session prints a blank score
// table (boxes to fill in at the range). Verified in a real browser, including
// the print popup. Runs on desktop + phone.

test.describe('Drill run-sheet (App 1)', () => {
  test('a planned session prints a blank drill score sheet', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Plan Session' }).click();

    // Add a drill (no gun needed — the picker shows all live-fire drills).
    await page.getByRole('button', { name: '+ Add Drill' }).click();
    await page.locator('.drill-pick-row').first().click();
    await page.getByRole('button', { name: /Add 1 Drill/ }).click();

    // Print Drills opens the run-sheet in a popup window.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'Print Drills' }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.getByText('Drills for this session')).toBeVisible();
    await expect(popup.getByText('Fill in your results at the range')).toBeVisible();
    await expect(popup.locator('.box').first()).toBeVisible(); // blank fill-in box
    await popup.close();
  });
});
