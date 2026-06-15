import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// Deeper than navigation: prove the demo data actually flows through the
// read-only screens, not just that the screens render.

test.describe('Content from demo data', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  test('Compete shows matches and classifiers', async ({ page }) => {
    await gotoTab(page, 'Compete');
    await expect(page.getByRole('heading', { name: 'Matches' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Classifiers' }).first()).toBeVisible();
    await expect(page.getByText('Matches shot').first()).toBeVisible();
  });

  test('Costs computes an all-in cost per round', async ({ page }) => {
    await gotoSection(page, 'Costs & Purchases');
    await expect(page.getByText('All-in cost per round fired:')).toBeVisible();
  });

  test('Reports lists printable reports', async ({ page }) => {
    await gotoSection(page, 'Reports');
    await expect(page.getByText('Save as PDF').first()).toBeVisible();
    await expect(page.getByText('cost per round, spend by gun')).toBeVisible();
  });

  test('Progress renders without crashing', async ({ page }) => {
    await gotoTab(page, 'Progress');
    await expect(page.getByRole('heading', { name: 'Progress' }).first()).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});
