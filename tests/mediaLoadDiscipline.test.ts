// Source-level guards for the P-4 / P-7 / P-8 media-load discipline fixes.
//
// WHY GUARDS AT ALL. What these fixes changed is *peak memory*: the old code
// loaded every photo and video into memory to do a job that needed almost none
// of them. Node's test runner cannot observe that — fake-indexeddb holds the
// whole store in memory either way, so a cursor and a whole-store load produce
// identical results and identical measurable behaviour. The behavioural tests in
// db.test.ts and photoCleanupRun.test.ts prove the RESULTS are right; these
// guards are what prove the memory property, and they do it by reading the
// source.
//
// WHAT THE SESSION-114 AUDIT CHANGED HERE. The first version of this file
// scoped every guard to a call site — "localLastModified must not contain
// getAllMediaWholeStore" — which meant a violation planted one line deeper, in
// the helper that call site delegates to, sailed through green. The auditor
// proved it: replacing newestMediaStamp's whole body with a call to
// getAllMediaWholeStore left every one of these tests passing. So the guards now
// cover BOTH the call sites AND the bodies of the five cursor helpers those call
// sites depend on. The helper list is asserted to be complete against db.ts, so
// a seventh helper added tomorrow fails this file until it is guarded too.
//
// THE COMPLETENESS CHECK WAS ITSELF TOO NARROW (second audit, same session). It
// recognised a helper only if it was spelled `async function name()` and opened
// its transaction as `transaction('media'`. Three ordinary alternatives walked
// straight past it — `transaction(['media'], …)` (the list form this same file
// already uses elsewhere), `export const name = async () => {}`, and a function
// with a type parameter. All three were planted and the whole suite stayed green.
// The patterns below are deliberately loose for that reason: a guard that only
// catches one writing style is a guard that catches nothing in a year's time.
//
// WHAT THESE GUARDS STILL CANNOT PROVE. They are text checks. A new whole-store
// load written somewhere they do not look — a brand-new function in db.ts, or a
// clever indirection — is not caught here; mediaGetAllFence.test.ts is the wider
// net that catches getAll('media') anywhere in src/. Neither can see a load
// smuggled in through a variable holding the function. Stated plainly so nobody
// reads green here as more assurance than it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DB = readFileSync('src/lib/db.ts', 'utf8');

/**
 * Return the source text of one function, from its declaration to the brace that
 * closes it — counting braces rather than guessing at the next `export`, so a
 * guard cannot silently scope itself to the wrong span.
 */
function bodyOf(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.ok(start !== -1, `could not find "${decl}" — has it been renamed?`);
  // The opening brace of the BODY is the one at end of line. Taking the first
  // `{` instead would land inside an inline return type such as
  // `Promise<{ key: IDBValidKey }[]>` and scope the guard to the type — which is
  // exactly the mistake that made an earlier version of this file pass on code
  // it should have failed.
  const open = src.indexOf('{\n', start);
  assert.ok(open !== -1, `no opening brace after "${decl}"`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces after "${decl}"`);
}

// ---------------------------------------------------------------------------
// The cursor helpers — the list is checked for completeness below, so no count is
// written here (a hand-kept number is a fact with no keeper). Each one exists to
// walk the media store one record at a time. If any of them ever calls getAllMediaWholeStore, the whole point of
// the P-series work is undone at the root, and every call site inherits it.
// ---------------------------------------------------------------------------
const CURSOR_HELPERS = [
  'async function newestMediaStamp()',
  'async function scanMediaOwnerIds()',
  'async function scanMediaKeys()',
  'export async function scanMediaImageIds()',
  'export async function hasOversizedMedia(',
  'export async function getMediaForOwner(',
];

for (const decl of CURSOR_HELPERS) {
  const name = decl.match(/(?:async function|const)\s+(\w+)/)?.[1] ?? decl;
  test(`media discipline: ${name} walks the store with a cursor and never loads it whole`, () => {
    const body = bodyOf(DB, decl);
    assert.equal(
      body.includes('getAllMediaWholeStore'),
      false,
      `${name} calls getAllMediaWholeStore — it must walk the store with a cursor`,
    );
    assert.equal(
      body.includes('.getAll('),
      false,
      `${name} calls .getAll( — it must walk the store with a cursor`,
    );
    assert.ok(
      body.includes('openCursor()') || body.includes('openKeyCursor()'),
      `${name} opens no cursor — it cannot be reading one record at a time`,
    );
    // A cursor that is never advanced reads exactly one record and hangs or
    // silently under-reports; every walk must ask for the next record.
    assert.ok(
      body.includes('cursor.continue()'),
      `${name} never calls cursor.continue() — the walk would stop at the first record`,
    );
  });
}

// ---------------------------------------------------------------------------
// Completeness: the guarded list must be the WHOLE list. Any function in db.ts
// that opens a cursor on the media store has to appear above, or this fails —
// which is what stops a sixth helper being added next month with no guard.
// ---------------------------------------------------------------------------
test('media discipline: every media-store cursor helper in db.ts is guarded above', () => {
  // Any top-level function, however it is spelled: `function name(`,
  // `async function name<T>(`, or `const name = async (`.
  const DECL_RE = /^(export )?(async function \w+\s*[<(]|const \w+ = (async )?[(<])/;
  const declared = DB.split('\n').filter((l) => DECL_RE.test(l)).map((l) => l.trim());

  // Any spelling of opening a transaction that includes the media store:
  // transaction('media', …), transaction(['media'], …), transaction([...STORES, 'media'], …).
  const MEDIA_TX_RE = /transaction\(\s*(\[[^\]]*)?'media'/;
  const mediaCursorFns = declared.filter((decl) => {
    const body = bodyOf(DB, decl);
    return MEDIA_TX_RE.test(body) && (body.includes('openCursor(') || body.includes('openKeyCursor('));
  });

  const nameOf = (decl: string) => decl.match(/(?:async function|const)\s+(\w+)/)?.[1] ?? '';
  const guarded = new Set(CURSOR_HELPERS.map(nameOf));
  const unguarded = mediaCursorFns.map(nameOf).filter((n) => !guarded.has(n));
  assert.deepEqual(
    unguarded,
    [],
    `these db.ts functions open a media cursor but are not in CURSOR_HELPERS: ${unguarded.join(', ')}`,
  );
});

// ---------------------------------------------------------------------------
// P-4 call site: localLastModified must delegate to the cursor helper.
// Before the fix it called getAllMediaWholeStore() — loading every photo blob
// into memory purely to read timestamps off them.
// ---------------------------------------------------------------------------
test('P-4: localLastModified reads media stamps through the cursor helper', () => {
  const body = bodyOf(DB, 'export async function localLastModified()');
  assert.equal(body.includes('getAllMediaWholeStore'), false, 'localLastModified still loads the whole media store');
  assert.equal(body.includes('newestMediaStamp'), true, 'localLastModified must call newestMediaStamp');
});

// ---------------------------------------------------------------------------
// P-7 call sites: neither the card nor the run loop may load the whole store.
// The run loop now lives in photoCleanupRun.ts (lifted out of the component so
// it could be tested for real — see photoCleanupRun.test.ts).
// ---------------------------------------------------------------------------
test('P-7: PhotoCleanupCard.tsx never loads the whole media store', () => {
  const src = readFileSync('src/ui/PhotoCleanupCard.tsx', 'utf8');
  assert.equal(src.includes('getAllMediaWholeStore'), false, 'PhotoCleanupCard.tsx still loads the whole media store');
  assert.equal(src.includes('hasOversizedMedia'), true, 'the mount probe must be the early-exit cursor probe');
  assert.equal(src.includes('runPhotoCleanup'), true, 'the run pass must go through runPhotoCleanup');
});

test('P-7: the run loop scans ids and fetches one photo at a time', () => {
  const src = readFileSync('src/ui/photoCleanupRun.ts', 'utf8');
  assert.equal(src.includes('getAllMediaWholeStore'), false, 'the run loop still loads the whole media store');
  assert.equal(src.includes('scanMediaImageIds'), true, 'the run loop must scan ids with the cursor helper');
  assert.equal(src.includes("getOne<Media>('media'"), true, 'the run loop must read each photo back individually');
});

// ---------------------------------------------------------------------------
// P-8 call sites: the two delete-stale-media paths. Both used to load every
// photo blob just to read ids off the records.
// ---------------------------------------------------------------------------
test('P-8: the import commit delete-stale path reads ids, not blobs', () => {
  const marker = '// …then remove superseded photos for the re-written owners';
  const start = DB.indexOf(marker);
  assert.ok(start !== -1, 'add-before-delete comment not found in db.ts');
  const end = DB.indexOf('\nexport async function getSettings', start);
  assert.ok(end !== -1, 'could not bound the import-commit delete block');
  const block = DB.slice(start, end);
  assert.equal(block.includes('getAllMediaWholeStore'), false, 'import commit still loads the whole media store');
  assert.equal(block.includes('scanMediaOwnerIds'), true, 'import commit must use scanMediaOwnerIds');
});

test('P-8: the restore delete-stale path reads keys only', () => {
  const marker = "// …then remove anything that isn't in the new set. The store is never empty.";
  const start = DB.indexOf(marker);
  assert.ok(start !== -1, 'restore delete-stale comment not found in db.ts');
  const end = DB.indexOf('\n/**', start);
  assert.ok(end !== -1, 'could not bound the restore delete block');
  const block = DB.slice(start, end);
  assert.equal(block.includes('getAllMediaWholeStore'), false, 'restore still loads the whole media store');
  assert.equal(
    block.includes('scanMediaKeys'),
    true,
    'restore must use scanMediaKeys — it needs only keys, so it reads no record values at all',
  );
});
