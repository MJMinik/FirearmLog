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
