import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// The descriptive "Speed & Accuracy" read on the match debrief, plus the coaching-
// remarks toggle. We log a spotless USPSA match (all A's over two stages → 100% of
// points kept), confirm the block and the over-accuracy QUESTION appear, then turn
// coaching remarks off in Settings and confirm the numbers stay but the question goes.

async function cleanUspsaMatch(page: import('@playwright/test').Page, name: string) {
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await page.getByLabel('What this Match is called').fill(name);
  const addStage = page.getByRole('button', { name: '+ Add Stage' });
  await addStage.click();
  await addStage.click();
  const blocks = page.locator('.drill-edit');
  for (let i = 0; i < 2; i++) {
    const b = blocks.nth(i);
    await b.getByRole('button', { name: '+ Add hit breakdown (A/C/D/miss)' }).click();
    await b.getByLabel('Alphas (A)', { exact: true }).fill('10'); // all A's → 100% of points
  }
  await page.getByRole('button', { name: 'Save Match' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test.describe('Speed & Accuracy debrief', () => {
  test('a clean USPSA match shows the read and asks the over-accuracy question', async ({ page }) => {
    await seedDemo(page);
    await cleanUspsaMatch(page, 'SA Clean');

    await expect(page.getByRole('heading', { name: 'Speed & Accuracy' })).toBeVisible();
    await expect(page.getByText(/kept 100% of your points/)).toBeVisible();
    await expect(page.getByText(/room to push the pace/)).toBeVisible();
  });

  test('turning off coaching remarks hides the question but keeps the numbers', async ({ page }) => {
    await seedDemo(page);
    await cleanUspsaMatch(page, 'SA Toggle');
    await expect(page.getByText(/room to push the pace/)).toBeVisible();

    // Turn the remarks off in Settings.
    await gotoSection(page, 'Settings');
    await page.getByRole('switch', { name: /Coaching remarks/ }).click();

    // Back to the match: the accuracy numbers remain, the question is gone.
    await gotoTab(page, 'Compete');
    await page.getByText('SA Toggle', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Speed & Accuracy' })).toBeVisible();
    await expect(page.getByText(/kept 100% of your points/)).toBeVisible();
    await expect(page.getByText(/room to push the pace/)).toHaveCount(0);
  });
});
