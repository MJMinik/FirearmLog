import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTERY_DUE_DAYS, daysSince, entryStillAt, hasBatteryLogEntry, isBatteryDue, lastBatteryEntry,
  normalizeBatteryLog, normalizeBatteryLogWithIndex, safeBatteryLog,
} from '../src/lib/optics.ts';

test('normalizeBatteryLog tolerates garbage and sorts newest first', () => {
  assert.deepEqual(normalizeBatteryLog([]), []);
  assert.deepEqual(normalizeBatteryLog([null, 'nope', 42, { notes: 'no date' }]), []);
  const log = normalizeBatteryLog([
    { date: '2025-01-01', notes: 'first' },
    { date: '2026-01-01', notes: 'second' },
    { date: '2025-06-01' } // missing notes tolerated
  ]);
  assert.equal(log.length, 3);
  assert.equal(log[0].date, '2026-01-01');
  assert.equal(log[1].date, '2025-06-01');
  assert.equal(log[1].notes, '');
});

test('lastBatteryEntry returns the newest entry or null', () => {
  assert.equal(lastBatteryEntry([]), null);
  const last = lastBatteryEntry([
    { date: '2025-01-01', notes: 'first' },
    { date: '2026-01-01', notes: 'second' }
  ]);
  assert.equal(last?.date, '2026-01-01');
  assert.equal(last?.notes, 'second');
});

test('daysSince counts whole days', () => {
  const now = new Date(2026, 5, 13, 12, 0, 0); // Jun 13, 2026
  assert.equal(daysSince('2026-06-13', now), 0);
  assert.equal(daysSince('2026-06-01', now), 12);
});

test('isBatteryDue is false with no log, false under the threshold, true over it', () => {
  const now = new Date(2026, 5, 13, 12, 0, 0); // Jun 13, 2026
  assert.equal(isBatteryDue([], now), false);

  const recent = [{ date: '2026-05-01', notes: '' }]; // ~43 days ago
  assert.equal(isBatteryDue(recent, now), false);

  const stale = [{ date: '2025-01-01', notes: '' }]; // well over BATTERY_DUE_DAYS
  assert.equal(isBatteryDue(stale, now), true);

  // Sanity check the threshold constant is what PT used.
  assert.equal(BATTERY_DUE_DAYS, 330);
});
// ---- normalizeBatteryLogWithIndex (session 137 follow-up) ----
//
// WHY THIS EXISTS: the Optics screen needs to let the shooter delete ONE
// battery-log entry out of the real stored array, but the list it renders is
// both filtered (garbage skipped) and re-sorted (newest first) — so "the 2nd
// row on screen" is not "index 1 in the raw array". A wrong index here
// deletes the WRONG entry from the owner's real log, silently. This is the
// single function both normalizeBatteryLog and the delete UI now route
// through, so the two can never disagree about what counts as a readable
// entry (they used to be two separate copies of the same filter — the exact
// class of drift lib/opticBattery.ts exists to end for the badge/reminder).

test('normalizeBatteryLogWithIndex: an empty log returns empty', () => {
  assert.deepEqual(normalizeBatteryLogWithIndex([]), []);
});

test('normalizeBatteryLogWithIndex: indexes survive the sort — the newest entry need not be raw index 0', () => {
  // Deliberately stored out of date order: newest entry is LAST in the raw
  // array (raw index 2), oldest is FIRST (raw index 0).
  const raw = [
    { date: '2025-01-01', notes: 'oldest' },  // raw index 0
    { date: '2025-06-01', notes: 'middle' },  // raw index 1
    { date: '2026-01-01', notes: 'newest' },  // raw index 2
  ];
  const out = normalizeBatteryLogWithIndex(raw);
  assert.equal(out.length, 3);
  // Newest-first in the RETURNED list...
  assert.deepEqual(out.map((e) => e.date), ['2026-01-01', '2025-06-01', '2025-01-01']);
  // ...but each entry still points at where it actually lives in `raw`.
  assert.deepEqual(out.map((e) => e.rawIndex), [2, 1, 0]);
  for (const e of out) assert.equal(raw[e.rawIndex]!.date, e.date);
});

test('normalizeBatteryLogWithIndex: malformed entries are skipped without shifting surviving indexes', () => {
  const raw: unknown[] = [
    { date: '2025-01-01', notes: 'good, raw index 0' },
    null,                                    // raw index 1 — garbage
    { notes: 'no date, raw index 2' },       // raw index 2 — garbage (date '')
    'nope',                                  // raw index 3 — garbage
    { date: '2026-01-01', notes: 'good, raw index 4' },
  ];
  const out = normalizeBatteryLogWithIndex(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.rawIndex), [4, 0]); // newest (index 4) first
  assert.equal(out[0]!.notes, 'good, raw index 4');
  assert.equal(out[1]!.notes, 'good, raw index 0');
});

test('normalizeBatteryLog and normalizeBatteryLogWithIndex never disagree about what is readable', () => {
  const raw = [
    { date: '2025-01-01', notes: 'a' },
    null,
    { date: 'not-a-date', notes: 'unreadable' },
    { date: '2026-01-01', notes: 'b' },
  ];
  const plain = normalizeBatteryLog(raw);
  const indexed = normalizeBatteryLogWithIndex(raw);
  assert.deepEqual(plain, indexed.map(({ date, notes }) => ({ date, notes })));
});

// Finding 2 (audit round 2): a stored `batteryLog` that isn't an array at all
// (storage garbage, or a record shape from before this field existed) must
// read as "no entries", not crash. Four call sites in the UI hand this
// function whatever `optic.batteryLog` happens to be, unguarded — this is the
// one place that can make all four safe by construction instead of by
// remembering to guard each one.
test('normalizeBatteryLogWithIndex: a non-array batteryLog ({}, null, undefined) reads as empty, never throws', () => {
  assert.deepEqual(normalizeBatteryLogWithIndex({} as unknown), []);
  assert.deepEqual(normalizeBatteryLogWithIndex(null as unknown), []);
  assert.deepEqual(normalizeBatteryLogWithIndex(undefined as unknown), []);
  assert.deepEqual(normalizeBatteryLogWithIndex('garbage' as unknown), []);
  assert.deepEqual(normalizeBatteryLog({} as unknown), []);
});

// ---- Finding 2 (audit round 2): a write-side non-array guard ----
// normalizeBatteryLog(WithIndex) is the READ side (filters + resorts) — a
// write path that needs to SPREAD the existing log and append one entry
// can't route through it (a filtered-and-resorted log written back would
// silently drop or reorder whatever garbage was already stored). This is
// the matching guard for the three UI sites that spread `optic.batteryLog`
// directly (BatteryLogSheet x2, RemindersScreen's markDone x1).

test('safeBatteryLog: a real array passes through untouched; anything else becomes []', () => {
  const real = [{ date: '2025-01-01', notes: 'a' }];
  assert.equal(safeBatteryLog(real), real); // same reference — not a copy, not resorted
  assert.deepEqual(safeBatteryLog(undefined), []);
  assert.deepEqual(safeBatteryLog(null), []);
  assert.deepEqual(safeBatteryLog({}), []);
  assert.deepEqual(safeBatteryLog('garbage'), []);
});

// ---- Finding 4 (audit round 2): freshness check for an irreversible delete ----
// Deleting one battery-log entry acts on a `rawIndex` captured whenever the
// screen last loaded. Between then and the confirmed delete, another
// tab/window could have appended or edited the same optic's log — the array
// at `rawIndex` may no longer be the entry the shooter tapped and confirmed.
// This is the freshness check: re-read fresh, and only allow the delete when
// the entry sitting at `rawIndex` right now still matches what was expected.

test('entryStillAt: true only when the raw index still holds the SAME date+notes', () => {
  const raw = [{ date: '2025-01-01', notes: 'first' }, { date: '2026-01-01', notes: 'second' }];
  assert.equal(entryStillAt(raw, 1, { date: '2026-01-01', notes: 'second' }), true);
  assert.equal(entryStillAt(raw, 1, { date: '2026-01-01', notes: 'DIFFERENT' }), false);
  assert.equal(entryStillAt(raw, 0, { date: '2026-01-01', notes: 'second' }), false); // wrong index
});

test('entryStillAt: false (never throws) on a stale/out-of-range index or a non-array log', () => {
  const raw = [{ date: '2025-01-01', notes: 'first' }];
  assert.equal(entryStillAt(raw, 5, { date: '2025-01-01', notes: 'first' }), false);
  assert.equal(entryStillAt(raw, -1, { date: '2025-01-01', notes: 'first' }), false);
  assert.equal(entryStillAt(undefined, 0, { date: '2025-01-01', notes: 'first' }), false);
  assert.equal(entryStillAt(null, 0, { date: '2025-01-01', notes: 'first' }), false);
  assert.equal(entryStillAt([null, 'x', 42], 0, { date: '2025-01-01', notes: 'first' }), false);
});

test('entryStillAt: simulates the race — an append by another tab shifts what a stale index means, and this catches it', () => {
  // Tab A loaded when the log had one entry (raw index 0) and the shooter
  // tapped Delete on it. Before the confirm lands, Tab B appends a NEWER
  // entry at the END of the raw array (append, not prepend — the array's
  // on-disk order is insertion order, not sorted order) — raw index 0 is
  // untouched in this scenario, so this proves the check does not FALSE-
  // POSITIVE (block) a delete that is still perfectly safe.
  const original = [{ date: '2025-01-01', notes: 'the one being deleted' }];
  const expected = { date: '2025-01-01', notes: 'the one being deleted' };
  const afterConcurrentAppend = [...original, { date: '2026-06-01', notes: 'added by the other tab' }];
  assert.equal(entryStillAt(afterConcurrentAppend, 0, expected), true);

  // Now the actually-dangerous case: the other tab deleted/edited raw index 0
  // itself (e.g. fixed a typo in that very entry) — the index is still IN
  // range, but it no longer holds what Tab A expects. This must block.
  const editedInPlace = [{ date: '2025-01-01', notes: 'typo fixed by the other tab' }];
  assert.equal(entryStillAt(editedInPlace, 0, expected), false);
});

// ---- Finding F-4 (audit round 3): idempotency check for markDone's ----
// ---- provenance write ----
// markDone's optic write can succeed and then have the FOLLOWING reminder
// write fail — the visible advice is to tap Mark done again, and without
// this check, retrying appends a SECOND, byte-identical provenance entry
// for the same day. This is the predicate that makes the retry a no-op on
// the optic side instead.

test('hasBatteryLogEntry: true only when an entry matches BOTH date and notes exactly', () => {
  const log = [{ date: '2027-06-20', notes: 'Marked done from the reminder' }, { date: '2027-06-19', notes: 'unrelated' }];
  assert.equal(hasBatteryLogEntry(log, '2027-06-20', 'Marked done from the reminder'), true);
  assert.equal(hasBatteryLogEntry(log, '2027-06-20', 'a different note'), false);
  assert.equal(hasBatteryLogEntry(log, '2027-06-21', 'Marked done from the reminder'), false);
});

test('hasBatteryLogEntry: false (never throws) on an empty, garbage, or non-array log', () => {
  assert.equal(hasBatteryLogEntry([], '2027-06-20', 'x'), false);
  assert.equal(hasBatteryLogEntry([null, 42, 'x', { notes: 'no date' }], '2027-06-20', 'x'), false);
  assert.equal(hasBatteryLogEntry(undefined, '2027-06-20', 'x'), false);
  assert.equal(hasBatteryLogEntry(null, '2027-06-20', 'x'), false);
  assert.equal(hasBatteryLogEntry({}, '2027-06-20', 'x'), false);
});
