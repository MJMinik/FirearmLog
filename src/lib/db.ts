// The data layer (spec §3.2). Nothing else in the app touches IndexedDB.
// This module is the seam where a cloud sync service could plug in later.

import type { DataSet, Media } from './types.ts';
import type { Snapshot } from './flog.ts';
import { newestStamp } from './flog.ts';

const DB_NAME = 'firearmlog';
// v3 (T3-1, Timed Skills): adds the additive 'skillSets' object store. Same
// purely-additive shape as v2's 'reminders' bump — the upgrade loop below
// creates whatever store is missing, so an existing install gets the new
// store with no rewrite of anything already there. Timed-skill sets travel in
// the .flog sync automatically (SNAPSHOT_STORES is derived from STORE_NAMES)
// and Clear All wipes them like any other record.
const SCHEMA_VERSION = 3;

export const STORE_NAMES = [
  'firearms', 'sessions', 'drills', 'ammunition', 'purchases',
  'maintenance', 'malfunctions', 'magazines', 'optics', 'parts',
  'goals', 'skills', 'skillSets', 'matches', 'classifiers', 'references',
  'reminders', 'media', 'trash', 'meta'
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

// F1: how long an indexedDB.open may sit unsettled before we give up on it.
// The open normally settles in milliseconds; ten seconds is generous enough
// that a slow first-install upgrade on an old device still fits, while a
// genuinely stuck open (a stale tab holding a connection, a pending delete
// queued ahead of us) becomes a rejection the boot guard can recover from
// instead of a spinner that lives forever.
const OPEN_TIMEOUT_MS = 10_000;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    let blocked = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(blocked ? 'db-open-blocked' : 'db-open-timeout'));
    }, OPEN_TIMEOUT_MS);
    // Fires when another open connection (usually an older tab) blocks this
    // open. We don't reject immediately — the other tab may close and let the
    // open proceed — but we remember it so the timeout can say WHY it fired.
    req.onblocked = () => { blocked = true; };
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
        }
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      // A success landing AFTER the timeout already rejected would leak an
      // open connection nothing will ever use — and a leaked connection is
      // exactly the thing that blocks future opens. Close it instead.
      if (timedOut) { req.result.close(); return; }
      resolve(req.result);
    };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
  });
  // T1-4: if the open FAILS (Safari Private Mode, quota exhaustion, a corrupt DB),
  // don't cache the rejected promise forever — that bricks every later call and the
  // app silently dies. Clear it so the next call can retry a fresh open. (Guarded so
  // we never null a newer open that has since replaced this one.)
  p.catch(() => { if (dbPromise === p) dbPromise = null; });
  dbPromise = p;
  return dbPromise;
}

/**
 * F1 boot probe: can the database open at all? The app calls this once at
 * startup. It shares openDb's cached promise, so a healthy boot costs
 * nothing extra. (The error screen's Try Again uses retryDb below instead —
 * sharing the cache is exactly wrong there.)
 */
export function probeDb(): Promise<void> {
  return openDb().then(() => undefined);
}

/**
 * F1 Try Again: a retry that is GUARANTEED fresh. probeDb shares the cached
 * open — right at boot, wrong after a failure: anything that touched the
 * database between the failure and the click (an effect re-running, future
 * code) may have re-filled the cache with another doomed in-flight open, and
 * the click would join that failure instead of re-attempting (caught by E2E
 * run #175 — the first Try Again click failed; a second would have worked).
 * Discarding the cache first is safe: an abandoned open that later settles
 * only resolves its own callers (the cache-clear guard above compares
 * identity, so it never nulls the newer open), at worst leaving a spare
 * connection to the same database that closes with the tab.
 */
export function retryDb(): Promise<void> {
  dbPromise = null;
  return probeDb();
}

/**
 * Queue a transaction's writes with an explicit abort-on-throw. IndexedDB only
 * auto-rolls-back when a REQUEST fails; an exception thrown while queueing
 * (e.g. DataCloneError on an unstorable value) would otherwise leave the
 * already-queued writes to auto-commit — a partial batch. Unreachable from real
 * .flog files (JSON can't carry unstorable values), but the atomicity contract
 * shouldn't depend on that. (Found by the B7 forced-rollback test.)
 */
function queueOrAbort(tx: IDBTransaction, queueWrites: () => void): void {
  try {
    queueWrites();
  } catch (e) {
    try { tx.abort(); } catch { /* already aborting */ }
    throw e;
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

// T1-5: serialize the destructive multi-transaction operations (restore, import,
// erase, photo cleanup). Each writes media across MANY transactions, so two
// overlapping (a double-tap, a Load fired during an import — or, worse, the same
// app open in TWO TABS) could race the add/delete passes. Two layers:
//  - `ioBusy` refuses overlap within this tab (cheap, synchronous);
//  - the Web Locks API (B6/M-3) refuses overlap ACROSS tabs sharing this device's
//    database. `ifAvailable: true` means we never wait on the other tab — a held
//    lock refuses immediately with the same plain message (no hang, no deadlock;
//    the browser releases a tab's locks automatically if the tab dies).
// Older browsers without navigator.locks keep the single-tab guard unchanged.
// Always reset in `finally` so a failure can never leave writes permanently blocked.
let ioBusy = false;
function ioBusyError(what: string): Error {
  return new Error(`Another import or restore is still finishing — please wait a moment, then try ${what} again.`);
}
async function withIoGuard<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (ioBusy) throw ioBusyError(what);
  ioBusy = true;
  try {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks?.request) {
      return await locks.request('firearmlog-io', { ifAvailable: true }, async (lock) => {
        if (!lock) throw ioBusyError(what); // another tab holds it
        return fn();
      });
    }
    return await fn();
  } finally {
    ioBusy = false;
  }
}

/**
 * B6/M-3: run any destructive maintenance (e.g. the photo cleanup's rewrite
 * pass) under the SAME exclusion as restore/import, in this tab and across
 * tabs — so a cleanup can never interleave with a Load from File.
 */
export function withExclusiveIo<T>(what: string, fn: () => Promise<T>): Promise<T> {
  return withIoGuard(what, fn);
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

/**
 * S-5 / D-3: read ONLY the media owned by one record, streaming the store with a
 * cursor so the whole photo/video library never lands in memory at once. The
 * Session Report used to `getAll('media')` and filter in JS — but each Media
 * record carries its raw bytes (an ArrayBuffer), so getAll materialises EVERY
 * photo and video simultaneously; on a large log that is the likeliest iPhone
 * memory crash (board seat 8). A cursor examines one record at a time and keeps
 * only this owner's few, so peak memory is one record's bytes plus the matches.
 *
 * The media store has no secondary index (schema v1, keyPath 'id' only), so this
 * is a full scan that filters as it goes — deliberately NOT a new index, which
 * would be a schema migration (a heavier, structural change) for a per-tap read
 * whose cost is memory, not a full scan. READ-ONLY: no write path is touched.
 */
export async function getMediaForOwner(
  ownerType: Media['ownerType'],
  ownerId: string,
): Promise<Media[]> {
  const db = await openDb();
  const tx = db.transaction('media', 'readonly');
  const out: Media[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = tx.objectStore('media').openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(); return; }
      const m = cursor.value as Media;
      if (m.ownerType === ownerType && m.ownerId === ownerId) out.push(m);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return out;
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
  queueOrAbort(tx, () => {
    tx.objectStore('ammunition').put(ops.keptCan);
    for (const s of ops.sessions) tx.objectStore('sessions').put(s);
    for (const p of ops.purchases) tx.objectStore('purchases').put(p);
    if (ops.newPurchase) tx.objectStore('purchases').put(ops.newPurchase);
    if (ops.deleteCanId) tx.objectStore('ammunition').delete(ops.deleteCanId);
  });
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
  queueOrAbort(tx, () => { for (const r of rows) os.put(r); });
  await txDone(tx);
}

/**
 * T3-1 audit M2: rewrite one session's timed-skill sets ATOMICALLY — every
 * old row's delete and every new row's put land in ONE ['skillSets']
 * transaction (mirrors applyAmmoMerge/commitClassifiers above). Before this,
 * SessionForm ran a delete-loop then a put-loop across many transactions; a
 * crash or a closed tab between them could leave a session's timed-skill
 * work deleted with nothing written back. IndexedDB rolls the whole thing
 * back on any failure, so a save is now all-or-nothing for this store too.
 */
export async function rewriteSessionSkillSets(oldIds: string[], rows: object[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('skillSets', 'readwrite');
  const os = tx.objectStore('skillSets');
  queueOrAbort(tx, () => {
    for (const ssid of oldIds) os.delete(ssid);
    for (const r of rows) os.put(r);
  });
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
  // B4/M-4: derived from the ONE canonical list (STORE_NAMES), not hand-copied —
  // three hand-maintained copies had drifted, and `references` was silently
  // dropped on import. Exclusions are deliberate and local: media and drills are
  // written in their own phases below.
  const stores: StoreName[] = STORE_NAMES.filter((n) => n !== 'media' && n !== 'drills');
  const tx = db.transaction(stores, 'readwrite');
  const putAll = (store: StoreName, records: object[] | undefined) => {
    const os = tx.objectStore(store);
    for (const r of records ?? []) os.put(r); // a missing section means empty, never a crash
  };
  queueOrAbort(tx, () => {
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
    putAll('skillSets', data.skillSets);
    putAll('matches', data.matches);
    putAll('classifiers', data.classifiers);
    putAll('references', data.references); // M-4: was silently dropped before
    putAll('trash', data.trash);
    if (settings !== undefined) {
      tx.objectStore('meta').put({ key: 'settings', value: settings });
    }
  });
  await txDone(tx);

  // Imports replace import-derived drills (IDs starting 'dr-'). Custom drills
  // made in the app use 'drx-' IDs and survive a re-import untouched.
  // (Edits made to imported drills are reset by a re-import — by design.)
  const existingDrills = await getAll<{ id: string }>('drills');
  const dtx0 = db.transaction('drills', 'readwrite');
  queueOrAbort(dtx0, () => {
    for (const d of existingDrills) {
      if (d.id.startsWith('dr-')) dtx0.objectStore('drills').delete(d.id);
    }
    for (const d of data.drills ?? []) dtx0.objectStore('drills').put(d);
  });
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

/**
 * Merge `patch` into the stored settings record (creating it if needed).
 * B3/M-2: the read and the write share ONE readwrite transaction, so two
 * near-simultaneous patches (e.g. a backup stamp landing while a toggle saves)
 * can no longer read the same "before" and silently drop each other — IndexedDB
 * serializes readwrite transactions on the store, so both patches land.
 */
export async function putSettings<T extends object>(patch: Partial<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  const os = tx.objectStore('meta');
  const next = await new Promise<T>((resolve, reject) => {
    const req = os.get('settings');
    req.onsuccess = () => {
      try {
        const current = ((req.result as { value?: T } | undefined)?.value) ?? ({} as T);
        const merged = { ...current, ...patch } as T;
        os.put({ key: 'settings', value: merged });
        resolve(merged);
      } catch (e) {
        reject(e); // e.g. an unstorable value — reject, never hang
      }
    };
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return next;
}

/**
 * R-G / D-1: seed the North Star ATOMICALLY — write the starter goal AND merge
 * the settings guard (northStarSeeded + the pin) in ONE ['goals','meta']
 * transaction. Before this the two writes were separate transactions, so a crash
 * in between left a transient orphan goal (it self-healed via the fixed id, but
 * the window existed and the seeder sat outside the B6 io-lock). One transaction
 * closes the window: IndexedDB rolls the whole thing back on any failure, so the
 * seed is all-or-nothing. Mirrors putSettings' read-merge-write on meta, adding
 * the goal put to the same tx. The caller (northStar.ts) runs this under
 * withExclusiveIo, so it also can't interleave with a restore/import across tabs.
 */
export async function seedGoalWithSettings<T extends object>(
  goal: object,
  patch: Partial<T>,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['goals', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  await new Promise<void>((resolve, reject) => {
    const req = meta.get('settings');
    req.onsuccess = () => {
      try {
        tx.objectStore('goals').put(goal);
        const current = ((req.result as { value?: T } | undefined)?.value) ?? ({} as T);
        meta.put({ key: 'settings', value: { ...current, ...patch } as T });
        resolve();
      } catch (e) {
        try { tx.abort(); } catch { /* already aborting */ }
        reject(e); // e.g. an unstorable value — abort + reject, never a partial write
      }
    };
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
}

/**
 * F4: seed the stock drill library ATOMICALLY — all 14 drills AND the
 * `drillsSeeded` settings guard in ONE ['drills','meta'] transaction, exactly
 * the seedGoalWithSettings shape above (same reasoning: a crash between the
 * drill writes and the guard write must roll the whole thing back, so the
 * seed is all-or-nothing; the fixed 'drs-' ids make even a full retry
 * overwrite, never duplicate). The caller (lib/stockDrills.ts) runs this
 * under withExclusiveIo, so it can't interleave with a restore across tabs.
 */
export async function seedDrillsWithSettings<T extends object>(
  drills: object[],
  patch: Partial<T>,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['drills', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  await new Promise<void>((resolve, reject) => {
    const req = meta.get('settings');
    req.onsuccess = () => {
      try {
        for (const d of drills) tx.objectStore('drills').put(d);
        const current = ((req.result as { value?: T } | undefined)?.value) ?? ({} as T);
        meta.put({ key: 'settings', value: { ...current, ...patch } as T });
        resolve();
      } catch (e) {
        try { tx.abort(); } catch { /* already aborting */ }
        reject(e); // abort + reject, never a partial library
      }
    };
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
}

/** Every store except media (which travels in its own snapshot section) —
 *  derived from the canonical STORE_NAMES so it can never drift (B4/M-4). */
const SNAPSHOT_STORES: StoreName[] = STORE_NAMES.filter((n) => n !== 'media');

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
  queueOrAbort(tx, () => {
    for (const name of SNAPSHOT_STORES) {
      const os = tx.objectStore(name);
      os.clear();
      for (const r of snapshot.stores[name] ?? []) os.put(r as object);
    }
  });
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
 *
 * ONE exception survives the wipe (decision 2a / R-4): an analytics OPT-OUT.
 * An opt-out is a refusal, and a refusal must outlast a factory reset — silently
 * re-enrolling a user who turned analytics off after "Start fresh" is a consent
 * inversion. Only that single flag is carried over, inside the same transaction.
 */
export async function clearAllData(): Promise<void> {
  return withIoGuard('the erase', async () => {
    const db = await openDb();
    const tx = db.transaction([...STORE_NAMES], 'readwrite');
    const meta = tx.objectStore('meta');
    await new Promise<void>((resolve, reject) => {
      const req = meta.get('settings');
      req.onsuccess = () => {
        try {
          const optOut =
            ((req.result as { value?: { analyticsOptOut?: boolean } } | undefined)?.value)
              ?.analyticsOptOut === true;
          for (const name of STORE_NAMES) tx.objectStore(name).clear();
          if (optOut) meta.put({ key: 'settings', value: { analyticsOptOut: true } });
          resolve();
        } catch (e) {
          try { tx.abort(); } catch { /* already aborting */ }
          reject(e);
        }
      };
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
  });
}
