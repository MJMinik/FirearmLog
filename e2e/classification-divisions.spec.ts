import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// The demo dataset carries classifier scores in three USPSA divisions —
// Carry Optics (B), Limited Optics (B), Production (C). Compete shows them all
// at a glance in one shared grid, and tapping a division reveals its progress
// detail. Runs on both the desktop and phone projects.
test.describe('Multi-division classification', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  test('Compete shows every division at a glance and taps through to detail', async ({ page }) => {
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    // All three divisions appear as selectable class cells (the shared grid).
    await expect(main.getByRole('button', { name: /Carry Optics: B class/ })).toBeVisible();
    await expect(main.getByRole('button', { name: /Limited Optics: B class/ })).toBeVisible();
    const production = main.getByRole('button', { name: /Production: C class/ });
    await expect(production).toBeVisible();

    // Tapping Production selects it and shows its path to the next class (B at 60%).
    await production.click();
    await expect(production).toHaveAttribute('aria-pressed', 'true');
    await expect(main.getByText(/Production: B class starts at 60%/)).toBeVisible();
  });

  test('Home surfaces the multi-division grid too', async ({ page }) => {
    // Home shows the top division in the headline and the rest in the grid below;
    // Production only appears in that grid, so its presence proves the grid rendered.
    await expect(page.getByRole('main').getByText('Production').first()).toBeVisible();
  });
});

// H-2 fix (July 2026 code review): USPSA grants no classification until 4
// valid scores are on record. One hot score must show "unclassified", never a
// class letter — on the Compete grid cell and in the progress note.
test.describe('Classification requires 4 scores (USPSA rule)', () => {
  test('a single hot classifier shows unclassified, not a class letter', async ({ page }) => {
    await page.goto('/');
    // Fresh install: skip the wizard, so the log holds exactly what we enter.
    await page.getByRole('button', { name: /Skip for now/ }).click();
    await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();

    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: '+ Log Classifier' }).click();
    await page.getByLabel('Classifier code').fill('23-01');
    await page.getByLabel('Percent', { exact: true }).fill('96');
    await page.getByRole('button', { name: 'Save classifier' }).click();

    // Saving lands back on Home; return to Compete for the read.
    await gotoTab(page, 'Compete');
    // The grid cell says unclassified (a 96% single score must NOT read "GM").
    await expect(
      main.getByRole('button', { name: /Carry Optics: unclassified — 1 of 4 scores/ }),
    ).toBeVisible();
    // And the progress note spells out the path to a first class.
    await expect(main.getByText(/1 of the 4 scores USPSA/)).toBeVisible();
  });
});
