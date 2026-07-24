import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Change 1 (July 2026): Guns & Rounds is now a collapsible section that
// mirrors the Gear Checklist pattern. Key behaviors:
//
// 1. On a fresh log the section is OPEN (required-field guard — a first-timer
//    can never face a hidden required field).
// 2. After selecting the first gun the section auto-collapses and the
//    summary line shows the gun name + rounds.
// 3. Tapping the header reopens it.
// 4. Editing an existing session loads it collapsed with the summary visible.
// 5. A validation error on the Guns section forces it open.

const GUN = 'Shadow Systems DR920';

test.describe('Guns & Rounds collapsible', () => {
  test('fresh log: section starts open (required-field guard)', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();

    // The Guns & Rounds disclosure header is present and expanded.
    const header = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    const disclosure = header.locator('.checklist-disclosure').first();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // Gun toggles are visible (body is open).
    await expect(page.getByRole('button', { name: GUN })).toBeVisible();
  });

  test('after selecting a gun the section collapses and the summary line shows the gun', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick the gun and fill rounds.
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('100');

    // Section auto-collapsed after the first gun was picked.
    const header = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    const disclosure = header.locator('.checklist-disclosure').first();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Summary line shows the gun name and round count.
    await expect(header.locator('.report-note').first()).toContainText(GUN);
    await expect(header.locator('.report-note').first()).toContainText('100 rds');
  });

  test('tapping the header reopens the section', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick a gun so the section collapses.
    await page.getByRole('button', { name: GUN }).click();
    const header = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    const disclosure = header.locator('.checklist-disclosure').first();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Tap the header to reopen.
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

    // Gun toggles are visible again.
    await expect(page.getByRole('button', { name: GUN })).toBeVisible();
  });

  test('editing a saved session loads Guns & Rounds collapsed with summary visible', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('button', { name: GUN }).click();
    await page.getByLabel(`Rounds for ${GUN}`).fill('75');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the saved session.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();

    // Section loads collapsed.
    const header = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    const disclosure = header.locator('.checklist-disclosure').first();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Summary line shows the saved gun and round count.
    await expect(header.locator('.report-note').first()).toContainText(GUN);
    await expect(header.locator('.report-note').first()).toContainText('75 rds');
  });

  test('saving without a gun shows the validation error and forces the section open', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Collapse the section by tapping the header (it starts open).
    const header = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    const disclosure = header.locator('.checklist-disclosure').first();
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Try to save with no gun selected.
    await page.locator('.navbar-action').click();

    // The section must be forced open so the error and gun toggles are visible.
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#session-guns-err')).toBeVisible();
  });
});
