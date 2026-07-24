import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Removing the redundant "Planned session" toggle (the footgun): a session's
// planned/logged state is set only by the entry point (+ Plan Session vs
// + Log Session) and the explicit "Convert to logged session" button — never by
// a stray toggle that converted on Save. This locks that shut: editing a plan
// and saving must keep it a plan (no silent conversion, no ammo deducted).
// Runs on desktop + phone (CI). First real run is on the PR.

test.describe('Planned session has no stray convert toggle', () => {
  test('the old toggle is gone, and editing a plan keeps it planned', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    // Start a plan and give it a distinctive location so we can find its row.
    await page.getByRole('button', { name: '+ Plan Session' }).click();
    await expect(page.getByRole('heading', { name: 'Plan Session' })).toBeVisible();

    // The removed footgun: the always-on "Planned session ..." toggle is gone.
    await expect(page.getByRole('button', { name: /Planned session/ })).toHaveCount(0);

    await page.getByLabel('Where').fill('Footgun Range');
    const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');
    await page.locator('.navbar-action').click(); // Save

    // Back on the Log list: the row is marked with the "Planned" badge.
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    const planRow = page.locator('.row-tap', { hasText: 'Footgun Range' });
    await expect(planRow.getByText('Planned')).toBeVisible();

    // Open it: still a plan (the Convert button shows only for plans), and the
    // removed toggle is still absent.
    await planRow.click();
    await expect(page.getByRole('button', { name: /Convert to logged session/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Planned session/ })).toHaveCount(0);

    // Make an innocuous edit (change the rounds) and save — the exact scenario
    // that used to risk a stray toggle tap silently converting it.
    await gunsCard.getByRole('spinbutton').first().fill('60');
    await page.locator('.navbar-action').click();

    // Still a plan: the "Planned" badge is still on its row.
    const planRowAfter = page.locator('.row-tap', { hasText: 'Footgun Range' });
    await expect(planRowAfter.getByText('Planned')).toBeVisible();
  });
});
