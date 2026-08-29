// Reminders engine (Reminders feature). Pure logic — no IndexedDB, no DOM — so
// the same urgency/due math runs in the app and in the unit tests, exactly like
// lib/maintenance.ts. It answers three questions for every reminder:
//   • is it due, coming up soon, later, or paused? (the urgency ladder)
//   • how should its one-line detail read to a shooter?
//   • what changes when the shooter marks it done? (advance date / round baseline)
//
// The two triggers share ONE ladder so the shooter never checks two places:
//   date-based   → measured in days until the due date
//   round-count  → measured in rounds remaining on a gun (current lifetime rounds
//                  minus the baseline, against the interval)
// A due item rises into Home's "Needs Attention"; a soon item sits in "Coming up".

import type { Firearm, Match, Reminder, Session } from './types.ts';
import { dayKey, formatDayKey } from './dates.ts';
import { roundsForFirearm } from './stats.ts';

/** Date reminders due within this many days are "coming up" (spec §2). */
export const REMINDER_HORIZON_DAYS = 30;

/** Round reminders within this many rounds of their interval are "coming up".
 *  Unspecified by the spec (it says "within N rounds") — 500 is roughly a range
 *  trip or two, so a spring/part reminder surfaces with time to order the part. */
export const REMINDER_HORIZON_ROUNDS = 500;

/** Home's "Coming up" card shows at most this many, soonest first (spec §6b LOCKED). */
export const HOME_COMING_UP_CAP = 4;

export type ReminderLevel = 'due' | 'soon' | 'later' | 'inactive';

export interface ReminderView {
  reminder: Reminder;
  level: ReminderLevel;
  /** Lower = more urgent. Days-until for date reminders, rounds-remaining for
   *  round reminders (both go negative once past due), so an ascending sort puts
   *  the most-overdue first and the soonest-upcoming next. Mixing the two units
   *  in one bucket is imperfect but minor — Home's card is horizon-filtered and
   *  realistically holds a handful. */
  sortKey: number;
  /** Human one-liner: "Due today", "Overdue by 3 days", "In 12 days · Jul 14, 2026",
   *  "1,900 of 5,000 rounds — 3,100 to go". Empty for paused reminders. */
  detail: string;
  gunName?: string;
}

export interface ReminderContext {
  /** Today as a local YYYY-MM-DD day-key. */
  today: string;
  /** A gun's lifetime round count, or null when it can't be resolved (gun gone) —
   *  a null makes the reminder gracefully inactive instead of crashing a screen. */
  roundsForGun: (gunId: string) => number | null;
  /** A gun's display name, or undefined. */
  gunName: (gunId: string) => string | undefined;
}

/**
 * Build the context every reminder is measured against, from the app's data.
 * ONE place so Home and the Reminders screen resolve rounds/names identically.
 * A gun that no longer exists resolves to null rounds (the reminder goes quietly
 * inactive) rather than crashing. Pass ACTIVE sessions only (trashed excluded).
 */
export function buildReminderContext(
  firearms: Firearm[],
  sessions: Session[],
  matches: Match[],
  today: string,
): ReminderContext {
  const byId = new Map(firearms.map((f) => [f.id, f]));
  return {
    today,
    roundsForGun: (gunId) => (byId.has(gunId) ? roundsForFirearm(gunId, firearms, sessions, matches) : null),
    gunName: (gunId) => byId.get(gunId)?.name,
  };
}

// ---- date helpers (local, DST-safe: parse at local noon) ----

// Exported (audit round 3, F-1): opticBattery.ts needs the exact same
// day-parsing this file already uses for a reminder's own dueDate, rather
// than writing a second regex/parser that could quietly disagree with this
// one — see isRealDayKey below for why "parses" isn't the same question as
// "is a real day".
export function parseDay(key: string | null | undefined): Date | null {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/**
 * True only when `key` is EXACTLY a real calendar day in canonical
 * YYYY-MM-DD form (audit round 3, F-1). The shape regex alone isn't enough:
 * JS's Date constructor NORMALIZES calendar overflow instead of rejecting
 * it — `new Date(2027, 1, 30, ...)` silently becomes March 2, so a naive
 * "did parseDay return non-null" check calls '2027-02-30' just as parseable
 * as '2027-02-28'. The round-trip (`dayKey(parseDay(key)) === key`) catches
 * that: a normalized value can never round-trip back to the key it came
 * from. This is also engine-INDEPENDENT, unlike parsing the string as a
 * Date-time via `new Date(key + 'T12:00:00')` (ECMA-262 leaves out-of-range
 * date-time fields implementation-defined, and V8's legacy-format fallback
 * need not agree with WebKit's — this app's floor is Safari 15.4).
 */
export function isRealDayKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const d = parseDay(key);
  return d !== null && dayKey(d) === key;
}

/** Whole days from `fromKey` to `toKey` (positive = to is later). Null if unparseable. */
export function daysBetween(fromKey: string, toKey: string): number | null {
  const a = parseDay(fromKey);
  const b = parseDay(toKey);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Shift a day-key by whole months (JS normalizes overflow, e.g. Jan 31 + 1mo). */
export function addMonthsToDay(key: string, months: number): string {
  const d = parseDay(key);
  if (!d) return key;
  return dayKey(new Date(d.getFullYear(), d.getMonth() + months, d.getDate(), 12));
}

/**
 * Where a recurring date reminder's due date lands when the shooter marks it
 * done: ALWAYS at least one interval forward from the current due date — done is
 * done, even done EARLY (swapping the battery a week ahead of its date must not
 * leave the reminder armed to fire again this cycle) — and then, when it was
 * completed very late, kept advancing until strictly after today, so it can't
 * come back already overdue. Null when it doesn't repeat or has no date.
 */
export function advanceDueDate(
  due: string | null | undefined,
  repeat: Reminder['repeat'],
  repeatMonths: number | null | undefined,
  today: string,
): string | null {
  if (!due || !repeat || repeat === 'none') return null;
  const step = repeat === 'yearly' ? 12 : Math.max(1, repeatMonths ?? 1);
  let next = addMonthsToDay(due, step); // at least one interval, even from a future date
  // Guard the loop so a bad interval can never hang (at most a few hundred steps).
  for (let i = 0; i < 1200; i++) {
    const days = daysBetween(today, next);
    if (days === null || days > 0) break;
    next = addMonthsToDay(next, step);
  }
  return next;
}

// ---- urgency ----

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function inactive(r: Reminder, gunName: string | undefined): ReminderView {
  return { reminder: r, level: 'inactive', sortKey: Number.POSITIVE_INFINITY, detail: '', gunName };
}

/** The urgency + detail of ONE reminder against a context. Never throws. */
export function reminderView(r: Reminder, ctx: ReminderContext): ReminderView {
  const gunName = r.firearmId ? ctx.gunName(r.firearmId) : undefined;
  if (r.enabled === false) return inactive(r, gunName);

  if (r.trigger === 'rounds') {
    const interval = r.everyRounds ?? 0;
    const rounds = r.firearmId ? ctx.roundsForGun(r.firearmId) : null;
    // A round reminder without a resolvable gun or a real interval can't be
    // measured — hide it gracefully rather than show a broken row.
    if (!r.firearmId || rounds === null || !(interval > 0)) return inactive(r, gunName);
    const since = Math.max(0, rounds - (r.baselineRounds ?? 0));
    const remaining = interval - since;
    const level: ReminderLevel = remaining <= 0 ? 'due' : remaining <= REMINDER_HORIZON_ROUNDS ? 'soon' : 'later';
    const detail = remaining <= 0
      ? `${since.toLocaleString()} of ${interval.toLocaleString()} rounds — due now`
      : `${since.toLocaleString()} of ${interval.toLocaleString()} rounds — ${remaining.toLocaleString()} to go`;
    return { reminder: r, level, sortKey: remaining, detail, gunName };
  }

  // date-based
  // Audit round 3, closing review, item 1: dueDate must be judged by the
  // SAME rule reminderGovernsOptic (lib/opticBattery.ts) holds it to now —
  // isRealDayKey, not merely "daysBetween's lenient parser accepted it".
  // Before this, a calendar-invalid dueDate like '2027-02-30' rendered here
  // as an active reminder while the optic it governs read the fallback
  // rule's own verdict — two screens, two answers about the same battery.
  const days = isRealDayKey(r.dueDate) ? daysBetween(ctx.today, r.dueDate) : null;
  if (days === null) return inactive(r, gunName);
  const level: ReminderLevel = days <= 0 ? 'due' : days <= REMINDER_HORIZON_DAYS ? 'soon' : 'later';
  const when = formatDayKey(r.dueDate as string);
  const detail = days < 0
    ? `Overdue by ${plural(-days, 'day')} · was ${when}`
    : days === 0
      ? 'Due today'
      : `In ${plural(days, 'day')} · ${when}`;
  return { reminder: r, level, sortKey: days, detail, gunName };
}

export function reminderViews(list: Reminder[], ctx: ReminderContext): ReminderView[] {
  return list.map((r) => reminderView(r, ctx));
}

const bySoonest = (a: ReminderView, b: ReminderView): number => a.sortKey - b.sortKey;

/** Overdue-or-due items (rise into Home's Needs Attention), soonest/most-overdue first. */
export function dueReminders(views: ReminderView[]): ReminderView[] {
  return views.filter((v) => v.level === 'due').sort(bySoonest);
}

/** Coming-up items (the "Coming up" bucket), soonest first. */
export function comingUpReminders(views: ReminderView[]): ReminderView[] {
  return views.filter((v) => v.level === 'soon').sort(bySoonest);
}

/** Further-out items (the "Later" bucket), soonest first. */
export function laterReminders(views: ReminderView[]): ReminderView[] {
  return views.filter((v) => v.level === 'later').sort(bySoonest);
}

/**
 * Everything that isn't on the active ladder — the Done section on the Reminders
 * screen. Deliberately level-based, not enabled-based: it catches paused/finished
 * reminders AND any record that can't be measured (a round-count reminder whose
 * gun left the log, a record missing its date/interval), so a stored reminder is
 * NEVER invisible and unreachable — it always has a row with a working Delete.
 */
export function inactiveReminders(views: ReminderView[]): ReminderView[] {
  return views.filter((v) => v.level === 'inactive');
}

/**
 * The Done-section sub-line for an inactive reminder, in plain range language.
 * `gunResolved` = the reminder's gun (if it names one) still exists in the log.
 */
export function inactiveNote(r: Reminder, gunResolved: boolean): string {
  if (r.enabled === false) {
    return r.lastDoneDate ? `Marked done ${formatDayKey(r.lastDoneDate)}` : 'Paused';
  }
  if (r.firearmId && !gunResolved) {
    return 'The gun this was for is no longer in your log — you can delete this reminder.';
  }
  // Audit round 3, closing review, item 1: a date that's PRESENT but
  // calendar-invalid (e.g. '2027-02-30') is a different situation from one
  // that's simply missing — "Missing its date" is imprecise, and mildly
  // confusing, for a record the shooter can see has a dueDate value.
  if (r.trigger === 'date' && r.dueDate && !isRealDayKey(r.dueDate)) {
    return "That date isn't valid — open it to fix or delete it.";
  }
  return 'Missing its date or round count — open it to fix or delete it.';
}

/** The reminders that belong to one gun — deleted alongside a permanent gun
 *  delete so no reminder is ever stranded pointing at a gun that's gone. */
export function reminderIdsForGun(
  reminders: Pick<Reminder, 'id' | 'firearmId'>[],
  gunId: string,
): string[] {
  return reminders.filter((r) => r.firearmId === gunId).map((r) => r.id);
}

/**
 * The Home "Coming up" card model (spec §6b LOCKED): at most `cap` items, soonest
 * first, and a "See all coming up (N)" row ONLY when more than `cap` exist. N is
 * the TOTAL count of coming-up items.
 */
export function homeComingUp(
  views: ReminderView[],
  cap: number = HOME_COMING_UP_CAP,
): { shown: ReminderView[]; total: number; hasOverflow: boolean } {
  const all = comingUpReminders(views);
  return { shown: all.slice(0, cap), total: all.length, hasOverflow: all.length > cap };
}

/**
 * The patch to apply when a shooter marks a reminder done. Pure so it's tested:
 *  - round-based: reset the baseline to the gun's current rounds (recurs forever).
 *  - recurring date: advance the due date one interval past the current due date
 *    (advanceDueDate above — an EARLY done still rolls forward; a very-late done
 *    rolls past today), so "mark one done and a repeating date rolls forward"
 *    stays true no matter when the shooter does the work.
 *  - one-off date: pause it (enabled=false) so it drops off the active ladder but
 *    stays in the Done section, re-enable-able.
 * Always stamps lastDoneDate.
 */
export function completionPatch(r: Reminder, ctx: ReminderContext): Partial<Reminder> {
  const today = ctx.today;
  if (r.trigger === 'rounds') {
    const rounds = r.firearmId ? ctx.roundsForGun(r.firearmId) : null;
    return { lastDoneDate: today, baselineRounds: rounds ?? r.baselineRounds ?? 0 };
  }
  if (r.repeat && r.repeat !== 'none' && r.dueDate) {
    const next = advanceDueDate(r.dueDate, r.repeat, r.repeatMonths ?? null, today);
    return { lastDoneDate: today, dueDate: next ?? r.dueDate };
  }
  return { lastDoneDate: today, enabled: false };
}
