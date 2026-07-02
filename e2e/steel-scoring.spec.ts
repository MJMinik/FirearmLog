import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Layer 2 -- Steel Challenge (SCSA) scoring: time-only, best-4-of-5, lowest wins.
// We log a Steel match, enter five string times on one stage, and confirm the
// entry form derives the stage time (dropping the slowest string) and that the
// saved debrief shows the match total. Then we confirm Outer Limits keeps all 4
// strings (nothing dropped).

test.describe('Steel Challenge scoring (Layer 2)', () => {
  test('a Steel match derives stage time (best 4 of 5) and shows the match total', async ({ page }) => {
    await seedDemo(page); // seeds guns so the match form has a gun to pick
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();
    await page.getByLabel('What this Match is called').fill('Steel Test Match');

    // Choosing the Steel Challenge match type switches the Stages section to Steel.
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await expect(page.getByRole('heading', { name: /Stages & strings/ })).toBeVisible();
    // Power Factor doesn't apply to Steel, so it's hidden.
    await expect(page.getByRole('heading', { name: 'Power Factor' })).toHaveCount(0);

    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();

    // Five strings; the 6.00 is the slowest and gets dropped.
    await block.getByLabel('String 1 time (s)').fill('3.00');
    await block.getByLabel('String 2 time (s)').fill('3.50');
    await block.getByLabel('String 3 time (s)').fill('4.00');
    await block.getByLabel('String 4 time (s)').fill('4.50');
    await block.getByLabel('String 5 time (s)').fill('6.00');

    // Best 4 of 5 = 3.00 + 3.50 + 4.00 + 4.50 = 15.00, dropping string 5.
    await expect(block.getByText(/dropped String 5/)).toBeVisible();

    await page.getByRole('button', { name: 'Save Match' }).click();

    // The debrief shows the Steel stage-times card and the match total (lowest wins).
    await expect(page.getByRole('heading', { name: 'Steel Test Match' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Stage times/ })).toBeVisible();
    await expect(page.getByText('Match total', { exact: true })).toBeVisible();
    await expect(page.getByText('15s').first()).toBeVisible();
  });

  test('Outer Limits is a 4-string stage with nothing dropped', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this Match is called').fill('Outer Limits Test');
    await page.getByLabel('Match type').selectOption('Steel Challenge');

    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    await block.getByLabel('Which Steel stage').selectOption('Outer Limits');

    // Only 4 string fields should render, and there is no 5th.
    await expect(block.getByLabel('String 4 time (s)')).toBeVisible();
    await expect(block.getByLabel('String 5 time (s)')).toHaveCount(0);

    await block.getByLabel('String 1 time (s)').fill('4.00');
    await block.getByLabel('String 2 time (s)').fill('4.50');
    await block.getByLabel('String 3 time (s)').fill('5.00');
    await block.getByLabel('String 4 time (s)').fill('5.50');

    // All four count (19.00) and nothing is dropped.
    await expect(block.getByText(/dropped String/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Save Match' }).click();
    await expect(page.getByRole('heading', { name: 'Outer Limits Test' })).toBeVisible();
    await expect(page.getByText('19s').first()).toBeVisible();
  });
});
