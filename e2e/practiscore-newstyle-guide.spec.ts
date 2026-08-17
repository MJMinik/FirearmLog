// E2E tests for the PractiScore new-style results guide (session 108, 7 Aug 2026).
// When a shooter pastes PractiScore's new-style results page and the parser refuses,
// looksLikeNewStyleResults fires and the screen shows targeted directions to the
// old-style page instead of the generic error.
//
// Both desktop and mobile projects run this spec (see playwright.config.ts).
import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';
import { TAKE_AIM_MINI_2026_08_03_NEWSTYLE } from '../tests/fixtures/practiscore-take-aim-mini-2026-08-03_newstyle.ts';
import { TAKE_AIM_MINI_2026_08_03_OLDSTYLE } from '../tests/fixtures/practiscore-take-aim-mini-2026-08-03_oldstyle.ts';

/** Navigate to the PractiScore import screen, ready for a paste. */
async function gotoPractiScoreImport(page: import('@playwright/test').Page) {
  await seedDemo(page);
  await gotoTab(page, 'Compete');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('dialog', { name: 'Import' })
    .getByRole('button', { name: 'Import from PractiScore' }).click();
  return main;
}

test.describe('PractiScore new-style guide', () => {

  test('new-style paste: guidance message appears and nothing is imported', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    // Count the Matches list BEFORE the paste, the same way the existing
    // practiscore-import spec proves "nothing was written".
    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    const matchRows = matchesCard.locator('.row-tap');
    await expect(matchRows.first()).toBeVisible();
    const totalBefore = await matchRows.count();

    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' })
      .getByRole('button', { name: 'Import from PractiScore' }).click();

    await main.getByRole('textbox', { name: 'Results text' }).fill(TAKE_AIM_MINI_2026_08_03_NEWSTYLE);
    await main.getByRole('button', { name: 'Read results' }).click();

    // The guidance message must be visible.
    await expect(main.getByText("new results page", { exact: false })).toBeVisible();
    await expect(main.getByText("Nothing was imported", { exact: false })).toBeVisible();

    // The numbered instructions must still be visible — step 1 now carries TWO
    // numbered lists (the Steel file steps and the USPSA copy steps, session 124),
    // so pin the USPSA one by its own first line; this confirms the screen did
    // not advance.
    await expect(main.locator('ol').filter({ hasText: 'Open your match on' })).toBeVisible();

    // The step-1 field must still be on screen (paste box, not the shooter picker).
    await expect(main.getByRole('textbox', { name: 'Results text' })).toBeVisible();

    // Leaving the screen: the Matches list count is unchanged — nothing was saved.
    await main.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await expect(matchRows).toHaveCount(totalBefore);
  });

  test('new-style paste: a retry with good input clears the guidance message', async ({ page }) => {
    const main = await gotoPractiScoreImport(page);

    await main.getByRole('textbox', { name: 'Results text' }).fill(TAKE_AIM_MINI_2026_08_03_NEWSTYLE);
    await main.getByRole('button', { name: 'Read results' }).click();

    // Guidance is shown.
    await expect(main.getByText("new results page", { exact: false })).toBeVisible();

    // There is no "Start over" control at step 1 — the shooter is still on the
    // paste box. The natural recovery is to clear the box and retry; verify the
    // message clears on the next read.
    await main.getByRole('textbox', { name: 'Results text' }).fill('');
    // Try with valid text to confirm the error is gone.
    await main.getByRole('button', { name: 'Try the sample' }).click();
    await main.getByRole('button', { name: 'Read results' }).click();
    await expect(main.getByText("new results page", { exact: false })).toHaveCount(0);
    // The shooter list must now be visible (sample parsed successfully).
    await expect(main.getByText('shooters')).toBeVisible();
  });

  test('old-style paste: import flow works end to end', async ({ page }) => {
    const main = await gotoPractiScoreImport(page);

    await main.getByRole('textbox', { name: 'Results text' }).fill(TAKE_AIM_MINI_2026_08_03_OLDSTYLE);
    await main.getByRole('button', { name: 'Read results' }).click();

    // Parser succeeds: 21 shooters in the Take Aim Mini 2026-08-03 file.
    await expect(main.getByText('21 shooters')).toBeVisible();

    // No guidance message.
    await expect(main.getByText("new results page", { exact: false })).toHaveCount(0);

    // Pick a shooter and complete the import.
    await main.getByRole('button', { name: 'Minik, Michael' }).click();

    // Fill required fields and save.
    const dateField = main.getByLabel('Date');
    if (await dateField.inputValue() === '') {
      await dateField.fill('2026-08-03');
    }
    await main.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await main.getByRole('button', { name: 'Save match' }).click();

    // After save we land on the match detail heading.
    await expect(main.getByRole('heading', { level: 1, name: /Take Aim|PractiScore Match/i })).toBeVisible({ timeout: 15_000 });
  });

  test('a parseable paste that also carries new-style page furniture still imports (detector only runs after a refusal)', async ({ page }) => {
    const main = await gotoPractiScoreImport(page);

    // An old-style table copied WITH surrounding new-style browser chrome: the
    // parser finds the header row and succeeds, so the detector must never run —
    // even though this text alone would fire two of its signal families.
    const withChrome = 'Horizontal Scroll\nOld style results\n1-Matt Olinchak\n'
      + TAKE_AIM_MINI_2026_08_03_OLDSTYLE;
    await main.getByRole('textbox', { name: 'Results text' }).fill(withChrome);
    await main.getByRole('button', { name: 'Read results' }).click();

    // Parser succeeded: shooter list appears, no guidance message anywhere.
    await expect(main.getByText('21 shooters')).toBeVisible();
    await expect(main.getByText('new results page', { exact: false })).toHaveCount(0);
  });

});
