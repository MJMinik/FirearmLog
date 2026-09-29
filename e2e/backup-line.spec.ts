import { test, expect, type Page } from '@playwright/test';
import { seedDemo, gotoSection, gotoTab } from './helpers';
import { storedSettings } from './licenceHelpers';

// The Sync & Backup card after Load from File
// (BACKUP_LINE_AFTER_RESTORE_SPEC_2026-09-18.md §3 and §5): save, load the same
// file, save again, and Home's backup nudge counting from the right date.

async function saveToFile(page: Page): Promise<string> {
  await gotoSection(page, 'Sync & Backup');
  await page.getByRole('main').getByRole('button', { name: 'Save to File' }).click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save the File Now', exact: true }).click(),
  ]);
  const path = (await dl.path())!;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('backup-last-line')).toBeVisible();
  return path;
}

async function loadFile(page: Page, path: string): Promise<void> {
  await gotoSection(page, 'Sync & Backup');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('main').getByRole('button', { name: 'Load from File' }).click(),
  ]);
  await chooser.setFiles(path);
  await expect(page.getByRole('heading', { name: "Replace this device's data?" })).toBeVisible();
  await page.getByRole('button', { name: /^Load (the Older File Anyway|from File)$/ }).last().click();
  await expect(page.getByRole('main')).toContainText('Done — this device now matches the file.', { timeout: 30_000 });
}

/** Local "8 Sep"-style date, matching the card's own. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}

test.describe('Sync & Backup: the line after a load', () => {
  test('save, load the same file, save again: the card tells the truth at each step', async ({ page }) => {
    test.slow();
    await seedDemo(page);

    // 1. Save. Today's line, unchanged.
    const file = await saveToFile(page);
    const savedAt = (await storedSettings(page))!.lastBackupAt as number;
    await expect(page.getByTestId('backup-last-line')).toContainText(`Last backup:`);
    await expect(page.getByTestId('backup-last-line')).toContainText(shortDate(savedAt));
    await expect(page.getByTestId('backup-loaded-line')).toHaveCount(0);

    // 2. Load that same file. The card says it was loaded, from a backup made
    //    on the file's own date, and no longer claims a "Last backup".
    await loadFile(page, file);
    const loaded = await storedSettings(page);
    expect(loaded?.lastRestoreAt).toBeGreaterThan(0);
    // lastBackupAt is the FILE's own creation time (a moment before or at the save's stamp), not the one-save-old stamp.
    expect(loaded?.lastBackupAt).toBe(loaded?.lastRestoreFileMadeAt);
    expect(loaded?.lastBackupAt as number).toBeGreaterThan(0);
    const line = page.getByTestId('backup-loaded-line');
    await expect(line).toContainText(`Loaded ${shortDate(loaded!.lastRestoreAt as number)} from a backup made ${shortDate(loaded!.lastRestoreFileMadeAt as number)}.`);
    await expect(line).toContainText('Save to File from this device to make a newer one.');
    await expect(page.getByTestId('backup-last-line')).toHaveCount(0);

    // 3. Save again: the save line returns, the load line stays beneath it, shorter.
    await saveToFile(page);
    await expect(page.getByTestId('backup-last-line')).toContainText('Last backup:');
    const both = page.getByTestId('backup-loaded-line');
    await expect(both).toContainText('Loaded ');
    await expect(both).not.toContainText('Save to File from this device');
    const after = await storedSettings(page);
    expect(after?.lastRestoreAt).toBe(loaded?.lastRestoreAt);
    expect(after?.lastRestoreFileMadeAt).toBe(loaded?.lastRestoreFileMadeAt);
    expect(after?.lastBackupAt as number).toBeGreaterThanOrEqual(loaded?.lastBackupAt as number);
  });

  test('Home\'s backup reminder counts from the loaded file: none right after a load, then it rises with edits', async ({ page }) => {
    test.slow();
    await seedDemo(page);
    const file = await saveToFile(page);
    await loadFile(page, file);

    await gotoTab(page, 'Home');
    await expect(page.getByText('Live-fire rounds')).toBeVisible();
    await expect(page.getByText(/changes since your last backup/)).toHaveCount(0);

    // Ten records change after the load: the reminder appears and counts them.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('firearmlog');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const rows = await new Promise<{ id: string }[]>((resolve, reject) => {
        const r = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        for (const row of rows.slice(0, 10)) tx.objectStore('sessions').put({ ...row, updatedAt: Date.now() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      });
    });
    await page.reload();
    await expect(page.getByText('10 changes since your last backup')).toBeVisible();
  });
});
