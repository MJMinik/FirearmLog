import { test, expect } from '@playwright/test';

// Activation pass (session 35): the empty-Home fallback — what a newcomer sees
// after skipping the Setup Wizard with an empty log — must lead with the real
// first step (adding a gun) and the sample-data path, NOT the Pistol Tracker
// importer. The importer stays reachable, but demoted behind a reveal.
// (Before this change the empty Home led with "let's get your range history in
// here" + the importer — the wrong first door for a shooter with nothing to import.)
test.describe('First-run empty Home (activation)', () => {
  // Skip the auto-opened Setup Wizard to reach the empty-Home fallback.
  async function skipToEmptyHome(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/');
    await page
      .getByRole('button', { name: "Skip for now — I'm just looking around" })
      .click();
  }

  test('leads with "Add your first gun" and sample data; importer is demoted behind a reveal', async ({ page }) => {
    await skipToEmptyHome(page);
    const main = page.getByRole('main');

    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();

    // The two newcomer-first actions are the heroes.
    await expect(main.getByRole('button', { name: '+ Add your first gun' })).toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Just exploring? See it with sample data' }),
    ).toBeVisible();

    // The Pistol Tracker importer is fully retired from the user's view
    // (July 8 2026): no reveal, no import button, anywhere on first-run Home.
    await expect(
      main.getByRole('button', { name: 'Import Pistol Tracker Backup' }),
    ).toHaveCount(0);
    await expect(
      main.getByRole('button', { name: 'Already have data to bring in?' }),
    ).toHaveCount(0);
  });

  test('"Add your first gun" opens the gun form — the first-log path never dead-ends', async ({ page }) => {
    await skipToEmptyHome(page);
    await page
      .getByRole('main')
      .getByRole('button', { name: '+ Add your first gun' })
      .click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  });
});
