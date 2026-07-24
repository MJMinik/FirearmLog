import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Inline "quick-add a drill" from the session-logging flow.
//
// A shooter logging a session can create a brand-new drill from inside the
// "Pick Drills" sheet — name only, with gun type + fire pre-filled from the
// session — and it lands straight on the session. This proves the wiring end to
// end (the unit suite covers the pure filtering logic; only E2E exercises the
// taps, the sheet, and the state hand-off). Runs on desktop + phone.

test.describe('Quick-add a drill inline (Pick Drills)', () => {
  test('create a new drill from the picker and it lands on the session', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick a gun so the session has a context (categories + live fire).
    const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');

    // Open the Pick Drills sheet from the Drills card.
    const drillsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Drills' }) });
    await drillsCard.getByRole('button', { name: '+ Add Drill' }).click();

    const sheet = page.getByRole('dialog', { name: 'Pick Drills' });
    await expect(sheet).toBeVisible();

    // Start the inline quick-add. (Whether the picker is empty or not, a
    // "+ New drill" affordance is present.)
    await sheet.getByRole('button', { name: '+ New drill' }).click();

    // A unique name so we never collide with a bundled demo drill.
    const drillName = `Inline QA Drill ${Date.now()}`;
    await sheet.getByLabel('Drill to add').fill(drillName);
    await sheet.getByRole('button', { name: 'Save & Add to Session' }).click();

    // The sheet closes and the new drill is now a row on the session.
    await expect(sheet).toBeHidden();
    await expect(drillsCard.getByText(drillName, { exact: true })).toBeVisible();

    // And it persists with the session: save, then it's a recorded session.
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await expect(page.getByText(/50\s*(rds|reps)/).first()).toBeVisible();
  });

  test('"More options" opens the full drill editor and still adds to the session', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await page.getByRole('button', { name: '+ Log Session' }).click();

    const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('25');

    const drillsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Drills' }) });
    await drillsCard.getByRole('button', { name: '+ Add Drill' }).click();

    const sheet = page.getByRole('dialog', { name: 'Pick Drills' });
    await sheet.getByRole('button', { name: '+ New drill' }).click();
    // Type the name in the quick-add FIRST, then escalate -- it must migrate.
    const typedName = `Migrated Drill ${Date.now()}`;
    await sheet.getByLabel('Drill to add').fill(typedName);
    await sheet.getByRole('button', { name: 'More options / full editor' }).click();

    // The full DrillForm editor opens in an overlay (its own "New Drill" screen).
    const overlay = page.locator('.screen-overlay');
    await expect(overlay.getByRole('heading', { name: 'New Drill' })).toBeVisible();
    // The name typed in the quick-add carried into the full editor (the bug fix).
    await expect(overlay.getByLabel('What this Drill is called')).toHaveValue(typedName);
    // Scope to the overlay's Save (the underlying session form also has one).
    await overlay.locator('.navbar-action').click();
    await expect(overlay).toBeHidden();

    // Back on the session, the editor-created drill is a row.
    await expect(drillsCard.getByText(typedName, { exact: true })).toBeVisible();
  });
});
