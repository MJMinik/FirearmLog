import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Batch 4b — interaction & navigation state safety.

test.describe('Dirty-form discard confirm (M4)', () => {
  test('a dirty Log Match confirms before discarding; a pristine one cancels instantly', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    // Pristine: ‹ Cancel leaves immediately, no confirm.
    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toHaveCount(0);

    // Dirty: type a name, then ‹ Cancel → the discard confirm appears.
    await page.getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this match is called').fill('Unsaved Match');
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();

    // Keep editing → back on the form with the text intact.
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('What this match is called')).toHaveValue('Unsaved Match');

    // ‹ Cancel again → Discard → leaves the form.
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toHaveCount(0);
  });
});

test.describe('Dirty guard fires on button-only edits (F1)', () => {
  test('toggling a single gun on marks Log Session dirty (no typed field)', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();

    // Toggle ONE gun on — a pure <button> edit that fires no `change` event, so
    // before F1 the bubbled-onChange guard never saw it and ‹ Cancel left silently.
    const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
    await gunsCard.locator('button.gun-toggle').first().click();

    // ‹ Cancel must now confirm before discarding that toggle-only edit.
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();

    // Keep editing → still on the form (nothing was discarded).
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();
  });
});

test.describe('Unsaved-changes guard on every exit (F3)', () => {
  // F3 closed the two exits that used to bypass Log Session's discard confirm:
  // the tab bar / desktop sidebar, and the browser's Back button. All exits now
  // show the ONE shared Discard-changes? sheet the ‹ Cancel button always had.

  async function openDirtySession(page: import('@playwright/test').Page) {
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();
    await page.getByLabel('Where').fill('Somewhere Unsaved');
  }

  test('a dirty Log Session guards a tab-bar exit; Keep editing preserves the edit', async ({ page }) => {
    await seedDemo(page);
    await openDirtySession(page);

    // Tab tap → the discard confirm, not a silent exit.
    await gotoTab(page, 'Home');
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();

    // Keep editing → still on the form, the edit intact.
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('Where')).toHaveValue('Somewhere Unsaved');

    // Tab tap again → Discard → lands on Home with the form gone.
    await gotoTab(page, 'Home');
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toHaveCount(0);
    await expect(page.getByText('Live-fire rounds')).toBeVisible();
  });

  test('a dirty Log Session guards the browser Back button', async ({ page }) => {
    await seedDemo(page);
    await openDirtySession(page);

    // Browser Back → the pop is neutralized and the confirm appears; the form
    // stays on screen behind it.
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('Where')).toHaveValue('Somewhere Unsaved');

    // Back again → Discard → Back replays for real and leaves the form.
    await page.goBack();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toHaveCount(0);
  });

  test('button-only edits arm the guard (+ Add Ammo via Back, + Add Malfunction via Cancel)', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();

    // A pure click-only edit — no field typed, no change event bubbles.
    await page.getByRole('button', { name: '+ Add Ammo' }).click();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();

    // A second click-only edit, guarded through the form's own ‹ Cancel.
    await page.getByRole('button', { name: '+ Add Malfunction' }).click();
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toHaveCount(0);
  });

  test('a pristine Log Session leaves on Back with no guard', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await expect(page.getByRole('heading', { name: 'Log Session' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Log Session' })).toHaveCount(0);
  });
});

test.describe('Unsaved-changes guard parity — Match & Classifier (F3 follow-on)', () => {
  // F3 wired Log Session's dirty state up to App so tab-bar / sidebar / browser
  // Back exits get the Discard-changes? sheet. Match and Classifier had the
  // sheet on their own ‹ Cancel but never reported dirty upward, so those same
  // exits silently destroyed a half-entered match. This locks the parity shut.

  test('a dirty Log Match guards a tab-bar exit and browser Back', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();
    await page.getByLabel('What this match is called').fill('Half-Entered Match');

    // Tab tap → the discard confirm, not a silent exit.
    await gotoTab(page, 'Home');
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('What this match is called')).toHaveValue('Half-Entered Match');

    // Browser Back → the pop is neutralized and the confirm appears.
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('What this match is called')).toHaveValue('Half-Entered Match');

    // Tab tap again → Discard → really leaves.
    await gotoTab(page, 'Home');
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toHaveCount(0);
    await expect(page.getByText('Live-fire rounds')).toBeVisible();
  });

  test('a click-only Match edit (+ Add Stage) arms the guard', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();

    // A pure <button> edit — no change event bubbles, so before this fix the
    // bubbled-onChange watcher never saw it.
    await page.getByRole('button', { name: '+ Add Stage' }).click();
    await page.getByRole('main').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toHaveCount(0);
  });

  test('a dirty Log Classifier guards browser Back; a pristine one leaves freely', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    // Pristine: Back leaves with no guard.
    await page.getByRole('main').getByRole('button', { name: '+ Log Classifier' }).click();
    await expect(page.getByRole('heading', { name: 'Log Classifier' })).toBeVisible();
    await page.goBack();
    // Wait for the form to actually leave FIRST — asserting no-sheet before the
    // popstate lands would pass vacuously in that instant.
    await expect(page.getByRole('heading', { name: 'Log Classifier' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toHaveCount(0);

    // Dirty: type a code, then Back → the confirm; Keep editing preserves it.
    await page.getByRole('main').getByRole('button', { name: '+ Log Classifier' }).click();
    await page.getByLabel('Classifier code').fill('23-01');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByLabel('Classifier code')).toHaveValue('23-01');

    // Back again → Discard → really leaves.
    await page.goBack();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('heading', { name: 'Log Classifier' })).toHaveCount(0);
  });
});

test.describe('Not-found states (M7)', () => {
  // Navigate to a detail screen for an id that doesn't exist — exactly what a dead
  // deep-link or a back-nav to a since-deleted record does — via the app's own
  // popstate path. It must land on a clear message with a way back, not a blank spinner.
  async function navTo(page: import('@playwright/test').Page, view: unknown) {
    await page.evaluate((v) => {
      history.pushState({ view: v }, '');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { view: v } }));
    }, view);
  }

  test('a missing gun shows a not-found screen', async ({ page }) => {
    await seedDemo(page);
    await navTo(page, { kind: 'gun-detail', id: 'does-not-exist' });
    await expect(page.getByText('This gun no longer exists.')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Back' })).toBeVisible();
  });

  test('a missing match shows a not-found screen', async ({ page }) => {
    await seedDemo(page);
    await navTo(page, { kind: 'match-detail', id: 'does-not-exist' });
    await expect(page.getByText('This match no longer exists.')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Back' })).toBeVisible();
  });
});
