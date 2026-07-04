import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';

// Per-drill history (T3-2): two doors — a Personal Record on Progress, and the
// Drills library — both open one drill's history (best + trend + every run),
// and each run drills into its session. Read-only view; runs on the seeded demo
// (165 sessions of drills) on both the phone and desktop layouts.

test.describe('Per-drill history', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  test('Door 2 — a Personal Record opens the history and drills into a session', async ({ page }) => {
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Personal Records' })).toBeVisible();

    // The record rows are the tappable .pr-row buttons; open the first.
    await main.locator('button.pr-row').first().click();

    // History screen: the demo's recorded drills have runs, so the list shows.
    await expect(page.getByRole('heading', { name: 'Every Run' })).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    // Tapping a run opens the session it came from.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: /Session/ }).first()).toBeVisible();
  });

  test('Door 1 — the Drills library opens a drill\'s history', async ({ page }) => {
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');

    // Expand the first drill in the library, then open its history.
    await main.locator('.card .row-tap').first().click();
    await main.getByRole('button', { name: /View your history/ }).first().click();

    // Land on the history screen — the runs list, or the empty state for a
    // drill that's never been logged. Either way, no crash.
    await expect(page.getByText(/Every Run|haven't logged this drill/)).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});
