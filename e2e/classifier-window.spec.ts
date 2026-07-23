import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// T3-5 (July 23 2026): the Classification card's "which 6-of-8 scores count"
// reveal. The demo dataset carries 15 Carry Optics classifier scores, so the
// window is full (8) and a new score would displace the current oldest one --
// the exact case the "drops with your next classifier" marker exists for.
// Runs on both the desktop and phone projects.
test.describe('Classifier window reveal (T3-5)', () => {
  test('Show the scores that count reveals the window, a drop marker, and the next-classifier line', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    // Select Carry Optics (the demo's richest division -- 15 scores on record).
    const co = main.getByRole('button', { name: /Carry Optics:/ });
    await co.click();
    await expect(co).toHaveAttribute('aria-pressed', 'true');

    // Collapsed by default (§7: depth on demand, default view unchanged).
    const toggle = main.getByRole('button', { name: /Show the scores that count/ });
    await expect(toggle).toBeVisible();
    await expect(main.getByText('Counts toward your average').first()).toHaveCount(0);

    await toggle.click();

    // At least one row counts, and the oldest carries the drop marker (15 scores
    // on record is well past the 8 needed for a new score to displace one).
    await expect(main.getByText('Counts toward your average').first()).toBeVisible();
    await expect(main.getByText(/drops with your next classifier/)).toBeVisible();

    // The next-classifier line: either a solved percent, or the honest
    // "no single classifier" line when even 110 wouldn't clear the next band.
    // CO is a mid-B climber in the demo data (not unclassified, not GM), so one
    // of these two must show.
    await expect(
      main.getByText(/(A \d+(\.\d)?% or better on your next classifier moves you to \w+\.)|(No single classifier can move you up yet)/),
    ).toBeVisible();

    // The toggle collapses again.
    await main.getByRole('button', { name: /Hide the scores that count/ }).click();
    await expect(main.getByText('Counts toward your average').first()).toHaveCount(0);
  });

  test('the reveal is not offered for a division with no classifier scores', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Skip for now/ }).click();
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    // A fresh log has no classifier scores at all, so the whole Classification
    // card shows its empty state -- no reveal to offer.
    await expect(main.getByText('No classifier scores yet.')).toBeVisible();
    await expect(main.getByRole('button', { name: /Show the scores that count/ })).toHaveCount(0);
  });
});
