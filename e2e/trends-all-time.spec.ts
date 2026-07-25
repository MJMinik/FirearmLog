import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Verifies that selecting "All time" in the Trends card Months filter:
//   1. Updates every row label to show "(all time)".
//   2. The Malfunctions row shows a numeric rate (the demo data has malfunctions).
// Runs on both desktop and mobile projects automatically (no per-project loop needed).

test.describe('Trends — All time span', () => {
  test('selecting All time updates labels and shows a malfunction rate', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    // Open the Filters reveal to expose the Months select.
    await page.getByRole('main').getByRole('button', { name: 'Filters' }).first().click();
    await expect(page.getByLabel('Months')).toBeVisible();

    // Select "All time".
    await page.getByLabel('Months').selectOption('all');

    // (1) At least one row label now contains "(all time)".
    await expect(page.getByText('(all time)', { exact: false }).first()).toBeVisible();

    // (2) The Malfunctions row shows a numeric rate — not the "—" empty state.
    // The label text is: "Malfunctions / 1,000 rds (all time)". getByRole('generic')
    // matches nothing in Playwright — scope by the row's own class instead.
    const malfRow = page.locator('.row', { hasText: /Malfunctions \/ 1,000 rds \(all time\)/ });
    await expect(malfRow).toBeVisible();
    // The value cell reads like "0.8 (3)", not "—".
    await expect(malfRow.locator('.value')).toHaveText(/^\d+\.\d+ \(\d+\)$/);
  });
});
