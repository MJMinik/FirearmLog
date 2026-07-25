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
// 5. The always-visible summary line shows "N drill(s) added" when
//    drills exist, "No drills yet." when none. (App 3a: "added", not
//    "logged" — a pre-claim on rows that aren't saved yet.)
//
// Drill-add steps use the inline quick-add flow (same pattern as
// quick-add-drill.spec.ts) with a unique-per-test name — the picker's exact
// contents depend on the demo library, but "+ New drill" is always present.

const GUN = 'Shadow Systems DR920';

/** Open Pick Drills and quick-add a brand-new drill by name. */
async function quickAddDrill(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add Drill' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pick Drills' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: '+ New drill' }).click();
  await sheet.getByLabel('Drill to add').fill(name);
  await sheet.getByRole('button', { name: 'Save & Add to Session' }).click();
  await expect(sheet).toBeHidden();
}

test.describe('Drills collapsible', () => {
  test('fresh log: Drills section starts open', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();

    // The Drills disclosure header is present and expanded.
    const drillsCard = page.getByTestId('session-drills-card');
    const disclosure = page.getByTestId('session-drills-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // "+ Add Drill" button is visible (body is open).
    await expect(drillsCard.getByRole('button', { name: '+ Add Drill' })).toBeVisible();
  });

  test('tapping the header collapses Drills and summary shows "No drills yet."', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    const drillsCard = page.getByTestId('session-drills-card');
    const disclosure = page.getByTestId('session-drills-disclosure');

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

    const drillsCard = page.getByTestId('session-drills-card');
    const disclosure = page.getByTestId('session-drills-disclosure');

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
    await page.getByLabel(`Rounds for ${GUN}`).fill('50');

    // Add one drill via the inline quick-add flow.
    const drillName = `Collapse Test Drill ${Date.now()}`;
    await quickAddDrill(page, drillName);

    // Save the session.
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the saved session.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();

    // Drills section loads collapsed.
    const drillsCard = page.getByTestId('session-drills-card');
    const disclosure = page.getByTestId('session-drills-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Summary line shows "1 drill added".
    await expect(drillsCard.locator('.report-note').first()).toContainText('1 drill added');
  });

  test('summary line shows correct plural when multiple drills are logged', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick a gun (required to save).
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('50');

    // Add two brand-new drills via quick-add.
    const stamp = Date.now();
    await quickAddDrill(page, `Plural Test Drill A ${stamp}`);
    await quickAddDrill(page, `Plural Test Drill B ${stamp}`);

    // Summary line shows "2 drills added" (section still open, so check report-note).
    const drillsCard = page.getByTestId('session-drills-card');
    await expect(drillsCard.locator('.report-note').first()).toContainText('2 drills added');
  });

  // Cold-audit regression pin (session 78, High): the Drills InfoTip sits in
  // a sibling row next to the disclosure button (M-2), not inside it — tapping
  // help must never collapse the section, and the tip's own layout must not
  // squeeze the disclosure button down to nothing at narrow widths.
  test('opening the Drills help tip does not collapse the section', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    const drillsCard = page.getByTestId('session-drills-card');
    const disclosure = page.getByTestId('session-drills-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    await drillsCard.locator('.infotip-btn').click();
    await expect(drillsCard.locator('.infotip-bubble')).toBeVisible();
    // The section must still be open — tapping help is not the same tap as
    // toggling the disclosure.
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  });
});
