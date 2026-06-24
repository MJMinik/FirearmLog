import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Instructor field on a Class session. With no saved instructors yet, there's no
// empty dropdown — just a plain "Instructor" text field (you type a name). Once
// one is saved, the dropdown appears with a "No instructor" option plus the saved
// names. (The demo ships with no saved instructors, so a fresh Class session hits
// the empty branch first.)

test.describe('Class session instructor field', () => {
  test('empty list shows a text field; after saving one, a dropdown with "No instructor" appears', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    // New Class session — no saved instructors, so "Instructor" is a text field,
    // and there is NO instructor dropdown.
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('radio', { name: 'Class' }).click();
    await expect(page.getByRole('textbox', { name: 'Instructor' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Instructor' })).toHaveCount(0);

    // Type an instructor, log the session.
    await page.getByRole('textbox', { name: 'Instructor' }).fill('Test Coach');
    const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // New Class session — the instructor is now saved, so the dropdown shows with
    // a "No instructor" option and the name we just added.
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('radio', { name: 'Class' }).click();
    const dropdown = page.getByRole('combobox', { name: 'Instructor' });
    await expect(dropdown).toBeVisible();
    await expect(dropdown.locator('option', { hasText: 'No instructor' })).toHaveCount(1);
    await expect(dropdown.locator('option', { hasText: 'Test Coach' })).toHaveCount(1);
  });
});
