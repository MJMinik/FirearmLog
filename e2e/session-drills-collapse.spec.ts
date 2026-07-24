import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Drills collapsible (mirrors Guns & Rounds — session-guns-collapse.spec.ts).
//
// Key behaviors:
// 1. On a fresh log the Drills section is OPEN (adding drills is the point).
// 2. Tapping the header collapses it; the summary line shows "No drills yet."
// 3. After the header collapses, tapping again reopens it.
// 4. Editing an existing session that has drills loads the section collapsed
//    with the summary line showing the drill count.
// 5. The always-visible summary line shows "N drill / drills logged" when
//    drills exist, "No drills yet." when none.

const GUN = 'Shadow Systems DR920';
const DRILL_NAME = 'Bill Drill';

test.describe('Drills collapsible', () => {
  test('fresh log: Drills section starts open', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();

    // The Drills disclosure header is present and expanded.
    const drillsCard = page.locator('.card').filter({ hasText: 'Drills' }).first();
    const disclosure = drillsCard.locator('.checklist-disclosure').first();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // "+ Add Drill" button is visible (body is open).
    await expect(drillsCard.getByRole('button', { name: '+ Add Drill' })).toBeVisible();
  });

  test('tapping the header collapses Drills and summary shows "No drills yet."', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    const drillsCard = page.locator('.card').filter({ hasText: 'Drills' }).first();
    const disclosure = drillsCard.locator('.checklist-disclosure').first();

    // Collapse by tapping the header.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Summary line visible with "No drills yet."
    await expect(drillsCard.locator('.report-note').first()).toContainText('No drills yet.');

    // "+ Add Drill" button is hidden.
    await expect(drillsCard.getByRole('button', { name: '+ Add Drill' })).not.toBeVisible();
  });

  test('tapping the collapsed header reopens Drills', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    const drillsCard = page.locator('.card').filter({ hasText: 'Drills' }).first();
    const disclosure = drillsCard.locator('.checklist-disclosure').first();

    // Collapse then reopen.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // "+ Add Drill" is visible again.
    await expect(drillsCard.getByRole('button', { name: '+ Add Drill' })).toBeVisible();
  });

  test('editing a saved session with drills loads Drills collapsed with count summary', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick a gun (required to save).
    await page.getByRole('button', { name: GUN }).click();

    // Add a drill via the picker.
    await page.getByRole('button', { name: '+ Add Drill' }).click();
    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    // Pick the drill if it exists in the library; otherwise use quick-add.
    const drillBtn = sheet.getByRole('button', { name: DRILL_NAME }).first();
    if (await drillBtn.isVisible()) {
      await drillBtn.click();
      await sheet.getByRole('button', { name: 'Add Selected' }).click();
    } else {
      // Quick-add by name.
      await sheet.getByRole('button', { name: '+ New Drill' }).click();
      await sheet.getByPlaceholder('Drill name').fill(DRILL_NAME);
      await sheet.getByRole('button', { name: 'Save & Add' }).click();
    }

    // Save the session.
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the saved session.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();

    // Drills section loads collapsed.
    const drillsCard = page.locator('.card').filter({ hasText: 'Drills' }).first();
    const disclosure = drillsCard.locator('.checklist-disclosure').first();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Summary line shows "1 drill logged".
    await expect(drillsCard.locator('.report-note').first()).toContainText('1 drill logged');
  });

  test('summary line shows correct plural when multiple drills are logged', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick a gun (required to save).
    await page.getByRole('button', { name: GUN }).click();

    // Add two drills via quick-add.
    const addDrill = async (name: string) => {
      await page.getByRole('button', { name: '+ Add Drill' }).click();
      const sheet = page.locator('.sheet');
      await expect(sheet).toBeVisible();
      const drillBtn = sheet.getByRole('button', { name }).first();
      if (await drillBtn.isVisible()) {
        await drillBtn.click();
        await sheet.getByRole('button', { name: 'Add Selected' }).click();
      } else {
        await sheet.getByRole('button', { name: '+ New Drill' }).click();
        await sheet.getByPlaceholder('Drill name').fill(name);
        await sheet.getByRole('button', { name: 'Save & Add' }).click();
      }
    };

    await addDrill('Bill Drill');
    await addDrill('Mozambique');

    // Summary line shows "2 drills logged" (section still open, so check report-note).
    const drillsCard = page.locator('.card').filter({ hasText: 'Drills' }).first();
    await expect(drillsCard.locator('.report-note').first()).toContainText('2 drills logged');
  });
});
