import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoTab, gotoSection } from './helpers';

// M-13 (code review 2026-07-06): the three danger flows that had no end-to-end
// coverage — the two importers and the full backup round-trip. These drive the
// REAL parse → preview → commit paths in a real browser, so a regression in the
// import boundary or the .flog pipeline fails the PR before it can touch data.

/** Open Compete's "Import…" chooser and pick one of the two importers. */
async function openImporter(page: Page, which: 'Import from PractiScore' | 'Import USPSA Classifiers') {
  await gotoTab(page, 'Compete');
  await page.getByRole('button', { name: 'Import…' }).click();
  await page.getByRole('button', { name: which }).click();
}

test.describe('Danger flows (M-13)', () => {
  test('PractiScore sample imports as a match', async ({ page }) => {
    await seedDemo(page);
    await openImporter(page, 'Import from PractiScore');

    await page.getByRole('button', { name: 'Try the sample' }).click();
    await page.getByRole('button', { name: 'Read results' }).click();

    // Pick the first shooter row, choose the gun you shot, then save.
    await page.getByRole('main').locator('.row-tap').first().click();
    await page.getByLabel('Which gun did you shoot?').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Save match' }).click();

    // Saving opens the imported match's own screen — the strongest proof the
    // parse → preview → commit path landed a real, viewable match record.
    await expect(page.getByRole('heading', { name: /Spring Classic/ })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(/Carry Optics/);
  });

  test('USPSA classifier sample imports new scores', async ({ page }) => {
    await seedDemo(page);
    await openImporter(page, 'Import USPSA Classifiers');

    await page.getByRole('button', { name: 'Try the sample' }).click();
    await page.getByRole('button', { name: 'Read scores' }).click();

    // The preview offers "Import N new" (or says everything is already in the
    // log — with demo data the sample should hold at least one new row).
    const importBtn = page.getByRole('button', { name: /Import \d+ new/ });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    await expect(page.getByRole('heading', { name: 'Compete' }).first()).toBeVisible();
  });

  test('backup round-trip: Save to File → erase → Load from File restores the log', async ({ page }) => {
    test.slow(); // downloads + a full restore; give CI room
    await seedDemo(page);

    // 1. Save to File — capture the real .flog download.
    await gotoSection(page, 'Sync & Backup');
    await page.getByRole('button', { name: 'Save to File' }).click();
    await expect(page.getByRole('heading', { name: 'Your Data File Is Ready' })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Save the File Now' }).click(),
    ]);
    const flogPath = await download.path();
    expect(flogPath).toBeTruthy();
    // Close the save sheet (the X / close affordance is the sheet's onClose).
    await page.keyboard.press('Escape');

    // 2. Erase everything (the hard-gated wipe) → back to first-run.
    await gotoSection(page, 'Tour & Setup');
    await page.getByRole('button', { name: 'Clear all data' }).click();
    await page.getByPlaceholder('erase').fill('erase');
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your log' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Skip for now/ }).click();

    // 3. Load from File with the very file we just saved.
    await gotoSection(page, 'Sync & Backup');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Load from File' }).click(),
    ]);
    await chooser.setFiles(flogPath!);

    // The plain-language confirm, then the restore.
    await expect(page.getByRole('heading', { name: "Replace this device's data?" })).toBeVisible();
    await page.getByRole('button', { name: 'Load from File', exact: true }).last().click();
    await expect(page.getByRole('main')).toContainText('Done — this device now matches the file.', { timeout: 30_000 });

    // 4. The log is back: Home shows live stats again.
    await gotoTab(page, 'Home');
    await expect(page.getByText('Live-fire rounds')).toBeVisible();
    // (D-5: removed a self-swallowing `.not.toBeVisible().catch(() => {})` that
    // could never fail. The 'Live-fire rounds' assertion above is the real proof
    // the restore repopulated the log — the empty first-run Home shows the "Add
    // your first gun" CTA instead of live stats.)
  });
});
