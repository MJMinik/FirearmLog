// F5 (cold audit, session 141 fix pass 1): the Full Tour's "Photos, captions
// & markup" step carried two hard-coded "100 MB" figures that would go
// stale the moment VIDEO_ASK_BYTES ever changes. HelpScreen.tsx is a .tsx
// file (JSX) and the node test runner's --experimental-strip-types only
// strips TYPES, not JSX syntax, so it cannot be imported/executed here
// (confirmed: `node --experimental-strip-types -e "import('./src/ui/HelpScreen.tsx')"`
// fails with "Unknown file extension"). Rather than skip the check entirely,
// this reads the file as TEXT and asserts on its source — the same
// convention tests/csvImportStore.test.ts already uses for ImportCsvScreen.tsx
// (see its `uiSource` helper).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/ui/HelpScreen.tsx', import.meta.url)), 'utf8');

test('HelpScreen imports humanBytes/VIDEO_ASK_BYTES rather than hard-coding the ask line', () => {
  assert.match(src, /import\s*\{\s*humanBytes,\s*VIDEO_ASK_BYTES\s*\}\s*from\s*'\.\.\/lib\/inputLimits\.ts';/);
});

test('the "Photos, captions & markup" step derives its figure via humanBytes(VIDEO_ASK_BYTES), twice', () => {
  const calls = [...src.matchAll(/\$\{humanBytes\(VIDEO_ASK_BYTES\)\}/g)];
  assert.equal(calls.length, 2, 'both the "over" and "under" sentences should derive the figure, not hard-code it');
});

test('no hard-coded "100 MB" is left anywhere in the tour source', () => {
  assert.doesNotMatch(src, /100 MB/, 'a literal "100 MB" would go stale the moment VIDEO_ASK_BYTES changes');
});

test('the Sync tour step no longer claims the video clause only shows when video is the BIGGER part', () => {
  assert.doesNotMatch(src, /bigger part of it/, 'the false qualifier must be gone, not just softened');
  assert.match(src, /the video part shown separately when there is any/);
});
