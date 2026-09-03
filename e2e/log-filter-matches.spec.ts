import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// F2a (stranger-test pilot, July 13 2026): the Log filter offers a "Matches"
// chip and counts matches in "Showing X of Y" — so the LIST must actually show
// matching match rows while the shooter is narrowing. The pilot tester filtered
// to Matches, got an empty list, and called it broken.
//
// UPDATED for decision 52 (Michael, 3 Sep 2026, session 140): matches are now
// co-located in the Log's list ALWAYS, not just while filtering — see
// log-matches-colocated.spec.ts for the merged-timeline coverage. What this
// file still proves is that the Matches filter chip narrows the merged list
// down to matches only, that a match row still opens the right match, that
// the filter survives navigation, and the empty/teaching states are honest.

test.describe('Log filter shows matches honestly (F2a)', () => {
  test('Matches chip narrows the merged list to match rows; tapping one opens the match', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    const main = page.getByRole('main');
    const filterSheet = page.getByRole('dialog', { name: 'Search & Filter' });
    // One merged card either way — "Everything logged" unfiltered, "Matching
    // entries" while narrowing (decision 52's card-heading rename).
    const logCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Everything logged', exact: true }) })
      .or(main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matching entries', exact: true }) }));

    // Default view: the merged timeline, unfiltered.
    await expect(main.getByRole('heading', { name: 'Everything logged' })).toBeVisible();

    // Narrow to Matches via the filter sheet.
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.getByRole('button', { name: 'Matches', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    // The count note is there, the heading flips to "Matching entries", and
    // every row left is a real match row (kind-filtered to matches only, so
    // there are no session rows left to confuse this with).
    await expect(main.getByText(/Showing \d+ of \d+/)).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Matching entries' })).toBeVisible();
    const rows = logCard.locator('.row-tap');
    expect(await rows.count()).toBeGreaterThan(0);

    // Clear (still on the Log screen) returns the list to the full timeline.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Everything logged' })).toBeVisible();

    // Filter again — this time prove a match row opens THAT match: capture the
    // row's name (the label's first text node; the sub-line underneath is
    // date · division) and expect it as the detail heading.
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.getByRole('button', { name: 'Matches', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();
    const firstLabel = rows.first().locator('.label');
    const name = (await firstLabel.evaluate((el) => el.childNodes[0]?.textContent ?? '')).trim();
    expect(name.length).toBeGreaterThan(0);
    await rows.first().click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // Session 75 (July 23 2026, board-approved — extension of the Compete
    // filter conferral): the Log filter is session-persistent, so leaving
    // and returning to Log keeps the SAME filter, not a fresh one — the
    // Matches chip is still on and the heading is still "Matching entries".
    await gotoTab(page, 'Log');
    await expect(main.getByRole('heading', { name: 'Everything logged' })).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'Matching entries' })).toBeVisible();

    // Clear here so the remaining assertions (a fresh text search, then a
    // fresh Matches-chip-plus-no-hit-query) start from an unfiltered list.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Everything logged' })).toBeVisible();

    // The query path, not just the kind chip: a text search that hits the match
    // name ALSO surfaces it (the search field promises "match names").
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.locator('input[type="search"]').fill(name);
    await filterSheet.getByRole('button', { name: 'Done' }).click();
    await expect(logCard.locator('.row-tap').first()).toContainText(name);

    // With matches logged, the Matches chip plus a no-hit query gets the
    // GENERIC empty state — never the "No matches logged yet" teaching line.
    // This pins the `matches.length === 0` guard: drop it and this fails.
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.getByRole('button', { name: 'Matches', exact: true }).click();
    await filterSheet.locator('input[type="search"]').fill('zzz-no-such-record-zzz');
    await filterSheet.getByRole('button', { name: 'Done' }).click();
    await expect(main.getByText(/Nothing matches your search/)).toBeVisible();
    await expect(main.getByText('No matches logged yet')).toHaveCount(0);
  });

  test('filtering to Matches with none logged shows the teaching empty state', async ({ page }) => {
    // Fresh, empty log — skip the wizard instead of loading the sample.
    await page.goto('/');
    await page.getByRole('button', { name: "Skip for now — I'm just looking around" }).click();
    await gotoTab(page, 'Log');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    const filterSheet = page.getByRole('dialog', { name: 'Search & Filter' });
    await filterSheet.getByRole('button', { name: 'Matches', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    // Copy updated per decision 52 (3 Sep 2026, session 140): the sentence
    // keeps its teaching shape but drops "matches live in the Compete tab",
    // which is no longer the whole truth now that matches co-locate here.
    await expect(main.getByText('No matches logged yet. Tap Clear to see everything again.')).toBeVisible();
  });

  // Session 75 (July 23 2026, board-approved): the Log filter is
  // session-persistent in memory — it must survive a session-detail round trip
  // AND leaving the Log tab, any number of times, within one app run (same
  // decided behavior as the Compete filter; it still clears on a fresh launch,
  // which these runs don't exercise since they don't reload).
  test('filter survives opening a session detail and coming Back', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    const main = page.getByRole('main');
    const filterSheet = page.getByRole('dialog', { name: 'Search & Filter' });
    const sessionsCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Everything logged' }),
    }).or(main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matching entries' }),
    }));

    // Narrow to Practice-kind sessions only (this excludes matches from the
    // merged list entirely, so the first row is guaranteed to be a session).
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.getByRole('button', { name: 'Practice', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    await expect(main.getByRole('heading', { name: 'Matching entries' })).toBeVisible();
    const rows = sessionsCard.locator('.row-tap');
    await expect(rows.first()).toBeVisible();
    const shownText = await main.getByText(/Showing \d+ of \d+\./).textContent();
    expect(shownText).toBeTruthy();
    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    await expect(main.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();

    // Open the first session's detail, then come Back (the form's ‹ Cancel,
    // since nothing was edited).
    await rows.first().click();
    await expect(main.getByRole('button', { name: '‹ Cancel' })).toBeVisible();
    await main.getByRole('button', { name: '‹ Cancel' }).click();

    // The restored Log screen still shows the SAME filter, immediately.
    await expect(main.getByRole('heading', { name: 'Matching entries' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();
    await expect(main.getByText(shownText!)).toBeVisible();
    expect(await rows.count()).toBe(shown);

    // Clear still works after the restore.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Everything logged' })).toBeVisible();
    await expect(main.getByText(/Showing \d+ of \d+\./)).toHaveCount(0);
  });

  test('filter survives leaving the Log tab and returning', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    const main = page.getByRole('main');
    const filterSheet = page.getByRole('dialog', { name: 'Search & Filter' });

    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.getByRole('button', { name: 'Practice', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    await expect(main.getByRole('heading', { name: 'Matching entries' })).toBeVisible();
    const shownText = await main.getByText(/Showing \d+ of \d+\./).textContent();
    expect(shownText).toBeTruthy();

    // Leave the tab, come back — any number of round trips.
    await gotoTab(page, 'Home');
    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await gotoTab(page, 'Log');
    await expect(main.getByRole('heading', { name: 'Matching entries' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();
    await expect(main.getByText(shownText!)).toBeVisible();

    // A second round trip (Home → Log again) still holds it.
    await gotoTab(page, 'Home');
    await gotoTab(page, 'Log');
    await expect(main.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();
    await expect(main.getByText(shownText!)).toBeVisible();

    // Clear still works after these restores.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Everything logged' })).toBeVisible();
    await expect(main.getByText(/Showing \d+ of \d+\./)).toHaveCount(0);
  });
});
