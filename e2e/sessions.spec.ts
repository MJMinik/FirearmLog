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
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('logging a live-fire session records it', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Pick the first gun in the "Guns & Rounds" card and enter a round count.
    const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');

    // Save via the navbar action (date is prefilled to today).
    await page.locator('.navbar-action').click();

    // We return to the Log list; the new 50-round session is there
    // (rounds render as "rds" for live fire, "reps" for dry fire).
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await expect(page.getByText(/50\s*(rds|reps)/).first()).toBeVisible();
  });

  // Session-55 fresh-eyes find: with an EMPTY ammo library the Ammo Used card
  // used to vanish entirely — a new user never learned it existed. Now it
  // stays and teaches the door; with ammo present, the normal card shows.
  test('empty ammo library: Log Session keeps the Ammo Used card as a hint', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('main').getByRole('button', { name: '1. Add a gun' }).click();
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
    await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await page.getByRole('main').getByRole('button', { name: '+ Log Session', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ammo Used' })).toBeVisible();
    await expect(page.getByText('Add your ammo under More → Ammo to track rounds used here.')).toBeVisible();
  });

  test('with ammo in the library, the hint is gone and the real card shows', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Ammo Used' })).toBeVisible();
    await expect(page.getByText('Add your ammo under More → Ammo', { exact: false })).toHaveCount(0);
  });
});
