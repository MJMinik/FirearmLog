import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlog, newestStamp, parseFlog, FLOG_FORMAT, FLOG_VERSION } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';
import { writeZip, readZip } from '../src/lib/zip.ts';
import type { Media } from '../src/lib/types.ts';

function sampleSnapshot(): Snapshot {
  const photoBytes = new Uint8Array([1, 2, 3, 4, 5, 200, 100, 0]);
  const media: Media[] = [{
    id: 'md-fa-1-0', createdAt: 1000, updatedAt: 2000,
    ownerType: 'firearm', ownerId: 'fa-1', kind: 'image',
    name: 'Test photo', annotations: ['nice group'],
    mime: 'image/jpeg', data: photoBytes.buffer
  }];
  const stores = {
    firearms: [{ id: 'fa-1', name: 'Test Gun', createdAt: 1000, updatedAt: 5000 }],
    sessions: [{ id: 'se-1', date: '2026-06-11', createdAt: 1000, updatedAt: 9000 }],
    meta: [{ key: 'settings', value: { ownerName: 'Test' } }]
  };
  return { exportedAt: 10000, lastModified: 9000, stores, media };
}

test('newestStamp finds the latest real change', () => {
  const s = sampleSnapshot();
  assert.equal(newestStamp(s.stores, s.media), 9000);
});

test('flog round-trip: stores, media bytes, and stamps survive', () => {
  const s = sampleSnapshot();
  const file = buildFlog(s);
  const back = parseFlog(file);
  assert.equal(back.lastModified, 9000);
  assert.equal(back.exportedAt, 10000);
  assert.deepEqual(back.stores.firearms, s.stores.firearms);
  assert.deepEqual(back.stores.meta, s.stores.meta);
  assert.equal(back.media.length, 1);
  assert.equal(back.media[0].name, 'Test photo');
  assert.deepEqual(back.media[0].annotations, ['nice group']);
  assert.deepEqual([...new Uint8Array(back.media[0].data)], [1, 2, 3, 4, 5, 200, 100, 0]);
});

test('non-flog zips are refused in plain language', () => {
  const notFlog = writeZip([{ name: 'whatever.txt', data: new Uint8Array([1]) }]);
  assert.throws(() => parseFlog(notFlog), /isn't a FirearmLog data file/);
});

test('files from a newer app version are refused with advice', () => {
  const s = sampleSnapshot();
  const file = buildFlog(s);
  const back = parseFlog(file); // sanity
  assert.ok(back);
  const futuristic = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({ format: 'FirearmLog', version: 99, stores: {}, mediaMeta: [] }))
  }]);
  assert.throws(() => parseFlog(futuristic), /NEWER version/);
});

// H1 (T3-1 audit): FLOG_VERSION bumped 1 → 2 for the skillSets store. These
// three pin the exact version-fence contract at the new number: a legacy v1
// file (from before skillSets existed) still imports fine — backward compat
// is untouched — the CURRENT version imports fine, and anything newer refuses
// with the same plain-language advice as before.
test('a legacy version-1 .flog (pre-skillSets) still imports fine', () => {
  const legacy = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({
      format: FLOG_FORMAT, version: 1, exportedAt: 1, lastModified: 1,
      stores: { firearms: [{ id: 'fa-legacy', name: 'Old Gun' }] }, mediaMeta: [],
    }))
  }]);
  const back = parseFlog(legacy);
  assert.deepEqual(back.stores.firearms, [{ id: 'fa-legacy', name: 'Old Gun' }]);
});

test('a version-2 .flog (current, with skillSets) imports fine', () => {
  const current = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({
      format: FLOG_FORMAT, version: FLOG_VERSION, exportedAt: 1, lastModified: 1,
      stores: { skillSets: [{ id: 'ss-1', sessionId: 'se-1' }] }, mediaMeta: [],
    }))
  }]);
  const back = parseFlog(current);
  assert.deepEqual(back.stores.skillSets, [{ id: 'ss-1', sessionId: 'se-1' }]);
});

test('a version-3 .flog (from a newer app) is refused, not silently dropped', () => {
  const fromTheFuture = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({
      format: FLOG_FORMAT, version: 3, exportedAt: 1, lastModified: 1,
      stores: {}, mediaMeta: [],
    }))
  }]);
  assert.throws(() => parseFlog(fromTheFuture), /NEWER version/);
});

// ─── Tests for buildFlogBlob and parseFlogLazy ───────────────────────────────

import {
  buildFlogBlob, parseFlogLazy,
} from '../src/lib/flog.ts';
import type { FlogMediaSource } from '../src/lib/flog.ts';

// Re-use the same snapshot factory from above. Add a helper that builds the
// FlogMediaSource list from a Snapshot's media array.
function toMediaSources(media: Media[]): FlogMediaSource[] {
  return media.map((m) => {
    const meta = { ...m } as Record<string, unknown>;
    delete meta.data;
    return {
      id: m.id,
      meta,
      open: async () => new Uint8Array(m.data) as Uint8Array<ArrayBuffer>,
    };
  });
}

// ── 5. buildFlogBlob produces byte-identical output to buildFlog ─────────────

test('buildFlogBlob equals buildFlog byte-for-byte', async () => {
  const s = sampleSnapshot();
  const syncBytes = buildFlog(s);
  const blobBytes = new Uint8Array(
    await (await buildFlogBlob({
      exportedAt: s.exportedAt,
      lastModified: s.lastModified,
      stores: s.stores,
      media: toMediaSources(s.media),
    })).arrayBuffer()
  );
  assert.deepEqual([...blobBytes], [...syncBytes]);
});

// ── parseFlogLazy reports the same metadata as parseFlog ─────────────────────

test('parseFlogLazy: same stores, stamps, mediaCount and mediaBytes as parseFlog', async () => {
  const s = sampleSnapshot();
  const syncBytes = buildFlog(s);
  const blob = new Blob([syncBytes]);

  const eager = parseFlog(syncBytes);
  const lazy = await parseFlogLazy(blob);

  assert.equal(lazy.exportedAt, eager.exportedAt);
  assert.equal(lazy.lastModified, eager.lastModified);
  assert.deepEqual(lazy.stores, eager.stores);
  assert.equal(lazy.mediaCount, eager.media.length);
  // mediaBytes must equal the sum of each media entry's byte length.
  const expectedBytes = eager.media.reduce((sum, m) => sum + m.data.byteLength, 0);
  assert.equal(lazy.mediaBytes, expectedBytes);
});

// ── parseFlogLazy.readMedia returns identical bytes for every index ───────────

test('parseFlogLazy.readMedia gives identical bytes as parseFlog.media', async () => {
  const s = sampleSnapshot();
  const syncBytes = buildFlog(s);
  const blob = new Blob([syncBytes]);

  const eager = parseFlog(syncBytes);
  const lazy = await parseFlogLazy(blob);

  assert.equal(lazy.mediaCount, eager.media.length);
  for (let i = 0; i < eager.media.length; i++) {
    const lazyRecord = await lazy.readMedia(i);
    assert.deepEqual(
      [...new Uint8Array(lazyRecord.data)],
      [...new Uint8Array(eager.media[i].data)],
    );
    assert.equal(lazyRecord.name, eager.media[i].name);
  }
});

// ── 6. Cross-compatibility between old/new writers and old/new readers ───────

test('buildFlog output loads under parseFlogLazy', async () => {
  const s = sampleSnapshot();
  const syncBytes = buildFlog(s);
  const blob = new Blob([syncBytes]);
  const lazy = await parseFlogLazy(blob);
  assert.equal(lazy.exportedAt, s.exportedAt);
  assert.deepEqual(lazy.stores.firearms, s.stores.firearms);
  assert.equal(lazy.mediaCount, s.media.length);
});

test('buildFlogBlob output loads under parseFlog', async () => {
  const s = sampleSnapshot();
  const blob = await buildFlogBlob({
    exportedAt: s.exportedAt,
    lastModified: s.lastModified,
    stores: s.stores,
    media: toMediaSources(s.media),
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const eager = parseFlog(bytes);
  assert.equal(eager.exportedAt, s.exportedAt);
  assert.deepEqual(eager.stores.firearms, s.stores.firearms);
  assert.equal(eager.media.length, s.media.length);
  assert.deepEqual([...new Uint8Array(eager.media[0].data)], [1, 2, 3, 4, 5, 200, 100, 0]);
});

// ── 7. Version fence and prototype-pollution guard still fire on the lazy path

test('parseFlogLazy: file from a newer app is refused with the existing message', async () => {
  const futuristic = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({ format: 'FirearmLog', version: 99, stores: {}, mediaMeta: [] }))
  }]);
  const blob = new Blob([futuristic]);
  await assert.rejects(parseFlogLazy(blob), /NEWER version/);
});

test('parseFlogLazy: non-flog zip is refused with the existing message', async () => {
  const notFlog = writeZip([{ name: 'whatever.txt', data: new Uint8Array([1]) }]);
  const blob = new Blob([notFlog]);
  await assert.rejects(parseFlogLazy(blob), /isn't a FirearmLog data file/);
});

test('parseFlogLazy: __proto__ key in data.json does not pollute Object.prototype', async () => {
  const poisoned = JSON.stringify({
    format: 'FirearmLog', version: FLOG_VERSION, stores: {}, mediaMeta: [],
    __proto__: { polluted: true }
  });
  const zip = writeZip([{ name: 'data.json', data: new TextEncoder().encode(poisoned) }]);
  const blob = new Blob([zip]);
  // Should parse without throwing (the key is stripped, not rejected).
  const lazy = await parseFlogLazy(blob);
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
  assert.equal(lazy.mediaCount, 0);
});

test('parseFlogLazy: missing media entry is caught at open time, not during readMedia', async () => {
  // Build a data.json that claims a media entry, but omit it from the zip.
  const mediaMeta = [{ id: 'md-ghost-1', file: 'media/md-ghost-1', kind: 'image',
    createdAt: 1, updatedAt: 1, ownerType: 'firearm', ownerId: 'fa-1',
    name: 'Ghost', annotations: [], mime: 'image/jpeg' }];
  const json = JSON.stringify({ format: 'FirearmLog', version: FLOG_VERSION,
    exportedAt: 1, lastModified: 1, stores: {}, mediaMeta });
  const zip = writeZip([{ name: 'data.json', data: new TextEncoder().encode(json) }]);
  const blob = new Blob([zip]);
  // parseFlogLazy itself must throw — not lazily on readMedia.
  await assert.rejects(parseFlogLazy(blob), /damaged.*missing/i);
});

test('parseFlogLazy: missing data.json is refused with the existing message', async () => {
  const zip = writeZip([{ name: 'not-data.json', data: new Uint8Array([1]) }]);
  const blob = new Blob([zip]);
  await assert.rejects(parseFlogLazy(blob), /data\.json missing/);
});

// ── 8. The CR-4 reviver's effect, asserted directly on BOTH readers ───────────
//
// The pollution test above only checks that Object.prototype stayed clean. That
// is something JSON.parse already guarantees on its own, so that test would keep
// passing even if the reviver were deleted — it watches an outcome nothing can
// break. These assert the observable thing instead: a dangerous key that IS in
// the file is ABSENT from the parsed result. And they run it through both
// readers, because after session 114 both share one validator; if a later change
// gives either its own copy again, one of these two goes red.

function poisonedFlogZip(): Uint8Array<ArrayBuffer> {
  const json = '{"format":"FirearmLog","version":' + FLOG_VERSION +
    ',"exportedAt":1,"lastModified":1,"stores":{' +
    '"firearms":[{"id":"fa-1","__proto__":{"bad":1},"constructor":"x","prototype":"y"}],' +
    '"__proto__":[],"constructor":[],"prototype":[]},"mediaMeta":[]}';
  return writeZip([{ name: 'data.json', data: new TextEncoder().encode(json) }]);
}

test('parseFlog: dangerous keys are stripped from the parsed result, not merely harmless', () => {
  const snap = parseFlog(poisonedFlogZip());
  assert.deepEqual(Object.getOwnPropertyNames(snap.stores), ['firearms'],
    'the three dangerous store names must not survive parsing');
  const rec = (snap.stores.firearms as Record<string, unknown>[])[0];
  assert.deepEqual(Object.getOwnPropertyNames(rec), ['id'],
    'the three dangerous record keys must not survive parsing');
  assert.equal((Object.prototype as Record<string, unknown>).bad, undefined);
});

test('parseFlogLazy: strips the same dangerous keys as parseFlog', async () => {
  const blob = new Blob([poisonedFlogZip()]);
  const lazy = await parseFlogLazy(blob);
  assert.deepEqual(Object.getOwnPropertyNames(lazy.stores), ['firearms'],
    'the lazy reader must refuse the same keys as the eager one');
  const rec = (lazy.stores.firearms as Record<string, unknown>[])[0];
  assert.deepEqual(Object.getOwnPropertyNames(rec), ['id']);
  assert.equal((Object.prototype as Record<string, unknown>).bad, undefined);
});

// ── 9. The tolerant defaults survive the session-114 extraction ───────────────
//
// parseFlog used to inline its own validation and it forgave three omissions:
// no mediaMeta, no exportedAt, no lastModified. Session 114 moved that code into
// parseFlogDataJson so both readers share it, and an extraction is exactly the
// change that quietly drops a `?? []` — after which an older or hand-made file
// with no mediaMeta stops opening at all. Nothing else pinned these defaults, so
// this does.

test('parseFlog: a data.json with no mediaMeta / exportedAt / lastModified still opens', () => {
  const sparse = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({
      format: FLOG_FORMAT, version: FLOG_VERSION,
      stores: { firearms: [{ id: 'fa-sparse' }] }
    }))
  }]);
  const back = parseFlog(sparse);
  assert.deepEqual(back.media, [], 'missing mediaMeta must mean no media, not a crash');
  assert.equal(back.exportedAt, 0);
  assert.equal(back.lastModified, 0);
  assert.deepEqual(back.stores.firearms, [{ id: 'fa-sparse' }]);
});

test('parseFlogLazy: the same sparse file opens with the same defaults', async () => {
  const sparse = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({
      format: FLOG_FORMAT, version: FLOG_VERSION,
      stores: { firearms: [{ id: 'fa-sparse' }] }
    }))
  }]);
  const lazy = await parseFlogLazy(new Blob([sparse]));
  assert.equal(lazy.mediaCount, 0);
  assert.equal(lazy.exportedAt, 0);
  assert.equal(lazy.lastModified, 0);
});

// ── 10. A FlogMediaSource written with a method, not a closure ────────────────
//
// toMediaSources above builds `open` as an arrow function closing over m, so it
// never needed a receiver and hid a real defect: buildFlogBlob passed the bare
// function reference `m.open` through to the zip writer, which detached it. Any
// source written the other natural way — an object holding its own bytes and a
// method that reads `this` — returned undefined from open(), and the first sign
// of it was a TypeError thrown from inside crc32 during a backup. Pass 2 builds
// these sources from IndexedDB records, so that shape is coming.

test('buildFlogBlob: a media source whose open() uses `this` works', async () => {
  const bytes = new Uint8Array([9, 8, 7, 6, 5]) as Uint8Array<ArrayBuffer>;
  const source: FlogMediaSource = {
    id: 'md-this-1',
    meta: { id: 'md-this-1', createdAt: 1, updatedAt: 1, ownerType: 'firearm',
      ownerId: 'fa-1', kind: 'image', name: 'Method form', annotations: [],
      mime: 'image/jpeg', bytes },
    async open(): Promise<Uint8Array<ArrayBuffer>> {
      return (this.meta as { bytes: Uint8Array<ArrayBuffer> }).bytes;
    }
  };
  const blob = await buildFlogBlob({
    exportedAt: 1, lastModified: 1, stores: {}, media: [source]
  });
  const back = parseFlog(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(back.media.length, 1);
  assert.deepEqual([...new Uint8Array(back.media[0].data)], [9, 8, 7, 6, 5]);
});

// ── 11. Two readers, one answer, on files our writer would never produce ─────
//
// Both of these came from the session-114 cold audit's SECOND pass, and both are
// the same class of defect: the eager and lazy readers reaching different
// conclusions about the same untrusted bytes, with neither raising an error. A
// .flog can be handed to a user by anyone, so "which reader ran" must never
// decide what the logbook contains.

function zipWithTwoDataJson(): Uint8Array<ArrayBuffer> {
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  const first = { format: FLOG_FORMAT, version: FLOG_VERSION, exportedAt: 111,
    lastModified: 111, stores: {}, mediaMeta: [] };
  const second = { format: FLOG_FORMAT, version: FLOG_VERSION, exportedAt: 999,
    lastModified: 999, stores: { pwn: [] }, mediaMeta: [] };
  return writeZip([
    { name: 'data.json', data: enc(first) },
    { name: 'data.json', data: enc(second) },
  ]);
}

test('a .flog with two data.json entries is refused by both readers', async () => {
  const bytes = zipWithTwoDataJson();
  // Previously the eager reader took the first (exportedAt 111) and the lazy one
  // took the last (999, with an injected store), both reporting success. Making
  // them agree was the first fix; refusing is the better one, because agreement
  // is a convention and the convention broke twice.
  assert.throws(() => parseFlog(bytes), /contains the same item twice/);
  await assert.rejects(parseFlogLazy(new Blob([bytes])), /contains the same item twice/);
});

test('a .flog with two entries for the same photo is refused by both readers', async () => {
  // Round 3's finding: round 2's fix covered data.json only, and the media
  // lookup one line below still resolved last-wins in the eager reader and
  // first-wins in the lazy one. Same bytes, different photo, no error either
  // way — and reordering only the central directory flipped which reader saw
  // which image, so there was no structural tell.
  const meta = { id: 'md-1', file: 'media/a', kind: 'image', createdAt: 1,
    updatedAt: 1, ownerType: 'firearm', ownerId: 'fa-1', name: 'Dup',
    annotations: [], mime: 'image/jpeg' };
  const json = JSON.stringify({ format: FLOG_FORMAT, version: FLOG_VERSION,
    exportedAt: 1, lastModified: 1, stores: {}, mediaMeta: [meta] });
  const bytes = writeZip([
    { name: 'data.json', data: new TextEncoder().encode(json) },
    { name: 'media/a', data: new TextEncoder().encode('FIRST-BYTES') },
    { name: 'media/a', data: new TextEncoder().encode('SECOND-BYTES') },
  ]);
  assert.throws(() => parseFlog(bytes), /contains the same item twice/);
  await assert.rejects(parseFlogLazy(new Blob([bytes])), /contains the same item twice/);
});

test('a normal .flog with many distinct entries is unaffected by the duplicate check', async () => {
  const s = sampleSnapshot();
  const bytes = buildFlog(s);
  const eager = parseFlog(bytes);
  const lazy = await parseFlogLazy(new Blob([bytes]));
  assert.equal(eager.media.length, 1);
  assert.equal(lazy.mediaCount, 1);
});

test('a data.json whose mediaMeta is not a list is refused plainly by both readers', async () => {
  for (const bad of ['a string', 42, true, { nope: 1 }]) {
    const bytes = writeZip([{
      name: 'data.json',
      data: new TextEncoder().encode(JSON.stringify({
        format: FLOG_FORMAT, version: FLOG_VERSION, stores: {}, mediaMeta: bad
      }))
    }]);
    // A raw TypeError here would be a crash on the restore path, and a STRING is
    // iterable, which used to make the two readers disagree instead of refuse.
    assert.throws(() => parseFlog(bytes), /photo list inside is unreadable/,
      `eager reader accepted mediaMeta: ${JSON.stringify(bad)}`);
    await assert.rejects(parseFlogLazy(new Blob([bytes])), /photo list inside is unreadable/,
      `lazy reader accepted mediaMeta: ${JSON.stringify(bad)}`);
  }
});

test('a data.json with no mediaMeta at all is still fine under both readers', async () => {
  const bytes = writeZip([{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({
      format: FLOG_FORMAT, version: FLOG_VERSION, stores: {}
    }))
  }]);
  assert.deepEqual(parseFlog(bytes).media, []);
  assert.equal((await parseFlogLazy(new Blob([bytes]))).mediaCount, 0);
});

// ── 12. Round-3 findings ─────────────────────────────────────────────────────

test('a mediaMeta containing null (or any non-object) is refused plainly by both readers', async () => {
  for (const junk of [null, 42, 'media/a', [], true]) {
    const bytes = writeZip([{
      name: 'data.json',
      data: new TextEncoder().encode(JSON.stringify({
        format: FLOG_FORMAT, version: FLOG_VERSION, stores: {}, mediaMeta: [junk]
      }))
    }]);
    // null used to reach String(meta.file ?? '') as a raw TypeError in both
    // readers — consistent, but a crash rather than a message.
    assert.throws(() => parseFlog(bytes), /photo list inside is unreadable/,
      `eager reader accepted a ${JSON.stringify(junk)} element`);
    await assert.rejects(parseFlogLazy(new Blob([bytes])), /photo list inside is unreadable/,
      `lazy reader accepted a ${JSON.stringify(junk)} element`);
  }
});

test('LazyFlog.mediaMeta hands out copies with the internal file key stripped', async () => {
  const s = sampleSnapshot();
  const bytes = buildFlog(s);
  const lazy = await parseFlogLazy(new Blob([bytes]));
  assert.equal('file' in lazy.mediaMeta[0], false,
    'file is an archive detail, not part of a Media record — parseFlog strips it too');
  // Writing to the handed-out copy must not steer readMedia. It used to: the
  // live object was exposed, so setting .file changed which entry was read.
  (lazy.mediaMeta[0] as Record<string, unknown>).file = 'media/does-not-exist';
  const back = await lazy.readMedia(0);
  assert.deepEqual([...new Uint8Array(back.data)], [...new Uint8Array(s.media[0].data)]);
});

// ── 13. One name, computed once — and one deep copy ──────────────────────────
//
// Session 114's fourth audit round, rebuilt at session 117. Two writers were
// each deriving a photo's name TWICE: once for the ZIP entry (raw UTF-8 bytes)
// and once for meta.file inside data.json (a JSON string). Those two paths do
// not survive the same input, so the file could name the same photo two
// different ways and become unreadable — with the save reporting success and the
// damage surfacing at restore, months later.

const SURROGATE_ID = 'md-\uD800-1';

function snapshotWithMediaIds(ids: string[]): Snapshot {
  const media: Media[] = ids.map((id, i) => ({
    id, createdAt: 1000, updatedAt: 2000,
    ownerType: 'firearm', ownerId: 'fa-1', kind: 'image',
    name: `Photo ${i}`, annotations: [],
    mime: 'image/jpeg', data: new Uint8Array([i, i + 1, i + 2]).buffer,
  }));
  return { exportedAt: 10000, lastModified: 9000, stores: { firearms: [] }, media };
}

test('a photo id holding a lone surrogate still produces a READABLE backup (buildFlog)', () => {
  // A lone surrogate survives JSON intact but becomes U+FFFD once encoded as
  // UTF-8 bytes. Before the fix the entry was named media/md-<U+FFFD>-1 while
  // meta.file still said media/md-<D800>-1, so parseFlog refused its own
  // writer's file with "missing media/md-<D800>-1" — at restore, not at save.
  const s = snapshotWithMediaIds([SURROGATE_ID]);
  const bytes = buildFlog(s);
  const back = parseFlog(bytes);
  assert.equal(back.media.length, 1);
  assert.deepEqual([...new Uint8Array(back.media[0].data)], [0, 1, 2]);
});

test('a photo id holding a lone surrogate still produces a READABLE backup (buildFlogBlob)', async () => {
  const s = snapshotWithMediaIds([SURROGATE_ID]);
  const blob = await buildFlogBlob({
    exportedAt: s.exportedAt, lastModified: s.lastModified,
    stores: s.stores, media: toMediaSources(s.media),
  });
  const lazy = await parseFlogLazy(blob);
  assert.equal(lazy.mediaCount, 1);
  assert.deepEqual([...new Uint8Array((await lazy.readMedia(0)).data)], [0, 1, 2]);
  // And the streaming writer must agree with the eager one byte for byte, which
  // is the property that stops the two ever naming a photo differently.
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [...buildFlog(s)]);
});

test('neither writer emits two entries with one name — the repeated-id case', async () => {
  const s = snapshotWithMediaIds(['md-same', 'md-same']);
  assert.throws(() => buildFlog(s), /share the same id/);
  await assert.rejects(buildFlogBlob({
    exportedAt: s.exportedAt, lastModified: s.lastModified,
    stores: s.stores, media: toMediaSources(s.media),
  }), /share the same id/);
});

test('neither writer emits two entries with one name — two ids that ENCODE to one', async () => {
  // Distinct ids, one resulting name: two different lone surrogates both become
  // U+FFFD. indexByUniqueName refuses duplicate entry names in both readers, so
  // without this check a writer could emit a file its own reader will not open.
  const s = snapshotWithMediaIds(['md-\uD800-x', 'md-\uDC00-x']);
  assert.throws(() => buildFlog(s), /share the same id/);
  await assert.rejects(buildFlogBlob({
    exportedAt: s.exportedAt, lastModified: s.lastModified,
    stores: s.stores, media: toMediaSources(s.media),
  }), /share the same id/);
});

test('the collision message names both ids and the name they collide on', () => {
  // Round 5, finding 3. There is no screen anywhere that lists media ids, so a
  // message that says only "two photos share an id" leaves a library that can
  // never be saved again and nothing to look at. Name them.
  const s = snapshotWithMediaIds(['md-\uD800-x', 'md-\uDC00-x']);
  assert.throws(() => buildFlog(s), (err: unknown) => {
    const msg = String((err as Error).message);
    assert.match(msg, /md-\\ud800-x/i, 'the first id is not in the message');
    assert.match(msg, /md-\\udc00-x/i, 'the second id is not in the message');
    assert.match(msg, /media\/md-\uFFFD-x/, 'the colliding name is not in the message');
    assert.match(msg, /Nothing was saved/, 'the message must say nothing was written');
    return true;
  });
});

test('ordinary ids round-trip unchanged, and are written to disk verbatim', async () => {
  const s = snapshotWithMediaIds(['md-fa-1-0', 'md-se-2-1', 'md-fa-1-1']);
  const back = parseFlog(buildFlog(s));
  assert.deepEqual(back.media.map((m) => m.id), ['md-fa-1-0', 'md-se-2-1', 'md-fa-1-1']);
  const lazy = await parseFlogLazy(new Blob([buildFlog(s)]));
  assert.equal(lazy.mediaCount, 3);
  assert.deepEqual([...new Uint8Array((await lazy.readMedia(2)).data)], [2, 3, 4]);
  // Read the names back off the archive rather than asking our own reader what
  // it thinks they mean: every other assertion here would still pass if the
  // helper quietly prefixed or mangled every name, because writer and reader
  // would agree with each other about the wrong thing.
  assert.deepEqual(readZip(buildFlog(s)).map((e) => e.name),
    ['data.json', 'media/md-fa-1-0', 'media/md-se-2-1', 'media/md-fa-1-1']);
});

// ── 14. The copy LazyFlog hands out is DEEP, and it does not edit the numbers ──

function flogWithHandCraftedMeta(metaJson: string): Uint8Array<ArrayBuffer> {
  const json = `{"format":"${FLOG_FORMAT}","version":${FLOG_VERSION},"exportedAt":1,` +
    `"lastModified":1,"stores":{},"mediaMeta":[${metaJson}]}`;
  return writeZip([
    { name: 'data.json', data: new TextEncoder().encode(json) },
    { name: 'media/md-1', data: new Uint8Array([7, 7, 7]) },
  ]);
}

test('LazyFlog copies are deep — editing a nested field does not reach the reader', async () => {
  const bytes = flogWithHandCraftedMeta(
    '{"id":"md-1","file":"media/md-1","kind":"image","createdAt":1,"updatedAt":1,' +
    '"ownerType":"firearm","ownerId":"fa-1","name":"P","mime":"image/jpeg",' +
    '"annotations":[],"crop":{"x":1,"y":2}}');
  const lazy = await parseFlogLazy(new Blob([bytes]));
  const first = await lazy.readMedia(0);
  (first as unknown as { crop: { x: number } }).crop.x = 999;
  const second = await lazy.readMedia(0);
  assert.equal((second as unknown as { crop: { x: number } }).crop.x, 1,
    'a caller editing a nested field edited the reader\'s own retained state');
});

test('the mediaMeta LIST is deep too, not just what readMedia returns', async () => {
  // These are two separate copies made in two places, and an earlier version of
  // this section only proved one of them. Writing to the list and then reading
  // through readMedia is the only path that can tell them apart: a shallow list
  // copy shares its nested objects with the reader's retained state, so the edit
  // comes back out of readMedia as if it were what the file said.
  const bytes = flogWithHandCraftedMeta(
    '{"id":"md-1","file":"media/md-1","kind":"image","createdAt":1,"updatedAt":1,' +
    '"ownerType":"firearm","ownerId":"fa-1","name":"P","mime":"image/jpeg",' +
    '"annotations":[],"crop":{"x":1,"y":2}}');
  const lazy = await parseFlogLazy(new Blob([bytes]));
  (lazy.mediaMeta[0] as { crop: { x: number } }).crop.x = 999;
  const back = await lazy.readMedia(0) as unknown as { crop: { x: number } };
  assert.equal(back.crop.x, 1,
    'editing the handed-out list changed what readMedia reports the file contains');
});

test('the deep copy does not change the numbers — the two readers still agree', async () => {
  // Round 5, finding 1. The first version of this copy used
  // JSON.parse(JSON.stringify(x)), which cannot represent -0 or Infinity: the
  // eager reader returned -0 and Infinity, the lazy one 0 and null, and neither
  // raised a thing. That is the two-readers-disagree defect the whole branch
  // exists to close, reintroduced one layer down by the fix for it.
  const bytes = flogWithHandCraftedMeta(
    '{"id":"md-1","file":"media/md-1","kind":"image","createdAt":1,"updatedAt":1,' +
    '"ownerType":"firearm","ownerId":"fa-1","name":"P","mime":"image/jpeg",' +
    '"annotations":[],"rot":-0,"w":1e999}');
  const eager = parseFlog(bytes).media[0] as unknown as Record<string, unknown>;
  const lazy = await parseFlogLazy(new Blob([bytes]));
  const viaLazy = await lazy.readMedia(0) as unknown as Record<string, unknown>;

  assert.ok(Object.is(eager.rot, -0), 'the eager reader should give back -0');
  assert.ok(Object.is(viaLazy.rot, -0), 'the lazy reader flattened -0 to 0');
  assert.equal(eager.w, Infinity);
  assert.equal(viaLazy.w, Infinity, 'the lazy reader turned Infinity into null');
  assert.ok(Object.is(lazy.mediaMeta[0].rot, -0));
  assert.equal(lazy.mediaMeta[0].w, Infinity);
});

// ── 15. Golden bytes — something outside the code watches the wire format ─────
//
// Round 5, finding 4: the auditor appended '!GRATUITOUS' to every media entry
// name and the entire suite still passed, because the writer and the reader
// agree with each other. Every test above asks our own reader what our own
// writer meant, so none of them can see the file's actual shape change.
//
// This one pins the bytes themselves. It is the only test here that fails when
// the .flog wire format changes, and that is its whole job.
//
// WHEN IT GOES RED: decide which of the two things happened. If the format
// changed by ACCIDENT, the test has done its work — fix the writer. If it
// changed ON PURPOSE, then old files must still open, so bump FLOG_VERSION if
// readers can no longer be sure (see the fence at the top of flog.ts), confirm
// a file written by the PREVIOUS version still parses, and only then update
// GOLDEN_FLOG_B64 to the new bytes. Never update the constant first; updating
// it is the last step, after the compatibility question has an answer.

function goldenSnapshot(): Snapshot {
  const media: Media[] = [{
    id: 'md-golden-1', createdAt: 1000, updatedAt: 2000,
    ownerType: 'firearm', ownerId: 'fa-1', kind: 'image',
    name: 'Golden', annotations: ['a'],
    mime: 'image/jpeg', data: new Uint8Array([9, 8, 7, 6]).buffer,
  }];
  return {
    exportedAt: 1750000000000, lastModified: 1740000000000,
    stores: { firearms: [{ id: 'fa-1', name: 'G', createdAt: 1, updatedAt: 2 }] },
    media,
  };
}

// A ZIP records its modification time as DOS date and time fields derived from
// LOCAL time, so the same snapshot written in New York and in UTC differs in
// exactly those bytes and nowhere else. They are the one part of the file that
// is not a function of the records, so the comparison blanks them and pins
// everything else: names, order, sizes, CRCs, and the data.json text.
function blankZipTimestamps(bytes: Uint8Array): { bytes: Uint8Array; local: number; central: number } {
  const out = new Uint8Array(bytes);
  let local = 0;
  let central = 0;
  for (let i = 0; i + 16 <= out.length; i++) {
    if (out[i] !== 0x50 || out[i + 1] !== 0x4b) continue;
    if (out[i + 2] === 0x03 && out[i + 3] === 0x04) { out.fill(0, i + 10, i + 14); local++; }
    else if (out[i + 2] === 0x01 && out[i + 3] === 0x02) { out.fill(0, i + 12, i + 16); central++; }
  }
  return { bytes: out, local, central };
}

// Provenance, so this is a pin on the SHIPPED format rather than on whatever
// this branch happened to produce the day it was written: the same golden
// snapshot was built with b44283a's writer, the code live on Michael's phone
// before this branch existed, and the bytes are identical to these.
const GOLDEN_FLOG_B64 =
  'UEsDBBQAAAAAAAAAAACEKeT1dgEAAHYBAAAJAAAAZGF0YS5qc29ueyJmb3JtYXQiOiJGaXJlYXJt' +
  'TG9nIiwidmVyc2lvbiI6MiwiZXhwb3J0ZWRBdCI6MTc1MDAwMDAwMDAwMCwibGFzdE1vZGlmaWVk' +
  'IjoxNzQwMDAwMDAwMDAwLCJzdG9yZXMiOnsiZmlyZWFybXMiOlt7ImlkIjoiZmEtMSIsIm5hbWUi' +
  'OiJHIiwiY3JlYXRlZEF0IjoxLCJ1cGRhdGVkQXQiOjJ9XX0sIm1lZGlhTWV0YSI6W3siaWQiOiJt' +
  'ZC1nb2xkZW4tMSIsImNyZWF0ZWRBdCI6MTAwMCwidXBkYXRlZEF0IjoyMDAwLCJvd25lclR5cGUi' +
  'OiJmaXJlYXJtIiwib3duZXJJZCI6ImZhLTEiLCJraW5kIjoiaW1hZ2UiLCJuYW1lIjoiR29sZGVu' +
  'IiwiYW5ub3RhdGlvbnMiOlsiYSJdLCJtaW1lIjoiaW1hZ2UvanBlZyIsImZpbGUiOiJtZWRpYS9t' +
  'ZC1nb2xkZW4tMSJ9XX1QSwMEFAAAAAAAAAAAANzyffQEAAAABAAAABEAAABtZWRpYS9tZC1nb2xk' +
  'ZW4tMQkIBwZQSwECFAAUAAAAAAAAAAAAhCnk9XYBAAB2AQAACQAAAAAAAAAAAAAAAAAAAAAAZGF0' +
  'YS5qc29uUEsBAhQAFAAAAAAAAAAAANzyffQEAAAABAAAABEAAAAAAAAAAAAAAAAAnQEAAG1lZGlh' +
  'L21kLWdvbGRlbi0xUEsFBgAAAAACAAIAdgAAANABAAAAAA==';

test('golden .flog: the entry names on disk are exactly what we expect', () => {
  // The direct answer to the '!GRATUITOUS' mutation: names read out of the
  // written bytes, compared against literals, with no reader interpreting them.
  const names = readZip(buildFlog(goldenSnapshot())).map((e) => e.name);
  assert.deepEqual(names, ['data.json', 'media/md-golden-1']);
});

test('golden .flog: the bytes have not moved', () => {
  const written = buildFlog(goldenSnapshot());
  const { bytes, local, central } = blankZipTimestamps(written);
  // Two entries in, two local headers and two central directory records out. If
  // this ever fails, the blanking walked the wrong file and the comparison below
  // would be meaningless rather than merely red.
  assert.equal(local, 2, 'expected two local file headers');
  assert.equal(central, 2, 'expected two central directory records');
  assert.equal(Buffer.from(bytes).toString('base64'), GOLDEN_FLOG_B64,
    'the .flog wire format changed — read the note above this test before touching the constant');
});

test('golden .flog: the streaming writer produces the same bytes', async () => {
  const s = goldenSnapshot();
  const blob = await buildFlogBlob({
    exportedAt: s.exportedAt, lastModified: s.lastModified,
    stores: s.stores, media: toMediaSources(s.media),
  });
  const streamed = blankZipTimestamps(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(streamed.local, 2, 'expected two local file headers');
  assert.equal(streamed.central, 2, 'expected two central directory records');
  assert.equal(Buffer.from(streamed.bytes).toString('base64'), GOLDEN_FLOG_B64);
});

test('the archive timestamp is derived from exportedAt, in both writers', async () => {
  // The golden comparison BLANKS the ZIP date and time fields, because they are
  // built from local time and would otherwise differ between a machine in
  // Florida and one on CI. Nothing else looked at them, so both writers could
  // have stamped every backup 1980-01-01 with the suite still green — and a
  // folder of backups that cannot be sorted by date is a real loss on the day
  // someone needs the right one. This checks the fields RELATIVELY, which needs
  // no timezone: two different exportedAt values must produce different bytes,
  // and the same value must produce the same ones.
  const early = goldenSnapshot();
  const later = { ...goldenSnapshot(), exportedAt: goldenSnapshot().exportedAt + 86_400_000 };
  const stamp = (bytes: Uint8Array) => [...bytes.subarray(10, 14)].join(',');
  assert.notEqual(stamp(buildFlog(early)), stamp(buildFlog(later)),
    'the ZIP timestamp does not move when exportedAt does');
  assert.equal(stamp(buildFlog(early)), stamp(buildFlog(goldenSnapshot())));

  const streamed = new Uint8Array(await (await buildFlogBlob({
    exportedAt: later.exportedAt, lastModified: later.lastModified,
    stores: later.stores, media: toMediaSources(later.media),
  })).arrayBuffer());
  assert.equal(stamp(streamed), stamp(buildFlog(later)),
    'the two writers stamp the same snapshot differently');
});
