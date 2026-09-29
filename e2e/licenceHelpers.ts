import { type Page, expect } from '@playwright/test';
import { gotoTab } from './helpers';

// Shared by e2e/license-gate.spec.ts and e2e/backup-line.spec.ts.

/** Write `count` live-fire sessions of the shooter's OWN (ids in the form the
 *  app itself makes, never the sample's se-NNN form) straight into IndexedDB,
 *  on top of whatever is loaded, then reload so every screen re-reads. Needs a
 *  gun to exist (the demo has several). `over` lets a call make plans or dry
 *  fire instead. */
export async function seedOwnSessions(
  page: Page,
  count: number,
  over: { planned?: boolean; type?: string; location?: string; idTag?: string } = {},
): Promise<void> {
  await page.evaluate(async ({ count, over }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const gunId = await new Promise<string>((resolve, reject) => {
      const r = db.transaction('firearms', 'readonly').objectStore('firearms').getAllKeys();
      r.onsuccess = () => resolve(String(r.result[0]));
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      const os = tx.objectStore('sessions');
      for (let i = 0; i < count; i++) {
        const now = Date.now();
        os.put({
          id: `se-mk${over.idTag ?? 'own'}-${i}`, createdAt: now, updatedAt: now,
          date: '2026-08-15', type: over.type ?? 'practice',
          guns: [{ firearmId: gunId, rounds: 50 }],
          location: over.location ?? `E2E Own Range ${i}`, distances: '', notes: '',
          ammoUsage: [], drills: [], targetMediaIds: [], malfunctions: [],
          selfRating: null, rangeFee: null, planned: over.planned === true, checklist: null,
        });
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }, { count, over });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'FirearmLog', exact: true })).toBeVisible({ timeout: 20_000 });
}

/** The stored settings record, read straight out of IndexedDB. */
export async function storedSettings(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('firearmlog');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const r = db.transaction('meta', 'readonly').objectStore('meta').get('settings');
      r.onsuccess = () => { db.close(); resolve(r.result?.value); };
      r.onerror = () => { db.close(); reject(r.error); };
    });
  });
}

/** Log tab, then "+ Log Session": the new-session form. */
export async function openNewSessionForm(page: Page): Promise<void> {
  await gotoTab(page, 'Log');
  await page.getByRole('button', { name: '+ Log Session' }).click();
  await expect(page.getByRole('heading', { name: 'Log Session', exact: true })).toBeVisible();
}

export function kindChip(page: Page, name: string) {
  return page.getByRole('group', { name: 'Session kind' }).getByRole('button', { name });
}

export function wall(page: Page) {
  return page.getByRole('dialog', { name: 'Unlock live-fire logging' });
}
