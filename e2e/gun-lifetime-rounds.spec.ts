import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// A1: the Gun form lets the shooter set a gun's LIFETIME round count directly,
// as well as the "rounds fired before FirearmLog" starting count. The two are
// two views of one number (lifetime = start + rounds logged here; dry fire never
// counts). Setting the lifetime writes the right starting count, so the gun's
// own page then shows exactly that lifetime.

test.describe('Gun form: lifetime-aware round editing', () => {
  test('setting "Lifetime rounds (total)" makes the gun page show that lifetime', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');

    // Open the first gun, then edit it.
    await page.getByRole('main').locator('.card .row-tap').first().click();
    await page.locator('.navbar-action', { hasText: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Gun' })).toBeVisible();

    // The lifetime + starting-count fields live behind "More details".
    await page.getByRole('button', { name: /More details/ }).click();

    // Set a lifetime comfortably above anything already logged, so the entry is
    // not clamped. { exact: true }: "Lifetime rounds (total)" would otherwise
    // also loosely match the read-only "Lifetime rounds right now" note.
    const lifetime = page.getByLabel('Lifetime rounds (total)', { exact: true });
    await expect(lifetime).toBeVisible();
    await lifetime.fill('88000');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();

    // Back on the gun's detail: its lifetime stat reads exactly 88,000 — proof
    // the starting count was set to (88,000 − rounds already logged).
    await expect(page.getByRole('main').getByText('88,000')).toBeVisible();
  });

  test('a lifetime below the logged count clamps: note shows, starting count reads 0, gun keeps its logged lifetime', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Guns');

    await page.getByRole('main').locator('.card .row-tap').first().click();
    await page.locator('.navbar-action', { hasText: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Gun' })).toBeVisible();
    await page.getByRole('button', { name: /More details/ }).click();

    const lifetime = page.getByLabel('Lifetime rounds (total)', { exact: true });
    const startCount = page.getByLabel('Rounds fired before FirearmLog', { exact: true });
    await expect(lifetime).toBeVisible();

    // Enter a lifetime below anything already logged (the 18-month demo gun has
    // thousands of rounds). 1 is guaranteed under that floor, so it clamps.
    // The clamp + snap fires on BLUR, not per keystroke (so select-all-and-retype
    // isn't corrupted), so leave the field before asserting the reconciled state.
    await lifetime.fill('1');
    await lifetime.blur();

    // The plain-language clamp note appears...
    await expect(page.getByText(/you've already logged/i)).toBeVisible();
    // ...the starting-count box snaps to 0 (what a save would actually store)...
    await expect(startCount).toHaveValue('0');
    // ...and the lifetime box itself snaps back up to the logged floor, so both
    // boxes show exactly what will save. Capture that floor to check the detail.
    const clampedLifetime = await lifetime.inputValue();
    expect(Number(clampedLifetime)).toBeGreaterThan(1);
    const expectedShown = Number(clampedLifetime).toLocaleString('en-US');

    await page.getByRole('button', { name: 'Save changes', exact: true }).click();

    // Back on the gun's detail: the lifetime stat equals the logged-rounds floor —
    // starting count was saved as 0, so lifetime = rounds already logged.
    const lifetimeStat = page.locator('.stat', { hasText: 'Lifetime rounds (live fire)' }).locator('.num');
    await expect(lifetimeStat).toHaveText(expectedShown);
  });
});
