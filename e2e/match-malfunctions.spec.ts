import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// Log a malfunction from a match (spec: session 126, 18 Aug 2026). Michael's
// Gun Craft match Monday (17 Aug) produced several hammer-down stoppages with
// no proper home -- MalfunctionEntry.matchId shipped display-only in the
// match-mags build (decision 4a rider: "no way to set matchId anywhere in the
// app yet"). This build gives the match form its own "Log a malfunction"
// section (mirroring SessionForm's, minus the "Which gun" picker -- a match
// has exactly one gun) and makes a match-linked row on the Malfunctions
// screen open its match instead of sitting dead.

const GUN = 'Shadow Systems DR920';

/** Start a new match from the Compete tab, named and with `gun` picked --
 *  mirrors match-mags.spec.ts. */
async function startNewMatch(page: Page, name: string, gun: string = GUN): Promise<void> {
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();
  await page.getByLabel('What this match is called').fill(name);
  await page.locator('#match-gun-select').selectOption({ label: gun });
}

/** The navbar Save button -- exactly "Save" on both Log Match and Edit Match. */
async function clickSave(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

/** Open the malfunctions Reveal on the match form, add a row, and fill its
 *  type + clear method -- the same taps the session form's section takes. */
async function addMalfunction(page: Page, type: string, clearMethod: string): Promise<void> {
  const card = page.getByTestId('match-malfs-card');
  await card.getByRole('button', { name: 'Log a malfunction', exact: true }).click();
  await card.getByRole('button', { name: '+ Add Malfunction' }).click();
  await card.locator('label', { hasText: 'What happened' }).locator('select').selectOption(type);
  await card.locator('label', { hasText: 'How you cleared it' }).locator('select').selectOption(clearMethod);
}

test.describe('Log a malfunction from a match (session 126)', () => {
  test('logging one on a new match shows it on the Malfunctions screen and opens the match', async ({ page }) => {
    await seedDemo(page);
    await startNewMatch(page, 'Gun Craft Match');
    await addMalfunction(page, 'Failure to feed', 'Tap-Rack-Bang');
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Gun Craft Match' })).toBeVisible();

    // The detail card's read-only Malfunctions row.
    const malfRow = page.locator('.row', { hasText: 'Malfunctions' });
    await expect(malfRow).toBeVisible();
    await expect(malfRow.locator('.value')).toHaveText('1 · Failure to feed');

    // The Malfunctions screen: the row carries the MATCH's name, and tapping
    // it opens the match (not a session -- there is none to open).
    await gotoSection(page, 'Malfunctions');
    const row = page.getByRole('main').locator('.row-tap', { hasText: 'Gun Craft Match' });
    await expect(row).toBeVisible();
    // Tests-constrain audit, gap 1: the row's sub-line renders the saved
    // record's GUN and DATE -- assert both, or a persist writing date:'' /
    // firearmId:'' passes every test in this file unnoticed.
    await expect(row).toContainText(GUN);
    await expect(row).not.toContainText('No date');
    await row.click();
    await expect(page.getByRole('heading', { name: 'Gun Craft Match' })).toBeVisible();
  });

  test('edit round-trip: removing the row clears it from the Malfunctions screen and the detail card', async ({ page }) => {
    await seedDemo(page);
    await startNewMatch(page, 'Hammer Down Match');
    await addMalfunction(page, 'Failure to fire', 'Manual clear');
    const formCard = page.getByTestId('match-malfs-card');
    await formCard.locator('label', { hasText: /^Magazine/ }).locator('select').selectOption({ label: 'DR9-2' });
    await formCard.locator('input[type="number"]').fill('47');
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Hammer Down Match' })).toBeVisible();
    await expect(page.locator('.row', { hasText: 'Malfunctions' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Match' })).toBeVisible();
    // The Reveal opens itself (defaultOpen: editing && malfs.length > 0),
    // same as SessionForm's -- the saved row is right there, no extra tap.
    const card = page.getByTestId('match-malfs-card');
    await expect(card.locator('.drill-edit-head strong')).toHaveText('Failure to fire');
    // Tests-constrain audit, gaps 2+3: the reloaded row carries the saved
    // resolution, magazine and round number -- the non-null branches of the
    // edit-load mapping, which no other test reaches. Without these, a
    // persist writing resolution:'' or an edit-load always mapping to ''
    // passes the whole file.
    await expect(card.locator('label', { hasText: 'How you cleared it' }).locator('select')).toHaveValue('Manual clear');
    await expect(card.locator('label', { hasText: /^Magazine/ }).locator('select')).toHaveValue(/.+/);
    await expect(card.locator('input[type="number"]')).toHaveValue('47');
    await card.getByRole('button', { name: 'Remove malfunction' }).click();
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Hammer Down Match' })).toBeVisible();
    await expect(page.locator('.row', { hasText: 'Malfunctions' })).toHaveCount(0);

    await gotoSection(page, 'Malfunctions');
    await expect(page.getByRole('main').locator('.row-tap', { hasText: 'Hammer Down Match' })).toHaveCount(0);
  });

  test('deleting a match takes its malfunction rows with it (audit F1)', async ({ page }) => {
    // Match deletion is PERMANENT -- no Recently Deleted, unlike sessions --
    // so an orphaned row would inflate the malfunction-rate trend forever
    // while its tap pointed at a match that no longer exists.
    await seedDemo(page);
    await startNewMatch(page, 'Doomed Match');
    await addMalfunction(page, 'Stovepipe', 'Manual clear');
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Doomed Match' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete match' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete match' }).click();
    await expect(page.getByRole('heading', { name: 'Doomed Match' })).toHaveCount(0);

    await gotoSection(page, 'Malfunctions');
    const rows = page.getByRole('main').locator('.row-tap');
    await expect(rows.first()).toBeVisible(); // the seeded session rows
    await expect(rows.filter({ hasText: 'Stovepipe' })).toHaveCount(0);
  });

  test('switching the gun clears each malfunction row\'s magazine (audit F2)', async ({ page }) => {
    // The row's other fields survive a gun switch (the stoppage still
    // happened); the MAG reference is gun-specific and silently keeping it
    // would save a gun-B record blaming a gun-A magazine.
    await seedDemo(page);
    await startNewMatch(page, 'Gun Switch Match');
    // Tests-constrain audit, gap 4: prove magsPickedFirst is actually WIRED,
    // not just unit-tested -- pick DR9-2 in the match's own mag picker, and
    // the malfunction row's dropdown must list it FIRST, ahead of the
    // natural-order DR9-1. Deleting the magsPickedFirst call breaks this.
    const magSection = page.locator('.session-mags');
    await expect(magSection).toBeVisible();
    await magSection.locator('.checklist-disclosure').click();
    await magSection.getByRole('button', { name: 'DR9-2' }).click();
    await addMalfunction(page, 'Failure to feed', 'Tap-Rack-Bang');
    const card = page.getByTestId('match-malfs-card');
    const magSelect0 = card.locator('label', { hasText: /^Magazine/ }).locator('select');
    await expect(magSelect0.locator('option').nth(1)).toHaveText(/DR9-2/);
    await magSelect0.selectOption({ label: 'DR9-1' });

    // Switch to any other pickable gun -- picked dynamically, the same way
    // match-mags.spec.ts does, since this file has no second hardcoded name.
    const gunSelect = page.locator('#match-gun-select');
    const other = await gunSelect.locator('option:not([value=""])').all();
    for (const opt of other) {
      const label = await opt.textContent();
      if (label && label.trim() !== GUN) { await gunSelect.selectOption({ label: label.trim() }); break; }
    }
    await expect(gunSelect).not.toHaveValue('');

    // The type survives; the magazine reference is gone.
    await expect(card.locator('.drill-edit-head strong')).toHaveText('Failure to feed');
    const magSelect = card.locator('label', { hasText: /^Magazine/ }).locator('select');
    if (await magSelect.count() > 0) {
      await expect(magSelect).toHaveValue('');
    }
    await clickSave(page);
    await expect(page.getByRole('heading', { name: 'Gun Switch Match' })).toBeVisible();

    // And the saved record carries no stale gun-A mag: the Malfunctions
    // screen row must not name DR9-1.
    await gotoSection(page, 'Malfunctions');
    const row = page.getByRole('main').locator('.row-tap', { hasText: 'Gun Switch Match' });
    await expect(row).toBeVisible();
    await expect(row.filter({ hasText: 'DR9-1' })).toHaveCount(0);
  });

  test('session-linked malfunction rows still open their session (regression guard)', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Malfunctions');
    const rows = page.getByRole('main').locator('.row-tap');
    // Wait for the async load to paint before counting -- the sibling
    // malfunctions-list.spec.ts does the same; a bare count() races it.
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    expect(before).toBeGreaterThan(0); // the demo dataset ships with a handful

    // Every seeded malfunction is session-linked -- the count before/after
    // proves the match-write path never touched them, and the first row
    // still opens its session rather than a match.
    await rows.first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();

    await gotoSection(page, 'Malfunctions');
    await expect(page.getByRole('main').locator('.row-tap')).toHaveCount(before);
  });
});
