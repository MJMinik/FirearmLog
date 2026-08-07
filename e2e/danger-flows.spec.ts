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

  // T-4: the stores whose survival the round-trip must PROVE, row by row —
  // the same read-the-real-database pattern export-csv.spec.ts uses. Covers
  // the core stores plus the three a dropped restore path would lose
  // silently: classifiers, media, skillSets.
  const COUNTED_STORES = [
    'firearms', 'sessions', 'drills', 'ammunition', 'purchases', 'maintenance',
    'magazines', 'matches', 'classifiers', 'media', 'skillSets',
  ];

  /** Per-store row counts, read in-page from the live IndexedDB. */
  async function storeCounts(page: Page): Promise<Record<string, number>> {
    return page.evaluate(async (stores) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('firearmlog');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const count = (store: string) => new Promise<number>((resolve) => {
        const r = db.transaction(store, 'readonly').objectStore(store).count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(-1);
      });
      const out: Record<string, number> = {};
      for (const st of stores) out[st] = await count(st);
      db.close();
      return out;
    }, COUNTED_STORES);
  }

  test('backup round-trip: Save to File → erase → Load from File restores the log', async ({ page }) => {
    test.slow(); // downloads + a full restore; give CI room
    await seedDemo(page);

    // The demo dataset holds no timed-skill sets, so plant one — written
    // through the page's own IndexedDB — or a restore path that dropped the
    // skillSets store entirely could never be caught below.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('firearmlog');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('skillSets', 'readwrite');
        tx.objectStore('skillSets').put({
          id: 'sk-e2e-roundtrip', createdAt: Date.now(), updatedAt: Date.now(),
          sessionId: 'se-e2e', date: '2026-08-01', skill: 'draw', firearmId: 'fa-e2e',
          dryFire: false, count: 10, bestSec: 1.2, typicalSec: null, parSec: null,
          cold: true, repTimesSec: null, notes: 'round-trip sentinel',
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    });

    // Per-store counts before the backup — what the restore must give back.
    const before = await storeCounts(page);
    for (const st of ['firearms', 'sessions', 'matches', 'classifiers', 'media', 'skillSets']) {
      expect(before[st], `store '${st}' has rows to round-trip`).toBeGreaterThan(0);
    }

    // 1. Save to File — capture the real .flog download.
    await gotoSection(page, 'Sync & Backup');
    await page.getByRole('button', { name: 'Save to File' }).click();
    await expect(page.getByRole('heading', { name: 'Your Data File Is Ready' })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save the File Now' }).click(),
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
    // could never fail.)

    // 5. T-4: the REAL proof — every counted store holds exactly the rows it
    // held before the wipe. Home rendering live stats can't tell a full
    // restore from one that quietly dropped classifiers, media, or skillSets;
    // these counts can.
    const after = await storeCounts(page);
    expect(after, 'per-store row counts after restore match the pre-wipe log').toEqual(before);
  });
});
