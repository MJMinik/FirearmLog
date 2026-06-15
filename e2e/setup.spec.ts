import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

test.describe('Setup wizard', () => {
  test('"Start fresh" opens the add-your-gear checklist', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add my gear' }).click();
    await expect(page.getByRole('heading', { name: 'Add your gear' })).toBeVisible();
    // The gear checklist nudges a gun first.
    await expect(page.getByText('Guns', { exact: false }).first()).toBeVisible();
  });

  test('loading sample data on top of existing data asks for confirmation', async ({ page }) => {
    await seedDemo(page);

    // Re-open the wizard from Help.
    await gotoSection(page, 'Help & Tour');
    await page.getByRole('button', { name: 'Set Up' }).click();
    await expect(page.getByRole('heading', { name: 'Set up FirearmLog' })).toBeVisible();

    // With data already present, the demo button must warn before replacing it.
    await page.getByRole('button', { name: 'See it with sample data' }).click();
    await expect(page.getByRole('heading', { name: 'Load sample data?' })).toBeVisible();

    await page.getByRole('button', { name: 'Load sample data' }).click();
    await expect(page.getByRole('heading', { name: 'FirearmLog' })).toBeVisible({ timeout: 20_000 });
  });
});
