import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// F2a (stranger-test pilot, July 13 2026): the Log filter offers a "Matches"
// chip and counts matches in "Showing X of Y" — so the LIST must actually show
// matching match rows while the shooter is narrowing. The pilot tester filtered
// to Matches, got an empty list, and called it broken. These runs prove the
// filter now delivers what it promises, and that the default list is unchanged.

test.describe('Log filter shows matches honestly (F2a)', () => {
  test('Matches chip surfaces real match rows; tapping one opens the match; the default list stays sessions-only', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');

    const main = page.getByRole('main');
    const filterSheet = page.getByRole('dialog', { name: 'Search & Filter' });
    const matchesCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matches', exact: true }),
    });

    // Default view: sessions only — no Matches card in the list. (Non-vacuous
    // baseline: if this ever shows by default, the assertions below mean nothing.)
    await expect(main.getByRole('heading', { name: 'All Sessions' })).toBeVisible();
    await expect(matchesCard).toHaveCount(0);

    // Narrow to Matches via the filter sheet.
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.getByRole('button', { name: 'Matches', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    // The count note and the Matches card are both there, with real rows.
    await expect(main.getByText(/Showing \d+ of \d+/)).toBeVisible();
    await expect(matchesCard).toBeVisible();
    const rows = matchesCard.locator('.row-tap');
    expect(await rows.count()).toBeGreaterThan(0);

    // Clear (still on the Log screen) returns the list to sessions-only.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(matchesCard).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'All Sessions' })).toBeVisible();

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
    // filter conferral): the Log filter is now session-persistent, so leaving
    // and returning to Log keeps the SAME filter, not a fresh one — the
    // Matches chip is still on and the Matches card is still there.
    await gotoTab(page, 'Log');
    await expect(main.getByRole('heading', { name: 'All Sessions' })).toHaveCount(0);
    await expect(matchesCard).toBeVisible();

    // Clear here so the remaining assertions (a fresh text search, then a
    // fresh Matches-chip-plus-no-hit-query) start from an unfiltered list.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'All Sessions' })).toBeVisible();
    await expect(matchesCard).toHaveCount(0);

    // The query path, not just the kind chip: a text search that hits the match
    // name ALSO surfaces it (the search field promises "match names").
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.locator('input[type="search"]').fill(name);
    await filterSheet.getByRole('button', { name: 'Done' }).click();
    await expect(matchesCard).toBeVisible();
    await expect(matchesCard.locator('.row-tap').first()).toContainText(name);

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

  test('filtering to Matches with none logged teaches where matches live', async ({ page }) => {
    // Fresh, empty log — skip the wizard instead of loading the sample.
    await page.goto('/');
    await page.getByRole('button', { name: "Skip for now — I'm just looking around" }).click();
    await gotoTab(page, 'Log');

    const main = page.getByRole('main');
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    const filterSheet = page.getByRole('dialog', { name: 'Search & Filter' });
    await filterSheet.getByRole('button', { name: 'Matches', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    // The empty state answers the actual question instead of shrugging.
    await expect(main.getByText(/No matches logged yet — matches live in the Compete tab/)).toBeVisible();
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
      has: page.getByRole('heading', { name: 'All Sessions' }),
    }).or(main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matching Sessions' }),
    }));

    // Narrow to Practice-kind sessions only (this also drops any Matches card,
    // so the first row is guaranteed to be a session, not a match).
    await main.getByRole('button', { name: /Search & Filter/ }).click();
    await filterSheet.getByRole('button', { name: 'Practice', exact: true }).click();
    await filterSheet.getByRole('button', { name: 'Done' }).click();

    await expect(main.getByRole('heading', { name: 'Matching Sessions' })).toBeVisible();
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
    await expect(main.getByRole('heading', { name: 'Matching Sessions' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();
    await expect(main.getByText(shownText!)).toBeVisible();
    expect(await rows.count()).toBe(shown);

    // Clear still works after the restore.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'All Sessions' })).toBeVisible();
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

    await expect(main.getByRole('heading', { name: 'Matching Sessions' })).toBeVisible();
    const shownText = await main.getByText(/Showing \d+ of \d+\./).textContent();
    expect(shownText).toBeTruthy();

    // Leave the tab, come back — any number of round trips.
    await gotoTab(page, 'Home');
    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await gotoTab(page, 'Log');
    await expect(main.getByRole('heading', { name: 'Matching Sessions' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();
    await expect(main.getByText(shownText!)).toBeVisible();

    // A second round trip (Home → Log again) still holds it.
    await gotoTab(page, 'Home');
    await gotoTab(page, 'Log');
    await expect(main.getByRole('button', { name: 'Search & Filter (1)' })).toBeVisible();
    await expect(main.getByText(shownText!)).toBeVisible();

    // Clear still works after these restores.
    await main.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'All Sessions' })).toBeVisible();
    await expect(main.getByText(/Showing \d+ of \d+\./)).toHaveCount(0);
  });
});
