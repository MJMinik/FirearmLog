import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// App 5a (owner decision): Wrap-Up re-layout — Notes is now ALWAYS visible in
// the card (no Reveal to open first); only the range fee sits behind a
// Reveal labeled "Range fee". The section's "force open on error" driver
// (wrapUpOpen/wrapUpForceKey) now targets that Range fee Reveal specifically.
//
// Cold-audit regression pin (session 78, High — new data-loss path), carried
// forward under the new shape: the force-open driver only forced the Reveal
// open the FIRST time it flipped true; a second failed save that set it to
// the same value was a no-op, so a Reveal the shooter had manually
// re-collapsed stayed collapsed on every save after the first — hiding the
// rangeFee error entirely (it's excluded from the top form-problem banner)
// and leaving Cancel offering only Discard. Fixed via Reveal's forceOpenKey
// (a counter that bumps on every failed save targeting rangeFee, so the
// effect always has a fresh value to react to).

const GUN = 'Shadow Systems DR920';

test.describe('Wrap-Up: Notes always visible; Range fee reveal re-opens on every failed save', () => {
  test('Notes needs zero extra taps; a negative fee keeps reopening its own Reveal with the error, however many times it is collapsed', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('50');

    // Notes is reachable with no taps — it's not behind any Reveal.
    const notesField = page.getByLabel('Notes');
    await expect(notesField).toBeVisible();
    await notesField.fill('Great session, tight groups.');

    const feeToggle = page.getByRole('button', { name: 'Range fee' });
    await feeToggle.click();
    await page.getByLabel(/Range fee/).fill('-20');

    // First failed save: the error shows and the section is open (already
    // covered behavior, but set up the scenario the same way as the bug).
    await page.locator('.navbar-action').click();
    await expect(page.locator('#session-rangefee-err')).toBeVisible();
    await expect(page.getByLabel(/Range fee/)).toBeVisible();

    // Collapse the Range fee Reveal via its own toggle — a normal user
    // action, not a bug. Notes must stay visible regardless.
    await feeToggle.click();
    await expect(page.getByLabel(/Range fee/)).toHaveCount(0);
    await expect(notesField).toBeVisible();
    await expect(notesField).toHaveValue('Great session, tight groups.');

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

    // Reopen and confirm the fixed fee AND the note actually persisted.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    // An existing session with a saved fee loads the Range fee reveal already open.
    await expect(page.getByLabel(/Range fee/)).toHaveValue('20');
    await expect(page.getByLabel('Notes')).toHaveValue('Great session, tight groups.');
  });

  // Cold-audit fix (Low): App 5a changed the Range fee reveal's defaultOpen
  // rule to key on the fee ALONE (Notes no longer factors in, since Notes is
  // always visible now). The negative case — a saved session with notes but
  // NO fee — must load with the Range fee reveal CLOSED; the old rule (fee
  // OR notes) would have opened it just because a note existed.
  test('a saved session with notes but no fee loads with the Range fee reveal closed', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('50');

    // Fill Notes only — leave the range fee untouched (blank).
    const notesField = page.getByLabel('Notes');
    await notesField.fill('No range fee this time, just notes.');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen: Notes shows the saved text with no taps, but the Range fee
    // reveal is collapsed — a note alone must not force it open.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await expect(page.getByLabel('Notes')).toHaveValue('No range fee this time, just notes.');
    const feeToggle = page.getByRole('button', { name: 'Range fee' });
    await expect(feeToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel(/Range fee/)).toHaveCount(0);
  });
});
