// One battery verdict (OPTIC_BATTERY_INTEGRATION_SPEC.md, session 137). Pure
// logic — no IndexedDB, no DOM — same discipline as lib/optics.ts and
// lib/reminders.ts, and built ON TOP of them rather than beside them.
//
// WHY THIS FILE EXISTS: the app had two separate judges of "is this optic's
// battery due" — the 330-day badge (lib/optics.ts, isBatteryDue) and whatever
// reminder the shooter set for themselves — and they silently drift out of
// step, because nothing ties them together. From 10 June 2027 they disagree
// on all four of the author's own guns. This module is the ONE place a
// verdict is produced: every screen calls opticBatteryStatus and shows what
// it returns, so two screens can never say two different things again. An
// optic with a governing reminder gets its verdict FROM the reminder; only an
// optic nobody set a reminder for falls back to the old 330-day rule, so
// nobody loses the warning they have today.
//
// This module does no reimplementation of date math. Every day-count comes
// from lib/optics.ts or lib/reminders.ts, both already unit-tested — a second
// copy of that arithmetic here is exactly how the two systems drifted apart
// in the first place.

import type { Optic, Reminder } from './types.ts';
import { BATTERY_DUE_DAYS, normalizeBatteryLog } from './optics.ts';
import {
  advanceDueDate,
  daysBetween,
  isRealDayKey,
  reminderView,
  REMINDER_HORIZON_DAYS,
} from './reminders.ts';
import type { ReminderContext, ReminderView } from './reminders.ts';
import { dayKey } from './dates.ts';

/**
 * A Reminder, plus the optic-link field the data model is gaining (spec §4).
 * `Reminder` itself isn't touched here (pass-1 is logic-only — no schema
 * edit), so this is declared locally as an intersection: any real Reminder
 * satisfies it whether or not the field exists yet, and it becomes a plain
 * alias for `Reminder` once the field lands on the type for real.
 *
 * - Absent (`!('opticId' in reminder)`): a record from before linking
 *   existed. Eligible for the legacy read-time match below.
 * - `null`: deliberately unlinked by a person. Never legacy-matches — a
 *   person's "not this one" has to stick.
 * - A string: an explicit link, made once (by a form save) and durable from
 *   then on.
 */
export type ReminderWithOpticLink = Reminder & {
  opticId?: string | null;
};

/** The minimal shape this module needs from an Optic — keeps fixtures (and
 *  callers) from having to build a full Optic record just for a verdict. */
export type OpticForBatteryStatus = Pick<Optic, 'id' | 'firearmId' | 'batteryLog'>;

/** Only these three levels reach a screen for a governed optic — a governing
 *  reminder is by construction enabled, date-triggered and dated, so
 *  `reminderView` never hands one back 'inactive' (guarded anyway, below). */
export type OpticBatteryLevel = 'due' | 'soon' | 'later';

/**
 * The one verdict every screen renders, in place of `isBatteryDue`:
 *  - 'reminder': a reminder governs this optic. `level`/`detail` are exactly
 *    what the Reminders screen and Home would show for it — one verdict, one
 *    set of words, everywhere.
 *  - 'age-due' / 'ok': no reminder governs; today's 330-day rule, unchanged.
 *  - 'no-log': no reminder, and no readable battery-log entry at all (spec
 *    Decision 4 — a real, distinct state, never collapsed into 'ok').
 */
export type OpticBatteryStatus =
  | { kind: 'reminder'; level: OpticBatteryLevel; reminder: ReminderWithOpticLink; detail: string }
  | { kind: 'age-due'; days: number }
  | { kind: 'ok'; days: number }
  | { kind: 'no-log' };

/** "Battery-shaped" per spec §4: made from the optic-battery template, or a
 *  hand-written title that says so. The title clause exists ONLY to catch a
 *  hand-made "Optic Battery" reminder that predates templateKey — dropping it
 *  silently loses that whole case, hence its own pinned test. */
function isBatteryShaped(reminder: ReminderWithOpticLink): boolean {
  if (reminder.templateKey === 'optic-battery') return true;
  return typeof reminder.title === 'string' && reminder.title.toLowerCase().includes('battery');
}

/**
 * Does this one reminder govern this one optic? (spec §4, "Which reminder
 * governs an optic"). Never throws — every access on `reminder`/`optic` is
 * guarded, because both can be storage garbage.
 */
export function reminderGovernsOptic(
  reminder: ReminderWithOpticLink,
  optic: OpticForBatteryStatus,
  opticsOnSameGun: number,
): boolean {
  if (!reminder || typeof reminder !== 'object') return false;
  if (reminder.enabled === false) return false;
  if (reminder.trigger !== 'date') return false;
  if (!isRealDayKey(reminder.dueDate)) return false;

  const opticId = typeof optic?.id === 'string' && optic.id !== '' ? optic.id : null;

  // Explicit link always wins its own check, both ways: a matching opticId
  // governs even off a gun with several optics, and a link to a DIFFERENT
  // optic (or no id at all) is settled right here — it never falls through
  // to try the legacy path.
  if (opticId !== null && reminder.opticId === opticId) return true;
  if ('opticId' in reminder) return false; // present-but-not-matching: settled, not legacy-eligible

  // Legacy match: absent opticId key, same gun, that gun carries exactly one
  // optic today, and the reminder reads as being about a battery.
  const firearmId = reminder.firearmId;
  if (!firearmId || !optic?.firearmId || firearmId !== optic.firearmId) return false;
  if (opticsOnSameGun !== 1) return false;
  return isBatteryShaped(reminder);
}

/** A stub `ReminderContext` for a date-triggered reminder: `reminderView`
 *  only touches `roundsForGun`/`gunName` for round reminders or to label a
 *  view's `gunName`, neither of which this module needs — a real gun catalog
 *  would be one more thing this pure module would have to depend on. */
function dateOnlyContext(todayKey: string): ReminderContext {
  return { today: todayKey, roundsForGun: () => null, gunName: () => undefined };
}

/**
 * The reminder that governs this optic, or null. When more than one
 * qualifies, the SOONEST due date wins (earliest warning is the safe
 * tie-break) — using the exact same `sortKey` `reminderView` computes for
 * every other soonest-first list in the app. A dead-even tie (identical due
 * date) breaks on `id` so the result never depends on input order.
 */
export function governingReminder(
  optic: OpticForBatteryStatus,
  candidateReminders: readonly ReminderWithOpticLink[],
  opticsOnSameGun: number,
  today: Date,
): ReminderWithOpticLink | null {
  const list = Array.isArray(candidateReminders) ? candidateReminders : [];
  const governing = list.filter((r) => {
    try {
      return reminderGovernsOptic(r, optic, opticsOnSameGun);
    } catch {
      return false;
    }
  });
  if (governing.length === 0) return null;

  const ctx = dateOnlyContext(dayKey(today));
  let best: { reminder: ReminderWithOpticLink; sortKey: number } | null = null;
  for (const r of governing) {
    let view: ReminderView;
    try {
      view = reminderView(r, ctx);
    } catch {
      continue;
    }
    if (view.level === 'inactive') continue; // shouldn't happen for a governing reminder; guarded anyway
    const better =
      !best ||
      view.sortKey < best.sortKey ||
      (view.sortKey === best.sortKey && String(r.id) < String(best.reminder.id));
    if (better) best = { reminder: r, sortKey: view.sortKey };
  }
  return best ? best.reminder : null;
}

/**
 * The one verdict every screen renders for one optic. Never throws: garbage
 * in (`batteryLog` full of junk, a reminder missing fields, an unparseable
 * date) always yields a real status, never an exception — screens call this
 * mid-render and can't afford to crash on one bad record.
 */
export function opticBatteryStatus(
  optic: OpticForBatteryStatus,
  candidateReminders: readonly ReminderWithOpticLink[],
  opticsOnSameGun: number,
  today: Date,
): OpticBatteryStatus {
  try {
    const reminder = governingReminder(optic, candidateReminders, opticsOnSameGun, today);
    if (reminder) {
      const view = reminderView(reminder, dateOnlyContext(dayKey(today)));
      if (view.level !== 'inactive') {
        return { kind: 'reminder', level: view.level, reminder, detail: view.detail };
      }
    }
  } catch {
    // Fall through to the fallback column below — a broken reminder never
    // means a broken screen, it just means this optic reads as ungoverned.
  }

  try {
    const rawLog = Array.isArray(optic?.batteryLog) ? optic.batteryLog : [];
    // normalizeBatteryLog only requires date !== '' — a garbage string like
    // 'not-a-date' passes THAT filter (and rightly stays in the visible
    // Battery Log list on the Optics screen, per Decision 2's delete-it-
    // yourself model). The verdict only uses entries whose date is a REAL
    // calendar day per isRealDayKey (lib/reminders.ts) — the same check a
    // reminder's own dueDate is held to, above. normalizeBatteryLog's sort
    // is lexical, but that's provably chronological for every entry that
    // survives this filter, since isRealDayKey only lets canonical
    // YYYY-MM-DD keys through.
    const last = normalizeBatteryLog(rawLog).filter((e) => isRealDayKey(e.date))[0];
    if (!last) return { kind: 'no-log' };
    const todayStr = dayKey(today);
    const days = daysBetween(last.date, todayStr);
    // Unreachable from every app caller, which always passes `new Date()`
    // (an Invalid Date only exists on this function's TYPE signature, not on
    // any real call). Kept because it's what stops that Invalid-Date case
    // from leaking `days: null` into a `number` field — nothing stronger.
    if (days === null) return { kind: 'no-log' };
    return days > BATTERY_DUE_DAYS ? { kind: 'age-due', days } : { kind: 'ok', days };
  } catch {
    return { kind: 'no-log' };
  }
}

/**
 * The pure half of "logging a battery change moves the reminder" (spec §4,
 * Decision 3 = option A). Given the reminder that governs an optic (the
 * caller establishes governance via `opticBatteryStatus`/`governingReminder`
 * BEFORE calling this — it is not re-checked here), the date of a
 * battery-log entry just saved, the optic's battery log AFTER that entry was
 * added (so "is it the newest" can be answered), and today: returns the
 * patch to apply to the reminder, or null when nothing should move.
 *
 * Nothing moves when:
 *  - the new entry isn't the newest date in the log (a backdated history
 *    entry — fixing an old record — must never reach forward into the
 *    future and drag the reminder with it), or
 *  - the entry lands MORE than REMINDER_HORIZON_DAYS (30) days before the
 *    due date — an off-schedule early change (Decision 3-A). The anchored
 *    date (a birthday, a memorable day) stands; the early swap is logged as
 *    fact and nothing else happens. This is the whole point of 3-A: without
 *    it, an early battery death would silently reschedule an anniversary.
 *
 * Otherwise — within 30 days before the due date, on it, or past it — this
 * counts as doing the scheduled swap: a repeating reminder advances via the
 * EXISTING `advanceDueDate` (never reimplemented here), a one-off reminder is
 * paused (mirrors `completionPatch`), and `lastDoneDate` is set to the
 * CHANGE date (not necessarily today — the sheet allows a backdated-to-today
 * or past change) in both cases.
 */
export function batteryChangeRollForward(
  reminder: ReminderWithOpticLink,
  changeDate: string,
  batteryLogAfterChange: unknown[],
  today: Date,
): Partial<Reminder> | null {
  try {
    if (!reminder || typeof reminder !== 'object') return null;
    if (typeof changeDate !== 'string' || changeDate === '') return null;
    if (!isRealDayKey(reminder.dueDate)) return null;
    const dueDate = reminder.dueDate;

    const log = Array.isArray(batteryLogAfterChange) ? batteryLogAfterChange : [];
    // Same rule as opticBatteryStatus above: "newest" means newest among
    // entries whose date is a REAL calendar day (isRealDayKey), not merely
    // newest by raw string sort among entries with date !== ''. A garbage
    // date — free text, or a calendar-invalid key like '2027-02-30' — must
    // not be able to sort ahead of every real date and permanently block
    // roll-forward for this optic (newest.date !== changeDate would then
    // fail forever, since the garbage entry can never equal a real
    // changeDate).
    const newest = normalizeBatteryLog(log).filter((e) => isRealDayKey(e.date))[0];
    if (!newest || newest.date !== changeDate) return null; // not the newest REAL entry: no movement

    // Days from the change to the due date: positive = due date is that many
    // days AFTER the change (change is early); zero/negative = on or past it.
    const gap = daysBetween(changeDate, dueDate);
    if (gap === null) return null;
    if (gap > REMINDER_HORIZON_DAYS) return null; // Decision 3-A: off-schedule early, anchor stands

    const todayKey = dayKey(today);
    if (reminder.repeat && reminder.repeat !== 'none') {
      const next = advanceDueDate(dueDate, reminder.repeat, reminder.repeatMonths ?? null, todayKey);
      return { dueDate: next ?? dueDate, lastDoneDate: changeDate };
    }
    return { enabled: false, lastDoneDate: changeDate };
  } catch {
    return null; // never throw; "nothing moves" is the safe direction to fail in.
  }
}
