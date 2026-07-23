import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Layer 1 -- the match-after debrief on the Match detail screen. We log a match
// with two stages of clearly different hit factor, then confirm the detail view
// renders the stage breakdown and flags the weakest (lower hit factor) stage.
// T3-6b (July 23 2026): "Toughest" was renamed "Weakest" -- the metric ranks the
// shooter's own stage percents, not how hard a stage was for the field.

test.describe('Match-after debrief (Layer 1)', () => {
  test('a logged match shows a stage breakdown that flags weakest + strongest', async ({ page }) => {
    await seedDemo(page); // seeds guns so the match form has a gun to pick
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();
    await page.getByLabel('What this match is called').fill('Debrief Test Match');

    // Two stages: stage 1 strong (80pts / 8s = HF 10), stage 2 weak (60 / 12 = HF 5).
    const addStage = page.getByRole('button', { name: '+ Add Stage' });
    await addStage.click();
    await addStage.click();
    const blocks = page.locator('.drill-edit');
    await blocks.nth(0).getByLabel('Points').fill('80');
    await blocks.nth(0).getByLabel('Time (s)').fill('8');
    await blocks.nth(1).getByLabel('Points').fill('60');
    await blocks.nth(1).getByLabel('Time (s)').fill('12');

    await page.getByRole('button', { name: 'Save match' }).click();

    // We land on the match detail (the debrief).
    await expect(page.getByRole('heading', { name: 'Debrief Test Match' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Stage breakdown/ })).toBeVisible();

    // Stage 2 has the lower hit factor, so it is flagged the weakest; stage 1 the strongest.
    await expect(page.getByText('Weakest', { exact: true })).toBeVisible();
    await expect(page.getByText('Strongest', { exact: true })).toBeVisible();
  });

  test('a stage hit breakdown derives the all-alphas read-back', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this match is called').fill('Breakdown Test');

    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    await block.getByLabel('Time (s)').fill('2');
    await block.getByRole('button', { name: /Add hit breakdown/ }).click();
    await block.getByLabel('Alphas (A)', { exact: true }).fill('1');
    await block.getByLabel('Charlies (C)', { exact: true }).fill('1');

    // Points is now derived (read-only) from the hits: 1A(5) + 1C(3) minor = 8.
    await expect(block.getByLabel(/^Points/)).toHaveValue('8');

    await page.getByRole('button', { name: 'Save match' }).click();

    await expect(page.getByRole('heading', { name: 'Breakdown Test' })).toBeVisible();
    // Minor 1A 1C in 2s = HF 4.0; all alphas = 5.0 (+1.0).
    await expect(page.getByText(/all A's/)).toBeVisible();
  });
});
