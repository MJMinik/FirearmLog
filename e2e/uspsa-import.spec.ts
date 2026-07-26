import { test, expect } from '@playwright/test';
import { seedDemo, gotoTab } from './helpers';

// End-to-end coverage for the USPSA classifier importer (src/ui/UspsaImport.tsx):
// paste/try-sample -> parse -> preview (which scores are new vs. already logged)
// -> "Import N new" writes one Classifier record per NEW score in one transaction.
// The parser is unit-tested in tests/uspsaClassifier.test.ts (parseUspsaClassifiers,
// classifierKey, SAMPLE_USPSA_CSV); these specs prove the SCREEN is wired up end to
// end — real navigation in, a real IndexedDB write out, and de-duping actually works.
//
// Note: danger-flows.spec.ts (M-13) already has a thin happy-path smoke test for
// this screen. These specs assert the exact codes/count that land (not just that
// SOME import happened) and add the malformed-input failure path, which had no
// coverage anywhere.

test.describe('USPSA classifier import', () => {
  test('happy path: sample export -> preview shows the right new/already-logged split -> import lands exactly those scores', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const classifiersCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Classifiers', exact: true }) });
    const classifierRows = classifiersCard.locator('.row-tap');
    await expect(classifierRows.first()).toBeVisible();
    const totalBefore = await classifierRows.count();

    // Reach the screen the way a shooter does: Compete -> Import… -> USPSA Classifiers.
    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import USPSA Classifiers' }).click();

    await expect(main.getByRole('heading', { name: 'Import USPSA Classifiers' })).toBeVisible();
    await main.getByRole('button', { name: 'Try the sample' }).click();
    await main.getByRole('button', { name: 'Read scores' }).click();

    // The sample holds 7 scores (tests/uspsaClassifier.test.ts). Confirm the
    // preview found all 7, then read the ACTUAL new/already-logged split off the
    // page rather than assuming none collide with the seeded demo data.
    const previewCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Preview' }) });
    await expect(previewCard.getByText('7 scores found')).toBeVisible();
    const previewRows = previewCard.locator('.row');
    await expect(previewRows).toHaveCount(7);
    const alreadySavedRows = previewRows.filter({ hasText: 'already saved' });
    const alreadySavedCount = await alreadySavedRows.count();
    const expectedNew = 7 - alreadySavedCount;

    // Guard against a vacuous pass: if the app ever mis-flagged every score as
    // already-saved, expectedNew would be 0 and every assertion below would hold
    // while nothing was actually imported. The sample codes are not in the demo
    // seed, so at least some must be genuinely new for this test to mean anything.
    expect(expectedNew).toBeGreaterThan(0);

    const importBtn = main.getByRole('button', { name: `Import ${expectedNew} new` });
    await expect(importBtn).toBeVisible();

    // The rows the preview flagged "already saved" are exactly the ones that will
    // be skipped -- capture their codes (and the genuinely-new ones) so we can
    // assert de-duping held after the import.
    const alreadyCodes = await alreadySavedRows.locator('.label').allTextContents();
    const newRows = previewRows.filter({ hasNotText: 'already saved' });
    const newCodes = await newRows.locator('.label').allTextContents();
    expect(newCodes.length).toBe(expectedNew);

    await importBtn.click();

    // Lands back on Compete -- nothing deep-linked, no dangling importer screen.
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();

    // The Classifiers list really grew by exactly the new count.
    await expect(classifierRows).toHaveCount(totalBefore + expectedNew);

    // Every score the preview called NEW is now visible in the log; a score the
    // preview said was already-saved doesn't cause a duplicate row.
    for (const label of newCodes) {
      const code = label.split(' — ')[0].trim();
      await expect(classifiersCard.getByText(code, { exact: false }).first()).toBeVisible();
    }
    expect(alreadyCodes.length).toBe(alreadySavedCount);
  });

  test('malformed input fails safely: a visible error, no preview, no scores written', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    const classifiersCard = main.locator('.card').filter({ has: page.getByRole('heading', { name: 'Classifiers', exact: true }) });
    const classifierRows = classifiersCard.locator('.row-tap');
    await expect(classifierRows.first()).toBeVisible();
    const totalBefore = await classifierRows.count();

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import USPSA Classifiers' }).click();
    await expect(main.getByRole('heading', { name: 'Import USPSA Classifiers' })).toBeVisible();

    await main.getByLabel('Classifier export').fill('hello\nworld');
    await main.getByRole('button', { name: 'Read scores' }).click();

    // A visible, plain-language error — not a silent failure or a crash.
    await expect(page.getByRole('alert')).toContainText(/USPSA/);

    // Still on step 1: no preview, no import button, nothing to commit.
    await expect(main.getByRole('button', { name: 'Read scores' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Preview' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /Import \d+ new/ })).toHaveCount(0);

    // Leaving the screen confirms nothing was written.
    await main.getByRole('button', { name: '‹ Cancel' }).click();
    await expect(main.getByRole('heading', { name: 'Compete' })).toBeVisible();
    await expect(classifierRows).toHaveCount(totalBefore);
  });

  test('empty input never even reaches the parser — Read scores stays disabled', async ({ page }) => {
    await seedDemo(page);
    await gotoTab(page, 'Compete');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Import…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Import' });
    await sheet.getByRole('button', { name: 'Import USPSA Classifiers' }).click();

    await expect(main.getByRole('button', { name: 'Read scores' })).toBeDisabled();
    await main.getByLabel('Classifier export').fill('   ');
    await expect(main.getByRole('button', { name: 'Read scores' })).toBeDisabled();
  });
});
