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
      main.getByRole('button', { name: 'Just looking? See a log 18 months in' }),
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

// Session 59: the two first-run coach marks — anchored amber guidance chosen
// over modal popups (a modal's guidance dies with the reflex-dismiss; an
// anchored mark stays until acted on). These specs guard the full lifecycle:
// shown at the right moment, gone when acted on, and a ✕ that sticks.
test.describe('First-run coach marks', () => {
  test('gun form: the Save mark shows for the first gun, and ✕ dismisses it for good', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: "Skip for now — I'm just looking around" })
      .click();
    const main = page.getByRole('main');

    // First gun: the mark points at Save.
    await main.getByRole('button', { name: '+ Add your first gun' }).click();
    const mark = page.getByRole('note').filter({ hasText: 'tap Save' });
    await expect(mark).toBeVisible();

    // ✕ persists: cancel out, reopen the form, the mark stays gone.
    await mark.getByRole('button', { name: 'Dismiss tip' }).click();
    await expect(mark).toHaveCount(0);
    await page.getByRole('button', { name: '‹ Cancel' }).click();
    await main.getByRole('button', { name: '+ Add your first gun' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
    await expect(page.getByRole('note').filter({ hasText: 'tap Save' })).toHaveCount(0);
  });

  test('wizard: saving the first gun retires the Save mark and the goal step points at the goals', async ({ page }) => {
    await page.goto('/');
    // The wizard welcome: step 1 is the tap target.
    await page.getByRole('button', { name: '1. Add a gun' }).click();

    // The Save mark is up (fresh log, new gun)…
    await expect(page.getByRole('note').filter({ hasText: 'tap Save' })).toBeVisible();

    // …save a minimal gun via the navbar Save the mark points at.
    await page.getByLabel('What this Gun is called').fill('Test Pistol');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Goal step: the mark points down into the glowing goal card.
    const goalMark = page.getByRole('note').filter({ hasText: 'Pick a goal here' });
    await expect(goalMark).toBeVisible();
    await expect(page.locator('.card.coach-glow')
      .getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();

    // Acting on what it points at completes the flow (the mark's whole job).
    await page.getByRole('button', { name: 'Shoot tighter groups' }).click();
    await expect(page.getByRole('main')
      .getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
  });
});
