// Backup memory pass 3 (session 118): the restore reads a backup by its index
// instead of loading it whole, and the three phases were reordered so that a
// failure cannot destroy anything.
//
// THE FIRST TEST IN THIS FILE IS THE WHOLE POINT OF THE PASS. Everything else is
// supporting evidence.
//
// Why the reorder was needed: opening a backup used to checksum every photo
// before the confirmation sheet appeared, so a damaged file was refused with the
// device untouched. Reading photos one at a time gives that up — a photo can now
// fail in the middle of the restore. With the old order (records first) that left
// the owner holding the file's guns and sessions, a photo library half his and
// half the file's, and no way back. Photos first means a failure before the
// record phase destroys nothing at all.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import {
  restoreSnapshot, restoreFromFile, exportSnapshotSources,
  getAll, getAllMediaWholeStore, clearAllData, putOne,
  type RestoreSource,
} from '../src/lib/db.ts';
import { buildFlogBlob, parseFlog, parseFlogLazy } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';
import type { Media } from '../src/lib/types.ts';

function payload(n: number, seed: number): ArrayBuffer {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * 17 + seed * 5) & 0xff;
  return u.buffer;
}

function media(id: string, bytes = 32, seed = 1): Media {
  return {
    id, ownerType: 'session', ownerId: 'se-1', kind: 'image', name: `${id}.jpg`,
    annotations: [], mime: 'image/jpeg', data: payload(bytes, seed),
    createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
  } as Media;
}

const EMPTY_STORES = [
  'firearms', 'sessions', 'drills', 'ammunition', 'purchases', 'maintenance',
  'malfunctions', 'magazines', 'optics', 'parts', 'goals', 'skills', 'skillSets',
  'matches', 'classifiers', 'references', 'reminders', 'trash', 'meta',
];

function storesWith(over: Record<string, unknown[]>): Record<string, unknown[]> {
  const base: Record<string, unknown[]> = {};
  for (const n of EMPTY_STORES) base[n] = [];
  return { ...base, ...over };
}

function snapshotWith(over: Record<string, unknown[]>, mediaList: Media[] = []): Snapshot {
  return {
    exportedAt: 1_700_000_000_000, lastModified: 1_700_000_000_000,
    stores: storesWith(over), media: mediaList,
  };
}

// ─── The safety property ──────────────────────────────────────────────────────
test('pass 3: a restore that fails part-way leaves his RECORDS untouched', async () => {
  await clearAllData();
  // What he has before: two guns, a session, and two photos.
  await restoreSnapshot(snapshotWith(
    { firearms: [{ id: 'g-his-1' }, { id: 'g-his-2' }], sessions: [{ id: 'se-his' }] },
    [media('md-his-1'), media('md-his-2')],
  ));

  // A backup that reads fine for one photo and then fails, which is what a
  // damaged archive or an evicted iCloud file does.
  const failing: RestoreSource = {
    stores: storesWith({ firearms: [{ id: 'g-from-file' }], sessions: [{ id: 'se-from-file' }] }),
    mediaCount: 3,
    mediaMeta: [{ id: 'md-file-1' }, { id: 'md-file-2' }, { id: 'md-file-3' }],
    readMedia: async (i) => {
      if (i === 1) throw new Error('This data file looks damaged (checksum failed on media/md-file-2).');
      return media(`md-file-${i + 1}`, 32, i);
    },
  };

  await assert.rejects(() => restoreFromFile(failing), /looks damaged/);

  // EVERY record he had is still there, and nothing from the file arrived.
  const firearms = await getAll<{ id: string }>('firearms');
  const sessions = await getAll<{ id: string }>('sessions');
  assert.deepEqual(firearms.map((f) => f.id).sort(), ['g-his-1', 'g-his-2'],
    'his guns were replaced by a restore that failed — the record phase must not run until every photo is in');
  assert.deepEqual(sessions.map((s) => s.id), ['se-his'],
    'his sessions were replaced by a restore that failed');

  // Photos the file does not name survive untouched. Extras from the file are the
  // accepted cost: orphans taking up space until a successful restore's delete
  // pass clears them.
  const mediaAfter = await getAllMediaWholeStore();
  const ids = mediaAfter.map((m) => m.id);
  assert.ok(ids.includes('md-his-1') && ids.includes('md-his-2'),
    'a failed restore lost one of his photos');
});

// ─── The limit of that guarantee, asserted rather than described ──────────────
// The test above uses ids the file does not share, which is the ONE shape where
// phase 1 is genuinely additive — and its first version was named "destroys
// nothing of his" on the strength of it. Two cold audits reproduced the case it
// could not see: a backup is normally of his OWN library, so the ids collide,
// and `put` on an existing key replaces the record — bytes, caption, notes and
// markup together.
//
// This is here so the limit is a fact with a keeper rather than a paragraph. If
// someone later makes phase 1 defer colliding writes until after the records are
// committed — which is the remaining fix — this test goes red and gets rewritten
// as the stronger guarantee. That is the good kind of red.
test('pass 3: a failed restore DOES revert photos the backup also names', async () => {
  await clearAllData();
  const his = media('md-shared', 32, 1);
  his.name = 'Draw drill — low left';
  his.annotations = ['pushing the shot'];
  (his as unknown as { marks: unknown[] }).marks = [{ id: 'mk1', cx: 0.4, cy: 0.4, rx: 0.1, ry: 0.1, color: '#f00', label: 'A' }];
  await restoreSnapshot(snapshotWith({ firearms: [{ id: 'g-his' }] }, [his]));

  await assert.rejects(() => restoreFromFile({
    stores: storesWith({ firearms: [{ id: 'g-file' }] }),
    mediaCount: 2,
    mediaMeta: [{ id: 'md-shared' }, { id: 'md-second' }],
    readMedia: async (i) => {
      if (i === 1) throw new Error('This data file looks damaged (checksum failed on media/md-second).');
      return media('md-shared', 32, 9); // the backup's older version of the same photo
    },
  }), /looks damaged/);

  assert.deepEqual((await getAll<{ id: string }>('firearms')).map((f) => f.id), ['g-his'],
    'his records must still survive — that is what the reorder buys');

  const after = (await getAllMediaWholeStore()).find((m) => m.id === 'md-shared')!;
  assert.equal(after.name, 'md-shared.jpg',
    'if this now reads "Draw drill — low left", phase 1 has stopped overwriting colliding ids and this test should be replaced by the stronger guarantee');
  assert.deepEqual(after.annotations, []);
  assert.equal((after as unknown as { marks?: unknown[] }).marks, undefined);
});

test('pass 3: a successful restore still replaces everything and clears the strays', async () => {
  await clearAllData();
  await restoreSnapshot(snapshotWith({ firearms: [{ id: 'g-old' }] }, [media('md-old')]));
  await restoreFromFile({
    stores: storesWith({ firearms: [{ id: 'g-new' }] }),
    mediaCount: 1,
    mediaMeta: [{ id: 'md-new' }],
    readMedia: async () => media('md-new'),
  });
  assert.deepEqual((await getAll<{ id: string }>('firearms')).map((f) => f.id), ['g-new']);
  assert.deepEqual((await getAllMediaWholeStore()).map((m) => m.id), ['md-new'],
    'the stale-delete pass did not run, or ran on the wrong set');
});

test('pass 3: a photo with a bad id is refused before anything is written', async () => {
  await clearAllData();
  await restoreSnapshot(snapshotWith({ firearms: [{ id: 'g-safe' }] }, [media('md-safe')]));
  await assert.rejects(
    () => restoreFromFile({
      stores: storesWith({ firearms: [{ id: 'g-bad' }] }),
      mediaCount: 1,
      mediaMeta: [{ id: 42 } as unknown as Record<string, unknown>],
      readMedia: async () => media('md-whatever'),
    }),
    /a photo is missing its id/,
  );
  // The record-shape check has to walk the INDEX now that the photos are not
  // loaded. If it had been left behind, a bad id would reach the database
  // mid-restore instead — the exact half-written state this pass prevents.
  assert.deepEqual((await getAll<{ id: string }>('firearms')).map((f) => f.id), ['g-safe']);
  assert.deepEqual((await getAllMediaWholeStore()).map((m) => m.id), ['md-safe']);
});

// ─── The lazy reader against the eager one, both from a real database ─────────
test('pass 3: a lazy restore lands exactly what an eager one lands', async () => {
  await clearAllData();
  await putOne('firearms', { id: 'g1', make: 'Atlas', createdAt: 1, updatedAt: 2 });
  await putOne('sessions', { id: 'se-1', date: '2026-08-10', createdAt: 1, updatedAt: 3, guns: [] });
  for (const [i, id] of ['md-a', 'md-b', 'md-c'].entries()) await putOne('media', media(id, 100 + i, i));

  const blob = await buildFlogBlob(await exportSnapshotSources());
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // Eager: parse the whole thing and restore from it.
  await clearAllData();
  await restoreSnapshot(parseFlog(bytes));
  const eagerFirearms = await getAll<{ id: string }>('firearms');
  const eagerMedia = (await getAllMediaWholeStore()).sort((a, b) => a.id.localeCompare(b.id));

  // Lazy: open by the index and restore from that.
  await clearAllData();
  await restoreFromFile(await parseFlogLazy(blob));
  const lazyFirearms = await getAll<{ id: string }>('firearms');
  const lazyMedia = (await getAllMediaWholeStore()).sort((a, b) => a.id.localeCompare(b.id));

  assert.deepEqual(lazyFirearms, eagerFirearms);
  assert.deepEqual(lazyMedia.map((m) => m.id), eagerMedia.map((m) => m.id));
  for (const [i, m] of lazyMedia.entries()) {
    assert.deepEqual([...new Uint8Array(m.data)], [...new Uint8Array(eagerMedia[i].data)],
      `photo ${m.id} came back with different bytes through the lazy reader`);
  }
});

test('pass 3: the progress counter still reports every photo', async () => {
  await clearAllData();
  for (const id of ['md-1', 'md-2', 'md-3']) await putOne('media', media(id));
  const blob = await buildFlogBlob(await exportSnapshotSources());
  await clearAllData();
  const seen: [number, number][] = [];
  await restoreFromFile(await parseFlogLazy(blob), (d, t) => seen.push([d, t]));
  assert.deepEqual(seen, [[0, 3], [1, 3], [2, 3], [3, 3]]);
});

// ─── Opening a backup must not cost the size of the backup ────────────────────
// Same instrument as the save side: arrayBuffers rather than the JS heap, because
// a photo's bytes live in an external backing store the heap figure cannot see.
// This is the property that made the confirmation sheet expensive — it used to
// hold the whole file for as long as the sheet stayed open.
test('pass 3: opening a backup does not load it', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;

  await clearAllData();
  const ONE_MB = 1024 * 1024;
  const COUNT = 24;
  for (let i = 0; i < COUNT; i++) await putOne('media', media(`md-big-${i}`, ONE_MB, i));
  const blob = await buildFlogBlob(await exportSnapshotSources());
  assert.ok(blob.size > COUNT * ONE_MB, 'the fixture archive is smaller than expected');

  gc(); gc();
  const before = process.memoryUsage();
  const lazy = await parseFlogLazy(blob);
  gc(); gc();
  const after = process.memoryUsage();

  assert.equal(lazy.mediaCount, COUNT);
  const grewMb = ((after.heapUsed + after.arrayBuffers) - (before.heapUsed + before.arrayBuffers)) / ONE_MB;
  assert.ok(grewMb < 4,
    `opening a ${COUNT} MB backup grew memory by ${grewMb.toFixed(1)} MB — it is being read whole, which is what pass 3 removed`);
});

test('pass 3: the total photo size is known from the index, for the space check', async () => {
  await clearAllData();
  for (const [i, id] of ['md-x', 'md-y'].entries()) await putOne('media', media(id, 5000 + i, i));
  const eagerTotal = (await getAllMediaWholeStore()).reduce((n, m) => n + m.data.byteLength, 0);
  const blob = await buildFlogBlob(await exportSnapshotSources());
  const lazy = await parseFlogLazy(blob);
  // The free-space preflight moved to open time and now sizes itself from this.
  // If it ever stopped matching, the check would size the wrong thing silently.
  assert.equal(lazy.mediaBytes, eagerTotal);
});

// ─── The transaction/read ordering, measured rather than read ─────────────────
// Each photo must be read BEFORE its write transaction is opened. An IndexedDB
// transaction commits as soon as control returns to the event loop with nothing
// of its own pending, so a transaction opened first is dead by the time a disk
// read resolves — and WebKit is stricter about this than Chrome, which makes it
// an iPhone defect specifically.
//
// I first held this by reading the source, on the belief that fake-indexeddb was
// too permissive to catch it. THAT BELIEF WAS WRONG and a cold auditor showed it:
// fake-indexeddb does enforce the lifetime, just not across a microtask, which is
// all my fixtures crossed. A real read is a MACROTASK. So the fixture below awaits
// one, and the ordering becomes a behavioural fact instead of a text match.
//
// The text guard it replaces was also defeatable by writing a comment: it searched
// the raw file including comments, so "// then pull it in with source.readMedia(i)"
// above the transaction line satisfied it while the code did the opposite — which
// is exactly the comment somebody would write while introducing the bug.
test('pass 3: a photo read that goes to disk does not kill its write transaction', async () => {
  await clearAllData();
  await restoreFromFile({
    stores: storesWith({ firearms: [{ id: 'g-macrotask' }] }),
    mediaCount: 2,
    mediaMeta: [{ id: 'md-slow-1' }, { id: 'md-slow-2' }],
    readMedia: async (i) => {
      // A real read is blob.slice().arrayBuffer() — a macrotask, not a microtask.
      await new Promise((r) => setTimeout(r, 0));
      return media(`md-slow-${i + 1}`);
    },
  });
  assert.deepEqual((await getAllMediaWholeStore()).map((m) => m.id).sort(), ['md-slow-1', 'md-slow-2'],
    'a photo read that goes to disk killed its write transaction — open the transaction AFTER the read, not before');
});

// ─── The backup's name ────────────────────────────────────────────────────────
// Pinned against a literal with an injected date, the same pattern csvExport
// already uses. A shape check ("some date") is not enough: the whole point of the
// dated name is that the newest sorts last and an old one is safe to delete on
// sight, and both of those need the date to be RIGHT.
import { backupFileName } from '../src/lib/flog.ts';

test('pass 3: a backup is named for the day it was taken', () => {
  assert.equal(backupFileName(new Date(2026, 7, 10, 14, 30)), 'FirearmLog-2026-08-10.flog');
  // Local date, not UTC: a save at 11pm belongs to the day he took it, not to
  // tomorrow. This is the same rule every other date in the app follows.
  assert.equal(backupFileName(new Date(2026, 11, 31, 23, 59)), 'FirearmLog-2026-12-31.flog');
});
