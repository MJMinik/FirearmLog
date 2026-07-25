import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, isDesktop } from './helpers';

// T3-1: timed-skill sets — an "Add a timed-skills set" progressive-disclosure
// reveal inside Log Session, an add-set sheet, the day's sets on the Session
// Report, and a per-skill trend card on Progress (cold sets marked by shape).

/** Start a new session with the first demo gun and 50 rounds, landing on the
 *  Log Session form with "Guns & Rounds" filled in. */
async function startSessionWithGun(page: Page, rounds = '50'): Promise<void> {
  await gotoTab(page, 'Log');
  await page.getByRole('button', { name: '+ Log Session' }).click();
  const gunsCard = page.getByTestId('session-guns-card');
  await gunsCard.locator('button.gun-toggle').first().click();
  await gunsCard.getByRole('spinbutton').first().fill(rounds);
}

/**
 * Open "Add a timed-skills set", tap "+ Add Set", fill in one Draw set, and save it.
 * The sheet is scoped by its dialog role/name ("Add Set") — its own submit
 * button shares the substring "Add Set" with the trigger button, so scoping
 * to the dialog (rather than a name match) keeps the two unambiguous.
 */
async function addDrawSet(page: Page, opts: { best: string; count?: string; cold?: boolean }): Promise<void> {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Add a timed-skills set' }).click();
  await main.getByRole('button', { name: '+ Add Set' }).click();

  const sheet = page.getByRole('dialog', { name: 'Add Set' });
  await expect(sheet).toBeVisible();
  if (opts.count) {
    await sheet.getByLabel('Reps in this set', { exact: true }).fill(opts.count);
  }
  await sheet.getByLabel('Best (sec)').fill(opts.best);
  if (opts.cold) {
    await sheet.getByRole('button', { name: /Cold/ }).click();
  }
  await sheet.getByRole('button', { name: 'Add Set', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

test.describe('Timed skills — Log Session', () => {
  test('adding a set: the thumb-first stepper and add-set sheet work on phone', async ({ page }) => {
    test.skip(isDesktop(page), 'phone-focused: verifies the thumb-first stepper at phone width');
    await seedDemo(page);
    await startSessionWithGun(page);

    const main = page.getByRole('main');
    // Collapsed by default — no set fields visible until the reveal is tapped.
    await expect(main.getByRole('button', { name: '+ Add Set' })).toHaveCount(0);
    await main.getByRole('button', { name: 'Add a timed-skills set' }).click();
    await main.getByRole('button', { name: '+ Add Set' }).click();

    const sheet = page.getByRole('dialog', { name: 'Add Set' });
    await expect(sheet).toBeVisible();
    // Default skill is Draw; the reps stepper's + button is a real 44pt-ish
    // thumb target — step it up three times rather than typing.
    const increase = sheet.getByRole('button', { name: 'Increase Reps in this set' });
    await increase.click();
    await increase.click();
    await increase.click();
    await expect(sheet.getByLabel('Reps in this set', { exact: true })).toHaveValue('3');

    await sheet.getByLabel('Best (sec)').fill('1.42');
    await sheet.getByLabel('Typical (sec)').fill('1.55');
    await sheet.getByRole('button', { name: /Cold/ }).click();
    await sheet.getByRole('button', { name: 'Add Set', exact: true }).click();
    await expect(sheet).toHaveCount(0);

    // The set now shows as a summary row inside the (still open) reveal.
    const setRow = main.locator('.row-tap').filter({ hasText: 'Draw' });
    await expect(setRow).toBeVisible();
    await expect(setRow.locator('.row-sub')).toHaveText(/3 reps.*best 1\.42s/);
    await expect(setRow).toContainText('Cold');

    // Save the session; it lands back on the Log list without error.
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();
  });

  // L2 (audit): "+ Add Set" is no longer disabled with no gun picked — a
  // disabled attribute made the button's own guard branch unreachable. Now it
  // is always tappable: with no gun, tapping it opens Guns & Rounds instead of
  // the Add Set sheet.
  test('a set with no gun picked yet: "+ Add Set" opens Guns & Rounds instead of the sheet', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Log');
    await page.getByRole('button', { name: '+ Log Session' }).click();
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Add a timed-skills set' }).click();
    await expect(main.getByText('Choose a gun in Guns & Rounds first', { exact: false })).toBeVisible();
    await expect(main.getByRole('button', { name: '+ Add Set' })).toBeEnabled();

    // Collapse Guns & Rounds first so the guard's "open it" effect is visible.
    const disclosure = page.getByTestId('session-guns-disclosure');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await main.getByRole('button', { name: '+ Add Set' }).click();
    await expect(page.getByRole('dialog', { name: 'Add Set' })).toHaveCount(0);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  });

  test('a saved set appears on the Session Report', async ({ page }) => {
    await seedDemo(page);
    await startSessionWithGun(page, '30');
    await addDrawSet(page, { best: '1.38', count: '5' });

    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    // Reopen the just-saved session and open its Session Report.
    await page.getByRole('main').locator('.row-tap').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Session' })).toBeVisible();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: 'Session Report' }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('.sec-title', { hasText: 'Timed Skills' })).toBeVisible();
    const skillsSec = popup.locator('.sec', { has: popup.locator('.sec-title', { hasText: 'Timed Skills' }) });
    await expect(skillsSec).toContainText('Draw');
    await expect(skillsSec).toContainText('1.38s');
    await expect(skillsSec).toContainText('5');
    await popup.close();
  });

  test('editing a saved set: reopening it pre-fills the sheet, and Remove set deletes it', async ({ page }) => {
    await seedDemo(page);
    await startSessionWithGun(page, '30');
    await addDrawSet(page, { best: '1.60', count: '4' });

    const main = page.getByRole('main');
    // Tap the summary row to reopen it for editing.
    await main.locator('.row-tap').filter({ hasText: 'Draw' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit Set' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Best (sec)')).toHaveValue('1.60');
    await expect(sheet.getByLabel('Reps in this set', { exact: true })).toHaveValue('4');

    await sheet.getByRole('button', { name: 'Remove set' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(main.locator('.row-tap').filter({ hasText: 'Draw' })).toHaveCount(0);
    await expect(main.getByText('Pick a gun above first.')).toHaveCount(0);
  });
});

test.describe('Timed skills — Progress', () => {
  test('the Timed Skills card renders a trend, a PR, and marks a cold set by shape', async ({ page }) => {
    await seedDemo(page);

    // Log two Draw sets on two different sessions — a trend needs 2+ points,
    // and the second is logged cold so the chart's shape-marking is exercised.
    await startSessionWithGun(page, '20');
    await addDrawSet(page, { best: '1.80', count: '5' });
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    await startSessionWithGun(page, '20');
    await addDrawSet(page, { best: '1.42', count: '5', cold: true });
    await page.locator('.navbar-action').click();
    await expect(page.getByRole('heading', { name: 'Log' }).first()).toBeVisible();

    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    const card = main.locator('.card', { has: page.getByRole('heading', { name: 'Timed Skills' }) });
    await expect(card).toBeVisible();

    // The Draw chip is offered (data exists); PR shows the faster of the two.
    await expect(card.getByRole('button', { name: 'Draw', exact: true })).toBeVisible();
    await expect(card).toContainText('Best Draw');
    await expect(card).toContainText('1.42s');

    // A trend line rendered (not the "log at least two sets" fallback).
    await expect(card).not.toContainText('Log at least two sets');
    const svg = card.locator('svg[role="img"]');
    await expect(svg).toBeVisible();
    // The cold set is marked by a rotated <rect> (a diamond), never by color
    // alone — at least one such shape must be present among the plotted marks.
    const diamonds = svg.locator('rect[transform*="rotate(45"]');
    await expect(diamonds).toHaveCount(1);

    // The discoverability hint is present before any dot is tapped.
    await expect(card).toContainText('Tap a dot (or diamond)');
    await svg.locator('rect.chart-hit').first().click();
    await expect(card).not.toContainText('Tap a dot (or diamond)');
  });

  test('no Timed Skills card when no sets have been logged', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Progress');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Timed Skills' })).toHaveCount(0);
  });
});
