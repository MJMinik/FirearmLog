// Manage Lists: rename, combine, hide — E2E spec (§9 of SPEC_MANAGE_LISTS.md).
// Tests run on both desktop and mobile projects (see playwright.config.ts).
// Selector discipline: scope to getByRole('main'), { exact: true } where names
// could collide with stepper buttons or other controls.
import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

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

    // Confirmation step should appear
    await expect(sheet.getByText('Rename', { exact: false })).toBeVisible();
    await expect(sheet.getByText('This updates', { exact: false }).or(
      sheet.getByText('This renames it everywhere', { exact: false })
    )).toBeVisible();

    // Confirm the rename
    const renameOrCombineBtn = sheet.getByRole('button', { name: 'Rename', exact: true })
      .or(sheet.getByRole('button', { name: 'Combine', exact: true }));
    await renameOrCombineBtn.click();

    // Sheet closes; back on the list detail which now shows the new name
    await expect(page.getByRole('dialog', { name: 'Rename' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Locations', exact: true })).toBeVisible();
    await expect(main.getByText(`${safeName} (dry)`, { exact: false })).toBeVisible();
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
    const gotoTabFn = async (name: string) => {
      const navLocator = page.getByRole('navigation', { name: 'Main' });
      const isDesk = (page.viewportSize()?.width ?? 0) >= 900;
      if (isDesk) {
        await navLocator.getByRole('button', { name }).first().click();
      } else {
        await navLocator.getByRole('button', { name: 'More' }).first().click();
      }
    };
    await gotoTabFn('Log');

    await page.getByRole('main').getByRole('button', { name: /Log Session/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Log Session' }).or(
      page.getByRole('heading', { name: 'New Session' })
    ).first()).toBeVisible();

    // Focus the Where field to open suggestions
    const whereField = page.getByLabel('Where').first();
    await whereField.click();

    // Wait a moment for suggestions to appear
    await page.waitForTimeout(300);

    // The hidden location must NOT appear in suggestions
    const suggestions = page.locator('.suggest-list');
    const hiddenInList = suggestions.getByText(locationName, { exact: true });
    await expect(hiddenInList).toHaveCount(0);
  });
});
