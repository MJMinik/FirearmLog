// The North Star seed guard tests. The four rules under test (northStar.ts):
// at most once per install; only once the log is real (>= 1 gun); an existing
// pin is never touched; "Start fresh" (Clear All) seeds again. The decision
// logic is pure (northStarAction) and each branch is covered directly; the
// orchestrator (ensureNorthStar) then runs against fake-indexeddb to prove the
// real reads/writes behave — including crash-retry idempotence via the fixed id.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  northStarAction,
  ensureNorthStar,
  NORTH_STAR_GOAL,
  NORTH_STAR_GOAL_ID,
} from '../src/lib/northStar.ts';
import {
  clearAllData,
  deleteOne,
  getAll,
  getSettings,
  putOne,
  putSettings,
  withExclusiveIo,
} from '../src/lib/db.ts';
import { stampNew } from '../src/lib/stamps.ts';
import type { AppSettings, Goal } from '../src/lib/types.ts';

// ---------- the pure decision, branch by branch ----------

test('decision: a seeded install never acts again, whatever else is true', () => {
  assert.equal(
    northStarAction({ seeded: true, gunCount: 3, goldenGoalId: undefined, goals: [] }),
    'none'
  );
  assert.equal(
    northStarAction({ seeded: true, gunCount: 3, goldenGoalId: 'go-1', goals: [{ id: 'go-1' }] }),
    'none'
  );
});

test('decision: an empty device (zero guns) stays genuinely empty', () => {
  assert.equal(
    northStarAction({ seeded: undefined, gunCount: 0, goldenGoalId: undefined, goals: [] }),
    'none'
  );
});

test('decision: a live existing pin is respected — mark seeded, add nothing', () => {
  assert.equal(
    northStarAction({ seeded: undefined, gunCount: 1, goldenGoalId: 'go-4', goals: [{ id: 'go-4' }] }),
    'mark'
  );
});

test('decision: a dangling pin (goal deleted) counts as no pin — seed', () => {
  // Dead pin, and no goals of their own left → a true newcomer state → seed.
  assert.equal(
    northStarAction({ seeded: undefined, gunCount: 1, goldenGoalId: 'go-gone', goals: [] }),
    'seed'
  );
});

test('decision: a real log with guns but no goals of its own gets the seed', () => {
  assert.equal(
    northStarAction({ seeded: undefined, gunCount: 2, goldenGoalId: undefined, goals: [] }),
    'seed'
  );
});

test('decision (R-H): guns + a goal of their own but no pin → none, never a surprise seed', () => {
  // The user already keeps goals — not a newcomer. Leave them untouched, and
  // do NOT mark seeded (so clearing their goals later can still seed them).
  assert.equal(
    northStarAction({ seeded: undefined, gunCount: 2, goldenGoalId: undefined, goals: [{ id: 'go-mine' }] }),
    'none'
  );
});

test('decision (R-H): only the seed goal present (crash mid-seed) still counts as a newcomer → seed', () => {
  // The half-written seed goal is not a "goal of their own"; the retry completes.
  assert.equal(
    northStarAction({ seeded: undefined, gunCount: 1, goldenGoalId: undefined, goals: [{ id: NORTH_STAR_GOAL_ID }] }),
    'seed'
  );
});

// ---------- the orchestrator against (fake) IndexedDB ----------

const aGun = (id: string) =>
  stampNew({ name: 'Test Pistol', manufacturer: '', model: '', caliber: '9mm' }, id, 1000);

async function wipe(): Promise<void> {
  await clearAllData();
}

test('seeds once a gun exists: creates the pinned goal, marks the install, reports a change', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  const created = await ensureNorthStar(1234);
  assert.equal(created, true);

  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1);
  assert.equal(goals[0].id, NORTH_STAR_GOAL_ID);
  assert.equal(goals[0].text, NORTH_STAR_GOAL.text);
  assert.equal(goals[0].category, NORTH_STAR_GOAL.category);
  assert.equal(goals[0].target, NORTH_STAR_GOAL.target);
  assert.equal(goals[0].achieved, false);

  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.northStarSeeded, true);
  assert.equal(settings?.goldenGoalId, NORTH_STAR_GOAL_ID);
});

test('at most once per install: deleting the seed is respected forever', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureNorthStar(1234), true);

  // The user deletes the starter goal and unpins it.
  await deleteOne('goals', NORTH_STAR_GOAL_ID);
  await putSettings<AppSettings>({ goldenGoalId: '' });

  // Every later check is a no-op — the goal never comes back.
  assert.equal(await ensureNorthStar(9999), false);
  assert.equal((await getAll<Goal>('goals')).length, 0);
});

test('zero guns: creates nothing and does NOT mark seeded (still eligible later)', async () => {
  await wipe();
  assert.equal(await ensureNorthStar(1234), false);
  assert.equal((await getAll<Goal>('goals')).length, 0);
  const settings = await getSettings<AppSettings>();
  assert.notEqual(settings?.northStarSeeded, true);
});

test('an existing pin is never touched: marks seeded, adds no goal — and unpinning later never surprises', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  const own = stampNew(
    { text: 'Reach USPSA A class', category: 'Classification', target: 'A in CO', achieved: false, dateSet: '2026-01-01', dateAchieved: '' },
    'go-mine',
    1000
  );
  await putOne('goals', own);
  await putSettings<AppSettings>({ goldenGoalId: 'go-mine' });

  assert.equal(await ensureNorthStar(1234), false); // mark only — nothing visible changed
  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1); // no second goal
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.northStarSeeded, true);
  assert.equal(settings?.goldenGoalId, 'go-mine'); // the pin is untouched

  // Unpinning after the mark can't summon the starter goal.
  await putSettings<AppSettings>({ goldenGoalId: '' });
  assert.equal(await ensureNorthStar(9999), false);
  assert.equal((await getAll<Goal>('goals')).length, 1);
});

test('crash-retry is idempotent: the fixed id overwrites, never duplicates', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  // Simulate a crash AFTER the goal write but BEFORE the settings write: the
  // goal record exists, the guard does not.
  const half = stampNew(
    { text: NORTH_STAR_GOAL.text, category: NORTH_STAR_GOAL.category, target: NORTH_STAR_GOAL.target, achieved: false, dateSet: '2026-07-08', dateAchieved: '' },
    NORTH_STAR_GOAL_ID,
    1000
  );
  await putOne('goals', half);

  assert.equal(await ensureNorthStar(2000), true); // the retry completes the seed
  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1); // overwritten in place — no duplicate
  const settings = await getSettings<AppSettings>();
  assert.equal(settings?.northStarSeeded, true);
  assert.equal(settings?.goldenGoalId, NORTH_STAR_GOAL_ID);
});

test('"Start fresh" seeds again: Clear All wipes the guard with everything else', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  assert.equal(await ensureNorthStar(1000), true);

  await clearAllData(); // the in-app "Clear all data / Start over"
  assert.equal((await getAll<Goal>('goals')).length, 0);

  // Empty again: no seed while the log isn't real…
  assert.equal(await ensureNorthStar(2000), false);
  assert.equal((await getAll<Goal>('goals')).length, 0);

  // …but the first gun of the new log seeds a fresh North Star.
  await putOne('firearms', aGun('fa-2'));
  assert.equal(await ensureNorthStar(3000), true);
  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1);
  assert.equal(goals[0].id, NORTH_STAR_GOAL_ID);
});

test('the seeded flag alone (no pin, no goal) still means never again', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  await putSettings<AppSettings>({ northStarSeeded: true });
  assert.equal(await ensureNorthStar(1234), false);
  assert.equal((await getAll<Goal>('goals')).length, 0);
});

test('R-H: an existing install with its own goal is left untouched — no seed, not marked', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));
  // A user who already keeps goals (e.g. upgrading into the feature, or a
  // restored backup) — but has NOT pinned one.
  const own = stampNew(
    { text: 'Shoot a match a month', category: 'Practice', target: '12 in 2026', achieved: false, dateSet: '2026-01-01', dateAchieved: '' },
    'go-mine',
    1000
  );
  await putOne('goals', own);

  assert.equal(await ensureNorthStar(1234), false); // nothing seeded
  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1);                    // only their own goal
  assert.equal(goals[0].id, 'go-mine');             // the North Star was NOT added
  const settings = await getSettings<AppSettings>();
  assert.notEqual(settings?.northStarSeeded, true); // one-shot not burned — still eligible later
});

test('R-G: the seed is refused while a restore holds the io-lock, then runs once it frees', async () => {
  await wipe();
  await putOne('firearms', aGun('fa-1'));

  // Hold the exclusive io-lock exactly as a restore/import would.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const restoreHolding = withExclusiveIo('a fake restore', () => held);

  // While the lock is held the seed must refuse and fail SAFE — no goal written.
  assert.equal(await ensureNorthStar(1234), false);
  assert.equal((await getAll<Goal>('goals')).length, 0);
  const mid = await getSettings<AppSettings>();
  assert.notEqual(mid?.northStarSeeded, true); // not marked either — still eligible

  // Release the lock; the next check seeds normally.
  release();
  await restoreHolding;
  assert.equal(await ensureNorthStar(2000), true);
  const goals = await getAll<Goal>('goals');
  assert.equal(goals.length, 1);
  assert.equal(goals[0].id, NORTH_STAR_GOAL_ID);
});
