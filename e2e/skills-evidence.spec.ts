import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// F7 (batch 2): the Skills Check bridges a shooter's dated OPINION (their 1–10
// self-rating) to the MEASURED evidence (the timer's numbers). A curated, in-code
// map gives mapped skills a trailing "Measured" link to their drill history (or
// the accuracy card); unmapped skills get none — no link, no apology. A separate
// self-rating trend chart shows the opinion over time, drawn distinct from the
// measurement charts.

test.describe('Skills Check → measured evidence bridge (F7)', () => {
  test('a mapped skill links to its drill history; an unmapped one shows no link', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    const skills = page.getByRole('main').locator('.card').filter({
      has: page.getByRole('heading', { name: 'Skills Check' }),
    });

    // Draw is mapped → a "Measured" link; Movement is not → no link.
    await expect(skills.getByRole('button', { name: 'See the measured evidence for Draw' })).toBeVisible();
    await expect(skills.getByRole('button', { name: 'See the measured evidence for Movement' })).toHaveCount(0);
    await expect(skills.getByRole('button', { name: 'See the measured evidence for Recoil Control' })).toHaveCount(0);

    // Tapping Draw's link lands on the RIGHT drill's history.
    await skills.getByRole('button', { name: 'See the measured evidence for Draw' }).click();
    await expect(page.getByRole('heading', { name: 'Draw to First Shot' })).toBeVisible();
  });

  test('the self-rating trend renders, labelled as the shooter\'s own opinion, and reads out on tap', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    const skills = page.getByRole('main').locator('.card').filter({
      has: page.getByRole('heading', { name: 'Skills Check' }),
    });

    // The trend defaults to Draw and is titled as a self-assessment on its face.
    await expect(skills.getByText('Your self-ratings — how you scored your own Draw, 1–10, at each check.')).toBeVisible();
    const chart = skills.getByRole('img', { name: /Draw self-ratings/ });
    await expect(chart).toBeVisible();

    // Furniture manners: tapping a dot writes the readout for that check.
    await chart.locator('rect.chart-hit').first().click();
    await expect(skills.locator('p.chart-readout')).toContainText('you rated your Draw');

    // Picking another area re-titles the chart to that area.
    await skills.getByRole('button', { name: 'Splits', exact: true }).click();
    await expect(skills.getByText(/Your self-ratings — how you scored your own Splits/)).toBeVisible();
  });
});
