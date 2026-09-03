import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// Decision 52 (Michael, 3 Sep 2026, session 140): "I want all competitions to
// automatically be co-located in log." The Log screen's list view merges
// sessions and matches into ONE chronological timeline, newest first — a
// match row is the same MatchRow the Compete tab draws (tapping it opens the
// match detail), with no swipe/delete on it (a match is deleted from the
// match itself, on Compete). Tie-break for two rows sharing a date: sessions
// sort before matches (see screens.tsx). The demo dataset already carries
// plenty of both sessions and matches (compete-filter.spec.ts's "expect(total)
// .toBeGreaterThan(5)" pins that), so seedDemo alone gives real interleaving
// with no extra seeding needed.

/** The merged-timeline card, whichever heading it's currently showing
 *  (decision 52's rename: "Everything logged" unfiltered, "Matching entries"
 *  while the filter narrows it). */
function logCard(page: Page): Locator {
  const main = page.getByRole('main');
  return main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Everything logged', exact: true }) })
    .or(main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matching entries', exact: true }) }));
}

/** Session rows are the only ones wrapped in a SwipeRow (`.swipe-row`) — a
 *  MatchRow's button is a bare `.row-tap`, a direct child of the card. */
function sessionRows(page: Page): Locator {
  return logCard(page).locator('.swipe-row .row-tap');
}

/** A `.row-tap` with no `.swipe-row` ancestor is a match row — found via XPath
 *  rather than assuming it's a direct child, so this keeps working even if
 *  the card's markup grows an extra wrapper around a MatchRow later. */
function matchRows(page: Page): Locator {
  return logCard(page).locator(
    'xpath=.//button[contains(concat(" ", normalize-space(@class), " "), " row-tap ")' +
    ' and not(ancestor::*[contains(concat(" ", normalize-space(@class), " "), " swipe-row ")])]'
  );
}

/** formatDayKey's rendered shape (src/lib/dates.ts): "Mon D, YYYY". */
const DATE_RE = /([A-Za-z]{3} \d{1,2}, \d{4})/;

/** Every row's {kind, date} in the order they render, read straight off the
 *  DOM in one pass — a session row's date is its label's first text node; a
 *  match row's date sits at the start of its `.row-sub` line ("date · division"). */
async function readRows(page: Page): Promise<{ kind: 'session' | 'match'; date: number }[]> {
  const rows = await logCard(page).evaluate((card) => {
    const out: { kind: string; text: string }[] = [];
    for (const el of Array.from(card.children)) {
      if (el.classList.contains('swipe-row')) {
        const label = el.querySelector('.label');
        out.push({ kind: 'session', text: (label?.childNodes[0]?.textContent ?? '').trim() });
      } else if (el.tagName === 'BUTTON' && el.classList.contains('row-tap')) {
        const sub = el.querySelector('.row-sub');
        out.push({ kind: 'match', text: (sub?.textContent ?? '').trim() });
      }
    }
    return out;
  });
  return rows.map((r) => {
    const m = DATE_RE.exec(r.text);
    expect(m, `expected a rendered date in ${JSON.stringify(r)}`).not.toBeNull();
    return { kind: r.kind as 'session' | 'match', date: new Date(m![1]).getTime() };
  });
}

test.describe('Log: sessions and matches co-located (decision 52)', () => {
  test('the list is one merged timeline, newest first, with matches between sessions', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    await expect(page.getByRole('heading', { name: 'Everything logged' })).toBeVisible();
    await expect(sessionRows(page).first()).toBeVisible();
    await expect(matchRows(page).first()).toBeVisible();

    const rows = await readRows(page);
    expect(rows.length).toBeGreaterThan(5);

    // Descending date order across the WHOLE merged list, sessions and
    // matches together — not just within one kind.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].date, `row ${i - 1} (${rows[i - 1].kind}) should not be older than row ${i} (${rows[i].kind})`)
        .toBeGreaterThanOrEqual(rows[i].date);
    }

    // At least one match sits BETWEEN two sessions (a session appears both
    // before and after some match's position) — "co-located", not bolted on
    // at one end of the list.
    const firstMatchIdx = rows.findIndex((r) => r.kind === 'match');
    const lastMatchIdx = rows.length - 1 - [...rows].reverse().findIndex((r) => r.kind === 'match');
    const sessionBefore = rows.slice(0, firstMatchIdx).some((r) => r.kind === 'session');
    const sessionAfter = rows.slice(lastMatchIdx + 1).some((r) => r.kind === 'session');
    expect(sessionBefore && sessionAfter, 'expected at least one match row sandwiched between session rows').toBe(true);
  });

  test('tapping a match row opens that match\'s detail', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    const row = matchRows(page).first();
    await expect(row).toBeVisible();
    // The row's own label (name, or match type when unnamed) becomes the
    // navbar/back context; the detail screen carries the match-only "Edit"
    // navbar action (src/ui/MatchScreens.tsx's MatchDetail) — never present
    // on a session form — so this proves the real match detail opened
    // without depending on match.name being set (MatchRow falls back to
    // matchType; the detail heading falls back to the date instead, so name
    // text isn't guaranteed to match the h1 verbatim).
    await row.click();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '‹ Back' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toHaveCount(0);
  });

  test('a match row has no swipe/delete control; a session row does', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    // Session rows: each sits inside a `.swipe-row`, which always renders a
    // (hidden-until-open) `.swipe-delete` button — the SwipeRow contract.
    const firstSessionRow = sessionRows(page).first();
    await expect(firstSessionRow).toBeVisible();
    const sessionWrapper = firstSessionRow.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " swipe-row ")][1]');
    await expect(sessionWrapper.locator('.swipe-delete')).toHaveCount(1);

    // Match rows: never wrapped in a SwipeRow at all, so there's no delete
    // affordance anywhere near them — proven structurally, not just visually.
    const firstMatchRow = matchRows(page).first();
    await expect(firstMatchRow).toBeVisible();
    const hasSwipeAncestor = await firstMatchRow.evaluate(
      (el) => el.closest('.swipe-row') !== null
    );
    expect(hasSwipeAncestor).toBe(false);
  });

  test('the Matches filter narrows the merged list to match rows only', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    const filterSheet = page.getByRole('dialog', { name: 'Search & Filter' });
    await filterSheet.getByRole('button', { name: 'Matches', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('heading', { name: 'Matching entries' })).toBeVisible();
    await expect(sessionRows(page)).toHaveCount(0);
    const remaining = matchRows(page);
    await expect(remaining.first()).toBeVisible();
    expect(await remaining.count()).toBeGreaterThan(0);

    // Clear restores the merged timeline.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Everything logged' })).toBeVisible();
    expect(await sessionRows(page).count()).toBeGreaterThan(0);
  });
});
