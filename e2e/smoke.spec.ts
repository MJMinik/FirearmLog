import { test, expect } from '@playwright/test';
import { seedDemo } from './helpers';

test.describe('Smoke', () => {
  test('a fresh install opens on the Setup Wizard with the start options', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up FirearmLog' })).toBeVisible();
    // First run is for new users: start fresh or explore sample data. (Importing
    // an old backup lives under Gear & Data, not in the first-run wizard.)
    await expect(page.getByRole('button', { name: 'Add my gear' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'See it with sample data' })).toBeVisible();
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
