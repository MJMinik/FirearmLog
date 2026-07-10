import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

test.describe('Setup wizard', () => {
  test('first run leads with the checklist; step 1 opens the gun form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText("Let's get you set up — three steps:")).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: '1. Add a gun' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  });

  test('loading sample data on top of existing data asks for confirmation', async ({ page }) => {
    await seedDemo(page);

    // Re-open the wizard from Tour & Setup.
    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('button', { name: 'Set Up' }).click();
    await expect(page.getByRole('heading', { name: 'Set up FirearmLog' })).toBeVisible();

    // With data already present, the demo button must warn before replacing it.
    await page.getByRole('button', { name: 'See it with sample data' }).click();
    await expect(page.getByRole('heading', { name: 'Load sample data?' })).toBeVisible();

    await page.getByRole('button', { name: 'Load sample data' }).click();
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
