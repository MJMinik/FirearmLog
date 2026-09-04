// Session 141, video-guards spec §3.2: pure logic for the library's size —
// the tally wrapper, the ready-sheet sentence, and the Sync & Backup status
// line. Fake FlogMediaSource objects stand in for the real ones (no
// IndexedDB, no zip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallySources, backupSummary, lastBackupLine } from '../src/lib/backupSize.ts';
import type { FlogMediaSource } from '../src/lib/flog.ts';

function fakeSource(id: string, kind: 'image' | 'video', bytes: number): FlogMediaSource {
  return {
    id,
    meta: { id, kind },
    open: async () => new Uint8Array(bytes) as Uint8Array<ArrayBuffer>,
  };
}

test('tallySources: sums total bytes across both kinds, and video bytes for video only', async () => {
  const sources = [
    fakeSource('md-1', 'image', 1000),
    fakeSource('md-2', 'video', 5000),
    fakeSource('md-3', 'image', 200),
    fakeSource('md-4', 'video', 3000),
  ];
  const tallied = tallySources(sources);
  // Nothing is read yet — the sizes only exist once each wrapped source has
  // actually been opened, same as the real save path.
  assert.deepEqual(tallied.sizes(), { total: 0, video: 0 });
  for (const s of tallied.sources) await s.open();
  assert.deepEqual(tallied.sizes(), { total: 1000 + 5000 + 200 + 3000, video: 5000 + 3000 });
});

test('tallySources: no video in the library leaves the video tally at 0', async () => {
  const sources = [fakeSource('md-1', 'image', 500), fakeSource('md-2', 'image', 700)];
  const tallied = tallySources(sources);
  for (const s of tallied.sources) await s.open();
  assert.deepEqual(tallied.sizes(), { total: 1200, video: 0 });
});

test('tallySources: the wrapped source still returns the same bytes the original would', async () => {
  const original = fakeSource('md-1', 'video', 12);
  const tallied = tallySources([original]);
  const bytes = await tallied.sources[0].open();
  assert.equal(bytes.byteLength, 12);
  assert.equal(tallied.sources[0].id, 'md-1');
  assert.deepEqual(tallied.sources[0].meta, { id: 'md-1', kind: 'video' });
});

const MB = 1024 * 1024;

test('backupSummary: the exact signed sentence when the backup holds video', () => {
  assert.equal(
    backupSummary(4, 12, 328 * MB, 296 * MB),
    '4 sessions and 12 photos/videos, packed and ready: 328 MB, of which 296 MB is video.'
  );
});

test('backupSummary: the ", of which… is video" clause is dropped entirely with no video', () => {
  assert.equal(
    backupSummary(4, 12, 40 * MB, 0),
    '4 sessions and 12 photos/videos, packed and ready: 40 MB.'
  );
});

test('backupSummary: no em dash in the signed copy (rule 44)', () => {
  assert.doesNotMatch(backupSummary(4, 12, 328 * MB, 296 * MB), /—/);
});

test('lastBackupLine: the exact signed line with video broken out', () => {
  const atMs = new Date(2026, 8, 3, 14, 0).getTime(); // 3 Sep 2026, local
  assert.equal(lastBackupLine(328 * MB, 296 * MB, atMs), 'Last backup: 328 MB (296 MB video), 3 Sep.');
});

test('lastBackupLine: the video parenthesis is dropped when video bytes are 0', () => {
  const atMs = new Date(2026, 8, 3, 14, 0).getTime();
  assert.equal(lastBackupLine(40 * MB, 0, atMs), 'Last backup: 40 MB, 3 Sep.');
});

// F6(d) (cold audit, session 141 fix pass 1): the two tests above only ever
// used a mid-afternoon time, so a mutation swapping getDate()/getMonth() for
// getUTCDate()/getUTCMonth() survived them undetected in this UTC sandbox
// AND on a real machine with a non-UTC clock (23:30 local sits on the OTHER
// side of the UTC day boundary from local for something like half the
// world's timezones, so a UTC mutation would show the wrong day/month there).
// HONEST LIMIT, stated rather than hidden: this sandbox's own runner is UTC
// (offset 0 — checked), so local and UTC agree here and this assertion alone
// cannot distinguish the two IN THIS ENVIRONMENT. It is still the correct
// assertion to have: it derives its expectation from the same local getters
// (getDate/getMonth via `new Date(y, m, d, h, mi)`, always local) that
// lastBackupLine is documented to use, so it (a) would catch the UTC
// mutation on any non-UTC runner and (b) still catches an off-by-one day or
// wrong-month bug regardless of timezone.
test('lastBackupLine: derives the date from LOCAL components (23:30 local, near a day boundary)', () => {
  const MONTHS_LOCAL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const at = new Date(2026, 8, 30, 23, 30); // 30 Sep 2026, 23:30 — local, by construction
  const expectedDate = `${at.getDate()} ${MONTHS_LOCAL[at.getMonth()]}`;
  assert.equal(lastBackupLine(40 * MB, 0, at.getTime()), `Last backup: 40 MB, ${expectedDate}.`);
});
