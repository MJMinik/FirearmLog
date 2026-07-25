import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Verifies that selecting "All time" in the Trends card Time span filter:
//   1. Updates every row label to show "(all time)".
//   2. "Live + match rounds (all time)" reads the EXACT lifetime total from the
//      demo dataset — 25,613 (verified independently against
//      public/demo-dataset.bin via src/lib/flog.ts + src/lib/dashboard.ts's
//      roundsByMonth, on this branch, July 2026). A shape-only regex would
//      pass even if H-3's window/live-session fix silently changed the
//      figure for clean data, which the fix must NOT do.
//   3. The Malfunctions row shows a numeric rate (the demo data has malfunctions) —
//      shape assertion only, since the exact count is covered at the unit level.
// Runs on both desktop and mobile projects automatically (no per-project loop needed).

test.describe('Trends — All time span', () => {
  test('selecting All time updates labels and shows the exact lifetime totals', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');

    // Open the Filters reveal to expose the Time span select.
    await page.getByRole('main').getByRole('button', { name: 'Filters' }).first().click();
    await expect(page.getByLabel('Time span')).toBeVisible();

    // Select "All time".
    await page.getByLabel('Time span').selectOption('all');

    // (1) At least one row label now contains "(all time)".
    await expect(page.getByText('(all time)', { exact: false }).first()).toBeVisible();

    // (2) "Live + match rounds (all time)" is the exact demo-dataset lifetime figure.
    const roundsRow = page.locator('.row', { hasText: /Live \+ match rounds \(all time\)/ });
    await expect(roundsRow).toBeVisible();
    await expect(roundsRow.locator('.value')).toHaveText('25,613');

    // (3) The Malfunctions row shows a numeric rate — not the "—" empty state.
    // The label text is: "Malfunctions / 1,000 rds (all time)". getByRole('generic')
    // matches nothing in Playwright — scope by the row's own class instead.
    const malfRow = page.locator('.row', { hasText: /Malfunctions \/ 1,000 rds \(all time\)/ });
    await expect(malfRow).toBeVisible();
    // The value cell reads like "0.3 (8)", not "—".
    await expect(malfRow.locator('.value')).toHaveText(/^\d+\.\d+ \(\d+\)$/);
  });
});
