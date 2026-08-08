// Source-level guards for the P-4/P-7/P-8 media-load discipline fixes.
// Memory behaviour itself is not directly observable in a unit test — these
// grep-based guards are the practical substitute. They prove that the old
// whole-store call patterns are absent from the functions that were fixed,
// and that the cursor-based replacements are present.
// Each guard is stated with what it proves and what it cannot prove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// P-4: localLastModified in db.ts must NOT call getAllMediaWholeStore.
// Before the fix localLastModified called getAllMediaWholeStore() which loaded
// every photo blob into memory just to read timestamps.
// After the fix it calls newestMediaStamp() — a cursor that reads only the
// updatedAt field and never retains the record.
// ---------------------------------------------------------------------------
test('P-4: localLastModified does not call getAllMediaWholeStore (source guard)', () => {
  const src = readFileSync('src/lib/db.ts', 'utf8');

  // Isolate the localLastModified function body (between its export line and
  // the next exported declaration), then verify the call is absent.
  const fnStart = src.indexOf('export async function localLastModified()');
  assert.ok(fnStart !== -1, 'localLastModified function not found in db.ts');
  // Find the next export after it so we scope the search.
  const fnEnd = src.indexOf('\nexport ', fnStart + 1);
  const fnBody = fnEnd === -1 ? src.slice(fnStart) : src.slice(fnStart, fnEnd);

  assert.equal(
    fnBody.includes('getAllMediaWholeStore'),
    false,
    'localLastModified still calls getAllMediaWholeStore — P-4 fix not applied',
  );
  assert.equal(
    fnBody.includes('newestMediaStamp'),
    true,
    'localLastModified must call newestMediaStamp after P-4 fix',
  );
});

// ---------------------------------------------------------------------------
// P-7: PhotoCleanupCard.tsx must NOT call getAllMediaWholeStore at all.
// Before the fix both the mount probe and the run pass called it, loading every
// photo and video blob to do jobs that needed almost none of them.
// ---------------------------------------------------------------------------
test('P-7: PhotoCleanupCard.tsx does not call getAllMediaWholeStore (source guard)', () => {
  const src = readFileSync('src/ui/PhotoCleanupCard.tsx', 'utf8');
  assert.equal(
    src.includes('getAllMediaWholeStore'),
    false,
    'PhotoCleanupCard.tsx still calls getAllMediaWholeStore — P-7 fix not applied',
  );
  // Positive: the cursor-based probe and id-scan must be present.
  assert.equal(
    src.includes('hasOversizedMedia'),
    true,
    'PhotoCleanupCard.tsx must use hasOversizedMedia for the mount probe',
  );
  assert.equal(
    src.includes('scanMediaImageIds'),
    true,
    'PhotoCleanupCard.tsx must use scanMediaImageIds for the run pass',
  );
});

// ---------------------------------------------------------------------------
// P-8: the two delete-stale-media paths in db.ts must NOT call
// getAllMediaWholeStore. Before the fix both called it and loaded every photo
// blob just to read ids. After the fix they call scanMediaOwnerIds, which
// the cursor keeps private to db.ts (not exported).
// We check absence of the old call by scoping to each function body.
// ---------------------------------------------------------------------------
test('P-8: commitDataSet delete-stale path does not call getAllMediaWholeStore (source guard)', () => {
  const src = readFileSync('src/lib/db.ts', 'utf8');

  // The delete-stale block in commitDataSet ends with the closing `}` for that
  // inline block. The easiest safe scope: from the comment that marks the
  // add-before-delete stanza to the end of the commitDataSet function.
  const marker = '// …then remove superseded photos for the re-written owners';
  const blockStart = src.indexOf(marker);
  assert.ok(blockStart !== -1, 'add-before-delete comment not found in db.ts');
  // Find next top-level exported function after the block.
  const blockEnd = src.indexOf('\nexport async function getSettings', blockStart);
  assert.ok(blockEnd !== -1, 'could not bound the commitDataSet delete block');
  const block = src.slice(blockStart, blockEnd);

  assert.equal(
    block.includes('getAllMediaWholeStore'),
    false,
    'commitDataSet delete-stale path still calls getAllMediaWholeStore — P-8 fix not applied',
  );
  assert.equal(
    block.includes('scanMediaOwnerIds'),
    true,
    'commitDataSet delete-stale path must use scanMediaOwnerIds after P-8 fix',
  );
});

test('P-8: restoreSnapshotInner delete-stale path does not call getAllMediaWholeStore (source guard)', () => {
  const src = readFileSync('src/lib/db.ts', 'utf8');

  // The delete-stale block in restoreSnapshotInner.
  const marker = '// …then remove anything that isn\'t in the new set. The store is never empty.';
  const blockStart = src.indexOf(marker);
  assert.ok(blockStart !== -1, 'restore delete-stale comment not found in db.ts');
  const blockEnd = src.indexOf('\n/**', blockStart);
  assert.ok(blockEnd !== -1, 'could not bound the restoreSnapshotInner delete block');
  const block = src.slice(blockStart, blockEnd);

  assert.equal(
    block.includes('getAllMediaWholeStore'),
    false,
    'restoreSnapshotInner delete-stale path still calls getAllMediaWholeStore — P-8 fix not applied',
  );
  assert.equal(
    block.includes('scanMediaOwnerIds'),
    true,
    'restoreSnapshotInner delete-stale path must use scanMediaOwnerIds after P-8 fix',
  );
});
