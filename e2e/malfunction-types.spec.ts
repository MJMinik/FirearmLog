import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab, reopenGunsIfCollapsed } from './helpers';

// App 2 — a custom "Other" malfunction type can be typed in, and is remembered
// so it shows up in the dropdown next time. Driven in a real browser.

test.describe('Custom malfunction types (App 2)', () => {
  test('a typed-in "Other" type is saved and reappears in the dropdown', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    // First session: log a malfunction with a custom type.
    await page.getByRole('button', { name: '+ Log Session' }).click();
    const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    await gunsCard.locator('button.gun-toggle').first().click();
    await reopenGunsIfCollapsed(gunsCard);
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

// App 3a — a malfunction can carry an optional round number (and ammo/magazine
// when present), and those stick when you reopen the session to edit it.
test.describe('Malfunction details (App 3a)', () => {
  test('round number is saved and reappears when the session is reopened', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await page.getByRole('button', { name: '+ Log Session' }).click();
    const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
    await gunsCard.locator('button.gun-toggle').first().click();
    await reopenGunsIfCollapsed(gunsCard);
    await gunsCard.getByRole('spinbutton').first().fill('50');

    await page.getByRole('button', { name: '+ Add Malfunction' }).click();
    await page.locator('label', { hasText: 'What happened' }).locator('select').selectOption('Stovepipe');

    // The optional round-number field is always present; fill it.
    const roundField = page.locator('label', { hasText: 'Round number' }).locator('input');
    await roundField.fill('47');

    // Ammo picker only renders when sample ammo exists; pick a real one if so.
    const ammoSelect = page.locator('label', { hasText: 'Ammo' }).locator('select');
    if (await ammoSelect.count()) {
      await ammoSelect.selectOption({ index: 1 }); // index 0 is "— Not sure —"
    }

    await page.locator('.navbar-action').click(); // Save
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the just-logged session (today's date sorts to the top) — tapping a
    // Log row opens the editable session form directly.
    await page.getByRole('main').locator('.row-tap').first().click();
    const roundFieldAgain = page.locator('label', { hasText: 'Round number' }).locator('input');
    await expect(roundFieldAgain).toHaveValue('47');
  });
});
