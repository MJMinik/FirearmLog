import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonthsToDay, advanceDueDate, buildReminderContext, comingUpReminders, completionPatch,
  daysBetween, dueReminders, homeComingUp, inactiveNote, inactiveReminders, laterReminders,
  reminderIdsForGun, reminderView, reminderViews,
} from '../src/lib/reminders.ts';
import type { ReminderContext } from '../src/lib/reminders.ts';
import type { Firearm, Reminder } from '../src/lib/types.ts';

const TODAY = '2026-07-15';

function rem(over: Partial<Reminder> = {}): Reminder {
  return {
    id: over.id ?? 'rm-1', createdAt: 0, updatedAt: 0,
    title: 'Test reminder', notes: '', source: 'custom', trigger: 'date',
    enabled: true, ...over,
  };
}

function ctx(rounds: number | null = 0): ReminderContext {
  return { today: TODAY, roundsForGun: () => rounds, gunName: () => 'Test Gun' };
}

// ---- date urgency ----

test('date reminder: overdue, due today, soon, and later', () => {
  assert.equal(reminderView(rem({ trigger: 'date', dueDate: '2026-07-10' }), ctx()).level, 'due');   // -5 days
  assert.equal(reminderView(rem({ trigger: 'date', dueDate: TODAY }), ctx()).level, 'due');          // today
  assert.equal(reminderView(rem({ trigger: 'date', dueDate: '2026-07-30' }), ctx()).level, 'soon');  // +15
  assert.equal(reminderView(rem({ trigger: 'date', dueDate: '2026-09-20' }), ctx()).level, 'later'); // +67
});

test('date reminder detail reads plainly for each case', () => {
  assert.equal(reminderView(rem({ trigger: 'date', dueDate: TODAY }), ctx()).detail, 'Due today');
  assert.match(reminderView(rem({ trigger: 'date', dueDate: '2026-07-10' }), ctx()).detail, /Overdue by 5 days/);
  assert.match(reminderView(rem({ trigger: 'date', dueDate: '2026-07-16' }), ctx()).detail, /^In 1 day ·/);
});

test('a date reminder with no date is inactive, never a crash', () => {
  assert.equal(reminderView(rem({ trigger: 'date', dueDate: null }), ctx()).level, 'inactive');
});

// ---- round urgency ----

test('round reminder: due at/over interval, soon within horizon, later beyond', () => {
  const base = { trigger: 'rounds' as const, firearmId: 'fa-1', everyRounds: 5000, baselineRounds: 0 };
  assert.equal(reminderView(rem(base), ctx(5000)).level, 'due');   // remaining 0
  assert.equal(reminderView(rem(base), ctx(5200)).level, 'due');   // past
  assert.equal(reminderView(rem(base), ctx(4600)).level, 'soon');  // remaining 400 (<=500)
  assert.equal(reminderView(rem(base), ctx(3000)).level, 'later'); // remaining 2000
});

test('round reminder measures from the baseline, not the raw count', () => {
  const r = rem({ trigger: 'rounds', firearmId: 'fa-1', everyRounds: 5000, baselineRounds: 2000 });
  assert.equal(reminderView(r, ctx(6900)).level, 'soon'); // since 4900, remaining 100
  assert.equal(reminderView(r, ctx(7000)).level, 'due');  // since 5000, remaining 0
  assert.match(reminderView(r, ctx(3500)).detail, /1,500 of 5,000 rounds — 3,500 to go/); // since 1500
});

test('round reminder with an unresolvable gun is inactive, not broken', () => {
  const r = rem({ trigger: 'rounds', firearmId: 'fa-gone', everyRounds: 5000, baselineRounds: 0 });
  assert.equal(reminderView(r, ctx(null)).level, 'inactive');
});

test('a disabled reminder is inactive everywhere', () => {
  assert.equal(reminderView(rem({ trigger: 'date', dueDate: TODAY, enabled: false }), ctx()).level, 'inactive');
});

// ---- bucketing + sort ----

test('buckets split by level and sort soonest first', () => {
  const views = reminderViews([
    rem({ id: 'a', trigger: 'date', dueDate: '2026-07-30' }), // soon +15
    rem({ id: 'b', trigger: 'date', dueDate: '2026-07-20' }), // soon +5
    rem({ id: 'c', trigger: 'date', dueDate: '2026-07-01' }), // due -14
    rem({ id: 'd', trigger: 'date', dueDate: '2026-12-01' }), // later
    rem({ id: 'e', trigger: 'date', dueDate: null, enabled: false }), // paused
  ], ctx());
  assert.deepEqual(comingUpReminders(views).map((v) => v.reminder.id), ['b', 'a']);
  assert.deepEqual(dueReminders(views).map((v) => v.reminder.id), ['c']);
  assert.deepEqual(laterReminders(views).map((v) => v.reminder.id), ['d']);
  assert.deepEqual(inactiveReminders(views).map((v) => v.reminder.id), ['e']);
});

test('an orphaned round-count reminder lands in the Done bucket — never invisible', () => {
  // Its gun is gone: roundsForGun resolves null, so it's inactive — and the Done
  // bucket must catch it so the record always has a reachable row with Delete.
  const orphan = rem({ id: 'o', trigger: 'rounds', firearmId: 'fa-gone', everyRounds: 5000, baselineRounds: 0 });
  const views = reminderViews([orphan], ctx(null));
  assert.equal(dueReminders(views).length, 0);
  assert.equal(comingUpReminders(views).length, 0);
  assert.equal(laterReminders(views).length, 0);
  assert.deepEqual(inactiveReminders(views).map((v) => v.reminder.id), ['o']);
});

test('inactiveNote explains each Done row plainly', () => {
  // Paused / finished.
  assert.equal(inactiveNote(rem({ enabled: false }), true), 'Paused');
  assert.match(inactiveNote(rem({ enabled: false, lastDoneDate: '2026-07-01' }), true), /^Marked done /);
  // Orphaned: the gun left the log.
  assert.match(
    inactiveNote(rem({ trigger: 'rounds', firearmId: 'fa-gone', everyRounds: 5000 }), false),
    /no longer in your log/,
  );
  // Unmeasurable for any other reason.
  assert.match(inactiveNote(rem({ trigger: 'date', dueDate: null }), true), /Missing its date or round count/);
});

// ---- Home cap / overflow (spec §6b LOCKED) ----

function soonList(n: number) {
  return Array.from({ length: n }, (_, i) =>
    rem({ id: `s${i}`, trigger: 'date', dueDate: `2026-07-${String(18 + i).padStart(2, '0')}` }));
}

test('homeComingUp caps at 4 and reports overflow only past the cap', () => {
  const three = homeComingUp(reminderViews(soonList(3), ctx()));
  assert.equal(three.shown.length, 3);
  assert.equal(three.hasOverflow, false);

  const four = homeComingUp(reminderViews(soonList(4), ctx()));
  assert.equal(four.shown.length, 4);
  assert.equal(four.total, 4);
  assert.equal(four.hasOverflow, false);

  const six = homeComingUp(reminderViews(soonList(6), ctx()));
  assert.equal(six.shown.length, 4);
  assert.equal(six.total, 6);
  assert.equal(six.hasOverflow, true);
});

// ---- recurrence + completion ----

test('advanceDueDate always moves at least one interval from the due date', () => {
  assert.equal(advanceDueDate('2026-07-10', 'yearly', null, TODAY), '2027-07-10'); // just past -> next year
  // Done EARLY (due date still in the future): it STILL advances one interval —
  // "done is done"; the reminder must not stay armed to fire again this cycle.
  assert.equal(advanceDueDate('2026-08-01', 'yearly', null, TODAY), '2027-08-01');
  assert.equal(advanceDueDate('2026-06-15', 'months', 3, TODAY), '2026-09-15');
  // Done very LATE: keeps stepping until strictly after today, so it can't come
  // back already overdue.
  assert.equal(advanceDueDate('2023-07-10', 'yearly', null, TODAY), '2027-07-10');
  assert.equal(advanceDueDate('2026-01-05', 'months', 2, TODAY), '2026-09-05'); // 03-05, 05-05, 07-05 all <= today
  assert.equal(advanceDueDate('2026-07-10', 'none', null, TODAY), null);
});

test('completionPatch: recurring date advances, one-off pauses, round re-anchors', () => {
  const recur = completionPatch(rem({ trigger: 'date', dueDate: '2026-07-10', repeat: 'yearly' }), ctx());
  assert.equal(recur.dueDate, '2027-07-10');
  assert.equal(recur.lastDoneDate, TODAY);

  const once = completionPatch(rem({ trigger: 'date', dueDate: '2026-07-10', repeat: 'none' }), ctx());
  assert.equal(once.enabled, false);
  assert.equal(once.lastDoneDate, TODAY);

  const rounds = completionPatch(rem({ trigger: 'rounds', firearmId: 'fa-1', everyRounds: 5000, baselineRounds: 0 }), ctx(6100));
  assert.equal(rounds.baselineRounds, 6100);
  assert.equal(rounds.lastDoneDate, TODAY);
});

test('completionPatch: marking a recurring reminder done EARLY still rolls it forward', () => {
  // Due Aug 1, done July 15 (today, before the date), yearly -> next due Aug 1 NEXT year.
  const early = completionPatch(rem({ trigger: 'date', dueDate: '2026-08-01', repeat: 'yearly' }), ctx());
  assert.equal(early.dueDate, '2027-08-01');
  assert.equal(early.lastDoneDate, TODAY);
});

test('completionPatch: a very-overdue recurring reminder rolls past today, never back into overdue', () => {
  const late = completionPatch(rem({ trigger: 'date', dueDate: '2024-05-01', repeat: 'yearly' }), ctx());
  assert.equal(late.dueDate, '2027-05-01'); // 2025-05-01 and 2026-05-01 are already past
  assert.equal(late.lastDoneDate, TODAY);
});

// ---- gun-delete cascade ----

test('reminderIdsForGun picks exactly the reminders tied to that gun', () => {
  const list = [
    rem({ id: 'r1', trigger: 'rounds', firearmId: 'fa-1', everyRounds: 5000 }),
    rem({ id: 'r2', trigger: 'date', dueDate: '2026-08-01', firearmId: 'fa-1' }),
    rem({ id: 'r3', trigger: 'date', dueDate: '2026-08-01', firearmId: 'fa-2' }),
    rem({ id: 'r4', trigger: 'date', dueDate: '2026-08-01', firearmId: null }),
  ];
  assert.deepEqual(reminderIdsForGun(list, 'fa-1'), ['r1', 'r2']);
  assert.deepEqual(reminderIdsForGun(list, 'fa-2'), ['r3']);
  assert.deepEqual(reminderIdsForGun(list, 'fa-none'), []);
});

// ---- date helpers ----

test('daysBetween and addMonthsToDay are local and DST-safe', () => {
  assert.equal(daysBetween('2026-07-15', '2026-07-20'), 5);
  assert.equal(daysBetween('2026-07-20', '2026-07-15'), -5);
  assert.equal(daysBetween('bad', '2026-07-15'), null);
  assert.equal(addMonthsToDay('2026-07-15', 12), '2027-07-15');
  assert.equal(addMonthsToDay('2026-01-31', 1), '2026-03-03'); // JS overflow (Feb has no 31)
});

// ---- context builder ----

test('buildReminderContext resolves known guns and reports null for missing ones', () => {
  const firearms = [{ id: 'fa-1', name: 'Carry 9', startingRoundCount: 1200 } as unknown as Firearm];
  const c = buildReminderContext(firearms, [], [], TODAY);
  assert.equal(c.roundsForGun('fa-1'), 1200);
  assert.equal(c.roundsForGun('fa-missing'), null);
  assert.equal(c.gunName('fa-1'), 'Carry 9');
});
