import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Tester-2 F4 (July 16 2026): a NEW session must start UNRATED. New sessions
// used to initialize the "how it felt" ratings to 5/5/5, so an untouched form
// was indistinguishable from a real all-5 session — a data-integrity leak. Now
// the fields start blank ("—") and an untouched field stores no rating at all.

test.describe('New session ratings start blank, not 5', () => {
  test('logging without touching the ratings leaves them blank on reopen', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    // Log a minimal session — pick a gun, set rounds, DO NOT open/touch ratings.
    await page.getByRole('button', { name: '+ Log Session' }).click();
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the session we just logged (newest row at the top of the list).
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByTestId('session-guns-card')).toBeVisible();

    // Expand the ratings section and confirm every field is blank (not 5).
    await page.getByRole('button', { name: /Rate how it felt/ }).click();
    for (const label of ['focus', 'fundamentals', 'satisfaction']) {
      await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
    }
  });
});
