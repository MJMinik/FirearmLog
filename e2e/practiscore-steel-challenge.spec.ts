// E2E for the Steel Challenge refusal (session 117, 9 Aug 2026).
//
// Michael shot a Steel Challenge match that morning, copied the Combined results
// page exactly as the on-screen instructions say, and got the generic refusal
// telling him to find a heading row "like Place, Name, Div". A Steel Challenge
// page has no placing column at all — the place is fused into the name cell — so
// he had done everything right and there was nothing left to try.
//
// The screen now says which kind of page it is and that reading it is not built
// yet. Note what this does NOT claim: the import still does not work. The fix is
// that the message stops asking for something impossible.
//
// Both desktop and mobile projects run this spec (see playwright.config.ts).
import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';
import { STEEL_CHALLENGE_2026_08_09_COMBINED } from '../tests/fixtures/practiscore-steel-challenge-2026-08-09.ts';

test.describe('Steel Challenge results page', () => {

  test('says what the page is, and writes nothing', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    // Count the Matches list BEFORE the paste — the same way the sibling specs
    // prove "nothing was written".
    const matchesCard = main.locator('.card')
      .filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    const matchRows = matchesCard.locator('.row-tap');
    await expect(matchRows.first()).toBeVisible();
    const totalBefore = await matchRows.count();

    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' })
      .getByRole('button', { name: 'Import from PractiScore' }).click();

    await main.getByRole('textbox', { name: 'Results text' })
      .fill(STEEL_CHALLENGE_2026_08_09_COMBINED);
    await main.getByRole('button', { name: 'Read results' }).click();

    // It names the page, and says plainly that nothing happened.
    await expect(main.getByText('Steel Challenge results page', { exact: false })).toBeVisible();
    await expect(main.getByText('nothing was imported', { exact: false })).toBeVisible();

    // And it does NOT send him after a placing column his page cannot have.
    // This is the whole point of the change, so it is asserted rather than
    // assumed: the old wording is what cost him the morning.
    await expect(main.getByRole('alert')).not.toContainText('Place, Name, Div');

    // Still on step 1 — no shooter picker, no way to save.
    await expect(main.getByRole('textbox', { name: 'Results text' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Save match' })).toHaveCount(0);

    // Leaving confirms nothing was written.
    await main.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await expect(matchRows).toHaveCount(totalBefore);
  });

  test('a good USPSA paste still imports — the Steel branch steals nothing', async ({ page }) => {
    // The false-positive guard, driven through the real screen rather than the
    // detector in isolation: the working path has to stay working.
    const { TAKE_AIM_MINI_2026_08_03_OLDSTYLE } =
      await import('../tests/fixtures/practiscore-take-aim-mini-2026-08-03_oldstyle.ts');
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Import…' }).click();
    await page.getByRole('dialog', { name: 'Import' })
      .getByRole('button', { name: 'Import from PractiScore' }).click();
    await main.getByRole('textbox', { name: 'Results text' })
      .fill(TAKE_AIM_MINI_2026_08_03_OLDSTYLE);
    await main.getByRole('button', { name: 'Read results' }).click();

    await expect(main.getByText('Steel Challenge results page', { exact: false })).toHaveCount(0);
    await expect(main.getByText('Which one is you?')).toBeVisible();
  });
});
