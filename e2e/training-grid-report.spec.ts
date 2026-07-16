import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, isDesktop } from './helpers';

// A day square on the Progress training grid. On a BIGGER screen a tap opens
// that day's SESSION REPORT — the finished read with drills, notes, and target
// photos — not the edit screen (Michael, July 8 2026). A day with several
// sessions shows the picker sheet first; each row there opens a report too.
//
// Tester-2 F3 (July 16 2026): on a PHONE the squares render ~11px wide — well
// under the 44pt tap minimum — so a tap that opens a report is usually an
// accident. On phone widths "Just show the day's count" is therefore the
// DEFAULT (Michael's decision); the checkbox still lets either side switch.

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
  const gunsCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Guns & Rounds' }) });
  await gunsCard.locator('button.gun-toggle').first().click();
  await gunsCard.getByRole('spinbutton').first().fill('50');
  await page.locator('.navbar-action').click();
  await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
}

function todaySquare(page: Page) {
  const grid = page.getByRole('img', { name: 'Training activity heatmap' });
  return grid.locator('rect').filter({ has: page.locator(`title:has-text("${todayKey()}:")`) });
}

function countOnlyToggle(page: Page) {
  return page.getByText("Just show the day's count, don't open the report");
}

/** Tap today's square and assert a Session Report popup opened (report mode). */
async function expectOpensReport(page: Page): Promise<void> {
  const square = todaySquare(page);
  await expect(square).toHaveCount(1);
  // One session today opens the report straight away; if the sample data also
  // logged something today, the day picker shows first — open the first row.
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

/** Tap today's square and assert only the count line shows — no popup (peek). */
async function expectShowsCount(page: Page): Promise<void> {
  const square = todaySquare(page);
  await expect(square).toHaveCount(1);
  const gotPopup = page.waitForEvent('popup', { timeout: 2000 }).catch(() => null);
  await square.click();
  expect(await gotPopup).toBeNull();
  const gridCard = page.getByRole('main').locator('.card').filter({
    has: page.getByRole('heading', { name: /Training grid/ }),
  });
  await expect(gridCard.locator('p.report-note[aria-live="polite"]')).toContainText(/session/);
  await expect(page.getByRole('heading', { name: 'Progress' }).first()).toBeVisible();
}

test.describe('Training grid day squares', () => {
  test('default tap: opens the report on a big screen, shows the count on a phone', async ({ page }) => {
    await seedDemo(page);
    await logSessionToday(page);
    await gotoTab(page, 'Progress');

    if (isDesktop(page)) {
      // Desktop default: count-only OFF, so a tap opens the day's report.
      await expect(countOnlyToggle(page)).not.toBeChecked();
      await expectOpensReport(page);
    } else {
      // Phone default (F3): count-only ON, so a tap peeks the count — no popup.
      await expect(countOnlyToggle(page)).toBeChecked();
      await expectShowsCount(page);
    }
  });

  test('the checkbox flips the tap behaviour on either form factor', async ({ page }) => {
    await seedDemo(page);
    await logSessionToday(page);
    await gotoTab(page, 'Progress');

    // Flip whatever the form-factor default is and assert the OTHER behaviour.
    await countOnlyToggle(page).click();
    if (isDesktop(page)) {
      // Desktop: default off → now ON → the quiet count peek.
      await expectShowsCount(page);
    } else {
      // Phone: default on → now OFF → tapping opens the report.
      await expectOpensReport(page);
    }
  });
});
