import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, isDesktop } from './helpers';

// The Progress training grid.
//
// DESKTOP (a pointer hits a 12px square fine): a tap on a day square opens that
// day's SESSION REPORT — the finished read with drills, notes, and target photos
// — not the edit screen (Michael, July 8 2026). A day with several sessions shows
// a picker sheet first. The "Just show the day's count" checkbox flips a tap to a
// quiet count peek instead.
//
// PHONE (A4, batch 2): the squares render ~5–11px — a quarter of the 44pt minimum
// — so the grid is DISPLAY-ONLY there (no per-cell tap, no count-only checkbox).
// The readout moves to a coarser, honest target: tap a MONTH chip below the grid
// for that month's totals.

/** Today's day key in the page's local time (matches the app's day keys). */
function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Log a bare 50-round session for today so today's square is never empty. */
async function logSessionToday(page: Page): Promise<void> {
  await gotoTab(page, 'Log');
  await page.getByRole('button', { name: '+ Log Session' }).click();
  const gunsCard = page.locator('.card').filter({ hasText: 'Guns & Rounds' }).first();
  await gunsCard.locator('button.gun-toggle').first().click();
  await gunsCard.getByRole('spinbutton').first().fill('50');
  await page.locator('.navbar-action').click();
  await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
}

function gridCard(page: Page) {
  return page.getByRole('main').locator('.card').filter({
    has: page.getByRole('heading', { name: /Training grid/ }),
  });
}

function todaySquare(page: Page) {
  const grid = page.getByRole('img', { name: 'Training activity heatmap' });
  return grid.locator('rect').filter({ has: page.locator(`title:has-text("${todayKey()}:")`) });
}

function countOnlyToggle(page: Page) {
  return page.getByText("Just show the day's count, don't open the report");
}

function monthChips(page: Page) {
  return gridCard(page).getByRole('group', { name: 'Tap a month for its totals' }).getByRole('button');
}

/** Desktop: tap today's square and assert a Session Report popup opened. */
async function expectOpensReport(page: Page): Promise<void> {
  const square = todaySquare(page);
  await expect(square).toHaveCount(1);
  const firstTry = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
  await square.click();
  let popup = await firstTry;
  if (!popup) {
    await expect(page.getByRole('heading', { name: 'Sessions on this day' })).toBeVisible();
    [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('.drill-pick-row').first().click(),
    ]);
  }
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.locator('.header h1')).toContainText('Session —');
  await expect(popup.locator('.sec-title').first()).toHaveText('Session');
  await expect(popup.locator('.sec-title', { hasText: 'Guns' })).toBeVisible();
  await popup.close();
  await expect(page.getByRole('heading', { name: 'Progress' }).first()).toBeVisible();
}

/** Desktop: tap today's square and assert only the count line shows — no popup. */
async function expectShowsCount(page: Page): Promise<void> {
  const square = todaySquare(page);
  await expect(square).toHaveCount(1);
  const gotPopup = page.waitForEvent('popup', { timeout: 2000 }).catch(() => null);
  await square.click();
  expect(await gotPopup).toBeNull();
  await expect(gridCard(page).locator('p.report-note[aria-live="polite"]')).toContainText(/session/);
  await expect(page.getByRole('heading', { name: 'Progress' }).first()).toBeVisible();
}

test.describe('Training grid', () => {
  test('desktop taps a day for its report; phone grid is display-only with month totals', async ({ page }) => {
    await seedDemo(page);
    await logSessionToday(page);
    await gotoTab(page, 'Progress');

    if (isDesktop(page)) {
      // Desktop default: count-only OFF, so a tap opens the day's report.
      await expect(countOnlyToggle(page)).not.toBeChecked();
      await expectOpensReport(page);
    } else {
      // Phone: the count-only checkbox is gone entirely (no per-cell tap to gate).
      await expect(countOnlyToggle(page)).toHaveCount(0);

      // The grid squares are DISPLAY-ONLY: tapping one opens no popup and writes
      // no day-count readout.
      const square = todaySquare(page);
      await expect(square).toHaveCount(1);
      const gotPopup = page.waitForEvent('popup', { timeout: 1500 }).catch(() => null);
      await square.click();
      expect(await gotPopup).toBeNull();
      await expect(gridCard(page).locator('p.report-note[aria-live="polite"]')).toHaveCount(0);

      // The coarse readout works: tap a month chip → its totals appear.
      const chips = monthChips(page);
      expect(await chips.count()).toBeGreaterThan(0);
      await chips.last().click();
      await expect(gridCard(page).locator('p.report-note[aria-live="polite"]')).toContainText(/session/);
    }
  });

  test('the count-only checkbox flips the tap (desktop only)', async ({ page }) => {
    await seedDemo(page);
    await logSessionToday(page);
    await gotoTab(page, 'Progress');

    if (isDesktop(page)) {
      await countOnlyToggle(page).click();
      await expectShowsCount(page);
    } else {
      // Phone has no such checkbox — the whole per-cell interaction is gone.
      await expect(countOnlyToggle(page)).toHaveCount(0);
    }
  });

  test('phone grid has no sub-44pt interactive cells; the month targets clear 44pt', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');
    test.skip(isDesktop(page), 'phone-only: desktop keeps the per-cell pointer tap');

    // No day square advertises itself as tappable (display-only → no pointer).
    const rects = page.getByRole('img', { name: 'Training activity heatmap' }).locator('rect');
    const n = await rects.count();
    expect(n).toBeGreaterThan(0);
    for (const i of [0, Math.floor(n / 2), n - 1]) {
      const cursor = await rects.nth(i).evaluate((el) => getComputedStyle(el).cursor);
      expect(cursor).not.toBe('pointer');
    }

    // The real interactive targets — the month chips — each clear the 44pt floor.
    const chips = monthChips(page);
    const c = await chips.count();
    expect(c).toBeGreaterThan(0);
    for (let i = 0; i < c; i++) {
      const box = await chips.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
