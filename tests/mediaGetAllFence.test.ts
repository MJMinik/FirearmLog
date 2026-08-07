// P-1 fence: getAll('media') must never appear in src/ outside the allowed
// files. The allowed list is deliberately narrow:
//   - src/lib/db.ts          (the data layer — internal whole-store ops: import,
//                             export, restore, cleanup; not re-exported as getAll)
//   - src/ui/PhotoCleanupCard.tsx (P-7 — whole-store cleanup, gets its own fix
//                             later; explicitly excluded here so its treatment
//                             is tracked, not silently overlooked)
// These files (plus reportLaunch.ts, whose multi-owner report bundle cannot use
// a single-owner cursor — its whole-store load is tracked with P-7) use the
// getAllMediaWholeStore escape hatch (or internal access) and are the ONLY
// files permitted to load the whole media store at once.
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
// db.ts owns its own internals; PhotoCleanupCard.tsx is tracked for P-7.
// reportLaunch.ts loads the whole bundle for multi-record reports (P-1).
const ALLOWED = new Set([
  'src/lib/db.ts',
  'src/ui/PhotoCleanupCard.tsx',
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
