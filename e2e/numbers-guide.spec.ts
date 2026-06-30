import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// The in-app "How the numbers work" wiki, reached from the match debrief.
// A logged match (any with a stage) shows the link; tapping it opens the explainer.

test.describe('How the numbers work (wiki)', () => {
  test('opens from a match debrief and explains the scoring', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this Match is called').fill('Wiki Link Test');
    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    await block.getByLabel(/^Points/).fill('50');
    await block.getByLabel('Time (s)').fill('10');
    await page.getByRole('button', { name: 'Save Match' }).click();

    await expect(page.getByRole('heading', { name: 'Wiki Link Test' })).toBeVisible();

    await page.getByRole('button', { name: /How the numbers work/ }).click();
    await expect(page.getByRole('heading', { name: 'How the numbers work' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hit factor' })).toBeVisible();
  });
});
