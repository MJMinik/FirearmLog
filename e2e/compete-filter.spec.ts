import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// A3 (batch 2): the Compete tab's match list gets a Filter — match type,
// division, gun, and a date range — the same Sheet + "Showing X of Y" pattern as
// the Log filter, so the two read as one system. (It's labelled "Filter", not
// "Search & Filter": unlike the Log's, this sheet has no free-text search field.)
// These runs prove the filter narrows the match list and the count line is honest.

test.describe('Compete match filter (A3)', () => {
  test('filtering by division narrows the list and the count line is honest; Clear restores it', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    const main = page.getByRole('main');
    const matchesCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matches', exact: true }),
    });
    const rows = matchesCard.locator('.row-tap');

    // Wait for the list to finish loading before counting (the screen has a
    // loading gate; counting too early races it).
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    expect(total).toBeGreaterThan(5);
    // No count line until something is narrowing.
    await expect(matchesCard.getByText(/Showing \d+ of \d+/)).toHaveCount(0);

    // Narrow to a single division the demo actually holds matches in.
    await matchesCard.getByRole('button', { name: /Filter/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await sheet.getByLabel('Division').selectOption('Limited Optics');
    await sheet.getByRole('button', { name: 'Done' }).click();

    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
    await expect(matchesCard.getByText(`Showing ${shown} of ${total}.`)).toBeVisible();
    // Every surviving row really is that division (the sub-line carries it).
    for (let i = 0; i < shown; i++) {
      await expect(rows.nth(i)).toContainText('Limited Optics');
    }

    // Clear (on the card) restores the full list and drops the count line.
    await matchesCard.getByRole('button', { name: 'Clear', exact: true }).click();
    expect(await rows.count()).toBe(total);
    await expect(matchesCard.getByText(/Showing \d+ of \d+/)).toHaveCount(0);
  });

  test('filtering by match type also narrows honestly, and the badge counts the criteria', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    const main = page.getByRole('main');
    const matchesCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matches', exact: true }),
    });
    const rows = matchesCard.locator('.row-tap');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();

    await matchesCard.getByRole('button', { name: /Filter/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await sheet.getByLabel('Match type').selectOption('Steel Challenge');
    await sheet.getByRole('button', { name: 'Done' }).click();

    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
    await expect(matchesCard.getByText(`Showing ${shown} of ${total}.`)).toBeVisible();
    // One criterion active → the button shows a (1) badge.
    await expect(matchesCard.getByRole('button', { name: /Filter \(1\)/ })).toBeVisible();
  });

  // Session 75 (July 23 2026, board-approved): the filter is session-persistent
  // in memory — it must survive a match-detail round trip AND leaving the
  // Compete tab, any number of times, within one app run (it still clears on a
  // fresh launch, which these runs don't exercise since they don't reload).
  test('filter survives opening a match detail and coming Back', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    const main = page.getByRole('main');
    const matchesCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matches', exact: true }),
    });
    const rows = matchesCard.locator('.row-tap');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();

    await matchesCard.getByRole('button', { name: /Filter/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await sheet.getByLabel('Division').selectOption('Limited Optics');
    await sheet.getByRole('button', { name: 'Done' }).click();

    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
    await expect(matchesCard.getByRole('button', { name: 'Filter (1)' })).toBeVisible();
    await expect(matchesCard.getByText(`Showing ${shown} of ${total}.`)).toBeVisible();

    // Open the first surviving match's detail, then come Back.
    await rows.first().click();
    await expect(main.getByRole('button', { name: '‹ Back' })).toBeVisible();
    await main.getByRole('button', { name: '‹ Back' }).click();

    // The restored Compete screen still shows the SAME filter, immediately —
    // badge, count line, and the filtered-out matches still absent.
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    const restoredMatchesCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matches', exact: true }),
    });
    const restoredRows = restoredMatchesCard.locator('.row-tap');
    await expect(restoredMatchesCard.getByRole('button', { name: 'Filter (1)' })).toBeVisible();
    await expect(restoredMatchesCard.getByText(`Showing ${shown} of ${total}.`)).toBeVisible();
    expect(await restoredRows.count()).toBe(shown);
    for (let i = 0; i < shown; i++) {
      await expect(restoredRows.nth(i)).toContainText('Limited Optics');
    }

    // Clear still works after the restore.
    await restoredMatchesCard.getByRole('button', { name: 'Clear', exact: true }).click();
    expect(await restoredRows.count()).toBe(total);
    await expect(restoredMatchesCard.getByText(/Showing \d+ of \d+/)).toHaveCount(0);
  });

  test('filter survives leaving the Compete tab and returning', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');

    const main = page.getByRole('main');
    const matchesCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matches', exact: true }),
    });
    const rows = matchesCard.locator('.row-tap');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();

    await matchesCard.getByRole('button', { name: /Filter/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filter' });
    await sheet.getByLabel('Match type').selectOption('Steel Challenge');
    await sheet.getByRole('button', { name: 'Done' }).click();

    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
    await expect(matchesCard.getByText(`Showing ${shown} of ${total}.`)).toBeVisible();

    // Leave the tab, come back — any number of round trips.
    await gotoTab(page, 'Home');
    await expect(main.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible();
    await gotoTab(page, 'Compete');
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();

    const restoredMatchesCard = main.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Matches', exact: true }),
    });
    const restoredRows = restoredMatchesCard.locator('.row-tap');
    await expect(restoredMatchesCard.getByRole('button', { name: 'Filter (1)' })).toBeVisible();
    await expect(restoredMatchesCard.getByText(`Showing ${shown} of ${total}.`)).toBeVisible();
    expect(await restoredRows.count()).toBe(shown);

    // A second round trip (Home → Compete again) still holds it.
    await gotoTab(page, 'Home');
    await gotoTab(page, 'Compete');
    await expect(restoredMatchesCard.getByRole('button', { name: 'Filter (1)' })).toBeVisible();
    expect(await restoredRows.count()).toBe(shown);

    // Clear still works after these restores.
    await restoredMatchesCard.getByRole('button', { name: 'Clear', exact: true }).click();
    expect(await restoredRows.count()).toBe(total);
    await expect(restoredMatchesCard.getByText(/Showing \d+ of \d+/)).toHaveCount(0);
  });
});
