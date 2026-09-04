// Behavioural tests for the Free Up Space run loop (P-7).
//
// WHY THIS FILE EXISTS. The session-114 audit found the rewritten loop had no
// behavioural coverage at all: it lived inside PhotoCleanupCard, a React
// component the node test runner cannot mount, so the only thing watching it was
// a source-level grep. The auditor proved what that costs — flipping
// `if (!m) continue;` to `if (m) continue;`, which turns the entire cleanup into
// a no-op that cheerfully reports "shrank 0 photos", left all 1092 tests green.
// The loop was therefore lifted into photoCleanupRun.ts with the image encoder
// passed in as an argument, so a test can supply a stub encoder and drive the
// real loop against a real (in-memory) database.
//
// This is the user's REAL photo library being rewritten in place, so the
// properties below are the ones that matter: the right photos are touched, the
// bytes actually change, nothing is made bigger, ids and references survive, and
// a photo that vanishes mid-run is skipped rather than crashing the pass.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPhotoCleanup } from '../src/ui/photoCleanupRun.ts';
import { clearAllData, putOne, getOne, deleteOne, getAllMediaWholeStore } from '../src/lib/db.ts';
import type { Media } from '../src/lib/types.ts';

function photo(id: string, bytes: number, over: Partial<Media> = {}) {
  return {
    id, ownerType: 'firearm', ownerId: 'g1', kind: 'image', name: `${id}.jpg`,
    annotations: [], mime: 'image/jpeg', data: new ArrayBuffer(bytes),
    updatedAt: 1, createdAt: 0, ...over,
  } as unknown as Media;
}

/** A stub encoder that always returns `factor` of the original size. */
const shrinkBy = (factor: number) => async (data: ArrayBuffer, mime: string) =>
  ({ data: new ArrayBuffer(Math.floor(data.byteLength * factor)), mime });

const noProgress = () => {};

test('P-7 run: every image is re-encoded and the smaller bytes are written back', async () => {
  await clearAllData();
  await putOne('media', photo('md-a', 1_000));
  await putOne('media', photo('md-b', 2_000));

  const result = await runPhotoCleanup(shrinkBy(0.5), noProgress, () => 42);

  assert.equal(result.shrunk, 2, 'both photos reported as shrunk');
  assert.equal(result.savedBytes, 500 + 1_000, 'saved bytes is the real difference, summed');

  const a = await getOne<Media>('media', 'md-a');
  const b = await getOne<Media>('media', 'md-b');
  assert.equal(a?.data.byteLength, 500, 'md-a was actually rewritten smaller on disk');
  assert.equal(b?.data.byteLength, 1_000, 'md-b was actually rewritten smaller on disk');
  assert.equal(a?.updatedAt, 42, 'the rewritten record carries the new update stamp');
});

test('P-7 run: a re-encode that is not smaller is discarded, never written', async () => {
  await clearAllData();
  await putOne('media', photo('md-same', 1_000));

  // An encoder that returns the SAME size — common for an already-optimised JPEG.
  const result = await runPhotoCleanup(async (d, mime) => ({ data: new ArrayBuffer(d.byteLength), mime }), noProgress);

  assert.equal(result.shrunk, 0, 'nothing counted as shrunk');
  assert.equal(result.savedBytes, 0, 'no bytes claimed as saved');
  const m = await getOne<Media>('media', 'md-same');
  assert.equal(m?.updatedAt, 1, 'the record was not rewritten — its stamp is untouched');
});

test('P-7 run: a re-encode that is LARGER is discarded — the photo is never made worse', async () => {
  await clearAllData();
  await putOne('media', photo('md-worse', 1_000));

  const result = await runPhotoCleanup(async (d, mime) => ({ data: new ArrayBuffer(d.byteLength * 3), mime }), noProgress);

  assert.equal(result.shrunk, 0, 'nothing counted as shrunk');
  const m = await getOne<Media>('media', 'md-worse');
  assert.equal(m?.data.byteLength, 1_000, 'the original bytes are still on disk');
});

test('P-7 run: videos are never touched', async () => {
  await clearAllData();
  await putOne('media', photo('md-vid', 5_000, { kind: 'video', mime: 'video/mp4' }));

  let called = 0;
  const result = await runPhotoCleanup(async (d, mime) => { called++; return shrinkBy(0.5)(d, mime); }, noProgress);

  assert.equal(called, 0, 'the encoder was never asked to touch a video');
  assert.equal(result.shrunk, 0);
  const m = await getOne<Media>('media', 'md-vid');
  assert.equal(m?.data.byteLength, 5_000, 'the video is byte-for-byte unchanged');
});

test('P-7 run: the record keeps its id and every other field, so references survive', async () => {
  await clearAllData();
  await putOne('media', photo('md-keep', 1_000, { ownerId: 'gun-7', ownerType: 'firearm', name: 'target.jpg' }));

  await runPhotoCleanup(shrinkBy(0.25), noProgress, () => 99);

  const all = await getAllMediaWholeStore();
  assert.equal(all.length, 1, 'still exactly one record — nothing was added or removed');
  const m = all[0];
  assert.equal(m.id, 'md-keep', 'same id: a gun photoId or drill targetMediaId still resolves');
  assert.equal(m.ownerId, 'gun-7', 'owner preserved');
  assert.equal(m.name, 'target.jpg', 'name preserved');
  assert.equal(m.createdAt, 0, 'created stamp preserved');
});

// F6(e) (cold audit, session 141 fix pass 1): the rewrite spreads the whole
// record ({ ...m, data, mime }), so Media's two video-guards fields
// (origin/libraryId — src/lib/types.ts, deliberately absent from
// recordShape.ts's shape map) should ride along like any other field. Proven
// directly rather than assumed.
test('P-7 run: origin and libraryId survive the rewrite, when present', async () => {
  await clearAllData();
  await putOne('media', photo('md-origin', 1_000, { origin: 'stored', libraryId: 'lib-99' }));

  await runPhotoCleanup(shrinkBy(0.5), noProgress, () => 55);

  const m = await getOne<Media>('media', 'md-origin');
  assert.equal(m?.data.byteLength, 500, 'sanity: the rewrite actually ran');
  assert.equal(m?.origin, 'stored', 'origin survives the rewrite');
  assert.equal(m?.libraryId, 'lib-99', 'libraryId survives the rewrite');
});

test('P-7 run: a photo deleted between the scan and its turn is skipped, not a crash', async () => {
  await clearAllData();
  // Ids come back from the scan in key order, so md-a is processed first and
  // md-z last. Deleting md-z while md-a is being encoded reproduces exactly the
  // real-world window: the scan listed it, then it went away before its turn.
  await putOne('media', photo('md-a', 1_000));
  await putOne('media', photo('md-z', 1_000));

  let deleted = false;
  const shrink = async (d: ArrayBuffer, mime: string) => {
    if (!deleted) { deleted = true; await deleteOne('media', 'md-z'); }
    return shrinkBy(0.5)(d, mime);
  };
  const result = await runPhotoCleanup(shrink, noProgress);

  assert.ok(deleted, 'the test actually removed md-z mid-run');
  assert.equal(result.shrunk, 1, 'only the surviving photo counted — the vanished one was skipped');
  const a = await getOne<Media>('media', 'md-a');
  assert.equal(a?.data.byteLength, 500, 'md-a was rewritten despite md-z vanishing');
  assert.equal(await getOne<Media>('media', 'md-z'), undefined, 'md-z is gone and was not resurrected');
});

test('P-7 run: progress is reported once per photo, in order, with the real total', async () => {
  await clearAllData();
  for (const id of ['md-1', 'md-2', 'md-3']) await putOne('media', photo(id, 1_000));

  const seen: [number, number][] = [];
  await runPhotoCleanup(shrinkBy(0.5), (done, total) => seen.push([done, total]));

  assert.equal(seen.length, 3, 'one progress report per photo');
  assert.deepEqual(seen.map((s) => s[0]), [0, 1, 2], 'progress counts up');
  assert.ok(seen.every((s) => s[1] === 3), 'total is the real number of photos');
});

test('P-7 run: an empty library is a clean no-op, not an error', async () => {
  await clearAllData();
  const result = await runPhotoCleanup(shrinkBy(0.5), noProgress);
  assert.deepEqual(result, { shrunk: 0, savedBytes: 0 });
});

// Second audit, session 114: a damaged record used to abort the entire pass.
// Seeding three photos where the middle one had no bytes killed the run with raw
// programmer text on screen — the first photo was shrunk, the third never
// touched, and the user saw a TypeError. One bad record must not cost the rest.
test('P-7 run: a photo record with no bytes is skipped, and the run continues past it', async () => {
  await clearAllData();
  await putOne('media', photo('md-1', 1_000));
  await putOne('media', { id: 'md-2', ownerType: 'firearm', ownerId: 'g1', kind: 'image',
    name: 'broken.jpg', annotations: [], mime: 'image/jpeg', updatedAt: 1, createdAt: 0 } as unknown as Media);
  await putOne('media', photo('md-3', 1_000));

  const result = await runPhotoCleanup(shrinkBy(0.5), noProgress);

  assert.equal(result.shrunk, 2, 'both healthy photos were processed');
  const third = await getOne<Media>('media', 'md-3');
  assert.equal(third?.data.byteLength, 500, 'the photo AFTER the damaged one was still reached');
});
