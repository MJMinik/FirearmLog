import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// The North Star seed, end to end (lib/northStar.ts): a brand-new install gets
// ONE pinned "Reach A class" goal the moment the log is real (first gun), the
// welcome state stays card-free, the demo's own pin is respected, and deleting
// the seed is forever. Unit tests prove the rules; these prove the wiring —
// the App-level effect, the Progress pin row, and the Home card.

// Skip the auto-opened Setup Wizard to the empty Home, then add the first gun
// through the real form — the same path a new shooter takes.
async function addFirstGun(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: "Skip for now — I'm just looking around" })
    .click();
  await page
    .getByRole('main')
    .getByRole('button', { name: '+ Add your first gun' })
    .click();
  await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
  await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
  await page.getByRole('button', { name: 'Add Gun', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retire or remove this gun…' })).toBeVisible();
}

test.describe('North Star seed', () => {
  test('welcome state (zero guns): Home shows no North Star card and no goal exists yet', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: "Skip for now — I'm just looking around" })
      .click();
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: '+ Add your first gun' })).toBeVisible();
    // Deliberate design (session 47): the card appears once Home is a real
    // dashboard, not on the welcome screen — and an empty device stays empty.
    await expect(main.getByText('Your North Star', { exact: false })).toHaveCount(0);
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Reach A class')).toHaveCount(0);
  });

  test('adding the first gun seeds the pinned starter goal on Progress → Goals', async ({ page }) => {
    await addFirstGun(page);
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    await expect(main.getByText('Reach A class')).toBeVisible();
    await expect(main.getByText('North Star', { exact: true })).toBeVisible(); // the pin badge
    await expect(main.getByText('Classification · 75% classifier average')).toBeVisible();
  });

  test('the seeded goal is echoed as the Home card', async ({ page }) => {
    await addFirstGun(page);
    await gotoTab(page, 'Home');
    const main = page.getByRole('main');
    await expect(main.getByText('Reach A class')).toBeVisible();
    await expect(main.getByText('Your North Star · tap to plan a session')).toBeVisible();
  });

  test('deleting the seed is respected forever — it never comes back', async ({ page }) => {
    await addFirstGun(page);
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    await expect(main.getByText('Reach A class')).toBeVisible();

    // Delete it the deliberate way: Edit Goal → Delete goal → confirm.
    // (Same path the goal-swipe-delete spec uses on desktop; it works on both
    // layouts, and here the INTENT under test is deletion, not the gesture.)
    await main.getByRole('button', { name: 'Edit Reach A class' }).click();
    await page.getByRole('button', { name: 'Delete goal' }).click(); // opens confirm
    await page.getByRole('button', { name: 'Delete goal' }).last().click(); // confirm
    await expect(main.getByText('Reach A class')).toHaveCount(0);

    // A reload plus fresh data activity must NOT re-seed.
    await page.reload();
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Reach A class')).toHaveCount(0);
    await gotoTab(page, 'Home');
    await expect(main.getByText('Your North Star', { exact: false })).toHaveCount(0);
  });

  test('the demo ships pinned: "Reach USPSA A class" is the North Star and no starter goal is added', async ({ page }) => {
    await seedDemo(page);
    const main = page.getByRole('main');
    // Home card echoes the demo's own pin (go-4)…
    await expect(main.getByText('Reach USPSA A class')).toBeVisible();
    await expect(main.getByText('Your North Star · tap to plan a session')).toBeVisible();
    // …and the seeder only MARKED the install — no "Reach A class" starter.
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Reach A class', { exact: true })).toHaveCount(0);
  });
});
