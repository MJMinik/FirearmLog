import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlog, newestStamp, parseFlog, FLOG_FORMAT, FLOG_VERSION } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';
import { writeZip } from '../src/lib/zip.ts';
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
