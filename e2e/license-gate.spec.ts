import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';
import { kindChip, openNewSessionForm, seedOwnSessions, storedSettings, wall } from './licenceHelpers';
import { signTestLicence } from './licenceSigner';

// The free-limit gate and the license card (ENTITLEMENT_SPEC_2026-09-18.md §5
// and §10; decision 83). Valid licenses are signed at run time with a key pair
// playwright.config.ts generates for this run, and this build trusts only that
// public half; no key is committed anywhere.
//
// Seeding: the demo log (sample loaded, its se-NNN sessions never count) plus N
// live-fire sessions of the shooter's OWN written into IndexedDB, so "ten
// live-fire sessions" means ten he logged himself.

test.describe('The free limit: nine, ten, and the wall', () => {
  test('the sample log alone never gates: a new session opens on Live practice, nothing locked', async ({ page }) => {
    await seedDemo(page);
    await openNewSessionForm(page);
    await expect(kindChip(page, 'Live practice')).toHaveAttribute('aria-pressed', 'true');
    await expect(kindChip(page, 'Live practice')).toBeVisible();
    await expect(page.getByRole('button', { name: /, locked$/ })).toHaveCount(0);
  });

  test('the tenth live-fire session is free; the form after it is gated', async ({ page }) => {
    test.slow();
    await seedDemo(page);
    await seedOwnSessions(page, 9);
    await openNewSessionForm(page);
    // Nine of his own: not gated. Log the tenth through the real form.
    await expect(kindChip(page, 'Live practice')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /, locked$/ })).toHaveCount(0);
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('61');
    await page.locator('.navbar-action').click();
    await expect(page.getByText(/61\s*rds/).first()).toBeVisible();

    // Ten now. The next new form opens on Dry fire with both live chips locked.
    await openNewSessionForm(page);
    await expect(kindChip(page, 'Dry fire')).toHaveAttribute('aria-pressed', 'true');
    await expect(kindChip(page, 'Live practice, locked')).toBeVisible();
    await expect(kindChip(page, 'Class, locked')).toBeVisible();
  });

  test('at ten: tapping a locked chip shows the wall over the form; closing returns to it untouched', async ({ page }) => {
    await seedDemo(page);
    await seedOwnSessions(page, 10);
    await openNewSessionForm(page);
    await expect(kindChip(page, 'Dry fire')).toHaveAttribute('aria-pressed', 'true');

    // Type something first: closing the wall must not lose it.
    await page.getByLabel('Where').fill('Typed Before The Wall');
    await kindChip(page, 'Live practice, locked').click();

    const w = wall(page);
    await expect(w).toBeVisible();
    // The shooter's own figures: ten sessions, 500 rounds.
    await expect(w).toContainText('You have logged 10 live-fire sessions and 500 rounds in FirearmLog.');
    await expect(w).toContainText('Dry fire sessions');
    await expect(w).toContainText('Viewing and exporting your whole log');
    // The buy button is a plain link that opens the buy page in a new tab.
    const buy = w.getByRole('link', { name: 'Get a license' });
    await expect(buy).toHaveAttribute('href', 'https://firearmlog.com/buy');
    await expect(buy).toHaveAttribute('target', '_blank');
    await expect(buy).toHaveAttribute('rel', /noopener/);
    // No price anywhere in the wall.
    await expect(w).not.toContainText(/[$€£]\s?\d/);

    await w.getByRole('button', { name: 'Back to the form' }).click();
    await expect(w).toBeHidden();
    await expect(kindChip(page, 'Dry fire')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Where')).toHaveValue('Typed Before The Wall');
    // Class is locked the same way.
    await kindChip(page, 'Class, locked').click();
    await expect(w).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(w).toBeHidden();
    await expect(kindChip(page, 'Dry fire')).toHaveAttribute('aria-pressed', 'true');
  });

  test('at ten: a dry-fire session saves normally', async ({ page }) => {
    test.slow();
    await seedDemo(page);
    await seedOwnSessions(page, 10);
    await openNewSessionForm(page);
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('73');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await expect(page.getByText(/73\s*reps/).first()).toBeVisible();
    await expect(wall(page)).toHaveCount(0);
  });

  test('at ten: making a plan is not gated, and editing a logged session is never gated', async ({ page }) => {
    await seedDemo(page);
    await seedOwnSessions(page, 10);
    // A plan.
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Plan Session' }).click();
    await expect(page.getByRole('heading', { name: 'Plan Session' })).toBeVisible();
    await expect(kindChip(page, 'Live practice')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /, locked$/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Cancel/ }).click();

    // Editing one of his own live sessions: chips open, save works.
    await gotoTab(page, 'Log');
    await page.getByText('E2E Own Range 3').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: /, locked$/ })).toHaveCount(0);
    await kindChip(page, 'Class').click();
    await expect(wall(page)).toHaveCount(0);
    await expect(kindChip(page, 'Class')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
  });

  test('at ten: a logged dry-fire session cannot be changed to Live or Class (the wall), but every other edit is free', async ({ page }) => {
    test.slow();
    await seedDemo(page);
    await seedOwnSessions(page, 10);
    // Log a dry-fire session through the real form.
    await openNewSessionForm(page);
    await page.getByLabel('Where').fill('H2 Dry Range');
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('41');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen it: the two live chips are locked exactly as on a new form.
    await page.getByText('H2 Dry Range').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await expect(kindChip(page, 'Dry fire')).toHaveAttribute('aria-pressed', 'true');
    await expect(kindChip(page, 'Live practice, locked')).toBeVisible();
    await expect(kindChip(page, 'Class, locked')).toBeVisible();
    await page.getByLabel('Where').fill('H2 Dry Range Edited');
    await kindChip(page, 'Live practice, locked').click();
    await expect(wall(page)).toBeVisible();
    await wall(page).getByRole('button', { name: 'Back to the form' }).click();
    await expect(wall(page)).toBeHidden();
    // Nothing was lost or changed by the wall.
    await expect(kindChip(page, 'Dry fire')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Where')).toHaveValue('H2 Dry Range Edited');
    await kindChip(page, 'Class, locked').click();
    await expect(wall(page)).toBeVisible();
    await wall(page).getByRole('button', { name: 'Back to the form' }).click();
    // Saving it as the dry-fire session it is stays free.
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await expect(page.getByText('H2 Dry Range Edited').first()).toBeVisible();
    await expect(wall(page)).toHaveCount(0);

    // A Live session stays editable in full, and can be changed TO dry fire.
    await page.getByText('E2E Own Range 4').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: /, locked$/ })).toHaveCount(0);
    await kindChip(page, 'Dry fire').click();
    await expect(wall(page)).toHaveCount(0);
    await expect(kindChip(page, 'Dry fire')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await expect(wall(page)).toHaveCount(0);
  });

  test('at ten: converting a plan shows the wall over the form and leaves the plan untouched', async ({ page }) => {
    await seedDemo(page);
    await seedOwnSessions(page, 10);
    await seedOwnSessions(page, 1, { planned: true, location: 'E2E Planned Range', idTag: 'plan' });
    await gotoTab(page, 'Log');
    await page.getByText('E2E Planned Range').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await page.getByRole('button', { name: /Convert to logged session/ }).click();

    await expect(wall(page)).toBeVisible();
    await wall(page).getByRole('button', { name: 'Back to the form' }).click();
    // Still the plan: same heading, the Convert button is still offered.
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Convert to logged session/ })).toBeVisible();
    await expect(page.getByLabel('Where')).toHaveValue('E2E Planned Range');
  });

  test('below ten, converting a plan is not gated', async ({ page }) => {
    await seedDemo(page);
    await seedOwnSessions(page, 3);
    await seedOwnSessions(page, 1, { planned: true, location: 'E2E Planned Range', idTag: 'plan' });
    await gotoTab(page, 'Log');
    await page.getByText('E2E Planned Range').first().click();
    await page.getByRole('button', { name: /Convert to logged session/ }).click();
    await expect(wall(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Log Session (from Plan)' })).toBeVisible();
  });
});

test.describe('Pasting a license', () => {
  test('a valid license pasted into the wall lifts the wall; the Settings card shows the licensed state', async ({ page }) => {
    await seedDemo(page);
    await seedOwnSessions(page, 10);
    const licence = await signTestLicence({ plan: 'founding', seq: 17, to: 'E2E Tester', at: '2026-11-03' });

    await openNewSessionForm(page);
    await kindChip(page, 'Live practice, locked').click();
    // A trailing newline is what an email adds; it must not matter.
    await wall(page).getByLabel('Paste your license').fill(`${licence}\n`);
    await wall(page).getByRole('button', { name: 'Add license' }).click();
    await expect(wall(page)).toBeHidden();

    // The chips are open now.
    await expect(page.getByRole('button', { name: /, locked$/ })).toHaveCount(0);
    await kindChip(page, 'Live practice').click();
    await expect(kindChip(page, 'Live practice')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Cancel/ }).click();
    // (Cancel on a touched form asks first.)
    await page.getByRole('button', { name: 'Discard' }).click();

    await gotoSection(page, 'Settings');
    await expect(page.getByTestId('licence-line')).toHaveText('Licensed to E2E Tester, Founding member #17, since Nov 3, 2026.');
    expect((await storedSettings(page))?.licence).toBe(licence);

    // And it holds across a reload (checked again at app start).
    await page.reload();
    await gotoSection(page, 'Settings');
    await expect(page.getByTestId('licence-line')).toContainText('Licensed to E2E Tester');
  });

  test('a standard license shows "Standard"; one without a name shows just "Licensed"', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Settings');
    const card = page.getByTestId('licence-card');
    await card.getByLabel('Paste your license').fill(await signTestLicence({ plan: 'standard', at: '2026-12-25' }));
    await card.getByRole('button', { name: 'Add license' }).click();
    await expect(page.getByTestId('licence-line')).toHaveText('Licensed, Standard, since Dec 25, 2026.');
  });

  test('text that is not a license says so and changes nothing', async ({ page }) => {
    await seedDemo(page);
    await seedOwnSessions(page, 10);
    await gotoSection(page, 'Settings');
    const card = page.getByTestId('licence-card');
    await expect(page.getByTestId('licence-count')).toHaveText('10 of 10 live-fire sessions used.');
    await card.getByLabel('Paste your license').fill('FL1.this.isnotreal');
    await card.getByRole('button', { name: 'Add license' }).click();
    await expect(card.getByRole('alert')).toHaveText('That is not a valid FirearmLog license. Nothing was changed.');
    expect((await storedSettings(page))?.licence).toBeUndefined();
    await expect(page.getByTestId('licence-count')).toBeVisible();

    // A license signed by a key the app does not trust is refused the same way.
    await card.getByLabel('Paste your license').fill(await signTestLicence({ kid: 'not-a-known-key' }));
    await card.getByRole('button', { name: 'Add license' }).click();
    await expect(card.getByRole('alert')).toContainText('not a valid FirearmLog license');
    expect((await storedSettings(page))?.licence).toBeUndefined();
  });

  test('the card shows the count in the free state with NO buy link, and the buy link once the ten are used', async ({ page }) => {
    await seedDemo(page);
    await seedOwnSessions(page, 4);
    await gotoSection(page, 'Settings');
    await expect(page.getByTestId('licence-count')).toHaveText('4 of 10 live-fire sessions used.');
    const card = page.getByTestId('licence-card');
    await expect(card.getByRole('link', { name: 'Get a license' })).toHaveCount(0);
    // The ten are used: the trial-over state carries the buy link (spec §5.5).
    await seedOwnSessions(page, 6, { idTag: 'more' });
    await gotoSection(page, 'Settings');
    await expect(page.getByTestId('licence-count')).toHaveText('10 of 10 live-fire sessions used.');
    await expect(page.getByTestId('licence-card').getByRole('link', { name: 'Get a license' }))
      .toHaveAttribute('href', 'https://firearmlog.com/buy');
  });

  test('Remove asks first, says the license can be pasted again, and then the card is free again', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Settings');
    const licence = await signTestLicence({ to: 'E2E Tester' });
    const card = page.getByTestId('licence-card');
    await card.getByLabel('Paste your license').fill(licence);
    await card.getByRole('button', { name: 'Add license' }).click();
    await expect(page.getByTestId('licence-line')).toBeVisible();

    await card.getByRole('button', { name: /Remove license/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Remove license?' });
    await expect(sheet).toContainText('You can paste it again from your email or receipt.');
    await sheet.getByRole('button', { name: 'Keep license' }).click();
    await expect(page.getByTestId('licence-line')).toBeVisible();

    await card.getByRole('button', { name: /Remove license/ }).click();
    await page.getByRole('dialog', { name: 'Remove license?' }).getByRole('button', { name: 'Remove license' }).click();
    await expect(page.getByTestId('licence-count')).toBeVisible();
    await expect(page.getByTestId('licence-line')).toHaveCount(0);
    expect((await storedSettings(page))?.licence ?? '').toBe('');
  });
});

test.describe('The #licence= link', () => {
  test('a valid link fills, stores and clears the fragment from the address bar', async ({ page }) => {
    await seedDemo(page);
    const licence = await signTestLicence({ plan: 'founding', seq: 9, to: 'Link Tester' });
    // A different query string makes this a real page load (a hash-only change would not reload).
    await page.goto(`/?from=link#licence=${licence}`);
    const sheet = page.getByRole('dialog', { name: 'Your license' });
    await expect(sheet).toContainText('License added. Licensed to Link Tester, Founding member #9');
    await sheet.getByRole('button', { name: 'OK' }).click();
    expect(page.url()).not.toContain('licence=');
    expect(page.url()).not.toContain('#licence');
    expect((await storedSettings(page))?.licence).toBe(licence);
  });

  test('an invalid link says so, stores nothing, and still clears the fragment', async ({ page }) => {
    await seedDemo(page);
    await page.goto('/?from=link#licence=FL1.not.valid');
    const sheet = page.getByRole('dialog', { name: 'Your license' });
    await expect(sheet).toContainText('That link did not hold a valid FirearmLog license. Nothing was changed.');
    await sheet.getByRole('button', { name: 'OK' }).click();
    expect(page.url()).not.toContain('licence=');
    expect((await storedSettings(page))?.licence).toBeUndefined();
  });
});

test.describe('The license and Save, Load and Clear All', () => {
  test('Save to File carries it; loading a license-free file keeps it; loading the licensed file restores it', async ({ page }) => {
    test.slow();
    await seedDemo(page);
    const licence = await signTestLicence({ to: 'Backup Tester' });

    // A file made BEFORE the license exists (a license-free backup).
    await gotoSection(page, 'Sync & Backup');
    await page.getByRole('main').getByRole('button', { name: 'Save to File' }).click();
    const [plainDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save the File Now', exact: true }).click(),
    ]);
    const plainPath = (await plainDl.path())!;
    await page.keyboard.press('Escape');

    // Add the license, then a second file that carries it.
    await gotoSection(page, 'Settings');
    await page.getByTestId('licence-card').getByLabel('Paste your license').fill(licence);
    await page.getByTestId('licence-card').getByRole('button', { name: 'Add license' }).click();
    await expect(page.getByTestId('licence-line')).toBeVisible();
    await gotoSection(page, 'Sync & Backup');
    await page.getByRole('main').getByRole('button', { name: 'Save to File' }).click();
    const [licDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save the File Now', exact: true }).click(),
    ]);
    const licPath = (await licDl.path())!;
    await page.keyboard.press('Escape');

    async function loadFile(path: string) {
      await gotoSection(page, 'Sync & Backup');
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('main').getByRole('button', { name: 'Load from File' }).click(),
      ]);
      await chooser.setFiles(path);
      await expect(page.getByRole('heading', { name: "Replace this device's data?" })).toBeVisible();
      await page.getByRole('button', { name: /^Load (the Older File Anyway|from File)$/ }).last().click();
      await expect(page.getByRole('main')).toContainText('Done — this device now matches the file.', { timeout: 30_000 });
    }

    // Loading the license-FREE file over the licensed device keeps the license.
    await loadFile(plainPath);
    expect((await storedSettings(page))?.licence, 'a license-free file erased the license').toBe(licence);
    await gotoSection(page, 'Settings');
    await expect(page.getByTestId('licence-line')).toContainText('Licensed to Backup Tester');

    // The licensed file carried it: remove the license, load that file, it is back.
    await page.getByTestId('licence-card').getByRole('button', { name: /Remove license/ }).click();
    await page.getByRole('dialog', { name: 'Remove license?' }).getByRole('button', { name: 'Remove license' }).click();
    await expect(page.getByTestId('licence-count')).toBeVisible();
    await loadFile(licPath);
    expect((await storedSettings(page))?.licence).toBe(licence);
  });

  test('Clear all data: the license sentence is absent when no valid license is stored', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Settings');
    await page.getByRole('button', { name: 'Clear all data…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Clear all data' });
    await expect(sheet.getByText('Your saved backup files are not affected', { exact: false })).toBeVisible();
    await expect(sheet).not.toContainText('removes your license');
  });

  test('Clear all data removes the license and the sheet says so', async ({ page }) => {
    await seedDemo(page);
    const licence = await signTestLicence();
    await gotoSection(page, 'Settings');
    await page.getByTestId('licence-card').getByLabel('Paste your license').fill(licence);
    await page.getByTestId('licence-card').getByRole('button', { name: 'Add license' }).click();
    await expect(page.getByTestId('licence-line')).toBeVisible();

    await page.getByRole('button', { name: 'Clear all data…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Clear all data' });
    await expect(sheet).toContainText('This also removes your license from this device. You can paste it again afterward.');
    await sheet.getByPlaceholder('erase').fill('erase');
    await sheet.getByRole('button', { name: 'Erase everything' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your log' })).toBeVisible({ timeout: 20_000 });
    expect((await storedSettings(page))?.licence).toBeUndefined();
  });

  test('"Start my own log" (leaving the sample) keeps the license', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Settings');
    await page.getByTestId('licence-card').getByLabel('Paste your license').fill(await signTestLicence());
    await page.getByTestId('licence-card').getByRole('button', { name: 'Add license' }).click();
    await expect(page.getByTestId('licence-line')).toBeVisible();
    await page.getByRole('button', { name: 'Start my own log' }).click();
    await page.getByRole('button', { name: 'Clear sample & start' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your log' })).toBeVisible({ timeout: 20_000 });
    expect((await storedSettings(page))?.licence).toBeTruthy();
  });
});
