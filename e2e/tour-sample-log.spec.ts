import { test, expect, type Page } from '@playwright/test';
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

// Findability memo, decision 60 (4) & (3), 10 Sep 2026: the six Full Tour
// gaps closed with new sentences, and the "Where do I find…" static index.

/** Click Next through the open Full Tour sheet until its h3 title matches
 *  `title`, and return the sheet's body paragraph text. Fails loudly (via
 *  toPass' timeout) rather than looping forever if the title never appears. */
async function tourStepBody(page: Page, title: string): Promise<string> {
  const heading = page.getByRole('heading', { level: 3, name: title, exact: true });
  for (let i = 0; i < 25 && !(await heading.count()); i++) {
    await page.getByRole('button', { name: 'Next ›' }).click();
  }
  await expect(heading).toBeVisible();
  return (await page.locator('.sheet-body p.report-note').first().textContent()) ?? '';
}

test.describe('Full Tour: the six findability-memo sentences', () => {
  test('each new sentence is present in its step', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Skip for now/ }).click();
    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('button', { name: 'Full Tour' }).click();

    // The Full Tour only moves forward (Next), so these must run in the
    // tour's own step order, not the memo's order.
    const drillsBody = await tourStepBody(page, 'Drills');
    expect(drillsBody).toContain('View your history');
    expect(drillsBody).toContain('newest first');

    const classifiersBody = await tourStepBody(page, 'Compete — classifiers');
    expect(classifiersBody).toContain('also its own stop under Training');

    const opticsBody = await tourStepBody(page, 'Optics, magazines & spare parts');
    expect(opticsBody).toContain('Parts Report');

    const ammoBody = await tourStepBody(page, 'Ammo & costs');
    expect(ammoBody).toContain('+ Add Purchase');

    const settingsBody = await tourStepBody(page, 'Settings');
    expect(settingsBody).toContain('coaching-remarks switch');
    expect(settingsBody).toContain('Manage lists');

    const setupBody = await tourStepBody(page, 'Setup & sample data');
    expect(setupBody).toContain('Where do I find…');

    await page.getByRole('button', { name: 'Close' }).click();
  });

  test('the new Settings step\'s "Take me there" opens Settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Skip for now/ }).click();
    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('button', { name: 'Full Tour' }).click();
    await tourStepBody(page, 'Settings');
    await page.getByRole('button', { name: 'Take me there' }).click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });
});

test.describe('Help: the "Where do I find…" static index', () => {
  test('lists every nav group, and a tapped row jumps to the right screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Skip for now/ }).click();
    await gotoSection(page, 'Tour & Setup');

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Where do I find…', level: 2 })).toBeVisible();

    for (const group of ['Home, Log, Compete & Progress', 'Your Gear', 'Training', 'Records', 'App & Data']) {
      await expect(main.getByRole('button', { name: new RegExp(`^${group}`) })).toBeVisible();
    }

    // Open "Your Gear" and jump to Guns — proves the row reuses the tours'
    // own jump mechanism (open), landing on the real Guns screen.
    await main.getByRole('button', { name: /^Your Gear/ }).click();
    await main.getByRole('button', { name: /^Guns/ }).click();
    await expect(main.getByRole('heading', { name: 'Guns', level: 1 })).toBeVisible();
  });
});
