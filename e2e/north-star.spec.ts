import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// F10 + F2, end to end. The North Star is ASKED in the Setup Wizard's goal
// step (presets + write-your-own + skip) — the old boot-time auto-seed is
// gone, so nothing is ever pinned unasked. F2 rides along: the wizard's Done
// hands off to Home, which points at + Log Session until the first session
// exists. Unit tests prove the decision + writer; these prove the wiring —
// the wizard step, the Progress pin row, the Home card, and the handoff.

// Walk the first-run checklist with one real gun: tap step 1, save the gun —
// the wizard advances to the goal step (step 3b) on its own.
async function wizardAddGunAndDone(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText("Let's get you set up — three steps:")).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: '1. Add a gun' }).click();
  await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
  await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
  await page.getByRole('button', { name: 'Save gun', exact: true }).click();
}

test.describe('Setup goal (F10): asked, not assigned', () => {
  test('a preset becomes the pinned North Star on Progress and the Home card', async ({ page }) => {
    await wizardAddGunAndDone(page);

    // The goal question appears for the true newcomer — with the checklist
    // riding along: box 1 checked, step 2 where they stand (step 3b).
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
    await expect(page.getByText('1. Add a gun')).toBeVisible();
    await expect(page.getByText('2. Pick a goal')).toBeVisible();
    // The active step points at the choices sitting below it.
    await expect(page.getByText('Pick a goal from one below (or write your own) ↓')).toBeVisible();
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

  test('Add more gear from the goal step opens the gear list; Done returns to the question', async ({ page }) => {
    await wizardAddGunAndDone(page);
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
    await page.getByRole('button', { name: 'Add more gear — optics, ammo, magazines' }).click();
    await expect(page.getByRole('heading', { name: 'Add your gear' })).toBeVisible();
    await page.getByRole('button', { name: "Done — you're ready to log" }).click();
    await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
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
    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await expect(main.getByText('Your North Star', { exact: false })).toHaveCount(0);
    await gotoTab(page, 'Progress');
    await expect(main.getByText('No goals yet', { exact: false })).toBeVisible();

    // Re-running setup from Help must not re-ask — skip was the answer.
    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('main').getByRole('button', { name: 'Set Up' }).click();
    await page.getByRole('button', { name: 'Add gear' }).click();
    await page.getByRole('button', { name: "Done — you're ready to log" }).click();
    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
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

    // Guns but no sessions yet: the checklist card is up with steps 1–2 done
    // and step 3 as the tap target (step 3b, decision 1+2: Home carries the
    // scoreboard; a skipped goal still checks box 2).
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: "You're set up." })).toBeVisible();
    await expect(main.getByText('2. Pick a goal')).toBeVisible();
    // Step 3 teaches both doors: tap the row now, or + Log Session later.
    await expect(main.getByText('Tap here to log it now', { exact: false })).toBeVisible();

    // Step 3's row is the action: it opens Log Session directly.
    await main.getByRole('button', { name: '3. Log your first session' }).click();
    await expect(page.getByTestId('session-guns-card')).toBeVisible();
    await page.getByRole('button', { name: '‹ Cancel' }).click();

    // Log the first session (same minimal flow the sessions spec uses).
    // exact: true — the checklist row's sub mentions "+ Log Session", so a
    // substring match would also hit the row (bit E2E #182, both projects).
    await main.getByRole('button', { name: '+ Log Session', exact: true }).click();
    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    await gunsCard.getByRole('spinbutton').first().fill('50');
    await page.locator('.navbar-action').click();

    // Earned, not dismissed: the pointer is gone, and stays gone on reload.
    await gotoTab(page, 'Home');
    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: "You're set up." })).toHaveCount(0);
    await page.reload();
    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Save gun', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retire or remove this gun…' })).toBeVisible();

    await gotoTab(page, 'Home');
    await expect(main.getByRole('heading', { name: "You're set up." })).toBeVisible();
  });

  test('the demo (sessions exist) never shows the pointer', async ({ page }) => {
    await seedDemo(page);
    await expect(page.getByRole('main').getByRole('heading', { name: "You're set up." })).toHaveCount(0);
  });
});
