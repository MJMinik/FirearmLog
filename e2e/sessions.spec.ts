import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

test.describe('Sessions', () => {
  test('the Log tab shows sessions and toggles to the calendar', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    // Demo data means there are sessions to show.
    await expect(page.getByRole('main').locator('.row-tap').first()).toBeVisible();

    // Flip to the calendar view and back.
    await page.getByRole('radio', { name: 'Calendar' }).click();
    await expect(page.getByRole('radio', { name: 'Calendar' })).toBeChecked();
    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.getByRole('radio', { name: 'List' })).toBeChecked();
  });

  test('logging a live-fire session records it', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick the first gun in the "Guns & Rounds" card and enter a round count.
    const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');

    // Save via the navbar action (date is prefilled to today).
    await page.locator('.navbar-action').click();

    // We return to the Log list; the new 50-round session is there
    // (rounds render as "rds" for live fire, "reps" for dry fire).
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await expect(page.getByText(/50\s*(rds|reps)/).first()).toBeVisible();
  });
});
