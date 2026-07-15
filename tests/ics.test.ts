import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderIcs, canExportIcs, icsFileName } from '../src/lib/ics.ts';
import type { Reminder } from '../src/lib/types.ts';

function rem(over: Partial<Reminder> = {}): Reminder {
  return {
    id: over.id ?? 'rm-1', createdAt: 0, updatedAt: 0,
    title: 'Optic battery', notes: '', source: 'template', trigger: 'date',
    dueDate: '2026-07-14', repeat: 'none', enabled: true, ...over,
  };
}

const NOW = new Date(Date.UTC(2026, 6, 1, 13, 0, 0));

test('canExportIcs: date reminders yes, round reminders no', () => {
  assert.equal(canExportIcs(rem()), true);
  assert.equal(canExportIcs(rem({ dueDate: null })), false);
  assert.equal(canExportIcs(rem({ trigger: 'rounds', dueDate: null, everyRounds: 5000, firearmId: 'fa-1' })), false);
});

test('buildReminderIcs writes a valid all-day VEVENT on the due date', () => {
  const ics = buildReminderIcs(rem(), NOW);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:rm-1@firearmlog/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260714/);
  assert.match(ics, /SUMMARY:Optic battery/);
  assert.match(ics, /DTSTAMP:20260701T130000Z/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  // Lines are CRLF-terminated per RFC 5545.
  assert.ok(ics.includes('\r\n'));
});

test('recurrence maps to the right RRULE (or none)', () => {
  assert.match(buildReminderIcs(rem({ repeat: 'yearly' }), NOW), /RRULE:FREQ=YEARLY/);
  assert.match(buildReminderIcs(rem({ repeat: 'months', repeatMonths: 6 }), NOW), /RRULE:FREQ=MONTHLY;INTERVAL=6/);
  assert.doesNotMatch(buildReminderIcs(rem({ repeat: 'none' }), NOW), /RRULE/);
});

test('text is escaped per RFC 5545 (comma, semicolon, backslash, newline)', () => {
  const ics = buildReminderIcs(rem({ title: 'Spring;check,now\\then', notes: 'line1\nline2' }), NOW);
  assert.match(ics, /SUMMARY:Spring\\;check\\,now\\\\then/);
  assert.match(ics, /DESCRIPTION:line1\\nline2/);
});

test('a round-count reminder cannot be exported', () => {
  assert.throws(
    () => buildReminderIcs(rem({ trigger: 'rounds', dueDate: null, everyRounds: 5000, firearmId: 'fa-1' })),
    /Only date reminders/,
  );
});

test('icsFileName is a safe slug', () => {
  assert.equal(icsFileName(rem({ title: 'USPSA membership renewal' })), 'firearmlog-uspsa-membership-renewal.ics');
  assert.equal(icsFileName(rem({ title: '' })), 'firearmlog-reminder.ics');
});
