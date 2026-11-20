import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Layer 2 -- Score reconciliation ("my official score didn't match yours -- why?").
// On the debrief of a time-plus match (Steel / IDPA), a collapsed card lets the user
// enter the official per-stage time and flags any gap stage-by-stage plus on the
// match total. It's diagnostic only -- no db write. We log a one-stage Steel match
// (best 4 of 5 = 15.00s), reveal the card, and check both the match case and a gap.

test.describe('Score reconciliation (Layer 2)', () => {
  test('reconcile card flags a match and a per-stage gap against the official time', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this match is called').fill('Reconcile Test');
    await page.getByLabel('Match type').selectOption('Steel Challenge');

    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    // Best 4 of 5 = 3.00 + 3.50 + 4.00 + 4.50 = 15.00 (String 5 dropped).
    await block.getByLabel('String 1 time (s)').fill('3.00');
    await block.getByLabel('String 2 time (s)').fill('3.50');
    await block.getByLabel('String 3 time (s)').fill('4.00');
    await block.getByLabel('String 4 time (s)').fill('4.50');
    await block.getByLabel('String 5 time (s)').fill('6.00');

    await page.getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByRole('heading', { name: 'Reconcile Test' })).toBeVisible();

    // The reconcile card is collapsed by default; reveal it.
    await expect(page.getByRole('heading', { name: 'Reconcile with the official score' })).toBeVisible();
    await page.getByRole('button', { name: /Reconcile it/ }).click();

    const officialField = page.getByLabel('Official (s)').first();

    // Matching official time -> "Matches" on the stage and the match total.
    await officialField.fill('15');
    await expect(page.getByText('Matches ✓').first()).toBeVisible();

    // A gap -> "Off by" with the signed difference (official 16 - ours 15 = +1s).
    await officialField.fill('16');
    await expect(page.getByText(/Off by \+1s/).first()).toBeVisible();

    // The card closes again (20 Nov 2026: once open it could not be closed), and
    // reopening it still holds what was typed.
    const toggle = page.getByRole('button', { name: 'Close reconcile' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(page.getByLabel('Official (s)')).toHaveCount(0);
    await expect(page.getByText(/Off by \+1s/)).toHaveCount(0);
    const opener = page.getByRole('button', { name: /Reconcile it/ });
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await opener.click();
    await expect(page.getByLabel('Official (s)').first()).toHaveValue('16');
  });

  test('a Steel stage shows the average of the strings that counted, and the match total does not', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this match is called').fill('Average Test');
    await page.getByLabel('Match type').selectOption('Steel Challenge');
    await page.getByRole('button', { name: '+ Add Stage' }).click();
    const block = page.locator('.drill-edit').first();
    // Best 4 of 5 = 3.00 + 3.50 + 4.00 + 4.50 = 15.00; 15.00 / 4 = 3.75 (the 6.00 is dropped).
    await block.getByLabel('String 1 time (s)').fill('3.00');
    await block.getByLabel('String 2 time (s)').fill('3.50');
    await block.getByLabel('String 3 time (s)').fill('4.00');
    await block.getByLabel('String 4 time (s)').fill('4.50');
    await block.getByLabel('String 5 time (s)').fill('6.00');
    await page.getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByRole('heading', { name: 'Average Test' })).toBeVisible();

    await expect(page.getByText('Average counted string: 3.75s')).toBeVisible();
    // Exactly one average line: one stage has one, the Match total row has none.
    await expect(page.getByText(/Average counted string/)).toHaveCount(1);
  });
});
