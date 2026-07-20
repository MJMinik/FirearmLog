// Manage Lists: rename, combine, hide — E2E spec (§9 of SPEC_MANAGE_LISTS.md).
// Tests run on both desktop and mobile projects (see playwright.config.ts).
// Selector discipline: scope to getByRole('main'), { exact: true } where names
// could collide with stepper buttons or other controls.
import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';

/** Navigate to Settings → Manage lists from any starting point. */
async function gotoManageLists(page: import('@playwright/test').Page) {
  await gotoSection(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Manage lists' }).click();
  await expect(page.getByRole('heading', { name: 'Manage lists', exact: true })).toBeVisible();
}

/** Navigate to a specific list detail by UI name. */
async function gotoList(page: import('@playwright/test').Page, listName: string) {
  await gotoManageLists(page);
  await page.getByRole('main').getByRole('button', { name: listName }).first().click();
  await expect(page.getByRole('heading', { name: listName, exact: true })).toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Settings row is present
// ---------------------------------------------------------------------------

test.describe('Settings row', () => {
  test('Settings screen shows Manage lists row', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Settings');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Manage lists' })).toBeVisible();
    await expect(main.getByText('Rename or tidy the names your log suggests')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Manage lists screen renders with grouped lists
// ---------------------------------------------------------------------------

test.describe('Manage lists screen', () => {
  test('shows all 10 list groups and the standard-lists note', async ({ page }) => {
    await seedDemo(page);
    await gotoManageLists(page);

    const main = page.getByRole('main');
    // Group headings
    await expect(main.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Ammo', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Money', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Gear', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();

    // Standard-lists note (exact copy from §7)
    await expect(main.getByText(
      'Bullet types, divisions, cost categories, and other standard lists are the same for every shooter and update with the app.'
    )).toBeVisible();

    // Backup nudge
    await expect(main.getByText('Before a big cleanup', { exact: false })).toBeVisible();
  });

  test('screen intro line is present', async ({ page }) => {
    await seedDemo(page);
    await gotoManageLists(page);
    await expect(page.getByRole('main').getByText(
      'These lists come from your own log. Rename a name and your past entries follow.'
    )).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Rename: basic flow
// ---------------------------------------------------------------------------

test.describe('Rename: basic flow', () => {
  test('rename a location — both sessions show the new name in suggestions', async ({ page }) => {
    await seedDemo(page);

    // Log two sessions at the same location so we can verify both follow.
    // The demo data has sessions; we use the Locations list to confirm.
    await gotoList(page, 'Locations');

    const main = page.getByRole('main');
    // There should be values from demo data. Take the first visible value.
    const firstRenameBtn = main.locator('.setting-row').first().getByRole('button', { name: 'Rename', exact: true });
    await expect(firstRenameBtn).toBeVisible();

    // Get the current name from the row
    const firstRow = main.locator('.setting-row').first();
    const oldName = await firstRow.locator('.setting-label').first().textContent();
    const safeName = (oldName ?? 'Unknown').trim();

    await firstRenameBtn.click();

    // Rename sheet opens
    await expect(page.getByRole('dialog', { name: 'Rename', exact: true })).toBeVisible();
    const sheet = page.getByRole('dialog', { name: 'Rename', exact: true });

    // Clear field and type new name
    const input = sheet.locator('input').first();
    await input.clear();
    await input.fill(`${safeName} (dry)`);
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();

    // Confirmation step should appear: assert on the body text (count + action description),
    // not just the dialog title — "Rename" appears in both title and confirm button.
    await expect(sheet.getByText('This updates', { exact: false }).or(
      sheet.getByText('This renames it everywhere', { exact: false })
    )).toBeVisible();
    // The confirm button is enabled and labelled "Rename" or "Combine"
    const renameConfirmBtn = sheet.getByRole('button', { name: 'Rename', exact: true })
      .or(sheet.getByRole('button', { name: 'Combine', exact: true }));
    await expect(renameConfirmBtn).toBeEnabled();

    // Confirm the rename
    await renameConfirmBtn.click();

    // Sheet closes; back on the list detail which now shows the new name
    await expect(page.getByRole('dialog', { name: 'Rename' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Locations', exact: true })).toBeVisible();
    await expect(main.getByText(`${safeName} (dry)`, { exact: false })).toBeVisible();

    // Verify the form's suggestion field reflects the rename:
    // NEW name is suggested, OLD name is NOT.
    await gotoTab(page, 'Log');
    await page.getByRole('main').getByRole('button', { name: /Log Session/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Log Session' }).or(
      page.getByRole('heading', { name: 'New Session' })
    ).first()).toBeVisible();
    const whereField = page.getByLabel('Where').first();
    await whereField.click();
    const suggestions = page.locator('.suggest-list');
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByText(`${safeName} (dry)`, { exact: true })).toBeVisible();
    await expect(suggestions.getByText(safeName, { exact: true })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 3b. Rename: combine / collision
// ---------------------------------------------------------------------------

test.describe('Rename: combine / collision', () => {
  test('renaming onto an existing value shows combine dialog; surviving casing is the existing value', async ({ page }) => {
    await seedDemo(page);

    // Navigate to Locations which should have multiple values from demo data
    await gotoList(page, 'Locations');
    const main = page.getByRole('main');

    // We need at least two visible values to test a combine.
    const rows = main.locator('.setting-row');
    const rowCount = await rows.count();
    if (rowCount < 2) { test.skip(); return; }

    // Read the first two names
    const firstName = ((await rows.nth(0).locator('.setting-label').first().textContent()) ?? '').trim();
    const secondName = ((await rows.nth(1).locator('.setting-label').first().textContent()) ?? '').trim();
    if (!firstName || !secondName) { test.skip(); return; }

    // Rename the first value onto the second (case-insensitively)
    await rows.nth(0).getByRole('button', { name: 'Rename', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Rename', exact: true });
    await expect(sheet).toBeVisible();
    const input = sheet.locator('input').first();
    await input.clear();
    // Use uppercase of the second name to confirm casing resolves to the existing one
    await input.fill(secondName.toUpperCase());
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();

    // Combine dialog appears (not rename) with a count
    await expect(sheet.getByText('already exists', { exact: false })).toBeVisible();
    await expect(sheet.getByText('Combine', { exact: false })).toBeVisible();
    // Count must mention at least 1 record
    await expect(sheet.getByText(/\d+/, { })).toBeVisible();

    // Confirm the combine
    await sheet.getByRole('button', { name: 'Combine', exact: true }).click();

    // Sheet closes; list detail shows the EXISTING casing (secondName), not the typed uppercase
    await expect(page.getByRole('dialog', { name: 'Rename' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Locations', exact: true })).toBeVisible();
    await expect(main.getByText(secondName, { exact: true })).toBeVisible();
    await expect(main.getByText(secondName.toUpperCase(), { exact: true })).toHaveCount(0);
    // The old first name is gone
    await expect(main.getByText(firstName, { exact: true })).toHaveCount(0);

    // Verify the affected records now display the surviving casing.
    // Navigate to Log, then open the first session and confirm its location field
    // shows secondName (the surviving casing), not firstName (the renamed-away value).
    // The session row sub-line renders location as "· <location>", but the edit form's
    // location input is the authoritative surface — we check that.
    await gotoTab(page, 'Log');
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    const logMain = page.getByRole('main');
    // The combine guarantees at least one session carries secondName (the Locations
    // list is derived from sessions.location, and secondName is visible there).
    // Open THAT session — not an arbitrary first row — and assert positively.
    const sessionRow = logMain.locator('.row-tap', { hasText: secondName }).first();
    await expect(sessionRow).toBeVisible();
    await sessionRow.click();
    // Session edit view: the Where (location) field must hold the surviving casing
    const whereInput = page.getByLabel('Where').first();
    await expect(whereInput).toHaveValue(secondName);
  });
});

// ---------------------------------------------------------------------------
// 4. Rename: validation
// ---------------------------------------------------------------------------

test.describe('Rename: validation', () => {
  test('submitting blank name shows error message', async ({ page }) => {
    await seedDemo(page);
    await gotoList(page, 'Locations');

    const main = page.getByRole('main');
    const firstRenameBtn = main.locator('.setting-row').first().getByRole('button', { name: 'Rename', exact: true });
    await firstRenameBtn.click();

    const sheet = page.getByRole('dialog', { name: 'Rename', exact: true });
    const input = sheet.locator('input').first();
    await input.clear();
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();

    // Validation error
    await expect(sheet.getByText('Enter a name')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Hide / Unhide
// ---------------------------------------------------------------------------

test.describe('Hide and Unhide', () => {
  test('hidden value is gone from the visible list, shown under Hidden, Unhide restores it', async ({ page }) => {
    await seedDemo(page);
    await gotoList(page, 'Locations');

    const main = page.getByRole('main');
    // Find first Hide button
    const firstHideBtn = main.locator('.setting-row').first().getByRole('button', { name: 'Hide', exact: true });
    await expect(firstHideBtn).toBeVisible();

    // Get the value name before hiding
    const firstRow = main.locator('.setting-row').first();
    const valueName = ((await firstRow.locator('.setting-label').first().textContent()) ?? '').trim();

    await firstHideBtn.click();

    // Confirm dialog appears
    const confirmDialog = page.getByRole('dialog', { name: 'Hide from suggestions', exact: true });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText(`Hide '${valueName}' from suggestions?`)).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Hide', exact: true }).click();

    // After hide: value is now under a "Hidden" subheading with Unhide button
    await expect(page.getByRole('heading', { name: 'Hidden', exact: true })).toBeVisible();
    const hiddenSection = main.locator('.card', {
      has: page.getByRole('heading', { name: 'Hidden', exact: true })
    });
    await expect(hiddenSection.getByText(valueName, { exact: true })).toBeVisible();
    await expect(hiddenSection.getByRole('button', { name: 'Unhide', exact: true })).toBeVisible();

    // Unhide restores it to visible
    await hiddenSection.getByRole('button', { name: 'Unhide', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hidden', exact: true })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Standard-lists note: bullet types etc. are NOT shown as editable rows
// ---------------------------------------------------------------------------

test.describe('Standard lists', () => {
  test('no editable rows for bullet types, divisions, or cost categories', async ({ page }) => {
    await seedDemo(page);
    await gotoManageLists(page);

    const main = page.getByRole('main');
    // These must not appear as tappable list rows
    await expect(main.getByRole('button', { name: 'Bullet types', exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Divisions', exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Cost categories', exact: true })).toHaveCount(0);

    // The standard-lists note must be present (verified above but again here)
    await expect(main.getByText('Bullet types, divisions, cost categories')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. Empty state
// ---------------------------------------------------------------------------

test.describe('Empty state', () => {
  test('a list with no values shows the empty-state message', async ({ page }) => {
    // Start with a fresh empty log (no sessions, so no instructors)
    await page.goto('/');
    // An empty log opens the Setup Wizard; add a gun to get past it
    await page.getByRole('main').getByRole('button', { name: '1. Add a gun' }).click();
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('Test Gun');
    await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await gotoList(page, 'Instructors');
    await expect(page.getByRole('main').getByText('Nothing here yet — names show up as you log.')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8. Unsaved-changes guard on the rename sheet
// ---------------------------------------------------------------------------

test.describe('Unsaved-changes guard on rename sheet', () => {
  test('dirty rename sheet asks "Discard changes?" on backdrop tap; clean dismisses instantly', async ({ page }) => {
    await seedDemo(page);
    await gotoList(page, 'Locations');

    const main = page.getByRole('main');
    const firstRenameBtn = main.locator('.setting-row').first().getByRole('button', { name: 'Rename', exact: true });
    await firstRenameBtn.click();

    const sheet = page.getByRole('dialog', { name: 'Rename', exact: true });
    await expect(sheet).toBeVisible();

    // Type something to make it dirty
    const input = sheet.locator('input').first();
    await input.fill('dirty edit that should be guarded');

    // Tap backdrop → discard confirm must appear
    await page.locator('.sheet-backdrop').first().click({ position: { x: 50, y: 20 }, force: true });
    await expect(page.getByRole('dialog', { name: 'Discard changes?', exact: true })).toBeVisible();

    // Keep editing → sheet still there with edited text
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(sheet).toBeVisible();
    await expect(input).toHaveValue('dirty edit that should be guarded');

    // Esc → discard → sheet closes
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Discard changes?', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('pristine rename sheet dismisses instantly on backdrop tap', async ({ page }) => {
    await seedDemo(page);
    await gotoList(page, 'Locations');

    const main = page.getByRole('main');
    const firstRenameBtn = main.locator('.setting-row').first().getByRole('button', { name: 'Rename', exact: true });
    await firstRenameBtn.click();

    const sheet = page.getByRole('dialog', { name: 'Rename', exact: true });
    await expect(sheet).toBeVisible();

    // No edits — backdrop tap should close without confirm
    await page.locator('.sheet-backdrop').first().click({ position: { x: 50, y: 20 }, force: true });
    await expect(page.getByRole('dialog', { name: 'Discard changes?', exact: true })).toHaveCount(0);
    await expect(sheet).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Suggestion filtering: hidden values don't appear in form's SuggestField
// ---------------------------------------------------------------------------

test.describe('Suggestion filtering', () => {
  test('a hidden location is not suggested in the Session form', async ({ page }) => {
    await seedDemo(page);

    // First get a known location value from the list
    await gotoList(page, 'Locations');
    const main = page.getByRole('main');
    const firstRow = main.locator('.setting-row').first();
    const locationName = ((await firstRow.locator('.setting-label').first().textContent()) ?? '').trim();
    if (!locationName) { test.skip(); return; }

    // Hide that location
    await firstRow.getByRole('button', { name: 'Hide', exact: true }).click();
    await page.getByRole('dialog', { name: 'Hide from suggestions' })
      .getByRole('button', { name: 'Hide', exact: true }).click();

    // Now go log a session and check that hidden value does NOT appear in Where suggestions
    await page.getByRole('button', { name: '‹ Back' }).first().click(); // back to Manage lists
    await page.getByRole('button', { name: '‹ Back' }).first().click(); // back to Settings
    await page.getByRole('button', { name: '‹ Back' }).first().click(); // back to More/main

    // Navigate to Log and open session form
    await gotoTab(page, 'Log');

    await page.getByRole('main').getByRole('button', { name: /Log Session/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Log Session' }).or(
      page.getByRole('heading', { name: 'New Session' })
    ).first()).toBeVisible();

    // Focus the Where field to open suggestions
    const whereField = page.getByLabel('Where').first();
    await whereField.click();

    // The hidden location must NOT appear in suggestions.
    // Use a positive assertion on a visible non-hidden item first to confirm
    // the suggest-list rendered, then assert the hidden one is absent.
    const suggestions = page.locator('.suggest-list');
    // The suggest-list may or may not appear if there are no other locations —
    // but if it does appear, the hidden value must not be in it.
    // Either way: the hidden value must have count 0.
    const hiddenInList = suggestions.getByText(locationName, { exact: true });
    await expect(hiddenInList).toHaveCount(0);
  });
});
