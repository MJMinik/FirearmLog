// P-5 source guard: saveToFile() in SyncCard.tsx must not allocate a second
// ArrayBuffer just to copy bytes into before handing to Blob. The fix passes
// the Uint8Array from buildFlog/writeZip directly to new Blob([...]).
//
// Memory behaviour itself is not directly observable in a unit test.
// This source-level grep is the only practical verification that the copy
// is gone — an oversold "BlobCopy was avoided" assertion that actually ran
// in a browser environment would still be appropriate, but this is what the
// node test runner can prove. (See comment in mediaGetAllFence.test.ts for
// the same reasoning applied to getAll('media').)
//
// Proven to fail: on the pre-fix tree this test would report the copy pattern
// IS present — the assertion `assert.equal(copyPresent, false)` would throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('P-5: SyncCard.tsx does not allocate a redundant ArrayBuffer copy before Blob construction', () => {
  const src = readFileSync('src/ui/SyncCard.tsx', 'utf8');
  // Check only non-comment lines — the comment explaining the fix quotes the old
  // pattern; the guard cares about executable code, not documentation.
  const codeLines = src.split('\n').filter((l) => !l.trimStart().startsWith('//'));
  const codeOnly = codeLines.join('\n');

  // The old code pattern: new ArrayBuffer(bytes.length) followed by set(bytes).
  const allocCopy = /new ArrayBuffer\(bytes\.length\)/.test(codeOnly);
  const setCopy = /new Uint8Array\(ab\)\.set\(bytes\)/.test(codeOnly);
  assert.equal(allocCopy, false,
    'SyncCard still has `new ArrayBuffer(bytes.length)` in executable code — redundant buffer copy was not removed');
  assert.equal(setCopy, false,
    'SyncCard still has `new Uint8Array(ab).set(bytes)` in executable code — redundant buffer copy was not removed');
  // Positive guard: the Blob must now take bytes directly.
  const directBlob = /new Blob\(\[bytes/.test(codeOnly);
  assert.equal(directBlob, true,
    'SyncCard must pass bytes directly to Blob — `new Blob([bytes` not found in executable code');
});
