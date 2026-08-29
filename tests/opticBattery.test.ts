import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  batteryChangeRollForward,
  governingReminder,
  opticBatteryStatus,
  reminderGovernsOptic,
} from '../src/lib/opticBattery.ts';
import type { OpticForBatteryStatus, ReminderWithOpticLink } from '../src/lib/opticBattery.ts';
import { isBatteryDue } from '../src/lib/optics.ts';
import { dayKey } from '../src/lib/dates.ts';

function optic(over: Partial<OpticForBatteryStatus> = {}): OpticForBatteryStatus {
  return { id: 'op-1', firearmId: 'fa-1', batteryLog: [], ...over };
}

function reminder(over: Partial<ReminderWithOpticLink> = {}): ReminderWithOpticLink {
  return {
    id: over.id ?? 'rm-1', createdAt: 0, updatedAt: 0,
    title: 'Test reminder', notes: '', source: 'custom', trigger: 'date',
    enabled: true, ...over,
  };
}

/** The day-key `n` whole days before `base` (both read at local noon). Plain
 *  JS Date arithmetic in the TEST only — the module under test never does this. */
function keyDaysBefore(base: Date, n: number): string {
  return dayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() - n, 12, 0, 0));
}

// ---- 1. The owner's real fixture ----

test('Michael fixture: all four guns read "soon" from their reminder — while the old rule already disagrees', () => {
  const today = new Date(2027, 5, 20, 12, 0, 0); // 2027-06-20
  const batteryLog = [{ date: '2026-07-14', notes: '' }];

  const optics = ['op-1', 'op-2', 'op-3', 'op-4'].map((id, i) =>
    optic({ id, firearmId: `fa-${i + 1}`, batteryLog }));

  const reminders: ReminderWithOpticLink[] = [
    reminder({ id: 'rm-1', firearmId: 'fa-1', dueDate: '2027-07-14', repeat: 'yearly', source: 'template', templateKey: 'optic-battery' }),
    reminder({ id: 'rm-2', firearmId: 'fa-2', dueDate: '2027-07-14', repeat: 'yearly', source: 'template', templateKey: 'optic-battery' }),
    reminder({ id: 'rm-3', firearmId: 'fa-3', dueDate: '2027-07-14', repeat: 'yearly', source: 'template', templateKey: 'optic-battery' }),
    reminder({ id: 'rm-4', firearmId: 'fa-4', dueDate: '2027-07-14', repeat: 'yearly', source: 'custom', templateKey: null, title: 'Optic Battery' }),
  ];

  for (const o of optics) {
    const status = opticBatteryStatus(o, reminders, 1, today);
    assert.equal(status.kind, 'reminder');
    if (status.kind === 'reminder') assert.equal(status.level, 'soon');
  }

  // What this pins: under today's shipped rule, these same four records have
  // read "battery due" since 2027-06-10 (>330 days since the 2026-07-14
  // change) — the reminder says 2027-07-14, three and a half weeks out. Same
  // data, two contradictory verdicts. That contradiction is exactly what this
  // feature removes: opticBatteryStatus above says 'soon' for all four, one
  // verdict, matching the reminder.
  assert.equal(isBatteryDue(batteryLog, today), true);
});

// ---- 2. Custom-title case, isolated ----

test('a custom reminder with templateKey:null governs by title alone, case-insensitively', () => {
  const o = optic(); // firearmId 'fa-1'
  const byTitle = reminder({ firearmId: 'fa-1', dueDate: '2027-07-14', templateKey: null, title: 'Optic Battery' });
  assert.equal(reminderGovernsOptic(byTitle, o, 1), true);

  const mixedCase = reminder({ id: 'rm-2', firearmId: 'fa-1', dueDate: '2027-07-14', templateKey: null, title: 'Red dot BATTERY check' });
  assert.equal(reminderGovernsOptic(mixedCase, o, 1), true);

  // Sanity: the same shape with a title that says nothing about a battery does not govern.
  const notBattery = reminder({ id: 'rm-3', firearmId: 'fa-1', dueDate: '2027-07-14', templateKey: null, title: 'Clean the gun' });
  assert.equal(reminderGovernsOptic(notBattery, o, 1), false);
});

// ---- 3. opticId: null must not legacy-match ----

test('opticId: null is a deliberate unlink — it never legacy-matches, even when everything else lines up', () => {
  const o = optic(); // firearmId 'fa-1'
  // firearmId MUST match the optic's gun here, or this "false" would come from
  // the unrelated firearmId guard instead of the opticId:null guard under test
  // and the assertion would constrain nothing.
  const r = reminder({ firearmId: 'fa-1', dueDate: '2027-07-14', templateKey: 'optic-battery', opticId: null });
  assert.equal(reminderGovernsOptic(r, o, 1), false);
  assert.equal(governingReminder(o, [r], 1, new Date(2027, 5, 20, 12, 0, 0)), null);
});

// ---- 4. Explicit link beats legacy; explicit-to-another-optic excluded ----

test('an explicit opticId link governs regardless of gun uniqueness, and never governs a DIFFERENT optic', () => {
  const o1 = optic({ id: 'op-1' });
  const o2 = optic({ id: 'op-2' }); // same gun (fa-1) — would be ambiguous for legacy matching

  const linkedToO1 = reminder({ dueDate: '2027-07-14', opticId: 'op-1' });
  assert.equal(reminderGovernsOptic(linkedToO1, o1, 2), true); // explicit link ignores the two-optics rule
  assert.equal(reminderGovernsOptic(linkedToO1, o2, 2), false); // linked elsewhere
});

// ---- 5. Two optics on one gun: legacy match is ambiguous for both ----

test('a gun carrying two optics: neither is legacy-matched by the one old-style reminder', () => {
  const o1 = optic({ id: 'op-1' }); // firearmId 'fa-1'
  const o2 = optic({ id: 'op-2' }); // same gun, firearmId 'fa-1'
  // firearmId matches the gun deliberately, so this exercises the
  // opticsOnSameGun !== 1 guard specifically, not an unrelated firearm mismatch.
  const r = reminder({ firearmId: 'fa-1', dueDate: '2027-07-14', templateKey: 'optic-battery' });
  assert.equal(reminderGovernsOptic(r, o1, 2), false);
  assert.equal(reminderGovernsOptic(r, o2, 2), false);
});

// ---- 6. Disabled / rounds-trigger / unparseable date never govern ----

test('a disabled reminder, a rounds-triggered reminder, and an unparseable or missing due date never govern', () => {
  const o = optic();
  const disabled = reminder({ id: 'rm-a', dueDate: '2027-07-14', templateKey: 'optic-battery', enabled: false });
  const rounds = reminder({ id: 'rm-b', trigger: 'rounds', everyRounds: 5000, templateKey: 'optic-battery' });
  const garbageDate = reminder({ id: 'rm-c', dueDate: 'garbage', templateKey: 'optic-battery' });
  const missingDate = reminder({ id: 'rm-d', dueDate: null, templateKey: 'optic-battery' });
  for (const r of [disabled, rounds, garbageDate, missingDate]) {
    assert.equal(reminderGovernsOptic(r, o, 1), false);
  }
});

// ---- 7. Two governing reminders: soonest due date wins, deterministically ----

test('two governing reminders: the soonest due date wins, and a tie breaks the same way regardless of input order', () => {
  const o = optic();
  const today = new Date(2027, 5, 20, 12, 0, 0);

  const later = reminder({ id: 'rm-later', dueDate: '2027-09-01', opticId: 'op-1' });
  const sooner = reminder({ id: 'rm-sooner', dueDate: '2027-07-01', opticId: 'op-1' });
  assert.equal(governingReminder(o, [later, sooner], 1, today)?.id, 'rm-sooner');
  assert.equal(governingReminder(o, [sooner, later], 1, today)?.id, 'rm-sooner');

  const tieA = reminder({ id: 'rm-a', dueDate: '2027-07-01', opticId: 'op-1' });
  const tieB = reminder({ id: 'rm-b', dueDate: '2027-07-01', opticId: 'op-1' });
  assert.equal(governingReminder(o, [tieA, tieB], 1, today)?.id, 'rm-a');
  assert.equal(governingReminder(o, [tieB, tieA], 1, today)?.id, 'rm-a');
});

// ---- 8. Fallback column: the old 330-day rule, exactly ----

test('fallback (no governing reminder): >330 days is age-due, <=330 is ok, empty log is no-log', () => {
  // "Today" is deliberately Dec 20, not Jan 1: a 330/331-day lookback from
  // Dec 20 lands in late January of the SAME year, so the window brackets
  // both of that year's DST transitions (a spring-forward and a fall-back)
  // together rather than just one of them. One lone transition would skew
  // daysSince's real-millisecond subtraction by an hour and could flip an
  // exact 330/331 boundary regardless of the test machine's timezone; a
  // matched pair cancels out, so this boundary check holds wherever it runs.
  const today = new Date(2027, 11, 20, 12, 0, 0); // 2027-12-20

  const ok = opticBatteryStatus(optic({ batteryLog: [{ date: keyDaysBefore(today, 100), notes: '' }] }), [], 1, today);
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') assert.equal(ok.days, 100);

  // Boundary: exactly 330 days is NOT over (the shipped rule is strictly >330).
  const boundaryOk = opticBatteryStatus(optic({ batteryLog: [{ date: keyDaysBefore(today, 330), notes: '' }] }), [], 1, today);
  assert.equal(boundaryOk.kind, 'ok');
  if (boundaryOk.kind === 'ok') assert.equal(boundaryOk.days, 330);

  const boundaryOver = opticBatteryStatus(optic({ batteryLog: [{ date: keyDaysBefore(today, 331), notes: '' }] }), [], 1, today);
  assert.equal(boundaryOver.kind, 'age-due');
  if (boundaryOver.kind === 'age-due') assert.equal(boundaryOver.days, 331);

  const noLog = opticBatteryStatus(optic({ batteryLog: [] }), [], 1, today);
  assert.equal(noLog.kind, 'no-log');
});

// ---- 8b. An unparseable-only battery entry reads as no-log, honestly ----
// Separate from the never-throws test below on purpose: never-throws only
// proves nothing crashes; this proves the VERDICT is honest — a log entry
// that survives normalizeBatteryLog's '' check (it has a non-empty `date`)
// but doesn't parse to a real day must not be silently read as "Active".

test('an optic whose only battery entry has an unparseable date reads as no-log, never ok', () => {
  const today = new Date(2027, 5, 20, 12, 0, 0);
  const status = opticBatteryStatus(optic({ batteryLog: [{ date: 'not-a-date', notes: 'typo' }] }), [], 1, today);
  assert.equal(status.kind, 'no-log');
});

// ---- 8c/8d. Two ways a canonical-shaped date can still not be a real day
// (audit rounds 2 and 3) ----
// A YYYY-MM-DD-shaped string can fail to name a real calendar day two
// independent ways, because JS's Date normalizes calendar overflow instead
// of rejecting it: month overflow ('2027-13-01' rolls to 2028-01-01) and day
// overflow ('2027-02-30' rolls to 2027-03-02). Round 2 fixed the month case
// by filtering on Number.isFinite(daysSince(...)); that left the day case
// open, because daysSince's own parser (an ISO timestamp string) rejects an
// out-of-range MONTH but accepts a day value up to 31 regardless of what the
// given month actually holds — and per ECMA-262 that acceptance is
// implementation-defined, so it need not even agree between engines. Round 3
// replaced the filter (and the day-count) with isRealDayKey / daysBetween
// (lib/reminders.ts): a shape regex plus a round-trip through dayKey, which
// a normalized value can never pass, on any engine. Both cases are pinned
// here so neither can silently return.

test('a calendar-invalid date like 2027-13-01 (month overflow) must not block a real entry behind it — age-due, not no-log', () => {
  const today = new Date(2027, 5, 20, 12, 0, 0); // 2027-06-20
  const goodDate = keyDaysBefore(today, 400); // a real day, well past the 330-day line
  const status = opticBatteryStatus(
    optic({ batteryLog: [{ date: '2027-13-01', notes: 'bad key, sorts first lexically' }, { date: goodDate, notes: '' }] }),
    [], 1, today,
  );
  assert.equal(status.kind, 'age-due');
  if (status.kind === 'age-due') assert.equal(status.days, 400);
});

test('a calendar-invalid date like 2027-02-30 (day overflow) must not block a real entry behind it — age-due, not no-log', () => {
  const today = new Date(2027, 5, 20, 12, 0, 0); // 2027-06-20
  const goodDate = keyDaysBefore(today, 400); // a real day, well past the 330-day line
  const status = opticBatteryStatus(
    optic({ batteryLog: [{ date: '2027-02-30', notes: 'typo, sorts ahead of a real older date' }, { date: goodDate, notes: '' }] }),
    [], 1, today,
  );
  assert.equal(status.kind, 'age-due');
  if (status.kind === 'age-due') assert.equal(status.days, 400);
});

// ---- 9. Roll-forward (Decision 3-A) ----

test('roll-forward: a change a few days before the due date advances one full interval, birthday preserved', () => {
  const r = reminder({ dueDate: '2027-07-14', repeat: 'yearly' });
  const today = new Date(2027, 6, 10, 12, 0, 0); // 2027-07-10
  const patch = batteryChangeRollForward(r, '2027-07-10', [{ date: '2027-07-10', notes: '' }], today);
  assert.deepEqual(patch, { dueDate: '2028-07-14', lastDoneDate: '2027-07-10' });
});

test('roll-forward: a change made while already overdue advances past TODAY, not just past the old due date', () => {
  const r = reminder({ dueDate: '2026-07-14', repeat: 'yearly' });
  const today = new Date(2028, 0, 1, 12, 0, 0); // 2028-01-01 — well past two anniversaries
  const patch = batteryChangeRollForward(r, '2028-01-01', [{ date: '2028-01-01', notes: '' }], today);
  assert.deepEqual(patch, { dueDate: '2028-07-14', lastDoneDate: '2028-01-01' });
});

test('roll-forward: exactly 30 days early still rolls forward; 31 days early is off-schedule and nothing moves', () => {
  const r = reminder({ dueDate: '2027-07-14', repeat: 'yearly' });

  const at30 = batteryChangeRollForward(r, '2027-06-14', [{ date: '2027-06-14', notes: '' }], new Date(2027, 5, 14, 12, 0, 0));
  assert.deepEqual(at30, { dueDate: '2028-07-14', lastDoneDate: '2027-06-14' });

  const at31 = batteryChangeRollForward(r, '2027-06-13', [{ date: '2027-06-13', notes: '' }], new Date(2027, 5, 13, 12, 0, 0));
  assert.equal(at31, null);
});

test('roll-forward: an off-schedule change 60 days early (Decision 3-A) leaves the anchored date alone', () => {
  const r = reminder({ dueDate: '2027-07-14', repeat: 'yearly' });
  const patch = batteryChangeRollForward(r, '2027-05-15', [{ date: '2027-05-15', notes: '' }], new Date(2027, 4, 15, 12, 0, 0));
  assert.equal(patch, null);
});

test('roll-forward: a backdated entry that is NOT the newest in the log moves nothing', () => {
  const r = reminder({ dueDate: '2027-07-14', repeat: 'yearly' });
  // The log already has a newer entry (2027-07-10); the change being evaluated
  // (2026-01-01) is history being filled in, not the latest swap.
  const log = [{ date: '2027-07-10', notes: '' }, { date: '2026-01-01', notes: 'old receipt found' }];
  const patch = batteryChangeRollForward(r, '2026-01-01', log, new Date(2027, 6, 20, 12, 0, 0));
  assert.equal(patch, null);
});

// Finding 8 (audit round 2): "newest" must mean newest among entries that
// actually parse, not newest by raw string sort among non-empty ones. A
// garbage-but-nonempty date string sorts ahead of every real ISO date
// ('battery swapped 3/4' > '2027-07-10' lexically) and, before this fix,
// would have permanently blocked roll-forward for this optic — the garbage
// entry's date could never equal a real changeDate, so `newest.date !==
// changeDate` failed forever.
test('roll-forward: a garbage-but-nonempty date entry in the log must not block roll-forward for the real newest entry', () => {
  const r = reminder({ dueDate: '2027-07-14', repeat: 'yearly' });
  const log = [{ date: 'battery swapped 3/4', notes: 'free text, not a real date' }, { date: '2027-07-10', notes: '' }];
  const patch = batteryChangeRollForward(r, '2027-07-10', log, new Date(2027, 6, 10, 12, 0, 0));
  assert.deepEqual(patch, { dueDate: '2028-07-14', lastDoneDate: '2027-07-10' });
});

// Audit round 3, F-1: the sibling of the test above — a day-overflow typo
// ('2027-02-30') is exactly the kind of value the round-2 fix (Number.isFinite
// (daysSince(...))) let through, because daysSince's own parser accepts a
// day value up to 31 regardless of the month. It sorts ahead of the real
// entry lexically ('30' > '27'), so under the round-2 code `newest` was the
// typo, `newest.date !== changeDate`, and roll-forward was silently blocked
// forever for this optic.
test('roll-forward: a calendar-invalid date like 2027-02-30 (day overflow) in the log must not block roll-forward for the real newest entry', () => {
  const r = reminder({ dueDate: '2027-02-27', repeat: 'yearly' });
  const log = [{ date: '2027-02-30', notes: 'typo, day overflow' }, { date: '2027-02-27', notes: '' }];
  const patch = batteryChangeRollForward(r, '2027-02-27', log, new Date(2027, 1, 27, 12, 0, 0));
  assert.deepEqual(patch, { dueDate: '2028-02-27', lastDoneDate: '2027-02-27' });
});

test('roll-forward: a governed one-off (repeat: none) reminder is paused, not advanced', () => {
  const r = reminder({ dueDate: '2027-07-14', repeat: 'none' });
  const patch = batteryChangeRollForward(r, '2027-07-10', [{ date: '2027-07-10', notes: '' }], new Date(2027, 6, 10, 12, 0, 0));
  assert.deepEqual(patch, { enabled: false, lastDoneDate: '2027-07-10' });
  assert.equal(patch !== null && 'dueDate' in patch, false); // one-off: paused, never given a new dueDate
});

// ---- 10. Never throws ----

// Audit round 3, closing review, item 2: the comment above the
// `days === null` guard in opticBatteryStatus has now been wrong four
// times. Measured behaviour it must match: an Invalid-Date clock (never
// produced by any real app caller, all of which pass `new Date()`) must
// still not leak `days: null` into a `number` field.
test('opticBatteryStatus with an Invalid Date "today" reads no-log, never a null smuggled into days', () => {
  const invalidToday = new Date(NaN);
  const status = opticBatteryStatus(optic({ batteryLog: [{ date: '2027-06-20', notes: '' }] }), [], 1, invalidToday);
  assert.equal(status.kind, 'no-log');
});

test('opticBatteryStatus never throws on garbage batteryLog entries or garbage reminders', () => {
  const today = new Date(2027, 5, 20, 12, 0, 0);
  const garbageLog = [null, 42, 'x', { notes: 'no date' }, { date: 'not-a-date' }] as unknown[];

  assert.doesNotThrow(() => {
    const s = opticBatteryStatus(optic({ batteryLog: garbageLog }), [], 1, today);
    assert.equal(s.kind, 'no-log'); // none of those entries are readable
  });

  const garbageReminders = [
    {} as unknown as ReminderWithOpticLink, // missing everything
    {
      id: 'rm-x', trigger: 'date', dueDate: 'garbage', enabled: true,
      firearmId: 'fa-1', title: 'Optic Battery',
    } as unknown as ReminderWithOpticLink, // storage-shaped garbage: unparseable date, missing required fields
    null as unknown as ReminderWithOpticLink,
    undefined as unknown as ReminderWithOpticLink,
  ];
  assert.doesNotThrow(() => {
    const s = opticBatteryStatus(optic({ batteryLog: garbageLog }), garbageReminders, 1, today);
    assert.equal(s.kind, 'no-log');
  });
});

test('batteryChangeRollForward never throws on a garbage reminder or garbage log', () => {
  const today = new Date(2027, 5, 20, 12, 0, 0);
  const garbageLog = [null, 42, 'x', { notes: 'no date' }] as unknown[];

  assert.doesNotThrow(() => {
    const patch = batteryChangeRollForward({ dueDate: 'garbage' } as unknown as ReminderWithOpticLink, '2027-07-10', garbageLog, today);
    assert.equal(patch, null);
  });

  assert.doesNotThrow(() => {
    const nothing = null as unknown as ReminderWithOpticLink;
    assert.equal(batteryChangeRollForward(nothing, '2027-07-10', garbageLog, today), null);
  });
});
