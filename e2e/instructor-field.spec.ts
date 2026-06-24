import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Instructor on a Class session is a single "creatable" field (same component as
// "Where"): you type a name or tap a past one, and whatever's in the box is the
// instructor — no separate "add" step. A name typed on one class shows up as a
// suggestion on the next.

test.describe('Class session instructor field', () => {
  test('a typed instructor is suggested on the next class session', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    // Log a class with a brand-new instructor typed into the single field.
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('radio', { name: 'Class' }).click();
    await page.getByRole('textbox', { name: 'Instructor' }).fill('Test Coach');
    const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // New class session: typing in Instructor suggests the name we just used.
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('radio', { name: 'Class' }).click();
    const instr = page.getByRole('textbox', { name: 'Instructor' });
    await instr.click();
    await instr.fill('Test');
    await expect(page.getByRole('option', { name: 'Test Coach' })).toBeVisible();
  });
});
