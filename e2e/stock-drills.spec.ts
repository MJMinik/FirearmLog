import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';

// F4 + F5, end to end: the app ships the 14-drill stock library. It seeds
// once the log is real (first gun), shows up in Drills and the session form's
// picker, re-seeds after Clear All while custom drills clear (Q1), never
// duplicates on top of the demo's own copy, and the Drills screen has a real
// empty state behind it all. Unit tests prove the seeding rules; these prove
// the wiring on the live app.

// First gun via the first-run checklist (step 3b), skipping the goal step.
async function addFirstGun(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('main').getByRole('button', { name: '1. Add a gun' }).click();
  await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
  await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
  await page.getByRole('button', { name: 'Add Gun', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'FirearmLog' })).toBeVisible();
}

test.describe('Stock drill library (F4) + Drills empty state (F5)', () => {
  test('the first gun seeds the stock drills into the Drills library', async ({ page }) => {
    await addFirstGun(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    await expect(main.getByText('Bill Drill', { exact: true })).toBeVisible();
    await expect(main.getByText('Dot Torture', { exact: true })).toBeVisible();
    await expect(main.getByText('El Presidente', { exact: true })).toBeVisible();
    await expect(main.getByText('Wide Transitions', { exact: true })).toBeVisible();
  });

  test('the session form drill picker offers the stock drills', async ({ page }) => {
    await addFirstGun(page);
    const main = page.getByRole('main');
    // Confirm the seed has landed BEFORE opening the session form: the form
    // reads its drill list on mount (it doesn't re-read on refresh), so
    // entering it in the same beat as the seed would be a race, not a test.
    await gotoSection(page, 'Drills');
    await expect(main.getByText('Bill Drill', { exact: true })).toBeVisible();
    await gotoTab(page, 'Home');
    await main.getByRole('button', { name: '3. Log your first session' }).click();

    // Pick the gun so the picker has its context (category + live fire).
    const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
    await gunsCard.locator('button.gun-toggle').first().click();

    const drillsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Drills' }) });
    await drillsCard.getByRole('button', { name: '+ Add Drill' }).click();
    const sheet = page.getByRole('dialog', { name: 'Pick Drills' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Bill Drill', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Draw to First Shot', { exact: true })).toBeVisible();
  });

  test('an empty device stays empty, and Drills shows the F5 empty state', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: "Skip for now — I'm just looking around" })
      .click();
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    await expect(main.getByText('No drills yet.', { exact: false })).toBeVisible();
    await expect(main.getByText('Bill Drill')).toHaveCount(0);
  });

  test('Clear All re-seeds the stock set; a custom drill clears with the wipe (Q1)', async ({ page }) => {
    await addFirstGun(page);

    // Create a custom drill through the real form.
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: '+ Add Drill' }).click();
    await page.getByRole('textbox', { name: 'What this Drill is called' }).fill('My Own Drill');
    await page.locator('.navbar-action').click(); // Save
    await expect(main.getByText('My Own Drill', { exact: true })).toBeVisible();

    // Clear All (typed confirmation) → back to first-run → new first gun.
    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('button', { name: 'Clear all data' }).click();
    await page.getByPlaceholder('erase').fill('erase');
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await expect(page.getByText("Let's get you set up — three steps:")).toBeVisible({ timeout: 20_000 });
    await addFirstGun(page);

    await gotoSection(page, 'Drills');
    await expect(main.getByText('Bill Drill', { exact: true })).toBeVisible(); // stock is back
    await expect(main.getByText('My Own Drill')).toHaveCount(0); // custom cleared with the wipe
  });

  test('the demo carries its own copy: loading sample data never duplicates drills', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    // Exactly one of each — the demo's copy, with no second set seeded on top.
    await expect(main.getByText('Bill Drill', { exact: true })).toHaveCount(1);
    await expect(main.getByText('Dot Torture', { exact: true })).toHaveCount(1);
  });
});
