// P-1 fence: getAll('media') must never appear in src/ outside the allowed
// files. The allowed list is deliberately narrow, and is exactly two files:
//   - src/lib/db.ts            (the data layer itself. CORRECTED session 118:
//                               it no longer owns "the whole-store export path",
//                               because the export moved to a cursor in pass 2.
//                               It is allow-listed because it DEFINES the escape
//                               hatch, not because any path of its own needs it.
//                               Note the cost of that: this allow-list is
//                               file-wide, so a NEW whole-store loader added to
//                               db.ts is invisible here. The completeness sweep
//                               in mediaLoadDiscipline.test.ts is what catches
//                               that, and it only started catching it in pass 2
//                               after a cold auditor walked through both guards
//                               at once.)
//   - src/ui/reportLaunch.ts   (the multi-owner report bundle, which cannot use
//                               the single-owner cursor — KNOWN OPEN ITEM: it
//                               loads every photo AND retains them in React
//                               state while the Reports screen is mounted, which
//                               is a bigger memory hazard than anything P-4/7/8
//                               fixed. Queued as its own item, session 114.)
// PhotoCleanupCard.tsx WAS on this list and is not any more: P-7 replaced its two
// whole-store loads with hasOversizedMedia (early-exit cursor probe) and
// runPhotoCleanup (id scan, then one record at a time).
// Every other caller must use getMediaForOwner (a cursor that never materialises
// all bytes in memory).
//
// A test that has never failed proves nothing. Proven on the pre-fix tree
// (76bd058): with reportLaunch.ts not yet in ALLOWED it listed exactly the
// 7 call sites the review named, and passed once they were swapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Files legitimately allowed to call getAll('media') or getAllMediaWholeStore.
// db.ts owns its own internals — it DEFINES getAllMediaWholeStore. (This said
// "exportSnapshot legitimately needs every byte", which stopped being true in
// pass 2: the backup is written one photo at a time and exportSnapshot is no
// longer on any user-facing path. A stale justification for an escape hatch is
// exactly what stops the next reader questioning the hatch.)
// reportLaunch.ts loads the whole bundle for multi-record reports (P-1).
// PhotoCleanupCard.tsx was removed (P-7 fix): it imports hasOversizedMedia for
// its mount probe and hands the run to runPhotoCleanup — the escape hatch is
// gone from that file.
const ALLOWED = new Set([
  'src/lib/db.ts',
  'src/ui/reportLaunch.ts',
]);

// Matches: getAll<...>('media') or getAll('media') — the string literal 'media'
// in a getAll call. The escape hatch is checked separately by bare identifier
// over the WHOLE file, so an aliased import ("import { getAllMediaWholeStore
// as x }") or a re-export is caught too, not just direct call sites.
const GETALL_MEDIA_RE = /\bgetAll(?:<[^>]*>)?\s*\(\s*['"]media['"]/;
const ESCAPE_HATCH_RE = /\bgetAllMediaWholeStore\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

test('no getAll("media") outside allowed files (P-1 fence)', () => {
  const offenders: string[] = [];
  for (const abs of walk('src')) {
    const rel = abs.replace(/\\/g, '/');
    // Normalise to the src-relative form used in ALLOWED.
    const key = rel.replace(/^.*\/(src\/)/, 'src/');
    if (ALLOWED.has(key)) continue;
    const src = readFileSync(abs, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (GETALL_MEDIA_RE.test(line) || ESCAPE_HATCH_RE.test(line)) {
        offenders.push(`${key}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `getAll('media') found outside allowed files — use getMediaForOwner:\n  ${offenders.join('\n  ')}`,
  );
});

// ---------------------------------------------------------------------------
// THE OPERATION, NOT JUST THE HELPER NAME (added session 118, after a cold
// auditor walked through both media guards at once).
//
// The fence above bans a HELPER NAME across src/ and one getAll spelling that
// takes 'media' as an argument. The completeness sweep in
// mediaLoadDiscipline.test.ts bans the whole-store OPERATION, but only inside
// db.ts. Neither of them sees raw IndexedDB in any other file — the store is
// named in transaction()/objectStore() rather than passed to getAll — so this,
// dropped into any screen, loaded every photo and video in the log and left the
// whole suite green:
//
//     const tx = open.result.transaction('media', 'readonly');
//     const req = tx.objectStore('media').getAll();
//
// Two guards, one shared blind spot, and the save path had just moved into it.
// This closes it: anywhere in src/, opening a media transaction and calling
// .getAll( on it is the banned operation, whatever the surrounding code is
// named. The allow-list is the same one, for the same reason.
// ---------------------------------------------------------------------------
const MEDIA_TX_RE = /transaction\(\s*(\[[^\]]*)?['"]media['"]/;

test('no raw whole-media-store read anywhere in src (P-1 fence, operation form)', () => {
  const offenders: string[] = [];
  for (const abs of walk('src')) {
    const key = abs.replace(/\\/g, '/').replace(/^.*\/(src\/)/, 'src/');
    if (ALLOWED.has(key)) continue;
    const src = readFileSync(abs, 'utf8');
    // Whole-file rather than line-by-line: opening the transaction and calling
    // getAll on it are two different lines in every real spelling of this.
    if (MEDIA_TX_RE.test(src) && /\.getAll\(/.test(src)) {
      offenders.push(key);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these files open a media transaction and call .getAll( on it — every photo and video would be in memory at once: ${offenders.join(', ')}`,
  );
});
