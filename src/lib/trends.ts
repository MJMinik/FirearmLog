// Progress-tab trend helpers (spec §10.2). Pure + tested. The rounds-by-month
// aggregation already lives in dashboard.ts and is reused; this adds the
// malfunction-rate and dry/live math.
import type { Firearm, GunCategory, MalfunctionEntry } from './types.ts';
import type { MonthBucket } from './dashboard.ts';

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
