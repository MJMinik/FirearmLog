// P-1 fence: getAll('media') must never appear in src/ outside the allowed
// files. The allowed list is deliberately narrow, and is exactly two files:
//   - src/lib/db.ts            (the data layer itself — it owns the whole-store
//                               export path; every other whole-store use inside
//                               db.ts was replaced by a cursor in P-4/P-7/P-8)
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
// db.ts owns its own internals (exportSnapshot legitimately needs every byte).
// reportLaunch.ts loads the whole bundle for multi-record reports (P-1).
// PhotoCleanupCard.tsx was removed (P-7 fix): it now uses hasOversizedMedia,
// scanMediaImageIds, and getOne — the escape hatch is gone from that file.
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
