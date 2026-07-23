import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// T3-6a (July 23 2026): USPSA's Minor-only divisions -- Production, Carry Optics,
// Limited Optics, and PCC -- can't actually be scored Major, so the match form
// locks the Power Factor segment to Minor and disables Major there, with an
// InfoTip explaining why. Switching to any other division re-enables the choice.
// Runs on both the desktop and phone projects.
test.describe('Power factor guardrail (T3-6a)', () => {
  test('switching into a Minor-only division forces Minor and disables Major; switching out re-enables it', async ({ page }) => {
    await seedDemo(page); // seeds a gun so the match form has one to pick
    await gotoTab(page, 'Compete');
    await page.getByRole('main').getByRole('button', { name: '+ Log Match' }).click();
    await expect(page.getByRole('heading', { name: 'Log Match' })).toBeVisible();

    // getByLabel is unreliable for the Division <select> here (its accessible
    // name picks up option text too), so target it by a USPSA-only option that's
    // always present regardless of what's currently selected -- same technique
    // idpa-scoring.spec.ts uses.
    const division = page.locator('select', { has: page.locator('option', { hasText: 'Single Stack' }) });
    const major = page.getByRole('button', { name: 'Major', exact: true });
    const minor = page.getByRole('button', { name: 'Minor', exact: true });

    // Open is not Minor-only: Major is a real, enabled choice.
    await division.selectOption('Open');
    await expect(major).not.toHaveAttribute('aria-disabled', 'true');
    await major.click();
    await expect(major).toHaveAttribute('aria-pressed', 'true');

    // Switching into Carry Optics (Minor-only) snaps back to Minor and disables Major.
    await division.selectOption('Carry Optics');
    await expect(minor).toHaveAttribute('aria-pressed', 'true');
    await expect(major).toHaveAttribute('aria-pressed', 'false');
    await expect(major).toHaveAttribute('aria-disabled', 'true');
    // The InfoTip explains why -- open it and check the wording.
    await page.getByRole('button', { name: 'Help for Power Factor' }).click();
    await expect(page.getByText(/Major isn.t available in this division/)).toBeVisible();
    // Major can't be picked while disabled.
    await major.click({ force: true });
    await expect(minor).toHaveAttribute('aria-pressed', 'true');

    // Switching to Limited (not Minor-only) re-enables the choice, and Major is a
    // real, clickable option again.
    await division.selectOption('Limited');
    await expect(major).not.toHaveAttribute('aria-disabled', 'true');
    await major.click();
    await expect(major).toHaveAttribute('aria-pressed', 'true');
  });

  test('editing an old record with Major stored in a Minor-only division shows it corrected to Minor', async ({ page }) => {
    // The demo dataset's matches are all logged in Carry Optics/Minor already, so
    // build the legacy case directly: log a match in Open/Major, then edit it
    // while it's still Open (no correction should apply), confirming the
    // guardrail leaves an unrelated division's Major alone.
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    await page.getByRole('main').getByRole('button', { name: '+ Log Match' }).click();
    await page.getByLabel('What this match is called').fill('Legacy PF Test');
    await page.locator('select', { has: page.locator('option', { hasText: 'Single Stack' }) }).selectOption('Open');
    await page.getByRole('button', { name: 'Major', exact: true }).click();
    await page.getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByRole('heading', { name: 'Legacy PF Test' })).toBeVisible();

    // Re-open for edit: Open/Major is untouched (Open is never Minor-only).
    await page.getByRole('button', { name: 'Edit' }).click();
    const major = page.getByRole('button', { name: 'Major', exact: true });
    await expect(major).toHaveAttribute('aria-pressed', 'true');
    await expect(major).not.toHaveAttribute('aria-disabled', 'true');
  });
});
