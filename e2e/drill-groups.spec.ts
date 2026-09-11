import { test, expect, type Page } from '@playwright/test';
import { gotoSection, gotoTab } from './helpers';

// Board memo DRILL_GROUPING_BOARD_MEMO_2026-09-10, decisions 1-5 all (a): the
// Drills screen groups the library by the skill each drill trains, seven
// built-in sections in a fixed order plus an eighth Custom section shown
// only when it holds a drill. tests/drillGroups.test.ts proves the pure
// grouping logic; these prove the wiring on the live app: the section
// headings, counts, and order a fresh install actually shows, that search
// filters before grouping (fewer sections, or "No drills match."), and that
// a custom drill picks up the Skill chosen on its own add/edit form.

// First gun via the first-run checklist (step 3b), skipping the goal step —
// same helper shape as e2e/stock-drills.spec.ts, duplicated locally since
// that file's copy isn't exported.
async function addFirstGun(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('main').getByRole('button', { name: '1. Add a gun' }).click();
  await expect(page.getByRole('heading', { name: 'New Gun' })).toBeVisible();
  await page.getByRole('textbox', { name: 'What this Gun is called' }).fill('First Pistol');
  await page.getByRole('textbox', { name: 'Caliber' }).fill('9mm');
  await page.getByRole('button', { name: 'Save gun', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What are you working toward?' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
}

/** The card of drill rows immediately following one section's heading —
 *  `:text-is` so "Draw" never matches "Draw to First Shot" text elsewhere,
 *  and the CSS sibling chain (`h2 + p + div.card`) mirrors DrillsScreen's own
 *  markup exactly (one heading, one sub-line, one card, per section). */
function sectionCard(page: Page, heading: string) {
  return page.locator(`h2.menu-group-title:text-is("${heading}") + p.menu-group-sub + div.card`);
}

test.describe('Drill library grouping (board memo 10 Sep 2026)', () => {
  test('a fresh install shows all seven sections, in order, with the board\'s §1 counts, and no Custom heading', async ({ page }) => {
    await addFirstGun(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');

    const headings = main.locator('h2.menu-group-title');
    await expect(headings).toHaveText([
      'Draw', 'Reloads', 'Transitions', 'Recoil control / Splits',
      'Accuracy / Trigger control', 'Stage skills / Match simulation',
      'Steel Challenge stages',
    ]);

    const expected: [string, number][] = [
      ['Draw', 1], ['Reloads', 2], ['Transitions', 6], ['Recoil control / Splits', 2],
      ['Accuracy / Trigger control', 2], ['Stage skills / Match simulation', 1],
      ['Steel Challenge stages', 8],
    ];
    for (const [label, count] of expected) {
      await expect(sectionCard(main, label).locator('button.row-tap')).toHaveCount(count);
    }

    await expect(main.getByRole('heading', { name: 'Custom' })).toHaveCount(0);
  });

  test('a search that matches one drill shows exactly one section', async ({ page }) => {
    await addFirstGun(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Bill Drill' })).toBeVisible(); // seeded

    await page.getByPlaceholder('Search drills').fill('Bill Drill');
    await expect(main.locator('h2.menu-group-title')).toHaveText(['Recoil control / Splits']);
    await expect(sectionCard(main, 'Recoil control / Splits').locator('button.row-tap')).toHaveCount(1);
  });

  test('a search that matches nothing shows "No drills match."', async ({ page }) => {
    await addFirstGun(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    await page.getByPlaceholder('Search drills').fill('zzz-nonexistent-drill-zzz');
    await expect(main.getByText('No drills match.')).toBeVisible();
    await expect(main.locator('h2.menu-group-title')).toHaveCount(0);
  });

  test('a custom drill with Skill = Reloads appears under Reloads, and an unpicked skill appears under Custom', async ({ page }) => {
    await addFirstGun(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');

    // With a skill picked.
    await main.getByRole('button', { name: '+ Add Drill' }).click();
    await page.getByRole('textbox', { name: 'What this Drill is called' }).fill('My Reload Drill');
    await page.getByRole('group', { name: 'Skill trained' }).getByRole('button', { name: 'Reloads', exact: true }).click();
    await page.locator('.navbar-action').click(); // Save
    await expect(sectionCard(main, 'Reloads').getByRole('button', { name: 'My Reload Drill' })).toBeVisible();
    await expect(sectionCard(main, 'Reloads').locator('button.row-tap')).toHaveCount(3); // 2 built-in + this one

    // With no skill picked — lands in Custom, last.
    await main.getByRole('button', { name: '+ Add Drill' }).click();
    await page.getByRole('textbox', { name: 'What this Drill is called' }).fill('My Unsorted Drill');
    await page.locator('.navbar-action').click(); // Save
    await expect(main.getByRole('heading', { name: 'Custom' })).toBeVisible();
    const headings = await main.locator('h2.menu-group-title').allTextContents();
    expect(headings[headings.length - 1]).toBe('Custom');
    await expect(sectionCard(main, 'Custom').getByRole('button', { name: 'My Unsorted Drill' })).toBeVisible();
  });

  test('the Skill chooser is hidden when editing a built-in drill', async ({ page }) => {
    await addFirstGun(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Bill Drill' }).click();
    await main.getByRole('button', { name: 'Edit Drill' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Drill' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Skill trained' })).toHaveCount(0);
  });
});

test.describe('Pick Drills sheet grouping (11 Sep 2026)', () => {
  test('the session form picker shows the same skill sections, in order, with empty ones hidden', async ({ page }) => {
    await addFirstGun(page);
    const main = page.getByRole('main');
    // Same race guard as stock-drills.spec.ts: confirm the seed landed before
    // opening the session form, which reads its drill list on mount.
    await gotoSection(page, 'Drills');
    await expect(main.getByRole('button', { name: 'Bill Drill' })).toBeVisible();
    await gotoTab(page, 'Home');
    await main.getByRole('button', { name: '3. Log your first session' }).click();

    const gunsCard = page.getByTestId('session-guns-card');
    await gunsCard.locator('button.gun-toggle').first().click();
    const drillsCard = page.getByTestId('session-drills-card');
    await drillsCard.getByRole('button', { name: '+ Add Drill' }).click();
    const sheet = page.getByRole('dialog', { name: 'Pick Drills' });
    await expect(sheet).toBeVisible();

    // A live-fire pistol session offers 21 of the 22 built-ins (Reload
    // Practice is dry-fire only), so every one of the seven sections still
    // has at least one drill and appears, in the Drills screen's order.
    await expect(sheet.locator('h2.drill-pick-group')).toHaveText([
      'Draw', 'Reloads', 'Transitions', 'Recoil control / Splits',
      'Accuracy / Trigger control', 'Stage skills / Match simulation',
      'Steel Challenge stages',
    ]);
    await expect(sheet.getByRole('button', { name: '1-Reload-1' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Reload Practice' })).toHaveCount(0);
    // Rows still toggle: picking one enables the Add button with a count.
    await sheet.getByRole('button', { name: 'Bill Drill' }).click();
    await expect(sheet.getByRole('button', { name: 'Add 1 Drill' })).toBeEnabled();
  });
});

test.describe('Drill library grouping — desktop-independent smoke via tab nav', () => {
  test('the grouped headings survive a round trip through another tab and back', async ({ page }) => {
    await addFirstGun(page);
    await gotoSection(page, 'Drills');
    const main = page.getByRole('main');
    await expect(main.locator('h2.menu-group-title').first()).toHaveText('Draw');
    await gotoTab(page, 'Home');
    await gotoSection(page, 'Drills');
    await expect(main.locator('h2.menu-group-title').first()).toHaveText('Draw');
  });
});
