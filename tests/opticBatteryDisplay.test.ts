import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batteryChangeMoveNote, opticBatteryBadge, opticBatterySubline } from '../src/ui/opticBatteryDisplay.ts';
import type { OpticBatteryStatus } from '../src/lib/opticBattery.ts';
import type { ReminderWithOpticLink } from '../src/lib/opticBattery.ts';

// Exact strings/classes pinned by OPTIC_BATTERY_INTEGRATION_SPEC.md §5 — this
// display module exists so no two screens can ever render different words
// for the same status again, so every state is pinned here once.

function reminderStatus(level: 'due' | 'soon' | 'later'): OpticBatteryStatus {
  const reminder = {} as ReminderWithOpticLink; // opaque to this display module
  return { kind: 'reminder', level, reminder, detail: 'irrelevant to the badge' };
}

test('badge: reminder/due -> "Battery due" warn-badge', () => {
  const b = opticBatteryBadge(reminderStatus('due'));
  assert.deepEqual(b, { text: 'Battery due', cls: 'warn-badge' });
});

test('badge: reminder/soon -> "Battery due soon" info', () => {
  const b = opticBatteryBadge(reminderStatus('soon'));
  assert.deepEqual(b, { text: 'Battery due soon', cls: 'info' });
});

test('badge: reminder/later -> "Active" ok', () => {
  const b = opticBatteryBadge(reminderStatus('later'));
  assert.deepEqual(b, { text: 'Active', cls: 'ok' });
});

test('badge: age-due -> "Battery due" warn-badge', () => {
  const b = opticBatteryBadge({ kind: 'age-due', days: 400 });
  assert.deepEqual(b, { text: 'Battery due', cls: 'warn-badge' });
});

test('badge: ok -> "Active" ok', () => {
  const b = opticBatteryBadge({ kind: 'ok', days: 10 });
  assert.deepEqual(b, { text: 'Active', cls: 'ok' });
});

test('badge: no-log -> "No battery log" info', () => {
  const b = opticBatteryBadge({ kind: 'no-log' });
  assert.deepEqual(b, { text: 'No battery log', cls: 'info' });
});

test('Gun Detail sub-line matches the badge text except NO-LOG, which reads without "yet"', () => {
  assert.equal(opticBatterySubline(reminderStatus('due')), 'Battery due');
  assert.equal(opticBatterySubline(reminderStatus('soon')), 'Battery due soon');
  assert.equal(opticBatterySubline(reminderStatus('later')), 'Active');
  assert.equal(opticBatterySubline({ kind: 'age-due', days: 400 }), 'Battery due');
  assert.equal(opticBatterySubline({ kind: 'ok', days: 10 }), 'Active');
  assert.equal(opticBatterySubline({ kind: 'no-log' }), 'No battery changes logged');
});

// ---- Finding 3 (audit round 2): the pause branch needs a note too ----
// batteryChangeRollForward's pause branch (a non-repeating governed reminder)
// returns `{ enabled: false, lastDoneDate }` — no `dueDate` at all. The
// ORIGINAL note logic only fired on `patch?.dueDate`, so this exact branch
// saved silently: the reminder paused with no visible sign to the shooter
// that saving the battery entry had also marked it done.

test('batteryChangeMoveNote: a repeating-reminder patch (dueDate present) notes the new date', () => {
  const note = batteryChangeMoveNote({ dueDate: '2028-07-14', lastDoneDate: '2027-07-10' });
  assert.equal(note, 'Saving this also moves the battery reminder to Jul 14, 2028.');
});

test('batteryChangeMoveNote: a one-off pause patch (no dueDate, enabled:false) still gets a note', () => {
  const note = batteryChangeMoveNote({ enabled: false, lastDoneDate: '2027-07-10' });
  assert.equal(note, 'Saving this also marks the battery reminder done.');
});

test('batteryChangeMoveNote: null patch (nothing will move) is null', () => {
  assert.equal(batteryChangeMoveNote(null), null);
});
