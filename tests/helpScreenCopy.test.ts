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

// Findability memo (10 Sep 2026), decision 60 (4): the six Full Tour gaps.
// Each assertion checks a fragment specific enough that only the intended
// sentence can match, so a future edit that reworded the surrounding step
// without touching the new sentence would still pass.
test('Full Tour: a new Settings step covers the coaching switch, member numbers, and Manage lists', () => {
  assert.match(src, /title: 'Settings',/);
  assert.match(src, /view: \{ kind: 'settings' \}/);
  assert.match(src, /holds the coaching-remarks switch, the names and member numbers you shoot under so an import can find you, and Manage lists/);
});

test('Full Tour: "Compete — classifiers" points to How the numbers work as its own stop', () => {
  assert.match(src, /also its own stop under Training, reachable from More on a phone, the sidebar on a computer, or the Help menu/);
});

test('Full Tour: "Drills" covers Drill History\'s "View your history" entry point', () => {
  assert.match(src, /Open any drill and tap "View your history" to see your best, a trend chart, and every run you've logged — newest first\./);
});

test('Full Tour: "Optics, magazines & spare parts" covers the Parts Report', () => {
  assert.match(src, /Parts also prints — a Parts Report, a plain shelf list handy for insurance or for reordering\./);
});

test('Full Tour: "Ammo & costs" covers the general (non-ammo) purchase form', () => {
  assert.match(src, /tap "\+ Add Purchase" there to log a gear, training, or travel cost directly, same as ammo feeds in on its own\./);
});

test('Full Tour: the Setup & sample data step tells shooters the "Where do I find…" index exists', () => {
  assert.match(src, /This screen also holds a "Where do I find…" index/);
});

// Findability memo, decision 60 (3): the static "Where do I find…" index.
test('HelpScreen has a "Where do I find…" section listing every nav group', () => {
  assert.match(src, /<h2>Where do I find…<\/h2>/);
  for (const label of ['Home, Log, Compete & Progress', 'Your Gear', 'Training', 'Records', 'App & Data']) {
    assert.match(src, new RegExp(`label: '${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'`),
      `missing find-index group: ${label}`);
  }
});

test('every tappable "Where do I find…" row reuses the tours\' own jump mechanism (open)', () => {
  assert.match(src, /onClick=\{\(\) => open\(view\)\}/);
});
