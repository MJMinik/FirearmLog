// Hand-rolled iCalendar (.ics) for the "Add to Calendar" action — no server, no
// dependency (rule 43: keep the footprint small). Only DATE-based reminders can
// become a calendar event; a round-count reminder has no date to export, so the
// button never appears for one. Apple's Calendar/Reminders then owns the alert —
// the honest way to notify a closed phone without a push server (spec §3, §6.4).
//
// Pure text in, text out, so every escape and RRULE is unit-tested.

import type { Reminder } from './types.ts';

/** A reminder can be added to a calendar only when it's date-based with a date. */
export function canExportIcs(r: Reminder): boolean {
  return r.trigger === 'date' && !!r.dueDate;
}

// RFC 5545 text escaping: backslash, semicolon, comma, and newlines.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const pad = (n: number): string => String(n).padStart(2, '0');

// UTC timestamp in iCalendar basic form: 20260714T130000Z.
function stampUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// RFC 5545 line folding: no content line over 75 octets. Continuations begin with
// a single space. (We fold on characters — titles/notes are short and near-ASCII.)
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const out: string[] = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    out.push(' ' + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  if (rest.length) out.push(' ' + rest);
  return out.join('\r\n');
}

/**
 * Build a one-event .ics for a date reminder. An all-day event on the due date;
 * a yearly/every-N-months reminder carries the matching RRULE so the shooter's
 * calendar keeps it recurring. The calendar's own default all-day alert does the
 * notifying (no VALARM — all-day alarm offsets are unreliable across apps).
 */
export function buildReminderIcs(r: Reminder, now: Date = new Date()): string {
  if (!canExportIcs(r)) {
    throw new Error('Only date reminders can be added to a calendar.');
  }
  const date = (r.dueDate as string).replace(/-/g, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FirearmLog//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${r.id}@firearmlog`,
    `DTSTAMP:${stampUtc(now)}`,
    `DTSTART;VALUE=DATE:${date}`,
    `SUMMARY:${escapeText(r.title || 'FirearmLog reminder')}`,
  ];
  if (r.notes && r.notes.trim()) lines.push(`DESCRIPTION:${escapeText(r.notes.trim())}`);
  if (r.repeat === 'yearly') lines.push('RRULE:FREQ=YEARLY');
  else if (r.repeat === 'months' && r.repeatMonths) {
    lines.push(`RRULE:FREQ=MONTHLY;INTERVAL=${Math.max(1, Math.round(r.repeatMonths))}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** A safe download filename for a reminder's .ics. */
export function icsFileName(r: Reminder): string {
  const slug = (r.title || 'reminder')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `firearmlog-${slug || 'reminder'}.ics`;
}
