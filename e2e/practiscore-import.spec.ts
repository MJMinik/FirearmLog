import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// End-to-end coverage for the PractiScore importer (src/ui/PractiScoreImport.tsx):
// paste/try-sample -> parse -> pick which shooter is you -> preview -> Save match.
// The parser itself is unit-tested in tests/practiscore.test.ts (parsePractiScore,
// countInDivision, SAMPLE_PRACTISCORE_CSV); these specs prove the SCREEN is wired
// up end to end in a real browser — real navigation in, a real IndexedDB write out.
//
// Note: danger-flows.spec.ts (M-13) already has a thin happy-path smoke test for
// this screen (picks whichever shooter is first, checks the resulting heading).
// These specs pick a specific competitor and assert the per-stage/per-field data
// that actually landed, plus the malformed-input failure path, which had no
// coverage anywhere.

test.describe('PractiScore import', () => {
  test('happy path: sample export -> pick a specific shooter -> save -> the match record lands with the right data', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    const matchRows = matchesCard.locator('.row-tap');
    await expect(matchRows.first()).toBeVisible();
    const totalBefore = await matchRows.count();

    // Reach the screen the way a shooter does: Compete -> Import… -> From PractiScore.
    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();

    await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();
    await main.getByRole('button', { name: 'Try the sample' }).click();
    await main.getByRole('button', { name: 'Read results' }).click();

    // Step 2: pick which shooter is you. The sample has 5 competitors — pick
    // Chris Calder specifically (not the #1 finisher) so the assertions below
    // prove the RIGHT row's data flowed through, not just any row's.
    await expect(main.getByRole('heading', { name: 'Spring Classic USPSA Level 1', level: 2 })).toBeVisible();
    await main.getByRole('button', { name: 'Chris Calder' }).click();

    // Step 3: preview shows Chris Calder's real numbers from the sample CSV.
    // ("Division" is filtered by exact label text because "Division place" is
    // a separate row whose text would otherwise also match a loose substring.)
    const resultCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Your result' }) });
    const resultDivisionRow = resultCard.locator('.row').filter({ has: page.getByText('Division', { exact: true }) });
    await expect(resultCard.locator('.row', { hasText: 'Shooter' })).toContainText('Chris Calder');
    await expect(resultDivisionRow).toContainText('Carry Optics');
    await expect(resultCard.locator('.row', { hasText: 'Power factor' })).toContainText('Minor');
    await expect(resultCard.locator('.row', { hasText: 'Overall place' })).toContainText('3 of 5');
    await expect(resultCard.locator('.row', { hasText: 'Division place' })).toContainText('2 of 4');
    await expect(resultCard.locator('.row', { hasText: 'Match %' })).toContainText('84.98%');
    await expect(resultCard.locator('.row', { hasText: 'Stage 3' })).toContainText('79.50%');

    const gunSelect = main.getByLabel('Which gun did you shoot?');
    await gunSelect.selectOption({ index: 1 });
    const gunName = (await gunSelect.locator('option:checked').innerText()).trim();

    await main.getByRole('button', { name: 'Save match' }).click();

    // Lands on the new match's own detail screen — the strongest proof the
    // parse -> preview -> commit path landed a real, viewable record, not just
    // that the Save button was clickable.
    await expect(main.getByRole('heading', { name: 'Spring Classic USPSA Level 1', level: 1 })).toBeVisible();
    const matchCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Match', exact: true }) });
    const matchDivisionRow = matchCard.locator('.row').filter({ has: page.getByText('Division', { exact: true }) });
    await expect(matchDivisionRow).toContainText('Carry Optics');
    await expect(matchDivisionRow).toContainText('Minor');
    await expect(matchCard.locator('.row', { hasText: 'Gun' })).toContainText(gunName);
    await expect(matchCard.locator('.row', { hasText: 'Match percent' })).toContainText('84.98%');
    await expect(matchCard.locator('.row', { hasText: 'Division finish' })).toContainText('2 of 4');
    await expect(matchCard.locator('.row', { hasText: 'Overall finish' })).toContainText('3 of 5');

    const stageCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Stage breakdown' }) });
    await expect(stageCard.locator('.row', { hasText: 'Stage 3' })).toContainText('79.5%');

    // Back on Compete, the Matches list really grew by one and shows the new match.
    await main.getByRole('button', { name: '‹ Back' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await expect(matchRows).toHaveCount(totalBefore + 1);
    await expect(matchesCard.getByText('Spring Classic USPSA Level 1')).toBeVisible();
  });

  test('malformed input fails safely: a visible error, no shooter picker, no record created', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const matchesCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Matches', exact: true }) });
    const matchRows = matchesCard.locator('.row-tap');
    await expect(matchRows.first()).toBeVisible();
    const totalBefore = await matchRows.count();

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();
    await expect(main.getByRole('heading', { name: 'Import from PractiScore' })).toBeVisible();

    await main.getByLabel('Results text').fill('just some random text with no results table in it at all');
    await main.getByRole('button', { name: 'Read results' }).click();

    // A visible, plain-language error — not a silent failure or a crash.
    await expect(page.getByRole('alert')).toContainText(/PractiScore/);

    // Still on step 1: no shooter picker, no preview, no way to save.
    await expect(main.getByRole('button', { name: 'Read results' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Save match' })).toHaveCount(0);
    await expect(main.getByText('Which one is you?')).toHaveCount(0);

    // Leaving the screen confirms nothing was written.
    await main.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await expect(matchRows).toHaveCount(totalBefore);
  });

  test('empty input never even reaches the parser — Read results stays disabled', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import from PractiScore' }).click();

    await expect(main.getByRole('button', { name: 'Read results' })).toBeDisabled();
    await main.getByLabel('Results text').fill('   ');
    await expect(main.getByRole('button', { name: 'Read results' })).toBeDisabled();
  });
});
