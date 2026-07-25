import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Ammo Used auto-default: logging gun rounds on a NEW session pre-fills the
// Ammo Used row so inventory actually moves, instead of the row staying blank
// and nothing deducting. The default-picking logic is unit-tested
// (ammoSuggest.test.ts); here we lock the form wiring — the row appears with
// the right count, and an amber notice tells the shooter to pick a type when
// one isn't set. Runs on desktop + phone (CI; first run on the PR).

test.describe('Ammo Used auto-default', () => {
  test('gun rounds pre-fill the Ammo Used row; amber notice until a type is set', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    // Enter 40 rounds on the first gun.
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('40');

    // The Ammo Used row auto-fills its count to match the gun total.
    const ammoCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Ammo Used' }) });
    await expect(ammoCard.getByRole('spinbutton').first()).toHaveValue('40');

    // If the type couldn't be auto-picked, the amber "pick a type" notice shows;
    // choosing a type clears it. (If it WAS auto-picked, the notice is already absent.)
    const typeSelect = ammoCard.locator('select').first();
    if ((await typeSelect.inputValue()) === '') {
      await expect(ammoCard.getByText(/Pick an ammo type/)).toBeVisible();
      await typeSelect.selectOption({ index: 1 });
    }
    await expect(ammoCard.getByText(/Pick an ammo type/)).toHaveCount(0);
  });

  test('editing the ammo count is respected and not overwritten by the gun rounds', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();

    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');

    const ammoCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Ammo Used' }) });
    const ammoRounds = ammoCard.getByRole('spinbutton').first();
    await expect(ammoRounds).toHaveValue('50');

    // The shooter overrides the ammo count (e.g. shot 20 of their own rounds in
    // a borrowed gun). This "touches" the section.
    await ammoRounds.fill('20');

    // Changing the gun rounds afterward must NOT clobber the override.
    await gunsCard.getByRole('spinbutton').first().fill('60');
    await expect(ammoRounds).toHaveValue('20');
  });
});
