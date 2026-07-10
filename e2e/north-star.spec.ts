import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// F10 + F2, end to end. The North Star is ASKED in the Setup Wizard's goal
// step (presets + write-your-own + skip) — the old boot-time auto-seed is
// gone, so nothing is ever pinned unasked. F2 rides along: the wizard's Done
// hands off to Home, which points at + Log Session until the first session
// exists. Unit tests prove the decision + writer; these prove the wiring —
// the wizard step, the Progress pin row, the Home card, and the handoff.

// Walk the wizard's gear path with one real gun, then tap Done — the exact
// flow that earns the goal question.
async function wizardAddGunAndDone(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add my gear' }).click();
  // Scoped to main: the desktop sidebar also has a "Guns" button (the recorded
  // selector lesson — sidebar duplicates content labels; bit E2E #179).
  await page.getByRole('main').getByRole('button', { name: /^Guns/ }).click();
  await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
  await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
  await page.getByRole('button', { name: 'Add Gun', exact: true }).click();
  // Back on the checklist with the gun counted, then finish.
  await expect(page.getByRole('heading', { name: 'Add your gear' })).toBeVisible();
  await page.getByRole('button', { name: "Done — you're ready to log" }).click();
}

test.describe('Setup goal (F10): asked, not assigned', () => {
  test('a preset becomes the pinned North Star on Progress and the Home card', async ({ page }) => {
    await wizardAddGunAndDone(page);

    // The goal question appears for the true newcomer.
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
    await page.getByRole('button', { name: 'Shoot tighter groups' }).click();

    // Lands on Home with the chosen goal echoed as the North Star card.
    const main = page.getByRole('main');
    await expect(main.getByText('Shoot tighter groups')).toBeVisible();
    await expect(main.getByText('Your North Star · tap to plan a session')).toBeVisible();

    // Progress shows it pinned, grouped under its preset category.
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Shoot tighter groups')).toBeVisible();
    await expect(main.getByText('North Star', { exact: true })).toBeVisible(); // the pin badge
    await expect(main.getByText('Accuracy', { exact: true })).toBeVisible();
  });

  test('write my own: the custom goal is stored verbatim and pinned', async ({ page }) => {
    await wizardAddGunAndDone(page);
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();

    await page.getByRole('button', { name: 'Write my own' }).click();
    await page.getByRole('textbox', { name: 'My goal' }).fill('Bill Drill under 2.0 seconds');
    await page.getByRole('button', { name: 'Set my goal' }).click();

    const main = page.getByRole('main');
    await expect(main.getByText('Bill Drill under 2.0 seconds')).toBeVisible();
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Bill Drill under 2.0 seconds')).toBeVisible();
    await expect(main.getByText('North Star', { exact: true })).toBeVisible();
  });

  test('write my own requires text before saving', async ({ page }) => {
    await wizardAddGunAndDone(page);
    await page.getByRole('button', { name: 'Write my own' }).click();
    await page.getByRole('button', { name: 'Set my goal' }).click();
    await expect(page.getByText('Enter the goal before saving.')).toBeVisible();
  });

  test('skip: no goal is created, and the question never comes back', async ({ page }) => {
    await wizardAddGunAndDone(page);
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // Home, with no North Star card; Progress has no goals.
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'FirearmLog' })).toBeVisible();
    await expect(main.getByText('Your North Star', { exact: false })).toHaveCount(0);
    await gotoTab(page, 'Progress');
    await expect(main.getByText('No goals yet', { exact: false })).toBeVisible();

    // Re-running setup from Help must not re-ask — skip was the answer.
    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('button', { name: 'Set Up' }).click();
    await page.getByRole('button', { name: 'Add my gear' }).click();
    await page.getByRole('button', { name: "Done — you're ready to log" }).click();
    await expect(main.getByRole('heading', { name: 'FirearmLog' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toHaveCount(0);
  });

  test('the auto-seed is gone: a first gun added OUTSIDE the wizard creates no goal', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: "Skip for now — I'm just looking around" })
      .click();
    const main = page.getByRole('main');
    await main.getByRole('button', { name: '+ Add your first gun' }).click();
    await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
    await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
    await page.getByRole('button', { name: 'Add Gun', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retire or remove this gun…' })).toBeVisible();

    // No starter goal, anywhere — a reload doesn't summon one either.
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Reach A class')).toHaveCount(0);
    await gotoTab(page, 'Home');
    await expect(main.getByText('Your North Star', { exact: false })).toHaveCount(0);
    await page.reload();
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Reach A class')).toHaveCount(0);
  });

  test('the demo ships pinned: its own North Star shows and no starter goal is added', async ({ page }) => {
    await seedDemo(page);
    const main = page.getByRole('main');
    // Home card echoes the demo's own pin…
    await expect(main.getByText('Reach USPSA A class')).toBeVisible();
    await expect(main.getByText('Your North Star · tap to plan a session')).toBeVisible();
    // …and no starter goal was invented alongside it.
    await gotoTab(page, 'Progress');
    await expect(main.getByText('Reach A class', { exact: true })).toHaveCount(0);
  });
});

test.describe('Guided handoff (F2): Home points at the first session', () => {
  test('after setup, Home shows the pointer until the first session — then never again', async ({ page }) => {
    await wizardAddGunAndDone(page);
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // Guns but no sessions yet: the pointer card is up.
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: "You're set up." })).toBeVisible();
    await expect(main.getByText('Everything on this screen builds from your sessions.')).toBeVisible();

    // Log the first session (same minimal flow the sessions spec uses).
    await main.getByRole('button', { name: '+ Log Session' }).click();
    const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');
    await page.locator('.navbar-action').click();

    // Earned, not dismissed: the pointer is gone, and stays gone on reload.
    await gotoTab(page, 'Home');
    await expect(main.getByRole('heading', { name: 'FirearmLog' })).toBeVisible();
    await expect(main.getByRole('heading', { name: "You're set up." })).toHaveCount(0);
    await page.reload();
    await expect(main.getByRole('heading', { name: 'FirearmLog' })).toBeVisible();
    await expect(main.getByRole('heading', { name: "You're set up." })).toHaveCount(0);
  });

  test('a gun added outside the wizard earns the same pointer', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: "Skip for now — I'm just looking around" })
      .click();
    const main = page.getByRole('main');
    await main.getByRole('button', { name: '+ Add your first gun' }).click();
    await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
    await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
    await page.getByRole('button', { name: 'Add Gun', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retire or remove this gun…' })).toBeVisible();

    await gotoTab(page, 'Home');
    await expect(main.getByRole('heading', { name: "You're set up." })).toBeVisible();
  });

  test('the demo (sessions exist) never shows the pointer', async ({ page }) => {
    await seedDemo(page);
    await expect(page.getByRole('main').getByRole('heading', { name: "You're set up." })).toHaveCount(0);
  });
});
