import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// The "What it cost" card + coaching read on the match debrief (T3-4). We log a
// USPSA match with a known cost -- stage 1: 8A 1C 1M in 10s at 60% (HF 3.3, all-A
// 5.0), stage 2: 10A in 10s at 90% -- so the numbers are hand-checkable: the miss
// is a 10-point penalty, and the anchored what-if is 90.5% against an actual 75%.
// The coaching read names stage 1 (the lowest percent) and what it cost there.

type Page = import('@playwright/test').Page;

async function logMatch(page: Page, name: string, stages: {
  time?: string; percent?: string; alphas?: string; charlies?: string; misses?: string;
}[]) {
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: '+ Log Match' }).click();
  await page.getByLabel('What this match is called').fill(name);
  const addStage = page.getByRole('button', { name: '+ Add Stage' });
  for (let i = 0; i < stages.length; i++) await addStage.click();
  const blocks = page.locator('.drill-edit');
  for (let i = 0; i < stages.length; i++) {
    const b = blocks.nth(i);
    const s = stages[i];
    if (s.time) await b.getByLabel('Time (s)').fill(s.time);
    if (s.percent) await b.getByLabel('Stage %').fill(s.percent);
    await b.getByRole('button', { name: '+ Add hit breakdown (A/C/D/miss)' }).click();
    if (s.alphas) await b.getByLabel('Alphas (A)', { exact: true }).fill(s.alphas);
    if (s.charlies) await b.getByLabel('Charlies (C)', { exact: true }).fill(s.charlies);
    if (s.misses) await b.getByLabel('Misses (M)', { exact: true }).fill(s.misses);
  }
  await page.getByRole('button', { name: 'Save match' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test.describe('What it cost + coaching read', () => {
  test('a fully anchored USPSA match shows the penalty cost and the what-if percent', async ({ page }) => {
    await seedDemo(page);
    await logMatch(page, 'Cost Anchored', [
      { time: '10', percent: '60', alphas: '8', charlies: '1', misses: '1' },
      { time: '10', percent: '90', alphas: '10' },
    ]);

    await expect(page.getByRole('heading', { name: 'What it cost' })).toBeVisible();
    await expect(page.getByText(/Your 1 miss cost about 10 points in penalties/)).toBeVisible();
    // Anchored what-if: (60 x 5/3.3 and 90) weighted by available points -> 90.5% vs actual 75%.
    await expect(page.getByText(/about 90\.5% instead of 75%/)).toBeVisible();

    // The coaching read says it in one place: toughest stage + its cost, points kept.
    await expect(page.getByRole('heading', { name: 'Coaching read' })).toBeVisible();
    await expect(page.getByText(/Stage 1 was the expensive one -- 1 miss there cost about 10 points/)).toBeVisible();
  });

  test('without every stage percent, the card stops at points -- no what-if guess', async ({ page }) => {
    await seedDemo(page);
    await logMatch(page, 'Cost Partial', [
      { time: '10', percent: '60', alphas: '8', charlies: '1', misses: '1' },
      { time: '10', alphas: '10' }, // no stage % -> the winner anchor is incomplete
    ]);

    await expect(page.getByRole('heading', { name: 'What it cost' })).toBeVisible();
    await expect(page.getByText(/Your 1 miss cost about 10 points in penalties/)).toBeVisible();
    await expect(page.getByText(/instead of/)).toHaveCount(0); // the percent line honestly stays off
  });
});
