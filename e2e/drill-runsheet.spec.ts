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

// s147, Michael: "drill notes do not appear on session report. All notes
// should be printed on session reports." Proved red on the old report (the
// Drills table had no Notes column) and green with it.
test('a drill note typed on the session form is printed on the Session Report', async ({ page }) => {
  await seedDemo(page);
  await gotoTab(page, 'Log');
  await page.getByRole('button', { name: '+ Log Session' }).click();
  const gunsCard = page.getByTestId('session-guns-card');
  await gunsCard.locator('button.gun-toggle').first().click();
  await gunsCard.getByRole('spinbutton').first().fill('30');
  await page.getByRole('button', { name: '+ Add Drill' }).click();
  await page.locator('.drill-pick-row').first().click();
  await page.getByRole('button', { name: /Add 1 Drill/ }).click();
  await page.getByLabel('Drill notes').first().fill('Index drifting left on the reload');
  await page.locator('.navbar-action').click();
  await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

  await page.getByRole('main').locator('.row-tap').first().click();
  await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Session Report' }).click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  const drillsSec = popup.locator('.sec', { has: popup.locator('.sec-title', { hasText: 'Drills' }) });
  await expect(drillsSec.locator('th', { hasText: 'Notes' })).toBeVisible();
  await expect(drillsSec).toContainText('Index drifting left on the reload');
  await popup.close();
});
