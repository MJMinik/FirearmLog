import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Layer 1 -- the match-after debrief on the Match detail screen. We log a match
// with two stages of clearly different hit factor, then confirm the detail view
// renders the stage breakdown and flags the toughest (lower hit factor) stage.

test.describe('Match-after debrief (Layer 1)', () => {
  test('a logged match shows a stage breakdown that flags toughest + strongest', async ({ page }) => {
    await seedDemo(page); // seeds guns so the match form has a gun to pick
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();
    await page.getByLabel('What this Match is called').fill('Debrief Test Match');

    // Two stages: stage 1 strong (80pts / 8s = HF 10), stage 2 weak (60 / 12 = HF 5).
    const addStage = page.getByRole('button', { name: '+ Add Stage' });
    await addStage.click();
    await addStage.click();
    const blocks = page.locator('.drill-edit');
    await blocks.nth(0).getByLabel('Points').fill('80');
    await blocks.nth(0).getByLabel('Time (s)').fill('8');
    await blocks.nth(1).getByLabel('Points').fill('60');
    await blocks.nth(1).getByLabel('Time (s)').fill('12');

    await page.getByRole('button', { name: 'Save Match' }).click();

    // We land on the match detail (the debrief).
    await expect(page.getByRole('heading', { name: 'Debrief Test Match' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Stage breakdown/ })).toBeVisible();

    // Stage 2 has the lower hit factor, so it is flagged the toughest; stage 1 the strongest.
    await expect(page.getByText('Toughest', { exact: true })).toBeVisible();
    await expect(page.getByText('Strongest', { exact: true })).toBeVisible();
  });
});
