// Session 59: the coach-mark dismissal store (lib/coachMarks.ts).
// Small on purpose — the helpers are thin meta-store wrappers, but two things
// are worth machine-checking: dismissals MERGE (closing one mark can't
// resurrect another) and they survive a re-read (the "stays closed across
// visits" promise). Runs on fake-indexeddb like db.test.ts.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachMarkDismissals, dismissCoachMark } from '../src/lib/coachMarks.ts';
import { clearAllData } from '../src/lib/db.ts';

test('coach marks: dismissals persist and merge', async () => {
  assert.deepEqual(await coachMarkDismissals(), {}, 'a fresh install has no dismissals');

  await dismissCoachMark('gunSave');
  assert.deepEqual(await coachMarkDismissals(), { gunSave: true }, 'a dismissal persists');

  await dismissCoachMark('goalPick');
  assert.deepEqual(await coachMarkDismissals(), { gunSave: true, goalPick: true },
    'a second dismissal merges — it must not clobber the first');
});

test('coach marks: Clear All wipes dismissals, so a fresh start gets its guidance back', async () => {
  await dismissCoachMark('gunSave');
  await clearAllData();
  assert.deepEqual(await coachMarkDismissals(), {},
    'the wipe path (Clear All / the sample exit) resets guidance with the log');
});
