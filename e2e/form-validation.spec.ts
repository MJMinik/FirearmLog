import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Batch 4a — validation & error display. These forms used to save empty/default
// shells silently; now each blocks the save and explains why (a shared FormProblem).
// We drive the real screens and assert both the block and the recovery.

test.describe('Form validation guards empty/default saves', () => {
  test('N3 — a new Skills Check needs at least one rated area', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    await page.getByRole('button', { name: '+ New Check' }).click();
    await expect(page.getByRole('heading', { name: 'New Check' })).toBeVisible();

    // Nothing rated yet (ratings default to unset, not a fake all-5s) — Save is blocked.
    await page.getByRole('button', { name: 'Save assessment' }).click();
    await expect(page.getByText('Rate at least one area before saving.')).toBeVisible();

    // Rate a single area and it saves — the sheet closes.
    await page.getByLabel('Draw', { exact: true }).selectOption('7');
    await page.getByRole('button', { name: 'Save assessment' }).click();
    await expect(page.getByRole('heading', { name: 'New Check' })).toHaveCount(0);
  });

  test('M2 — Log Match refuses an empty shell', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();

    // Date (today) and gun (first) are auto-filled, so the new rule is what blocks:
    // no name, no rounds, no stage.
    await page.getByRole('main').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Add a name, the rounds fired, or a stage before saving.')).toBeVisible();

    // Giving it a name clears the block and it saves (we land on the debrief).
    await page.getByLabel('What this match is called').fill('Validation Test Match');
    await page.getByRole('main').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Validation Test Match' })).toBeVisible();
  });

  test('N9 — Add Goal refuses empty text', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    await page.getByRole('button', { name: '+ Add Goal' }).click();
    // The inline "Add Goal" button with no text entered — blocked with a reason.
    await page.getByRole('button', { name: 'Add Goal', exact: true }).click();
    await expect(page.getByText('Enter the goal before saving.')).toBeVisible();
  });
});
