// T-6: drive the REAL v2 -> v3 IndexedDB schema upgrade (SCHEMA_VERSION = 3).
// db.ts's onupgradeneeded warns that a missed store bump "is silent
// cross-device erasure", yet nothing executed that handler against a
// genuinely old database. This file creates the database exactly as a v2
// install left it on disk -- v2 stores only, representative rows -- then lets
// db.ts's own open at v3 run the upgrade, and asserts every current store
// exists and every v2 record survived untouched.
//
// db.ts is imported DYNAMICALLY, after the v2 database is seeded, because its
// first getAll() call is what opens (and upgrades) the database. Runs in its
// own process (node --test runs each file separately), so the module-level
// dbPromise cache starts cold.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// What was on disk at schema v2: every current store EXCEPT 'skillSets'
// (v3's one addition). Hardcoded on purpose -- deriving it from today's
// STORE_NAMES would quietly track future edits instead of describing v2.
const V2_STORES = [
  'firearms', 'sessions', 'drills', 'ammunition', 'purchases',
  'maintenance', 'malfunctions', 'magazines', 'optics', 'parts',
  'goals', 'skills', 'matches', 'classifiers', 'references',
  'reminders', 'media', 'trash', 'meta'
] as const;

/** Rows a real v2 install could hold -- one per store worth asserting on. */
const V2_ROWS: Record<string, { id?: string; key?: string }[]> = {
  firearms: [{ id: 'g-v2' }],
  sessions: [{ id: 'se-v2' }],
  classifiers: [{ id: 'cl-v2' }],
  reminders: [{ id: 'rm-v2' }], // v2's own addition -- proves a PRIOR bump's data rides through the next one
  media: [{ id: 'me-v2' }],
  meta: [{ key: 'settings' }],
};

function seedV2Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('firearmlog', 2);
    req.onupgradeneeded = () => {
      for (const name of V2_STORES) {
        req.result.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(Object.keys(V2_ROWS), 'readwrite');
      for (const [store, rows] of Object.entries(V2_ROWS)) {
        for (const row of rows) tx.objectStore(store).put(row);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

test('v2 -> v3 upgrade: every store exists afterwards and all v2 data survives', async () => {
  await seedV2Database();

  // Importing db.ts here (not at the top) so ITS open, at SCHEMA_VERSION 3,
  // is the first thing to touch the seeded v2 database -- the real upgrade path.
  const { getAll, STORE_NAMES } = await import('../src/lib/db.ts');

  // Every current store must exist -- getAll opens a transaction on the store,
  // which throws NotFoundError if the upgrade failed to create it.
  for (const name of STORE_NAMES) {
    await assert.doesNotReject(getAll(name), `store '${name}' is missing after the v2 -> v3 upgrade`);
  }

  // And the v2 records rode through the upgrade untouched.
  for (const [store, rows] of Object.entries(V2_ROWS)) {
    const after = await getAll<{ id?: string; key?: string }>(store as (typeof STORE_NAMES)[number]);
    for (const row of rows) {
      const found = row.key
        ? after.some((r) => r.key === row.key)
        : after.some((r) => r.id === row.id);
      assert.ok(found, `v2 record ${row.id ?? row.key} lost from '${store}' during the upgrade`);
    }
  }

  // The v3 addition starts present and empty.
  assert.deepEqual(await getAll('skillSets'), []);
});
