import { test, expect } from '@playwright/test';
import { seedDemo } from './helpers';

test.describe('Smoke', () => {
  test('a fresh install opens on the Setup Wizard with the start options', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up FirearmLog' })).toBeVisible();
    // First run is for new users: the 1-2-3 checklist (step 3b) or the sample
    // data door. (Restoring a backup lives under Sync & Backup, not here.)
    await expect(page.getByText("Let's get you set up — three steps:")).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: '1. Add a gun' })).toBeVisible();
    await expect(page.getByText('2. Pick a goal')).toBeVisible();
    await expect(page.getByText('3. Log your first session')).toBeVisible();
    await expect(page.getByRole('button', { name: 'See it with sample data' })).toBeVisible();
    // F6: a true first run has nowhere to go back to — no Back button.
    await expect(page.getByRole('button', { name: '‹ Back' })).toHaveCount(0);
  });

  test('the one-tap demo loads a full dataset and lands on a populated Home', async ({ page }) => {
    await seedDemo(page);
    // Home shows the headline stats and at least one gun in Firearm Status.
    await expect(page.getByText('Live-fire rounds')).toBeVisible();
    await expect(page.getByText('Sessions', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Firearm Status' })).toBeVisible();
    // No render crash: the error boundary fallback must not be on screen.
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});
