// Maintenance forecasting (spec §2-§4, §6) — the pure-logic half. A rounds-based
// odometer ("3,200 of 5,000 rounds on this spring") gets one quiet extra line
// estimating WHEN the remainder runs out at the shooter's recent pace.
//
// Rate: per gun, from LIVE sessions only (not planned, not dry-fire) — the same
// rule every odometer already follows (see maintenance.ts roundsSince /
// liveSessionsSince). Trailing 90-day window ending today, total live rounds for
// that gun in the window ÷ 90 = rounds/day. Computed at read time from sessions
// already stored — no new stored field, no schema change, nothing written.
//
// Evidence gate: the forecast exists only with >= 3 live sessions AND >= 200
// live rounds for this gun in the window. Below the gate: null, silently — no
// "not enough data" placeholder. remainingRounds <= 0 also returns null, as
// defense in depth (the caller is expected to withhold this for an item that
// isn't a rounds-based odometer or is already `due`).
//
// Range: optimistic bound = remaining / (rate * 1.5) days out; pessimistic
// bound = remaining / (rate * 0.67) days out. Rendered as approximate calendar
// language, never day-precision — month + early/mid/late bucket. Two bounds in
// the same bucket collapse to one. A pessimistic bound beyond ~a year renders
// "Months away at your recent pace" and nothing more precise.
//
// Pure logic — fully unit tested.

import type { Session } from './types.ts';
import { dayKey } from './dates.ts';

const WINDOW_DAYS = 90;
const MIN_LIVE_SESSIONS = 3;
const MIN_LIVE_ROUNDS = 200;
const OPTIMISTIC_MULTIPLIER = 1.5;
const PESSIMISTIC_MULTIPLIER = 0.67;
const MONTHS_AWAY_THRESHOLD_DAYS = 365;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** Local-calendar date arithmetic (never UTC ms math — see dates.ts header).
 * `days` may be fractional; the Date constructor truncates the fractional
 * part (MakeDay coerces to integer), so this adds a whole number of calendar
 * days — the right granularity for bucketing, which is never day-precise. */
function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

interface BucketParts { year: number; month: number; bucket: string; phrase: string; }

/** Day 1-10 = early, 11-20 = mid, 21-end = late, then the month name.
 * The spec's approved copy hyphenates the mid form ("mid-September") and
 * spaces the others ("early October", "late September") — standard English
 * for the mid- prefix, and the exact strings Michael signed. */
function bucketParts(d: Date): BucketParts {
  const day = d.getDate();
  const bucket = day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late';
  const name = MONTH_NAMES[d.getMonth()];
  const phrase = bucket === 'mid' ? `mid-${name}` : `${bucket} ${name}`;
  return { year: d.getFullYear(), month: d.getMonth(), bucket, phrase };
}

interface ForecastCalc {
  optimisticDate: Date;
  pessimisticDate: Date;
  pessimisticDays: number;
}

/** Shared gate + rate + bound math behind both maintForecast and forecastLine,
 * so the two never drift on what "below the gate" means. */
function computeForecast(remainingRounds: number, gunId: string, sessions: Session[], now: Date): ForecastCalc | null {
  // Number.isFinite, not just <= 0: NaN compares false to everything, so a
  // NaN remaining (a malformed record upstream) would sail through a bare
  // <= 0 check and end as "late undefined" in user-facing copy. Silence is
  // the honest output for data the math cannot stand on.
  if (!Number.isFinite(remainingRounds) || remainingRounds <= 0) return null;

  const cutoff = dayKey(addDays(now, -WINDOW_DAYS));
  const today = dayKey(now);
  const inWindow = sessions.filter((s) =>
    !s.planned && s.type !== 'dry_fire' && s.date > cutoff && s.date <= today &&
    s.guns.some((g) => g.firearmId === gunId)
  );
  if (inWindow.length < MIN_LIVE_SESSIONS) return null;

  let roundsInWindow = 0;
  for (const s of inWindow) {
    // Strict typeof+isFinite guard — deliberately STRONGER than the `|| 0`
    // stats.ts uses, because `|| 0` would pass a truthy string through and a
    // string rounds value would CONCATENATE into the rate, not add. A record
    // with a missing/NaN/string rounds value contributes exactly nothing.
    for (const g of s.guns) if (g.firearmId === gunId) roundsInWindow += (typeof g.rounds === 'number' && Number.isFinite(g.rounds) ? g.rounds : 0);
  }
  if (roundsInWindow < MIN_LIVE_ROUNDS) return null;

  const rate = roundsInWindow / WINDOW_DAYS; // rounds/day, guaranteed > 0 above the gate
  const optimisticDays = remainingRounds / (rate * OPTIMISTIC_MULTIPLIER);
  const pessimisticDays = remainingRounds / (rate * PESSIMISTIC_MULTIPLIER);
  return {
    optimisticDate: addDays(now, optimisticDays),
    pessimisticDate: addDays(now, pessimisticDays),
    pessimisticDays
  };
}

/** The range as bucket phrases ("mid-September", "early October"), or null
 * below the gate (fewer than 3 live sessions in window, fewer than 200 live
 * rounds in window, or remainingRounds not a positive finite number).
 * NOTE: unlike forecastLine, this carries NO months-away shape — a caller
 * rendering these phrases directly must apply its own far-future handling
 * (forecastLine is the only UI-ready form). Bounds so far out that the Date
 * itself overflows (an absurd remaining count) return null rather than a
 * phrase built on an Invalid Date. */
export function maintForecast(
  remainingRounds: number, gunId: string, sessions: Session[], now: Date
): { earliest: string; latest: string } | null {
  const calc = computeForecast(remainingRounds, gunId, sessions, now);
  if (!calc) return null;
  if (isNaN(calc.optimisticDate.getTime()) || isNaN(calc.pessimisticDate.getTime())) return null;
  return { earliest: bucketParts(calc.optimisticDate).phrase, latest: bucketParts(calc.pessimisticDate).phrase };
}

/** The complete user-facing line, or null below the gate. Exactly three copy
 * shapes — see module header — no trailing period, no em dashes. */
export function forecastLine(
  remainingRounds: number, gunId: string, sessions: Session[], now: Date
): string | null {
  const calc = computeForecast(remainingRounds, gunId, sessions, now);
  if (!calc) return null;

  if (calc.pessimisticDays > MONTHS_AWAY_THRESHOLD_DAYS) {
    return 'Months away at your recent pace';
  }

  const earliest = bucketParts(calc.optimisticDate);
  const latest = bucketParts(calc.pessimisticDate);
  if (earliest.year === latest.year && earliest.month === latest.month && earliest.bucket === latest.bucket) {
    return `At your recent pace, due roughly ${earliest.phrase}`;
  }
  return `At your recent pace, due roughly ${earliest.phrase} to ${latest.phrase}`;
}
