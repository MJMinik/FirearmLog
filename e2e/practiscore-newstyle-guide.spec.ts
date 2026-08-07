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
    const main = await gotoPractiScoreImport(page);

    await main.getByRole('textbox', { name: 'Results text' }).fill(TAKE_AIM_MINI_2026_08_03_NEWSTYLE);
    await main.getByRole('button', { name: 'Read results' }).click();

    // The guidance message must be visible.
    await expect(main.getByText("new results page", { exact: false })).toBeVisible();
    await expect(main.getByText("Nothing was imported", { exact: false })).toBeVisible();

    // The numbered instructions must still be visible — the ol list is always
    // present when the paste step is shown; this confirms the screen did not advance.
    await expect(main.locator('ol')).toBeVisible();

    // The step-1 field must still be on screen (paste box, not the shooter picker).
    await expect(main.getByRole('textbox', { name: 'Results text' })).toBeVisible();
  });

  test('new-style paste: Start over clears the guidance message', async ({ page }) => {
    const main = await gotoPractiScoreImport(page);

    await main.getByRole('textbox', { name: 'Results text' }).fill(TAKE_AIM_MINI_2026_08_03_NEWSTYLE);
    await main.getByRole('button', { name: 'Read results' }).click();

    // Guidance is shown.
    await expect(main.getByText("new results page", { exact: false })).toBeVisible();

    // The "Start over" / cancel path: clear the paste box (the screen has no
    // "Start over" at this stage — the user is still on step 1). Clearing the
    // textarea and retrying is the natural flow; verify the message clears.
    // The screen stays on step 1 (no parsed state), so we can simply empty the
    // box — the problem banner is reset on the next readResults call.
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

});
