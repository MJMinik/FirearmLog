import { test, expect } from '@playwright/test';
import { seedDemo, gotoSection, isDesktop } from './helpers';

// A2: hierarchical Back on desktop + history dedup.
// - Desktop: the sidebar is always present, so a top-level section screen hides
//   its "‹ Back" button; and a saved edit from a section list pops cleanly off
//   history instead of stacking a dead duplicate entry.
// - Phone: sections are reached through the More hub, so the Back button stays
//   and returns there.

test.describe('Section Back navigation', () => {
  test('desktop: Optics has no visible Back, and one browser Back leaves cleanly', async ({ page }) => {
    test.skip(!isDesktop(page), 'Desktop-only: the sidebar replaces the tab bar here.');
    await seedDemo(page);

    // Visit Guns first, THEN Optics, so the screen "before Optics" is known.
    await gotoSection(page, 'Guns');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Guns' })).toBeVisible();
    await gotoSection(page, 'Optics');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Optics' })).toBeVisible();

    // The section Back button is in the DOM but hidden by CSS at this breakpoint.
    await expect(page.locator('main .section-back')).toBeHidden();

    // Edit an optic from the Optics list and save.
    await page.getByRole('main').locator('.row-tap').first().click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Optic' })).toBeVisible();
    await page.locator('.navbar-action', { hasText: 'Save' }).click();

    // Saved: we're back on the Optics list...
    await expect(page.getByRole('main').getByRole('heading', { name: 'Optics' })).toBeVisible();

    // ...and a SINGLE browser Back lands on Guns — not a duplicate Optics entry.
    await page.goBack();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Guns' })).toBeVisible();
  });

  test('phone: Optics keeps its Back, and it returns to the More hub', async ({ page }) => {
    test.skip(isDesktop(page), 'Phone-only: sections are reached through the More hub.');
    await seedDemo(page);

    await gotoSection(page, 'Optics'); // reached via the More tab on phone
    await expect(page.getByRole('main').getByRole('heading', { name: 'Optics' })).toBeVisible();

    // On phone the Back button is visible; tapping it returns to More.
    const back = page.locator('main .section-back');
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByRole('main').getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  });
});
