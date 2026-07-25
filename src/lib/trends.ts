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
 * Count malfunctions in `[sinceDate, untilDate)` (YYYY-MM-DD, `untilDate`
 * exclusive) that match the gun / category filter — same one-gun-wins-over-
 * category rule as the rounds chart.
 *
 * H-3: the "Malfunctions / 1,000 rds" rate's denominator (`bucketTotals`'s
 * `liveAndMatch`) counts only LIVE (and match) rounds — a dry-fire rep isn't a
 * round fired downrange, so a stoppage during dry-fire can't be part of a
 * per-live-round rate. A malfunction whose `sessionId` resolves to a
 * non-live (dry-fire) session is excluded via `liveSessionIds` (owner
 * decision, July 2026: exclude dry-fire stoppages from this rate — they're
 * real but belong to a different metric). A malfunction with NO `sessionId`
 * (older/imported data, or logged outside a session) can't be classified
 * either way, so it's included whenever its own `date` falls in the window —
 * documented choice, not an oversight.
 */
export function malfunctionsInRange(
  malfs: Pick<MalfunctionEntry, 'date' | 'firearmId' | 'sessionId'>[],
  sinceDate: string,
  untilDate: string,
  filter: { firearmId?: string; category?: GunCategory | '' },
  firearms: Pick<Firearm, 'id' | 'category'>[],
  liveSessionIds: Set<string>
): number {
  return malfs.filter((m) => {
    if (!m.date || m.date < sinceDate || m.date >= untilDate) return false;
    if (m.sessionId && !liveSessionIds.has(m.sessionId)) return false;
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
 * First day (YYYY-MM-DD) of the month AFTER `now` — the exclusive upper edge
 * the chart's bucket construction already uses implicitly (its last bucket is
 * `now`'s own month). H-3: shared so every "in range" check in this file uses
 * the same window edge as the chart, instead of each helper reading its own
 * independent `new Date()`.
 */
export function spanEndExclusive(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * H-4: hard ceiling on the "All time" span. 600 months = 50 years, far beyond
 * any real shooting history — this only exists to stop a corrupt/mistyped
 * date (e.g. a four-digit year typo) from producing an absurd span that
 * silently blanks the chart (near-zero-width bars) or requests a huge SVG.
 */
export const MAX_SPAN_MONTHS = 600;

/** A day-key must be a real ISO calendar date: YYYY-MM-DD, 01–12, 01–31. */
const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Whole months from the earliest logged (non-planned) session or match up to
 * `now`, inclusive — clamped to [1, MAX_SPAN_MONTHS]. Powers the "All time"
 * span so the chart and totals cover a user's entire history without a
 * hardcoded month count. Falls back to 1 when there's no data yet (H-4: a
 * fake 12-month "all time" history was a lie for a brand-new user).
 *
 * H-4: a date that isn't strict `YYYY-MM-DD` (e.g. a US-format '12/03/2025'
 * arriving via a .flog restore, or any other malformed string) is REJECTED
 * before it can become `earliest` — string comparison would otherwise sort a
 * malformed date ahead of every real ISO date and feed a garbage year into
 * the month-diff arithmetic (the NaN chain that blanked the whole card).
 */
export function monthsSinceFirst(
  sessions: Pick<Session, 'date' | 'planned'>[],
  matches: Pick<Match, 'date'>[],
  now: Date = new Date()
): number {
  let earliest: string | null = null;
  for (const s of sessions) {
    if (s.planned || !s.date || !ISO_DATE_RE.test(s.date)) continue;
    if (!earliest || s.date < earliest) earliest = s.date;
  }
  for (const m of matches) {
    if (!m.date || !ISO_DATE_RE.test(m.date)) continue;
    if (!earliest || m.date < earliest) earliest = m.date;
  }
  if (!earliest) return 1;
  const y = Number(earliest.slice(0, 4));
  const mo = Number(earliest.slice(5, 7));
  const diff = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - mo) + 1;
  return Math.min(MAX_SPAN_MONTHS, Math.max(1, diff));
}

/** Dry-fire and live SESSION counts for the "Dry : live sessions" ratio. */
export interface SessionRatioCounts { liveSessions: number; drySessions: number; }

/**
 * Count dry-fire vs live SESSIONS in `[sinceDate, untilDate)` (YYYY-MM-DD,
 * `untilDate` exclusive), scoped to the gun/category filter — the basis for
 * the Trends card's "Dry : live sessions" row (Tester-2 Change-1, July 16
 * 2026). Sessions are firm units on both sides, unlike a user-defined "rep",
 * so the ratio compares session counts.
 *
 * "Live" vs "dry" and the planned-session exclusion mirror the Home sessions
 * tile EXACTLY — both count through `isLiveSession` / `isDrySession`, so the two
 * surfaces agree by construction. A session's relevance to a gun filter mirrors
 * the rounds chart via `sessionUsedFilteredGun` (a session counts if it USED the
 * gun/category). Matches are not sessions and are never counted here. Pure.
 *
 * H-3: `untilDate` is the same exclusive upper edge (`spanEndExclusive`) used
 * by the rounds chart and the malfunction rate, so a session mistyped into a
 * future year can't inflate this ratio either.
 */
export function sessionRatioCounts(
  sessions: Pick<Session, 'date' | 'planned' | 'type' | 'guns'>[],
  sinceDate: string,
  untilDate: string,
  filter: RoundsFilter,
  firearms: Pick<Firearm, 'id' | 'category'>[]
): SessionRatioCounts {
  let liveSessions = 0, drySessions = 0;
  for (const s of sessions ?? []) {
    if (!s.date || s.date < sinceDate || s.date >= untilDate) continue;
    if (!sessionUsedFilteredGun(s, filter, firearms)) continue;
    if (isDrySession(s)) drySessions++;
    else if (isLiveSession(s)) liveSessions++;
  }
  return { liveSessions, drySessions };
}
