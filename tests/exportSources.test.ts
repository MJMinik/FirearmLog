// Backup memory pass 2 (session 118): the streaming save path, proved against a
// REAL DATABASE rather than against a hand-built fixture.
//
// WHY THIS FILE EXISTS AT ALL. Pass 1 proved buildFlogBlob byte-identical to
// buildFlog across empty, one, two, three, seventeen and sixty-four records,
// unusual ids, and two thousand randomised libraries — but every one of those
// fed BOTH writers from the same test helper. The descriptions the two writers
// see were therefore identical by construction, and the one thing that could
// actually differ in production went unmeasured: buildFlog is handed whole
// records straight out of getAllMediaWholeStore, while buildFlogBlob is handed
// descriptions assembled by scanMediaExportSources, one record at a time, from
// a cursor. Those are two different pieces of code deciding what data.json says.
//
// This file closes that. It seeds fake-indexeddb, runs BOTH real export paths
// against it, and compares the finished archives byte for byte. A field dropped
// from `meta`, a record visited in a different order, or a normalisation that
// happens on one path and not the other all fail here and nowhere else.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportSnapshot, exportSnapshotSources, putOne, getAllMediaWholeStore, clearAllData,
} from '../src/lib/db.ts';
import { buildFlog, buildFlogBlob, parseFlog } from '../src/lib/flog.ts';
import type { Media } from '../src/lib/types.ts';

/** Deterministic bytes — a photo of n bytes whose content depends on the seed. */
function payload(n: number, seed: number): ArrayBuffer {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * 31 + seed * 7) & 0xff;
  return u.buffer;
}

function mediaRecord(over: Partial<Media> & { id: string }): Media {
  return {
    ownerType: 'session',
    ownerId: 'se-1',
    kind: 'image',
    name: 'photo.jpg',
    annotations: [],
    mime: 'image/jpeg',
    data: payload(64, 1),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  } as Media;
}

/**
 * A library deliberately shaped like a real one rather than a uniform one:
 * different owners, both kinds, a video an order of magnitude bigger than the
 * photos, a record carrying the optional `marks` field that only some have, and
 * ids that do not sort in insertion order — because the two writers must agree
 * about ORDER, and an already-sorted fixture cannot tell you whether they do.
 */
async function seedLibrary(): Promise<void> {
  await putOne('firearms', {
    id: 'g1', make: 'Atlas', model: 'Erebus', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000,
  });
  await putOne('sessions', {
    id: 'se-1', date: '2026-08-09', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_200_000, guns: [],
  });
  await putOne('media', mediaRecord({ id: 'md-c', data: payload(128, 3), updatedAt: 1_700_000_300_000 }));
  await putOne('media', mediaRecord({ id: 'md-a', data: payload(2048, 1), kind: 'video', mime: 'video/mp4', name: 'run.mp4' }));
  await putOne('media', mediaRecord({
    id: 'md-b', ownerType: 'firearm', ownerId: 'g1', data: payload(0, 2),
    marks: [{ id: 'mk1', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, color: '#f00', label: 'A' }],
  }));
  await putOne('media', mediaRecord({ id: 'md-d', annotations: ['left low'], data: payload(777, 4) }));
  // md-e carries updatedAt as TEXT. Both paths must apply the same typeof filter
  // and ignore it; without the filter here, JavaScript coerces and this string
  // wins the comparison, so lastModified comes back as a string from one path and
  // a number from the other. This is audit finding E of session 114, planted so
  // that removing the filter is not a silent no-op.
  await putOne('media', {
    ...mediaRecord({ id: 'md-e', data: payload(96, 5) }), updatedAt: '9999999999999',
  } as unknown as Media);
  // md-f is MISSING a field types.ts declares as a required string. The read
  // boundary fills it, so a scan that skipped normalizeRecord would describe this
  // photo differently from the whole-store path — planted so that dropping the
  // read boundary fails a test instead of passing quietly.
  await putOne('media', {
    id: 'md-f', ownerType: 'session', ownerId: 'se-1', kind: 'image',
    annotations: [], mime: 'image/jpeg', data: payload(48, 6),
    createdAt: 1_700_000_000_000, updatedAt: 1_700_000_050_000,
  } as unknown as Media);
}

/** Every id the fixture seeds, in ascending key order — which is walk order. */
const SEEDED_IDS = ['md-a', 'md-b', 'md-c', 'md-d', 'md-e', 'md-f'];

test('pass 2: the two export paths describe the same library in the same order', async () => {
  await clearAllData();
  await seedLibrary();

  const eager = await getAllMediaWholeStore();
  const streamed = await exportSnapshotSources();

  assert.deepEqual(
    streamed.media.map((m) => m.id),
    eager.map((m) => m.id),
    'the cursor visits media in a different order than getAll returns them — the two writers would produce different archives',
  );

  for (const [i, source] of streamed.media.entries()) {
    const expected = { ...(eager[i] as unknown as Record<string, unknown>) };
    delete expected.data;
    assert.deepEqual(source.meta, expected, `meta for ${source.id} differs from the whole-store record minus its bytes`);
    assert.equal(Object.prototype.hasOwnProperty.call(source.meta, 'data'), false,
      `meta for ${source.id} still carries its bytes — the whole point of streaming is that it does not`);
  }
});

test('pass 2: lastModified is identical on both export paths', async () => {
  await clearAllData();
  await seedLibrary();
  const snapshot = await exportSnapshot();
  const streamed = await exportSnapshotSources();
  assert.equal(streamed.lastModified, snapshot.lastModified);
  // And it is actually the newest media stamp, not merely equal by both being zero.
  assert.equal(streamed.lastModified, 1_700_000_300_000);
});

test('pass 2: a backup built from the database is byte-identical either way', async () => {
  await clearAllData();
  await seedLibrary();

  const snapshot = await exportSnapshot();
  const streamed = await exportSnapshotSources();
  // exportedAt is Date.now() on both paths and cannot match across two calls; it
  // pins the ZIP's date fields, so it is forced equal here. lastModified is NOT
  // forced — it is derived differently on the two paths and the test above is
  // what holds it.
  const pinned = { ...streamed, exportedAt: snapshot.exportedAt };

  const eagerBytes = buildFlog(snapshot);
  const streamedBytes = new Uint8Array(await (await buildFlogBlob(pinned)).arrayBuffer());

  assert.deepEqual([...streamedBytes], [...eagerBytes],
    'the streaming writer produced a different archive from the same database');

  // And the result is a real backup, not merely an identical pair of wrong ones.
  const reread = parseFlog(streamedBytes);
  assert.equal(reread.media.length, SEEDED_IDS.length);
  assert.deepEqual(reread.media.map((m) => m.id).sort(), [...SEEDED_IDS]);
  // The read boundary ran on this path: md-f was stored with no `name`.
  assert.equal(reread.media.find((m) => m.id === 'md-f')!.name, '');
  const video = reread.media.find((m) => m.id === 'md-a');
  assert.deepEqual([...new Uint8Array(video!.data)], [...new Uint8Array(payload(2048, 1))]);
});

test('pass 2: open() returns exactly the stored bytes, including a zero-length record', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();
  const eager = await getAllMediaWholeStore();
  for (const [i, source] of streamed.media.entries()) {
    const got = await source.open();
    assert.deepEqual([...got], [...new Uint8Array(eager[i].data)], `bytes differ for ${source.id}`);
  }
  const empty = streamed.media.find((m) => m.id === 'md-b');
  assert.equal((await empty!.open()).length, 0);
});

// ─── The window streaming opens, and the refusal that closes it ───────────────
// Reading the library one photo at a time means the library can change between
// the description being written and the bytes being read. data.json has already
// promised the entry exists, so a missing photo must fail the whole save rather
// than write an archive whose index describes something that is not in it. That
// file would look fine until the day it was restored.
test('pass 2: a photo deleted mid-pack fails the save in plain words', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();
  const doomed = streamed.media.find((m) => m.id === 'md-d')!;

  // Simulate exactly what a photo cleanup or a second tab would do between the
  // scan and the read.
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firearmlog');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').delete('md-d');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  await assert.rejects(
    () => doomed.open(),
    (e: Error) => {
      assert.match(e.message, /deleted while the backup was being written/);
      assert.match(e.message, /nothing was saved/);
      // The advice must be true: the scan runs again, so tapping again succeeds.
      assert.match(e.message, /Tap Save to File/);
      return true;
    },
  );
});

test('pass 2: the whole save fails when one photo vanishes — no partial archive', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firearmlog');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').delete('md-c');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  await assert.rejects(() => buildFlogBlob(streamed), /deleted while the backup was being written/);
});

// ─── The progress counter ─────────────────────────────────────────────────────
test('pass 2: progress counts photos, not zip entries, and finishes at N of N', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();
  const seen: [number, number][] = [];
  await buildFlogBlob({ ...streamed, onProgress: (done, total) => seen.push([done, total]) });

  // data.json is entry 0 and must not be reported as a photo.
  const n = SEEDED_IDS.length;
  assert.deepEqual(seen, [[0, n], [0, n], ...SEEDED_IDS.map((_, i) => [i + 1, n])]);
});

test('pass 2: a progress callback that throws cannot cost the user a backup', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();
  const blob = await buildFlogBlob({
    ...streamed,
    onProgress: () => { throw new Error('a rendering bug'); },
  });
  const reread = parseFlog(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(reread.media.length, SEEDED_IDS.length);
});

test('pass 2: an empty library still produces a readable backup', async () => {
  await clearAllData();
  const streamed = await exportSnapshotSources();
  assert.equal(streamed.media.length, 0);
  const seen: [number, number][] = [];
  const blob = await buildFlogBlob({ ...streamed, onProgress: (d, t) => seen.push([d, t]) });
  const reread = parseFlog(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(reread.media.length, 0);
  // Only data.json, and it is not a photo — so the counter never claims one.
  assert.deepEqual(seen, [[0, 0], [0, 0]]);
});

// ─── The memory property, asserted rather than commented ──────────────────────
// The whole point of the pass is that the scan keeps no photo bytes: each source
// holds a key and an id, and open() goes back to the database. That is not
// observable as a memory number from the node test runner — but it IS observable
// behaviourally, because a source that had captured the bytes would hand back the
// OLD ones. So: scan, change the bytes underneath, read.
//
// A cold auditor demonstrated why this test had to exist. He retained every
// record in a module-level array — the exact crash this pass removes — and the whole
// suite stayed green, because the property was written in a comment and
// nowhere else.
test('pass 2: open() re-reads the record rather than replaying scan-time bytes', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();
  const target = streamed.media.find((m) => m.id === 'md-c')!;
  const before = await target.open();

  const replacement = payload(256, 99);
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firearmlog');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const get = tx.objectStore('media').get('md-c');
    get.onsuccess = () => {
      const row = get.result as Media;
      tx.objectStore('media').put({ ...row, data: replacement });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  const after = await target.open();
  assert.notDeepEqual([...after], [...before],
    'open() returned the bytes captured at scan time — the scan is retaining photo data and the memory fix is undone');
  assert.deepEqual([...after], [...new Uint8Array(replacement)]);
});

// ─── The timestamp that dates every backup ────────────────────────────────────
// Not asserted anywhere until a cold auditor set it to zero and watched the
// whole suite pass. A zero here reaches dosDateTime, which clamps to 1980, so every
// entry in every backup he ever took would be stamped 1980-01-01 — and data.json
// would say the log was exported at the epoch.
test('pass 2: exportedAt is the moment of export, not a constant', async () => {
  await clearAllData();
  await seedLibrary();
  const before = Date.now();
  const streamed = await exportSnapshotSources();
  const after = Date.now();
  assert.ok(streamed.exportedAt >= before && streamed.exportedAt <= after,
    `exportedAt (${streamed.exportedAt}) is not a timestamp taken during this call — every backup would carry the wrong date`);
});

// ─── The progress callback must not move a single byte ────────────────────────
// The comment in zip.ts used to cite the golden-file test as the proof of this.
// It is not: the golden test never attaches a callback, so it only ever exercises
// the no-callback path. This is the test that actually compares the two.
test('pass 2: attaching a progress callback changes no byte of the archive', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();
  const pinned = { ...streamed, exportedAt: 1_700_000_400_000 };
  const quiet = new Uint8Array(await (await buildFlogBlob(pinned)).arrayBuffer());
  const noisy = new Uint8Array(await (await buildFlogBlob({ ...pinned, onProgress: () => {} })).arrayBuffer());
  assert.deepEqual([...noisy], [...quiet]);
});

// ─── A single record, fed from the database ───────────────────────────────────
// The DB-fed coverage was six records and zero. One is its own case: it is the
// only count where an off-by-one in the entry list produces a plausible archive.
test('pass 2: a one-photo library is byte-identical either way', async () => {
  await clearAllData();
  await putOne('media', mediaRecord({ id: 'md-only', data: payload(300, 8) }));
  const snapshot = await exportSnapshot();
  const streamed = await exportSnapshotSources();
  const eagerBytes = buildFlog(snapshot);
  const streamedBytes = new Uint8Array(
    await (await buildFlogBlob({ ...streamed, exportedAt: snapshot.exportedAt })).arrayBuffer());
  assert.deepEqual([...streamedBytes], [...eagerBytes]);
});

// ─── A record present but carrying no picture ─────────────────────────────────
// A DELIBERATE DIVERGENCE FROM buildFlog, recorded as a decision rather than
// discovered later: `new Uint8Array(undefined)` is a zero-length array, so the
// in-memory writer wrote an EMPTY photo into the backup and reported success.
// The streaming writer refuses, and its message does not say "try again" —
// the record will not fix itself, so that advice would fail every time.
test('pass 2: a record with no picture stored refuses, and says what to do', async () => {
  await clearAllData();
  await putOne('media', mediaRecord({ id: 'md-nodata', data: payload(16, 9) }));
  const streamed = await exportSnapshotSources();

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firearmlog');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const get = tx.objectStore('media').get('md-nodata');
    get.onsuccess = () => {
      const row = get.result as Record<string, unknown>;
      delete row.data;
      tx.objectStore('media').put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  await assert.rejects(() => buildFlogBlob(streamed), (e: Error) => {
    assert.match(e.message, /no picture stored against it/);
    // It must name the ITEM the reader can find, not an internal id.
    assert.match(e.message, /named "photo\.jpg"/);
    assert.match(e.message, /from the session it is attached to/);
    assert.equal(/md-/.test(e.message), false,
      'the message shows an internal id, which appears on no screen in the app');
    // Ban the BEHAVIOUR, not one verb. The first version of this banned
    // /[Tt]ry .*again/, and the sibling error four lines away in db.ts says
    // "Tap Save to File again" — so the most likely wrong edit was the one the
    // guard could not see. Retry advice of any wording is wrong here: the record
    // will not fix itself, so every retry fails.
    // \b matters: the message says "no picture stored AGAINST it", and a bare
    // /again/ matches inside "against". A guard that fires on the correct message
    // is as bad as one that misses the wrong one.
    assert.equal(/\bagain\b/.test(e.message), false,
      'the message tells the user to retry something that cannot succeed');
    // And it must say what CAN be done, naming the item rather than an internal id.
    assert.match(e.message, /Delete/);
    return true;
  });
});

// ─── A photo edited mid-pack is a point-in-time backup, not a failure ─────────
// The deleted case fails the save. The EDITED case must not: a backup is a
// snapshot of a moment, and refusing here would turn an ordinary photo edit into
// a save that cannot complete.
test('pass 2: a photo edited mid-pack still produces a readable backup', async () => {
  await clearAllData();
  await seedLibrary();
  const streamed = await exportSnapshotSources();

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firearmlog');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const get = tx.objectStore('media').get('md-d');
    get.onsuccess = () => {
      const row = get.result as Media;
      // Change the BYTES as well as the description. Editing only the name
// would pass identically if open() replayed scan-time bytes, so the case the
// comment describes — new bytes under an old description — would never be
// observed. With the data changed this is a second, independent witness that
// nothing was captured at scan time.
      tx.objectStore('media').put({ ...row, name: 'renamed.jpg', data: payload(999, 42), updatedAt: 1_900_000_000_000 });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  const blob = await buildFlogBlob(streamed);
  const reread = parseFlog(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(reread.media.length, SEEDED_IDS.length);
  // The description is the one read at scan time. That is what a point-in-time
  // backup means, and it is stated here so it reads as intended rather than as a bug.
  const edited = reread.media.find((m) => m.id === 'md-d')!;
  assert.equal(edited.name, 'photo.jpg');
  // The new bytes, under the old description. That IS the point-in-time backup.
  assert.deepEqual([...new Uint8Array(edited.data)], [...new Uint8Array(payload(999, 42))]);
});

// ─── The memory property, measured rather than described ──────────────────────
// The behavioural test above proves open() re-reads the record. It does NOT
// prove the scan keeps nothing: a cold auditor added `RECENT_SCAN.push(record)`
// to the cursor loop — every photo retained for the life of the process, the
// exact crash this pass removes — and the whole suite stayed green.
//
// This is the instrument that catches it, and it runs in the ordinary suite with
// no browser. The discriminator is `arrayBuffers`, not the JS heap: a photo's
// bytes live in an external backing store that heapUsed cannot see (measured:
// 0.2 MB of heap growth even WITH the retention array in place). Collecting
// twice before each reading is what makes the difference a real one, and gc() is
// reachable without a command-line flag by asking V8 for it directly.
//
// Measured separation on a 24 MB library: 0.2 MB honest, 23.1 MB with the
// retention array — about 115x, which is why the threshold below can be generous
// and still bite.
import v8 from 'node:v8';
import vm from 'node:vm';

function externalBytes(): number {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

test('pass 2: scanning the library retains no photo bytes', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;

  await clearAllData();
  const ONE_MB = 1024 * 1024;
  const COUNT = 24;
  for (let i = 0; i < COUNT; i++) {
    await putOne('media', mediaRecord({ id: `md-big-${String(i).padStart(2, '0')}`, data: payload(ONE_MB, i) }));
  }

  gc(); gc();
  const before = externalBytes();
  const streamed = await exportSnapshotSources();
  gc(); gc();
  const after = externalBytes();

  assert.equal(streamed.media.length, COUNT);
  const grewMb = (after - before) / ONE_MB;
  // One photo's worth of slack. A scan that retained the library would show ~24.
  assert.ok(grewMb < 3,
    `scanning ${COUNT} MB of photos grew memory by ${grewMb.toFixed(1)} MB — the scan is holding photo bytes, which is the whole defect this pass removes`);
});

// ─── The documented exception to "byte-for-byte identical", pinned on BOTH sides ─
// The headline claim of this pass is that the streaming writer produces exactly
// what the in-memory one produced. There is one input class where that is FALSE
// by design, and until now the exception lived only in prose: a media record
// present in the store but carrying no `data`. `new Uint8Array(undefined)` is a
// zero-length array, so buildFlog silently wrote an EMPTY photo and reported
// success; buildFlogBlob refuses.
//
// Both halves are asserted here. Without the first, buildFlog's side is unpinned
// and a future change could quietly alter a documented decision with nothing
// going red — and a reader grepping the equivalence tests would never learn the
// exception exists.
test('pass 2: the one place the two writers disagree, pinned on both sides', async () => {
  await clearAllData();
  await putOne('media', mediaRecord({ id: 'md-hollow', data: payload(8, 3) }));

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open('firearmlog');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const get = tx.objectStore('media').get('md-hollow');
    get.onsuccess = () => {
      const row = get.result as Record<string, unknown>;
      delete row.data;
      tx.objectStore('media').put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  // The old writer: succeeds, and writes an empty photo. This is the behaviour
  // the streaming writer deliberately does NOT copy.
  const snapshot = await exportSnapshot();
  const eagerBytes = buildFlog(snapshot);
  const reread = parseFlog(eagerBytes);
  assert.equal(reread.media.length, 1);
  assert.equal(reread.media[0].data.byteLength, 0,
    'buildFlog no longer writes a zero-length photo for a record with no data — the divergence documented in db.ts openMediaBytes has changed and the comment is now wrong');

  // The new writer: refuses.
  const streamed = await exportSnapshotSources();
  await assert.rejects(() => buildFlogBlob(streamed), /no picture stored against it/);
});

// ─── WHAT THIS FILE'S MEMORY TEST DOES NOT COVER ──────────────────────────────
// Stated as a limit rather than left to be discovered, because "the memory
// property is tested" is exactly the sentence that stops the next person
// looking.
//
// The instrument above closes at the end of the SCAN. It cannot see the PACK.
// A cold auditor proved it: retaining every payload inside writeZipBlob — a
// `written.push(bytes)` next to the existing `parts.push(new Blob([bytes]))` —
// keeps the whole archive in the JS heap and leaves the whole suite green.
//
// And it cannot be fixed here. Node's Blob COPIES its inputs, so the honest pack
// is already carrying the archive in this environment: measured in flight at the
// last progress callback, honest 41.6 MB against retaining 48.5 MB on a 24 MB
// archive — a 15% margin, far too thin to assert on. In a browser the Blob store
// is separate from the heap and the difference is stark; in Node it is not.
//
// So the pack half is held by two weaker things and it is worth knowing which:
// the source guards in syncCardBlobCopy.test.ts, and the Chromium measurement in
// scripts/measure-backup-memory.mjs, which is run by hand. THAT is why the script
// matters and why its numbers were worth getting right twice.
