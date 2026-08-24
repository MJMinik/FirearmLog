import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection } from './helpers';

// The Tour & Setup sample-log bar (session 132, 24 Aug 2026 — Michael's own
// design from his tap-test note: the sample-log offer "should be on the
// previous screen ... the same long bar extending above Quick Tour/Full
// tour/Setup with the explanation coming in as the second paragraph").
// The button is the SAME shared component the wizard uses (SampleLogButton),
// so what this spec pins is the new surface: placement above the tour
// buttons, the empty-log immediate load landing on Home, and the confirm
// gate firing when data already exists — the gate that guards someone's log.

test.describe('Tour & Setup sample-log bar', () => {
  test('empty log: bar sits above the tour buttons and loads straight to Home', async ({ page }) => {
    await page.goto('/');
    // A fresh install auto-opens the Setup Wizard — leave it, so we reach the
    // Tour & Setup screen the way a just-looking-around visitor does.
    await page.getByRole('button', { name: /Skip for now/ }).click();
    await gotoSection(page, 'Tour & Setup');

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Tour & Setup' })).toBeVisible();

    // The explanation arrives as the card's second paragraph (his words),
    // and the bar renders ABOVE the Quick Tour button — assert real geometry,
    // not just presence, because placement IS the feature here.
    await expect(main.getByText(/Load a sample log — a year and a half/)).toBeVisible();
    const sampleBtn = main.getByRole('button', { name: 'See a log 18 months in' });
    const quickTour = main.getByRole('button', { name: 'Quick Tour' });
    await expect(sampleBtn).toBeVisible();
    const sampleBox = await sampleBtn.boundingBox();
    const quickBox = await quickTour.boundingBox();
    expect(sampleBox, 'sample bar should have geometry').not.toBeNull();
    expect(quickBox, 'Quick Tour should have geometry').not.toBeNull();
    expect(sampleBox!.y, 'the sample bar renders above the tour buttons').toBeLessThan(quickBox!.y);

    // Empty log → no confirm step — the load runs and lands on Home showing
    // the sample (the wizard's land-on-Home contract, kept on this surface).
    await sampleBtn.click();
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Live-fire rounds')).toBeVisible();
    await expect(page.getByText(/exploring a sample log/i)).toBeVisible();
  });

  test('with data on the device: the confirm gate fires, and Cancel changes nothing', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Tour & Setup');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'See a log 18 months in' }).click();

    // Data exists (the seeded sample counts — a log is a log), so the same
    // ConfirmSheet the wizard shows must gate the load here too.
    await expect(page.getByText('Load sample data?')).toBeVisible();
    await expect(page.getByText(/replaces what's on this device/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Cancel: still on Tour & Setup, nothing loaded, nothing lost.
    await expect(page.getByText('Load sample data?')).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'Tour & Setup' })).toBeVisible();
  });
});
