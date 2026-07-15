import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// Hard-gate (session 35): "Clear all data / Start over" on Tour & Setup wipes
// every store, guarded by a typed "erase" confirmation. After the wipe the app
// reloads to an empty log, which returns to first-run (the Setup Wizard). This
// is the danger-zone flow, so it gets an explicit end-to-end check on CI.
test.describe('Clear all data / Start over', () => {
  test('typed "erase" wipes everything and returns to first-run', async ({ page }) => {
    await seedDemo(page); // real data present (demo guns/sessions/etc.)

    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('button', { name: 'Clear all data' }).click();

    // The guard sheet is up; the destructive button is disabled until "erase" is typed.
    // exact: the card heading is now "Clear all data / Start over", so match only
    // the confirmation sheet's exact "Clear all data" heading (avoids a strict-mode
    // clash between the two).
    await expect(page.getByRole('heading', { name: 'Clear all data', exact: true })).toBeVisible();
    const erase = page.getByRole('button', { name: 'Erase everything' });
    await expect(erase).toBeDisabled();

    await page.getByPlaceholder('erase').fill('erase');
    await expect(erase).toBeEnabled();
    await erase.click();

    // The wipe reloads to an empty log → the Setup Wizard auto-opens (guns === 0).
    await expect(page.getByRole('heading', { name: 'Set up your log' })).toBeVisible({ timeout: 20_000 });
  });
});
