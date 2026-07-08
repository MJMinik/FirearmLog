// The data layer (spec §3.2). Nothing else in the app touches IndexedDB.
// This module is the seam where a cloud sync service could plug in later.

import type { DataSet, Media } from './types.ts';
import type { Snapshot } from './flog.ts';
import { newestStamp } from './flog.ts';

const DB_NAME = 'firearmlog';
const SCHEMA_VERSION = 1;

export const STORE_NAMES = [
  'firearms', 'sessions', 'drills', 'ammunition', 'purchases',
  'maintenance', 'malfunctions', 'magazines', 'optics', 'parts',
  'goals', 'skills', 'matches', 'classifiers', 'references',
  'media', 'trash', 'meta'
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // T1-4: if the open FAILS (Safari Private Mode, quota exhaustion, a corrupt DB),
  // don't cache the rejected promise forever — that bricks every later call and the
  // app silently dies. Clear it so the next call can retry a fresh open. (Guarded so
  // we never null a newer open that has since replaced this one.)
  p.catch(() => { if (dbPromise === p) dbPromise = null; });
  dbPromise = p;
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

// T1-5: serialize the two multi-transaction destructive operations (restore and
// import). Each writes media across MANY transactions, so two overlapping (e.g. a
// double-tap, or a Pull fired during an import) could race the add/delete passes.
// This backstops the UI's own `saving` guards: a second one is refused with a
// clear message rather than interleaving. Always reset in `finally` so a failure
// can never leave imports permanently blocked.
let ioBusy = false;
async function withIoGuard<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (ioBusy) {
    throw new Error(`Another import or restore is still finishing — please wait a moment, then try ${what} again.`);
  }
  ioBusy = true;
  try {
    return await fn();
  } finally {
    ioBusy = false;
  }
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).getAll();
  await txDone(tx);
  return req.result as T[];
}

export async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).get(id);
  await txDone(tx);
  return req.result as T | undefined;
}

export async function putOne<T>(store: StoreName, record: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(record as unknown as object);
  await txDone(tx);
}

export async function deleteOne(store: StoreName, id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await txDone(tx);
}

/**
 * Audit CR-8: apply a "combine cans" merge ATOMICALLY — the kept can, the
 * repointed sessions/purchases, the optional new buy, and the deletion of the
 * merged-away can all land in ONE transaction. A crash can no longer leave
 * sessions repointed but the old can still present (double-count) or vice versa.
 */
export async function applyAmmoMerge(ops: {
  keptCan: object;
  sessions: object[];
  purchases: object[];
  newPurchase?: object;
  deleteCanId?: string;
}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['ammunition', 'sessions', 'purchases'], 'readwrite');
  tx.objectStore('ammunition').put(ops.keptCan);
  for (const s of ops.sessions) tx.objectStore('sessions').put(s);
  for (const p of ops.purchases) tx.objectStore('purchases').put(p);
  if (ops.newPurchase) tx.objectStore('purchases').put(ops.newPurchase);
  if (ops.deleteCanId) tx.objectStore('ammunition').delete(ops.deleteCanId);
  await txDone(tx);
}

/**
 * T1-5: write imported classifier rows in ONE transaction (mirrors applyAmmoMerge),
 * so an interrupted USPSA import can't leave a half-written set. Replaces a
 * per-row putOne loop in the import screen.
 */
export async function commitClassifiers(rows: object[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('classifiers', 'readwrite');
  const os = tx.objectStore('classifiers');
  for (const r of rows) os.put(r);
  await txDone(tx);
}

export async function countAll(store: StoreName): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).count();
  await txDone(tx);
  return req.result;
}

/**
 * Write a whole imported data set. Small records go in one transaction;
 * photos/videos are saved ONE PER TRANSACTION because iPhone Safari chokes
 * on many megabytes in a single write. onProgress reports photo progress.
 */
export async function commitDataSet(
  data: DataSet,
  settings: unknown,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  return withIoGuard('the import', () => commitDataSetInner(data, settings, onProgress));
}

async function commitDataSetInner(
  data: DataSet,
  settings: unknown,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const db = await openDb();
  const stores: StoreName[] = [
    'firearms', 'sessions', 'drills', 'ammunition', 'purchases',
    'maintenance', 'malfunctions', 'magazines', 'optics', 'parts',
    'goals', 'skills', 'matches', 'classifiers', 'trash', 'meta'
  ];
  const tx = db.transaction(stores, 'readwrite');
  const putAll = (store: StoreName, records: object[]) => {
    const os = tx.objectStore(store);
    for (const r of records) os.put(r);
  };
  putAll('firearms', data.firearms);
  putAll('sessions', data.sessions);
  putAll('ammunition', data.ammunition);
  putAll('purchases', data.purchases);
  putAll('maintenance', data.maintenance);
  putAll('malfunctions', data.malfunctions);
  putAll('magazines', data.magazines);
  putAll('optics', data.optics);
  putAll('parts', data.parts);
  putAll('goals', data.goals);
  putAll('skills', data.skills);
  putAll('matches', data.matches);
  putAll('classifiers', data.classifiers);
  putAll('trash', data.trash);
  if (settings !== undefined) {
    tx.objectStore('meta').put({ key: 'settings', value: settings });
  }
  await txDone(tx);

  // Imports replace import-derived drills (IDs starting 'dr-'). Custom drills
  // made in the app use 'drx-' IDs and survive a re-import untouched.
  // (Edits made to imported drills are reset by a re-import — by design.)
  const existingDrills = await getAll<{ id: string }>('drills');
  const dtx0 = db.transaction('drills', 'readwrite');
  for (const d of existingDrills) {
    if (d.id.startsWith('dr-')) dtx0.objectStore('drills').delete(d.id);
  }
  for (const d of data.drills) dtx0.objectStore('drills').put(d);
  await txDone(dtx0);

  // Re-imports must never duplicate photos OR lose them mid-write (audit CR-2).
  // Save the fresh set FIRST (one per transaction — iPhone Safari friendly)…
  const total = data.media.length;
  let done = 0;
  onProgress?.(done, total);
  for (const m of data.media) {
    const mtx = db.transaction('media', 'readwrite');
    mtx.objectStore('media').put(m);
    await txDone(mtx);
    done += 1;
    onProgress?.(done, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  // …then remove superseded photos for the re-written owners (anything on those
  // owners that isn't in the fresh set). Add-before-delete = never a gap.
  const newIds = new Set(data.media.map((m) => m.id));
  const ownerIds = new Set<string>();
  for (const f of data.firearms) ownerIds.add(f.id);
  for (const sn of data.sessions) ownerIds.add(sn.id);
  for (const m of data.matches) ownerIds.add(m.id);
  const existing = await getAll<Media>('media');
  for (const m of existing) {
    if (ownerIds.has(m.ownerId) && !newIds.has(m.id)) {
      const dtx = db.transaction('media', 'readwrite');
      dtx.objectStore('media').delete(m.id);
      await txDone(dtx);
    }
  }
}

export async function getSettings<T>(): Promise<T | undefined> {
  const row = await getOne<{ key: string; value: T }>('meta', 'settings');
  return row?.value;
}

/** Merge `patch` into the stored settings record (creating it if needed). */
export async function putSettings<T extends object>(patch: Partial<T>): Promise<T> {
  const current = (await getSettings<T>()) ?? ({} as T);
  const next = { ...current, ...patch };
  await putOne('meta', { key: 'settings', value: next });
  return next;
}

/** Every store except media, for snapshot export. */
const SNAPSHOT_STORES: StoreName[] = [
  'firearms', 'sessions', 'drills', 'ammunition', 'purchases',
  'maintenance', 'malfunctions', 'magazines', 'optics', 'parts',
  'goals', 'skills', 'matches', 'classifiers', 'references', 'trash', 'meta'
];

/** Everything in the database, packaged to travel (spec §7.1). */
export async function exportSnapshot(): Promise<Snapshot> {
  const stores: Record<string, unknown[]> = {};
  for (const name of SNAPSHOT_STORES) stores[name] = await getAll(name);
  const media = await getAll<Media>('media');
  return {
    exportedAt: Date.now(),
    lastModified: newestStamp(stores, media),
    stores,
    media
  };
}

/** Newest real change on this device (never bumped by mere app-open). */
export async function localLastModified(): Promise<number> {
  const stores: Record<string, unknown[]> = {};
  for (const name of SNAPSHOT_STORES) stores[name] = await getAll(name);
  const media = await getAll<Media>('media');
  return newestStamp(stores, media);
}

/**
 * Audit CR-5: validate an incoming snapshot's SHAPE before any destructive write,
 * so a damaged/foreign file is rejected up front and nothing on this device is
 * touched. Pure (no IndexedDB) so it's unit-tested. Throws a plain-language error.
 */
export function validateSnapshotShape(snapshot: Snapshot): void {
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.stores !== 'object' || snapshot.stores === null) {
    throw new Error('This data file is unreadable. Nothing on this device was changed.');
  }
  for (const name of SNAPSHOT_STORES) {
    const arr = snapshot.stores[name];
    if (arr === undefined) continue; // a missing store is treated as empty
    if (!Array.isArray(arr)) {
      throw new Error(`This data file is damaged (its "${name}" section is malformed). Nothing on this device was changed.`);
    }
    const keyProp = name === 'meta' ? 'key' : 'id';
    for (const r of arr) {
      if (!r || typeof r !== 'object' || typeof (r as Record<string, unknown>)[keyProp] !== 'string') {
        throw new Error(`This data file is damaged (a record in "${name}" is missing its ${keyProp}). Nothing on this device was changed.`);
      }
    }
  }
  if (!Array.isArray(snapshot.media)) {
    throw new Error('This data file is damaged (its photo list is malformed). Nothing on this device was changed.');
  }
  for (const m of snapshot.media) {
    if (!m || typeof (m as { id?: unknown }).id !== 'string') {
      throw new Error('This data file is damaged (a photo is missing its id). Nothing on this device was changed.');
    }
  }
}

/**
 * Pull: REPLACE everything on this device with the file's contents.
 * Safety (audit CR-1/CR-2/CR-5):
 *  - validate shape BEFORE any write (a bad file changes nothing);
 *  - the regular stores clear+rewrite in ONE transaction — IndexedDB rolls the
 *    whole thing back if any write fails, so old data survives a failed restore;
 *  - media is written ADD-NEW-THEN-DELETE-STALE (never wiped first), so an
 *    interruption can leave a few extra photos but can never lose them.
 */
export async function restoreSnapshot(
  snapshot: Snapshot,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  return withIoGuard('the restore', () => restoreSnapshotInner(snapshot, onProgress));
}

async function restoreSnapshotInner(
  snapshot: Snapshot,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  validateSnapshotShape(snapshot);
  const db = await openDb();

  // Regular stores: clear + rewrite atomically (all-or-nothing; rolls back on error).
  const tx = db.transaction([...SNAPSHOT_STORES], 'readwrite');
  for (const name of SNAPSHOT_STORES) {
    const os = tx.objectStore(name);
    os.clear();
    for (const r of snapshot.stores[name] ?? []) os.put(r as object);
  }
  await txDone(tx);

  // Media: add the new set first (one per transaction — iPhone Safari friendly)…
  const total = snapshot.media.length;
  let done = 0;
  onProgress?.(done, total);
  for (const m of snapshot.media) {
    const mtx = db.transaction('media', 'readwrite');
    mtx.objectStore('media').put(m);
    await txDone(mtx);
    done += 1;
    onProgress?.(done, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  // …then remove anything that isn't in the new set. The store is never empty.
  const keepIds = new Set(snapshot.media.map((m) => m.id));
  const existing = await getAll<Media>('media');
  for (const m of existing) {
    if (!keepIds.has(m.id)) {
      const dtx = db.transaction('media', 'readwrite');
      dtx.objectStore('media').delete(m.id);
      await txDone(dtx);
    }
  }
}

/**
 * DANGER — permanently erase ALL local data. Clears every object store in ONE
 * transaction, so it is atomic: any failure rolls the whole thing back and leaves
 * the data intact (never a half-wiped DB). Serialized via withIoGuard so it can't
 * overlap a restore/import. After this resolves the log is empty (guns === 0),
 * which returns the app to first-run. Backups (Save to File) live outside
 * IndexedDB and are NOT touched. Guarded in the UI by a typed confirmation.
 * (Hard-gate spec, session 35.)
 */
export async function clearAllData(): Promise<void> {
  return withIoGuard('the erase', async () => {
    const db = await openDb();
    const tx = db.transaction([...STORE_NAMES], 'readwrite');
    for (const name of STORE_NAMES) tx.objectStore(name).clear();
    await txDone(tx);
  });
}
