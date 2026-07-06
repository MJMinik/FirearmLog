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
