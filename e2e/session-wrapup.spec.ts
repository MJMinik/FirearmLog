import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Cold-audit regression pin (session 78, High — new data-loss path). The
// Wrap-Up Reveal's "force open on error" driver (wrapUpOpen) only forced the
// section open the FIRST time it flipped true; a second failed save that set
// it to the same value was a no-op, so a Wrap-Up the shooter had manually
// re-collapsed stayed collapsed on every save after the first — hiding the
// rangeFee error entirely (it's excluded from the top form-problem banner)
// and leaving Cancel offering only Discard. Fixed via Reveal's forceOpenKey
// (a counter that bumps on every failed save targeting rangeFee, so the
// effect always has a fresh value to react to).

const GUN = 'Shadow Systems DR920';

test.describe('Wrap-Up re-opens on every failed save, not just the first', () => {
  test('a negative fee keeps reopening Wrap-Up with its error, however many times it is collapsed', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('50');

    const wrapUpToggle = page.getByRole('button', { name: 'Wrap-Up' });
    await wrapUpToggle.click();
    await page.getByLabel(/Range fee/).fill('-20');

    // First failed save: the error shows and the section is open (already
    // covered behavior, but set up the scenario the same way as the bug).
    await page.locator('.navbar-action').click();
    await expect(page.locator('#session-rangefee-err')).toBeVisible();
    await expect(page.getByLabel(/Range fee/)).toBeVisible();

    // Collapse Wrap-Up via its own toggle — a normal user action, not a bug.
    await wrapUpToggle.click();
    await expect(page.getByLabel(/Range fee/)).toHaveCount(0);

    // Save again with the same bad fee still in state: THE regression pin —
    // the section must reopen with the error visible again, not silently
    // fail with no field, no banner, and only Discard on Cancel.
    await page.locator('.navbar-action').click();
    await expect(page.getByLabel(/Range fee/)).toBeVisible();
    await expect(page.locator('#session-rangefee-err')).toBeVisible();
    await expect(page.locator('#session-rangefee-err')).toContainText('dollar amount');

    // Fix the fee and save — it goes through.
    await page.getByLabel(/Range fee/).fill('20');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen and confirm the fixed fee actually persisted.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    // An existing session with a saved fee loads Wrap-Up already open.
    await expect(page.getByLabel(/Range fee/)).toHaveValue('20');
  });
});
