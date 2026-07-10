// The setup goal tests (F10 — the wizard ASKS; the auto-seed is gone).
// Two halves: the pure decision (goalStepNeeded) branch by branch, then the
// writer (applySetupGoal) against fake-indexeddb — skip marks without writing,
// a chosen goal lands pinned+marked atomically, and the fixed id keeps a
// crash-retry idempotent (overwrites, never duplicates).
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySetupGoal,
  goalStepNeeded,
  NORTH_STAR_GOAL_ID,
  SETUP_GOAL_PRESETS,
} from '../src/lib/northStar.ts';
import {
  clearAllData,
  getAll,
  getSettings,
  putOne,
  putSettings,
} from '../src/lib/db.ts';
import { stampNew } from '../src/lib/stamps.ts';
import type { AppSettings, Goal } from '../src/lib/types.ts';

// ---------- the pure decision, branch by branch ----------

test('decision: an answered install (any answer, incl. the old auto-seed era) is never asked again', () => {
  assert.equal(
    goalStepNeeded({ seeded: true, gunCount: 3, goals: [] }),
    false
  );
});

test('decision: an empty device (zero guns) is not asked — the log is not real yet', () => {
  assert.equal(
    goalStepNeeded({ seeded: undefined, gunCount: 0, goals: [] }),
    false
  );
});

test('decision: an install with goals of its own (restored backup, upgrade) is not asked', () => {
  assert.equal(
    goalStepNeeded({ seeded: undefined, gunCount: 2, goals: [{ id: 'go-mine' }] }),
    false
  );
  // …including a leftover old starter goal — a goal is a goal.
  assert.equal(
    goalStepNeeded({ seeded: undefined, gunCount: 2, goals: [{ id: NORTH_STAR_GOAL_ID }] }),
    false
  );
});

test('decision: the true newcomer — guns, no goals, never answered — IS asked', () => {
  assert.equal(
    goalStepNeeded({ seeded: undefined, gunCount: 1, goals: [] }),
    true
  );
});

// ---------- the writer, against fake-indexeddb ----------

async function wipe(): Promise<void> {
  await clearAllData();
}

test('skip: marks the install answered and writes NO goal and NO pin', async () => {
  await wipe();
  await applySetupGoal({ kind: 'skip' }, 1234);

  assert.equal((await getAll<Goal>('goals')).length, 0);
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.northStarSeeded, true);
  assert.equal(settings?.goldenGoalId ?? '', '');
});

test('preset: creates the goal under the fixed id, pinned, and marks the install — one write', async () => {
  await wipe();
  const preset = SETUP_GOAL_PRESETS[0]; // Shoot tighter groups · Accuracy
  await applySetupGoal({ kind: 'goal', text: preset.text, category: preset.category }, 1234);

  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1);
  assert.equal(goals[0].id, NORTH_STAR_GOAL_ID);
  assert.equal(goals[0].text, preset.text);
  assert.equal(goals[0].category, preset.category);
  assert.equal(goals[0].target, '');
  assert.equal(goals[0].achieved, false);

  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.northStarSeeded, true);
  assert.equal(settings?.goldenGoalId, NORTH_STAR_GOAL_ID);
});

test('write my own: the text is stored verbatim with no category', async () => {
  await wipe();
  await applySetupGoal({ kind: 'goal', text: 'Bill Drill under 2.0 seconds' }, 1234);

  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1);
  assert.equal(goals[0].text, 'Bill Drill under 2.0 seconds');
  assert.equal(goals[0].category, '');
});

test('idempotent: a crash-retry double-write overwrites the same record, never duplicates', async () => {
  await wipe();
  await applySetupGoal({ kind: 'goal', text: 'Shoot tighter groups', category: 'Accuracy' }, 1000);
  await applySetupGoal({ kind: 'goal', text: 'Shoot tighter groups', category: 'Accuracy' }, 2000);

  assert.equal((await getAll<Goal>('goals')).length, 1);
});

test('after any answer, the decision says never ask again (the flag closes the loop)', async () => {
  await wipe();
  await applySetupGoal({ kind: 'skip' }, 1234);
  const settings = await getSettings<AppSettings>();
  assert.equal(
    goalStepNeeded({ seeded: settings?.northStarSeeded, gunCount: 5, goals: [] }),
    false
  );
});

test('preserves unrelated settings: the answer merges, never clobbers', async () => {
  await wipe();
  await putSettings<AppSettings>({ coachingRemarks: false });
  await applySetupGoal({ kind: 'skip' }, 1234);
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.coachingRemarks, false);
  assert.equal(settings?.northStarSeeded, true);
});

test('a user-created goal elsewhere is untouched by the setup write', async () => {
  await wipe();
  const own: Goal = stampNew(
    { text: 'Dry fire 3x a week', category: '', target: '', achieved: false, dateSet: '2026-07-01', dateAchieved: '' },
    'go-own', 500
  );
  await putOne('goals', own);
  await applySetupGoal({ kind: 'goal', text: 'Shoot tighter groups', category: 'Accuracy' }, 1000);

  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 2);
  assert.ok(goals.some((g) => g.id === 'go-own' && g.text === 'Dry fire 3x a week'));
});
