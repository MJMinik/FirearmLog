import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// A day square on the Progress training grid opens that day's SESSION REPORT —
// the finished read with drills, notes, and target photos — not the edit screen
// (Michael, July 8 2026). A day with several sessions shows the picker sheet
// first; each row there opens a report too. The "Just show the day's count"
// checkbox keeps the quieter peek behaviour.

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

test.describe('Training grid day squares', () => {
  test('tapping a day opens that day\'s session report', async ({ page }) => {
    await seedDemo(page);
    await logSessionToday(page);
    await gotoTab(page, 'Progress');

    const square = todaySquare(page);
    await expect(square).toHaveCount(1);

    // One session today opens the report straight away; if the sample data also
    // logged something today, the day picker shows first — open the first row.
    // (The popup listener is registered BEFORE the click so the event can't be
    // missed either way.)
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
    // The report page, not the edit screen: report header + sections.
    await expect(popup.locator('.header h1')).toContainText('Session —');
    await expect(popup.locator('.sec-title').first()).toHaveText('Session');
    await expect(popup.locator('.sec-title', { hasText: 'Guns' })).toBeVisible();
    await popup.close();

    // And the app itself never navigated — still on Progress.
    await expect(page.getByRole('heading', { name: 'Progress' }).first()).toBeVisible();
  });

  test('"Just show the day\'s count" keeps the peek behaviour', async ({ page }) => {
    await seedDemo(page);
    await logSessionToday(page);
    await gotoTab(page, 'Progress');

    await page.getByText("Just show the day's count, don't open the report").click();
    await todaySquare(page).click();

    // No popup, no navigation — just the count line for today.
    await expect(page.locator('p.report-note[aria-live="polite"]')).toContainText(/session/);
    await expect(page.getByRole('heading', { name: 'Progress' }).first()).toBeVisible();
  });
});
