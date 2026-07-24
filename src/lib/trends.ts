// Progress-tab trend helpers (spec §10.2). Pure + tested. The rounds-by-month
// aggregation already lives in dashboard.ts and is reused; this adds the
// malfunction-rate and dry/live math.
import type { Firearm, GunCategory, MalfunctionEntry, Match, Session } from './types.ts';
import type { MonthBucket, RoundsFilter } from './dashboard.ts';
import { isLiveSession, isDrySession, sessionUsedFilteredGun } from './dashboard.ts';

/** Events per 1,000 rounds (e.g. malfunctions). Null when there are no rounds. */
export function ratePerThousand(events: number, rounds: number): number | null {
  if (rounds <= 0) return null;
  return (events / rounds) * 1000;
}

/** Totals across the month buckets the chart is already showing. */
export function bucketTotals(buckets: MonthBucket[]): { live: number; match: number; dry: number; liveAndMatch: number } {
  let live = 0, match = 0, dry = 0;
  for (const b of buckets) { live += b.liveRounds; match += b.matchRounds; dry += b.dryReps; }
  return { live, match, dry, liveAndMatch: live + match };
}

/**
 * Count malfunctions on/after `sinceDate` (YYYY-MM-DD) that match the gun /
 * category filter — same one-gun-wins-over-category rule as the rounds chart.
 */
export function malfunctionsInRange(
  malfs: Pick<MalfunctionEntry, 'date' | 'firearmId'>[],
  sinceDate: string,
  filter: { firearmId?: string; category?: GunCategory | '' },
  firearms: Pick<Firearm, 'id' | 'category'>[]
): number {
  return malfs.filter((m) => {
    if (!m.date || m.date < sinceDate) return false;
    if (filter.firearmId) return m.firearmId === filter.firearmId;
    if (filter.category) return firearms.find((f) => f.id === m.firearmId)?.category === filter.category;
    return true;
  }).length;
}

/** First day (YYYY-MM-DD) of the month `months-1` months before `now`. */
export function spanStartDate(months: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Whole months from the earliest logged (non-planned) session or match up to
 * `now`, inclusive — minimum 1. Powers the "All time" span so the chart and
 * totals cover a user's entire history without a hardcoded month count. Falls
 * back to 12 when there's no data yet.
 */
export function monthsSinceFirst(
  sessions: Pick<Session, 'date' | 'planned'>[],
  matches: Pick<Match, 'date'>[],
  now: Date = new Date()
): number {
  let earliest: string | null = null;
  for (const s of sessions) {
    if (s.planned || !s.date) continue;
    if (!earliest || s.date < earliest) earliest = s.date;
  }
  for (const m of matches) {
    if (!m.date) continue;
    if (!earliest || m.date < earliest) earliest = m.date;
  }
  if (!earliest) return 12;
  const y = Number(earliest.slice(0, 4));
  const mo = Number(earliest.slice(5, 7));
  const diff = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - mo) + 1;
  return Math.max(1, diff);
}

/** Dry-fire and live SESSION counts for the "Dry : live sessions" ratio. */
export interface SessionRatioCounts { liveSessions: number; drySessions: number; }

/**
 * Count dry-fire vs live SESSIONS on/after `sinceDate` (YYYY-MM-DD), scoped to
 * the gun/category filter — the basis for the Trends card's "Dry : live
 * sessions" row (Tester-2 Change-1, July 16 2026). Sessions are firm units on
 * both sides, unlike a user-defined "rep", so the ratio compares session counts.
 *
 * "Live" vs "dry" and the planned-session exclusion mirror the Home sessions
 * tile EXACTLY — both count through `isLiveSession` / `isDrySession`, so the two
 * surfaces agree by construction. A session's relevance to a gun filter mirrors
 * the rounds chart via `sessionUsedFilteredGun` (a session counts if it USED the
 * gun/category). Matches are not sessions and are never counted here. Pure.
 */
export function sessionRatioCounts(
  sessions: Pick<Session, 'date' | 'planned' | 'type' | 'guns'>[],
  sinceDate: string,
  filter: RoundsFilter,
  firearms: Pick<Firearm, 'id' | 'category'>[]
): SessionRatioCounts {
  let liveSessions = 0, drySessions = 0;
  for (const s of sessions ?? []) {
    if (!s.date || s.date < sinceDate) continue;
    if (!sessionUsedFilteredGun(s, filter, firearms)) continue;
    if (isDrySession(s)) drySessions++;
    else if (isLiveSession(s)) liveSessions++;
  }
  return { liveSessions, drySessions };
}
