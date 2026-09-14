import { test, expect, type Page } from '@playwright/test';
import { seedDemo, isDesktop, nav, gotoSection, gotoTab } from './helpers';
import { findEntries } from '../src/ui/findIndex.ts';

// Find a screen (decision 75, 12 Sep 2026, build 2): the search box atop the
// phone More tab / the desktop sidebar, and the desktop Help menu's "Find a
// Screen…" item that focuses it. Every result carries a `data-find-id`
// attribute (added purely for this suite) matching its FIND_INDEX entry's
// id, so a test can click the exact entry a query surfaced rather than
// guessing "the first one" when several entries share words or a landing
// screen — table order and ranking are already covered by
// tests/findIndex.test.ts.

const findBox = (page: Page) => page.getByRole('search', { name: 'Find a screen' });
const findInput = (page: Page) => findBox(page).getByRole('searchbox');

// L5: Tour & Setup shows this box AND the sidebar's own at once on desktop,
// so it carries its own distinct accessible name ("Find in this index").
const indexBox = (page: Page) => page.getByRole('search', { name: 'Find in this index' });
const indexInput = (page: Page) => indexBox(page).getByRole('searchbox');

/** However the current surface reaches its Find box: on desktop it's always
 *  in the sidebar; on the phone it's the More tab's own copy. */
async function goToFindBox(page: Page): Promise<void> {
  if (!isDesktop(page)) {
    await nav(page).getByRole('button', { name: 'More' }).first().click();
  }
  await expect(findInput(page)).toBeVisible();
}

function resultLocator(page: Page, id: string) {
  return page.locator(`[data-find-id="${id}"]`).first();
}


test.describe('Find a screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedDemo(page);
  });

  for (const entry of findEntries()) {
    test(`"${entry.words[0]}" finds and opens ${entry.id}`, async ({ page }) => {
      await goToFindBox(page);
      await findInput(page).fill(entry.words[0]);
      await resultLocator(page, entry.id).click();
      await expect(page.getByRole('heading', { name: entry.landing }).first()).toBeVisible();
    });
  }
});

test.describe('Find a screen — no match (phone More tab)', () => {
  test('shows the no-match line, and its index tap opens Tour & Setup', async ({ page }) => {
    test.skip(isDesktop(page), 'the no-match line is a More-tab-only surface');
    await seedDemo(page);
    await goToFindBox(page);
    await findInput(page).fill('zzznotarealscreenzzz');
    await expect(page.getByText('Nothing called that. Try another word, or open the')).toBeVisible();
    await page.getByRole('button', { name: 'Where do I find… index' }).click();
    await expect(page.getByRole('heading', { name: 'Tour & Setup' }).first()).toBeVisible();
  });
});

test.describe('Find a screen — clearing restores the normal view', () => {
  test('phone: clearing the box brings the More groups back', async ({ page }) => {
    test.skip(isDesktop(page), 'phone-only surface');
    await seedDemo(page);
    await goToFindBox(page);
    await expect(page.getByRole('heading', { name: 'Your Gear' })).toBeVisible();
    await findInput(page).fill('optics');
    await expect(page.getByRole('heading', { name: 'Your Gear' })).toBeHidden();
    await findInput(page).fill('');
    await expect(page.getByRole('heading', { name: 'Your Gear' })).toBeVisible();
  });

  test('desktop: clearing the box brings the full sidebar back', async ({ page }) => {
    test.skip(!isDesktop(page), 'desktop-only surface');
    await seedDemo(page);
    await expect(nav(page).getByRole('button', { name: 'Optics' })).toBeVisible();
    await findInput(page).fill('zzznotarealscreenzzz');
    await expect(nav(page).getByRole('button', { name: 'Optics' })).toBeHidden();
    await findInput(page).fill('');
    await expect(nav(page).getByRole('button', { name: 'Optics' })).toBeVisible();
  });
});

test.describe('Find a screen — the Help index filters in place', () => {
  // H2: Reveal defaults its groups closed, so a query that only matched
  // because of an "inside" row used to hide its own match behind a
  // collapsed group heading — on both phone and desktop.
  test('typing in the index reveals a matching "inside" row, not just its group heading', async ({ page }) => {
    await seedDemo(page);
    await gotoSection(page, 'Tour & Setup');
    await indexInput(page).fill('heatmap');
    await expect(page.getByRole('button', { name: 'Training grid' }).first()).toBeVisible();
  });
});

test.describe('Find a screen — desktop-only behavior', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 900, 'desktop-only surface');

  test('Escape clears the box', async ({ page }) => {
    await seedDemo(page);
    await findInput(page).fill('optics');
    await expect(findInput(page)).toHaveValue('optics');
    await findInput(page).press('Escape');
    await expect(findInput(page)).toHaveValue('');
  });

  test('the Help menu\'s "Find a Screen…" item focuses the sidebar box', async ({ page }) => {
    await seedDemo(page);
    // Hide the sidebar first — the item must show it again before focusing.
    await page.getByRole('menubar', { name: 'FirearmLog menu bar' })
      .getByRole('menuitem', { name: 'View', exact: true }).click();
    await page.getByRole('menu', { name: 'View', exact: true })
      .getByRole('menuitem', { name: 'Hide Sidebar' }).click();
    await expect(nav(page)).toBeHidden();

    await page.getByRole('menubar', { name: 'FirearmLog menu bar' })
      .getByRole('menuitem', { name: 'Help', exact: true }).click();
    await page.getByRole('menu', { name: 'Help', exact: true })
      .getByRole('menuitem', { name: 'Find a Screen…', exact: true }).click();

    await expect(nav(page)).toBeVisible();
    await expect(findInput(page)).toBeFocused();
  });

  test('the aria-live region announces the result count', async ({ page }) => {
    await seedDemo(page);
    const live = findBox(page).locator('[aria-live="polite"]');
    await expect(live).toHaveText('');
    await findInput(page).fill('optics');
    // The unlabeled cold-audit fix (session 79): the sidebar's count line is
    // now a visible " · Esc to clear" line (and doubles as the live region),
    // so an empty sidebar reads as "0 matched", not "the sidebar vanished".
    await expect(live).toHaveText('1 screen found · Esc to clear');
    await findInput(page).fill('zzznotarealscreenzzz');
    await expect(live).toHaveText('0 screens found · Esc to clear');
  });

  // L1: a click used to clear the box synchronously, before its own guarded
  // navigation had actually run — cancelling a parked navigation ("Keep
  // editing") left the box empty even though nothing had moved.
  test('a dirty session form: "Keep editing" leaves the sidebar query untouched', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Home');
    await page.getByRole('button', { name: '+ Log Session' }).first().click();
    await page.getByRole('textbox', { name: 'Where' }).fill('Take Aim');
    await findInput(page).fill('optics');
    await nav(page).getByRole('button', { name: 'Optics' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeHidden();
    await expect(findInput(page)).toHaveValue('optics');
    // And discarding for real still clears it, same as before this fix.
    await nav(page).getByRole('button', { name: 'Optics' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Optics' }).first()).toBeVisible();
    await expect(findInput(page)).toHaveValue('');
  });
});

test.describe('Find a screen — jumping to where you already are', () => {
  test('desktop: picking a thing on the current tab still clears the box', async ({ page }) => {
    test.skip(!isDesktop(page), 'the sidebar box only exists on desktop');
    await seedDemo(page);
    // Home is the tab the sample log lands on; "Needs Attention" lives on it,
    // so nothing about the active tab or the open view changes on the click.
    await goToFindBox(page);
    await findInput(page).fill('nudge');
    await resultLocator(page, 'home-attention').click();
    await expect(findInput(page)).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'FirearmLog' }).first()).toBeVisible();
  });

  test('phone: the More tab shows the short sidebar label for the numbers guide', async ({ page }) => {
    test.skip(isDesktop(page), 'phone-only surface');
    await seedDemo(page);
    await goToFindBox(page);
    await expect(page.getByRole('button', { name: 'The numbers', exact: true })).toBeVisible();
  });
});
