import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// H-1 (session 78 audit): Guns & Rounds no longer auto-collapses the moment
// the first gun is picked on a NEW session — collapsing mid-pick used to
// unmount the rounds input right under the shooter's finger, so sessions
// could be saved with 0 rounds silently. A NEW session's section now stays
// open through the whole pick; an EXISTING (saved) session still loads
// collapsed on open — that behavior is unrelated and unchanged. Key behaviors:
//
// 1. NEW session: picking a gun leaves the section OPEN — the regression pin.
// 2. NEW session: fill rounds, save, reopen from the list → loads COLLAPSED
//    with a truthful "<gun> · N rds" summary.
// 3. Manual toggle works both ways (Hide/Show), values intact either way.
// 4. An existing (demo) session opens collapsed with a truthful summary.
// 5. Removing the only gun blocks Save with the field error, and the section
//    stays open / is forced open so the shooter can see what to fix.

const GUN = 'Shadow Systems DR920';

test.describe('Guns & Rounds collapsible', () => {
  test('picking a gun on a NEW session leaves the section open (H-1 regression pin)', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();

    const disclosure = page.getByTestId('session-guns-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // Pick the gun — the section must NOT collapse, and the rounds input for
    // it must stay visible so it can be filled in the same motion.
    await page.getByRole('button', { name: GUN }).click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const roundsInput = page.getByLabel(`Rounds for ${GUN}`);
    await expect(roundsInput).toBeVisible();
    await roundsInput.fill('100');

    // Still open after typing — nothing re-collapses the section mid-entry.
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(roundsInput).toHaveValue('100');
  });

  test('save, then reopen from the list: the section loads collapsed with a truthful summary', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('75');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the saved session — Guns & Rounds loads collapsed (unrelated,
    // unchanged behavior for an EXISTING session).
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    const gunsCard = page.getByTestId('session-guns-card');
    const disclosure = page.getByTestId('session-guns-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(gunsCard.locator('.report-note').first()).toContainText(`${GUN} · 75 rds`);
  });

  test('manual toggle works both ways, and values survive Hide/Show', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('42');

    const gunsCard = page.getByTestId('session-guns-card');
    const disclosure = page.getByTestId('session-guns-disclosure');

    // Hide: the body (and its rounds input) disappears, but the summary line
    // — still showing the real values — stays visible.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel(`Rounds for ${GUN}`)).toHaveCount(0);
    await expect(gunsCard.locator('.report-note').first()).toContainText(`${GUN} · 42 rds`);

    // Show: the body reappears with the value intact.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel(`Rounds for ${GUN}`)).toHaveValue('42');
  });

  test('an existing demo session opens collapsed with a truthful summary', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();

    const gunsCard = page.getByTestId('session-guns-card');
    const disclosure = page.getByTestId('session-guns-disclosure');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    // The summary line reports at least one real gun name — not a placeholder.
    await expect(gunsCard.locator('.report-note').first()).toContainText('rds');
  });

  test('removing the only gun blocks Save and keeps the section visible with the error', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    const gunsCard = page.getByTestId('session-guns-card');
    const disclosure = page.getByTestId('session-guns-disclosure');
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('30');

    // Toggle the same gun off again — back to zero guns, section still open.
    await page.getByRole('button', { name: GUN }).click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // Collapsing now (manually) with no gun picked shows the honest empty summary.
    await disclosure.click();
    await expect(gunsCard.locator('.report-note').first()).toContainText('No gun selected yet.');

    // Attempting to save with no gun is blocked, and the section is forced
    // back open so the error and the gun toggles are visible.
    await page.locator('.navbar-action').click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#session-guns-err')).toContainText('Pick at least one gun.');
  });
});
