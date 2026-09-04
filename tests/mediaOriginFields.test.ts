// Session 141, video-guards spec §3.3 — the field-survival test the spec
// requires for Media's two new optional fields (origin, libraryId), plus the
// AppSettings round-trip for the two new backup-size numbers. Three paths a
// media record can travel, each proven to carry the fields through:
//  (a) buildFlog -> parseFlog (the .flog file itself)
//  (b) restoreSnapshot -> getMediaForOwner (a real load into IndexedDB)
//  (c) normalizeRecord (the read boundary every record passes through)
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlog, parseFlog } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';
import { restoreSnapshot, getMediaForOwner, getSettings, putSettings } from '../src/lib/db.ts';
import { normalizeRecord } from '../src/lib/recordShape.ts';
import type { Media, AppSettings } from '../src/lib/types.ts';

function mediaWithOrigin(id: string, ownerId: string): Media {
  return {
    id, createdAt: 1000, updatedAt: 2000,
    ownerType: 'firearm', ownerId, kind: 'image',
    name: 'Library still', annotations: [],
    mime: 'image/jpeg', data: new Uint8Array([9, 8, 7]).buffer,
    origin: 'stored', libraryId: 'lib-xyz',
  };
}

// (a) .flog round trip ───────────────────────────────────────────────────
test('field survival (a): origin and libraryId survive buildFlog -> parseFlog', () => {
  const snapshot: Snapshot = {
    exportedAt: 10_000, lastModified: 9000,
    stores: { firearms: [{ id: 'fa-origin-1', name: 'Origin Gun' }] },
    media: [mediaWithOrigin('md-origin-1', 'fa-origin-1')],
  };
  const bytes = buildFlog(snapshot);
  const back = parseFlog(bytes);
  assert.equal(back.media.length, 1);
  assert.equal(back.media[0].origin, 'stored');
  assert.equal(back.media[0].libraryId, 'lib-xyz');
});

// (b) a real restore into IndexedDB, read back the ordinary way ───────────
test('field survival (b): origin and libraryId survive restoreSnapshot -> getMediaForOwner', async () => {
  const snapshot: Snapshot = {
    exportedAt: 10_000, lastModified: 9000,
    stores: { firearms: [{ id: 'fa-origin-2', name: 'Origin Gun 2' }] },
    // A distinct ownerId from (a) — restoreSnapshot shares one in-memory
    // database across every test in this file, so the two must not collide.
    media: [mediaWithOrigin('md-origin-2', 'fa-origin-2')],
  };
  await restoreSnapshot(snapshot);
  const rows = await getMediaForOwner('firearm', 'fa-origin-2');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origin, 'stored');
  assert.equal(rows[0].libraryId, 'lib-xyz');
});

// (c) the read boundary ────────────────────────────────────────────────────
test('field survival (c): normalizeRecord leaves origin/libraryId untouched when present', () => {
  const record = mediaWithOrigin('md-origin-3', 'fa-origin-3');
  const normalized = normalizeRecord<Media>('media', record);
  assert.equal(normalized.origin, 'stored');
  assert.equal(normalized.libraryId, 'lib-xyz');
});

test('field survival (c): normalizeRecord never invents origin/libraryId when absent', () => {
  const record: Media = {
    id: 'md-origin-4', createdAt: 1000, updatedAt: 2000,
    ownerType: 'firearm', ownerId: 'fa-origin-4', kind: 'image',
    name: 'Plain photo', annotations: [], mime: 'image/jpeg',
    data: new Uint8Array([1]).buffer,
  };
  const normalized = normalizeRecord<Media>('media', record);
  assert.equal('origin' in normalized, false, 'origin must stay ABSENT, never filled with a default');
  assert.equal('libraryId' in normalized, false, 'libraryId must stay ABSENT, never filled with \'\'');
});

// ─── AppSettings round-trip of the two new backup-size numbers ────────────
test('AppSettings: lastBackupBytes / lastBackupVideoBytes round-trip through putSettings/getSettings', async () => {
  await putSettings<AppSettings>({ lastBackupAt: 5000, lastBackupBytes: 328_000_000, lastBackupVideoBytes: 296_000_000 });
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.lastBackupAt, 5000);
  assert.equal(settings?.lastBackupBytes, 328_000_000);
  assert.equal(settings?.lastBackupVideoBytes, 296_000_000);
});

test('AppSettings: a video-free backup can legitimately record 0, distinct from never-recorded (undefined)', async () => {
  await putSettings<AppSettings>({ lastBackupBytes: 40_000_000, lastBackupVideoBytes: 0 });
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.lastBackupVideoBytes, 0);
});
