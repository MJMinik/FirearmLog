import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// App 2 — a custom "Other" malfunction type can be typed in, and is remembered
// so it shows up in the dropdown next time. Driven in a real browser.

test.describe('Custom malfunction types (App 2)', () => {
  test('a typed-in "Other" type is saved and reappears in the dropdown', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    // First session: log a malfunction with a custom type.
    await page.getByRole('button', { name: '+ Log Session' }).click();
    const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');

    await page.getByRole('button', { name: '+ Add Malfunction' }).click();
    const whatHappened = page.locator('label', { hasText: 'What happened' }).locator('select');
    await whatHappened.selectOption('Other');                       // reveals the text field
    await page.getByPlaceholder('e.g. Brass over bolt').fill('Brass over bolt');
    await page.locator('.navbar-action').click();                   // Save

    // Second session: the custom type is now an option in the dropdown.
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
    await page.getByRole('button', { name: '+ Log Session' }).click();
    await page.getByRole('button', { name: '+ Add Malfunction' }).click();
    const whatHappened2 = page.locator('label', { hasText: 'What happened' }).locator('select');
    await expect(whatHappened2.locator('option', { hasText: 'Brass over bolt' })).toHaveCount(1);
  });
});
