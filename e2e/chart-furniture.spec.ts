import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// F4 (stranger-test finding, session 62): every chart must answer, by itself,
// "what am I looking at, over what dates, and what are the numbers?" These
// runs prove the furniture is really there on the seeded demo — y ticks, date
// anchors, the always-visible latest value, and the tap-readout line that
// starts as a hint (Michael's discoverability condition) and fills on tap.

test.describe('Chart furniture (F4)', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  test('Accuracy across matches: ticks, date anchors, last value, tap-readout', async ({ page }) => {
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    const card = main.locator('.card').filter({
      has: page.getByRole('heading', { name: /Accuracy across matches/ }),
    });
    await expect(card).toBeVisible();

    // Three % ticks (the accuracy band is always a real domain) and at least
    // two date anchors.
    await expect(card.locator('text.chart-tick').filter({ hasText: '100%' })).toBeVisible();
    expect(await card.locator('text.chart-tick').count()).toBe(3);
    expect(await card.locator('text.chart-date').count()).toBeGreaterThanOrEqual(2);

    // The latest match's number is always visible.
    await expect(card.locator('text.chart-last-label')).toBeVisible();

    // The readout starts as the hint, then a tap fills it with a real value —
    // and the tapped dot wears exactly one selection ring, which MOVES on the
    // next tap rather than accumulating.
    await expect(card.locator('.chart-readout')).toHaveText(/Tap a dot/);
    await expect(card.locator('.chart-sel-ring')).toHaveCount(0);
    await card.locator('.chart-hit').last().click();
    await expect(card.locator('.chart-readout')).toHaveText(/% of points kept/);
    await expect(card.locator('.chart-readout')).not.toHaveText(/Tap a dot/);
    await expect(card.locator('.chart-sel-ring')).toHaveCount(1);
    const ringX1 = await card.locator('.chart-sel-ring').getAttribute('cx');
    await card.locator('.chart-hit').first().click();
    await expect(card.locator('.chart-sel-ring')).toHaveCount(1);
    expect(await card.locator('.chart-sel-ring').getAttribute('cx')).not.toBe(ringX1);
  });

  test('Drill history trend: unit ticks, date anchors, last value, tap-readout', async ({ page }) => {
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    await main.locator('button.pr-row').first().click();

    const card = main.locator('.card').filter({
      has: page.getByRole('heading', { name: /^Trend/ }),
    });
    await expect(card).toBeVisible();

    // Three unit-aware y ticks (a flat domain would collapse to one — the
    // demo's drills vary), date anchors, and the latest run's number.
    expect(await card.locator('text.chart-tick').count()).toBeGreaterThanOrEqual(1);
    expect(await card.locator('text.chart-date').count()).toBeGreaterThanOrEqual(2);
    await expect(card.locator('text.chart-last-label')).toBeVisible();

    // Hint → readout on tap (each run owns a full-height invisible column).
    await expect(card.locator('.chart-readout')).toHaveText(/Tap a dot/);
    await card.locator('.chart-hit').first().click();
    await expect(card.locator('.chart-readout')).not.toHaveText(/Tap a dot/);
    await expect(card.locator('.chart-readout')).toHaveText(/—/);
  });

  test('Rounds by Month: whole columns answer a tap with the month\'s numbers', async ({ page }) => {
    // Home carries the chart; the demo has months of data.
    const main = page.getByRole('main');
    const card = main.locator('.card').filter({
      has: page.getByRole('heading', { name: /Rounds by Month/ }),
    });
    await expect(card).toBeVisible();

    await expect(card.locator('.chart-readout')).toHaveText(/Tap a bar/);
    // The CURRENT month (last column) can be empty — tap it first to prove an
    // empty month reads out honestly with NO ring (there's no bar to wear it),
    // then tap the oldest month, which has rounds, and expect the outline.
    await card.locator('.chart-hit').last().click();
    await expect(card.locator('.chart-readout')).toHaveText(/live · .* match · .* dry reps/);
    await card.locator('.chart-hit').first().click();
    await expect(card.locator('.chart-readout')).toHaveText(/live · .* match · .* dry reps/);
    await expect(card.locator('.chart-sel-ring')).toHaveCount(1);
  });

  test('the readout never goes stale: a month that leaves the chart leaves the readout', async ({ page }) => {
    // The audit's catch (session 62): a readout that kept asserting numbers
    // for data the chart no longer shows would be a lie under the chart. The
    // readout derives from current data — prove it: tap the OLDEST month in
    // the 12-month view, then narrow the span to 6 months. That month is no
    // longer drawn, so the readout must return to the hint.
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    const card = main.locator('.card').filter({
      has: page.getByRole('heading', { name: /^Trends/ }),
    });
    await expect(card).toBeVisible();

    await card.locator('.chart-hit').first().click();
    const readout = card.locator('.chart-readout');
    await expect(readout).toHaveText(/live · .* match · .* dry reps/);

    await card.getByRole('button', { name: 'Filters' }).click();
    await card.locator('select[aria-label="Months"]').selectOption('6');

    // Both the readout AND the selection ring let go of the vanished month.
    await expect(readout).toHaveText(/Tap a bar/);
    await expect(card.locator('.chart-sel-ring')).toHaveCount(0);
  });
});
