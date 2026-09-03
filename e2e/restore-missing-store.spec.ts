// D-10 (db-trio spec, session 140): loading a backup that predates a store
// this device has records in must say so on the confirm sheet, not silently
// erase the store. Drives the REAL Load-from-File flow in a real browser —
// the same setInputFiles pattern danger-flows.spec.ts's round-trip test uses —
// against a .flog built with the app's own writer (buildFlog) but with the
// 'reminders' section left out entirely, the way a file saved before that
// store existed (mid-July 2026) would look on disk today.
import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDemo, gotoSection } from './helpers';
import { buildFlog } from '../src/lib/flog.ts';
import { STORE_NAMES } from '../src/lib/db.ts';

async function addDateReminder(page: Page, title: string): Promise<void> {
  await gotoSection(page, 'Reminders');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: /Add reminder|Add your own/ }).first().click();
  await expect(main.getByRole('heading', { name: 'New Reminder' })).toBeVisible();
  await main.getByLabel('Title').fill(title);
  const d = new Date();
  d.setDate(d.getDate() + 20);
  const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await main.getByLabel('Due date').fill(due);
  await main.getByRole('button', { name: 'Save reminder' }).click();
  await expect(main.getByRole('heading', { name: 'Reminders' }).first()).toBeVisible();
}

/**
 * A minimal, valid .flog with every real record store present but EMPTY
 * except the one this test omits — built through buildFlog itself (the app's
 * own writer, spec §3.3), not a hand-rolled zip. Every other store is an empty
 * array rather than simply absent, so this file triggers exactly one D-10
 * warning (for the omitted store) instead of one per store this device
 * happens to hold records in — the point of this test is the ONE sentence,
 * not the count of them.
 */
async function buildFlogMissing(storeName: string): Promise<Uint8Array> {
  const stores: Record<string, unknown[]> = {};
  for (const name of STORE_NAMES) {
    if (name === 'media' || name === storeName) continue;
    stores[name] = [];
  }
  return buildFlog({ exportedAt: 1, lastModified: 1, stores, media: [] });
}

test('loading a backup with no reminders section warns, and Cancel changes nothing', async ({ page }) => {
  await seedDemo(page);
  await addDateReminder(page, 'Spring Check');

  const dir = await mkdtemp(join(tmpdir(), 'flog-missing-store-'));
  const flogPath = join(dir, 'old-backup.flog');
  try {
    await writeFile(flogPath, await buildFlogMissing('reminders'));

    await gotoSection(page, 'Sync & Backup');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Load from File' }).click(),
    ]);
    await chooser.setFiles(flogPath);

    await expect(page.getByRole('heading', { name: "Replace this device's data?" })).toBeVisible();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('has no reminders section');
    // The file is deliberately OLDER than the device (lastModified: 1), so the
    // button keeps the stronger 'Older' label; a same-age file missing a store
    // would read 'Load the File Anyway'. Either way it is no longer plain
    // 'Load from File'.
    const confirmBtn = sheet.getByRole('button', { name: 'Load the Older File Anyway' });
    await expect(confirmBtn).toBeVisible();

    // Cancel — the honest-restore promise this item does not touch: nothing is
    // written until Load is actually confirmed (ConfirmSheet's own Cancel).
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: "Replace this device's data?" })).toHaveCount(0);

    await gotoSection(page, 'Reminders');
    await expect(page.getByRole('main').getByText('Spring Check')).toBeVisible();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
