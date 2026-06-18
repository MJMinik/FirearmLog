// Dashboard aggregation logic — pure functions, no DOM, fully tested.
// Drives the Home screen's stat grid, Rounds by Month chart, training-gap
// alert, and self-rating trend alert.

import type { Session, Match, Ammunition, Firearm, DrillDef, DrillResult, GunCategory } from './types.ts';
import { sessionRounds, totalRounds } from './stats.ts';
import { classificationProgress } from './competition.ts';
import type { ClassProgress } from './competition.ts';

// ---- Rounds by Month (stacked: live + match, grouped by calendar month) ----

export interface MonthBucket {
  /** YYYY-MM */
  key: string;
  /** Human label: "Jan '26" */
  label: string;
  liveRounds: number;
  matchRounds: number;
  dryReps: number;
  total: number;
}

/**
 * Narrow the Rounds by Month chart to one gun type or one individual gun
 * (Michael's "Searchable" minimum — C3/G5). Empty/unset = everything.
 */
export interface RoundsFilter {
  category?: GunCategory | '';
  firearmId?: string;
}

function gunCategoryOf(firearmId: string, firearms: Pick<Firearm, 'id' | 'category'>[]): GunCategory | undefined {
  return firearms.find(f => f.id === firearmId)?.category;
}

/** Rounds in one session that count toward the filter (one gun wins over category). */
function sessionRoundsFiltered(
  s: Pick<Session, 'guns'>,
  filter: RoundsFilter | undefined,
  firearms: Pick<Firearm, 'id' | 'category'>[]
): number {
  if (!filter || (!filter.firearmId && !filter.category)) return sessionRounds(s);
  return s.guns.reduce((sum, g) => {
    if (filter.firearmId) return g.firearmId === filter.firearmId ? sum + (g.rounds || 0) : sum;
    if (filter.category) return gunCategoryOf(g.firearmId, firearms) === filter.category ? sum + (g.rounds || 0) : sum;
    return sum;
  }, 0);
}

/** Rounds in one match that count toward the filter (matches have a single gun). */
function matchRoundsFiltered(
  m: Pick<Match, 'totalRounds' | 'firearmId'>,
  filter: RoundsFilter | undefined,
  firearms: Pick<Firearm, 'id' | 'category'>[]
): number {
  const rds = typeof m.totalRounds === 'number' ? m.totalRounds : 0;
  if (!filter || (!filter.firearmId && !filter.category)) return rds;
  if (filter.firearmId) return m.firearmId === filter.firearmId ? rds : 0;
  if (filter.category) return gunCategoryOf(m.firearmId, firearms) === filter.category ? rds : 0;
  return 0;
}

/**
 * Aggregate rounds fired per calendar month for the last `months` months.
 * Each month bucket has live session rounds, match rounds, and dry-fire reps.
 * Optionally narrowed to one gun type or one gun (C3 "Rounds by Month searchable").
 */
export function roundsByMonth(
  sessions: Pick<Session, 'date' | 'guns' | 'planned' | 'type'>[],
  matches: Pick<Match, 'date' | 'totalRounds' | 'firearmId'>[],
  months: number,
  now: Date = new Date(),
  filter: RoundsFilter = {},
  firearms: Pick<Firearm, 'id' | 'category'>[] = []
): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const short = d.toLocaleString('default', { month: 'short' });
    const yr = String(d.getFullYear()).slice(2);
    buckets.push({ key, label: `${short} '${yr}`, liveRounds: 0, matchRounds: 0, dryReps: 0, total: 0 });
  }
  const keySet = new Set(buckets.map(b => b.key));

  for (const s of sessions) {
    if (s.planned || !s.date) continue;
    const mk = s.date.slice(0, 7); // YYYY-MM
    if (!keySet.has(mk)) continue;
    const bucket = buckets.find(b => b.key === mk)!;
    const rds = sessionRoundsFiltered(s, filter, firearms);
    if (s.type === 'dry_fire') {
      bucket.dryReps += rds;
    } else {
      bucket.liveRounds += rds;
    }
  }
  for (const m of matches) {
    if (!m.date) continue;
    const mk = m.date.slice(0, 7);
    if (!keySet.has(mk)) continue;
    const bucket = buckets.find(b => b.key === mk)!;
    bucket.matchRounds += matchRoundsFiltered(m, filter, firearms);
  }
  for (const b of buckets) b.total = b.liveRounds + b.matchRounds + b.dryReps;
  return buckets;
}

// ---- Training gap alert ----

/** Days since the most recent non-planned session. Null if no sessions. */
export function daysSinceLastSession(
  sessions: Pick<Session, 'date' | 'planned'>[],
  now: Date = new Date()
): number | null {
  let newest = '';
  for (const s of sessions) {
    if (!s.planned && s.date > newest) newest = s.date;
  }
  if (!newest) return null;
  const last = new Date(newest + 'T12:00:00');
  return Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
}

// ---- Self-rating trend ----

/**
 * True when the last 3 rated sessions show a declining fundamentals score
 * AND the average has dipped > 0.5 below the preceding 3 sessions.
 */
export function selfRatingDipping(
  sessions: Pick<Session, 'date' | 'selfRating'>[]
): { dipping: boolean; last3Avg: number; prevAvg: number } | null {
  const rated = [...sessions]
    .filter(s => s.selfRating && typeof (s.selfRating as Record<string, unknown>).fundamentals === 'number')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (rated.length < 4) return null;
  const getFund = (s: typeof rated[0]) => (s.selfRating as Record<string, number>).fundamentals;
  const last3 = rated.slice(0, 3).map(getFund);
  const prev = rated.slice(3, 6).map(getFund);
  if (prev.length === 0) return null;
  const last3Avg = last3.reduce((a, b) => a + b, 0) / last3.length;
  const prevAvg = prev.reduce((a, b) => a + b, 0) / prev.length;
  const declining = last3[0] <= last3[1] && last3[1] <= last3[2];
  return { dipping: declining && last3Avg < prevAvg - 0.5, last3Avg, prevAvg };
}

// ---- Quick stats for the grid ----

export interface DashboardStats {
  liveFireRounds: number;
  liveSessions: number;
  drySessions: number;
  totalSessions: number;
  ammoInventory: number;
  /** Classification for the top division, if any. */
  classification: (ClassProgress & { division: string }) | null;
  /** "Training since January 2025" */
  trainingSince: string | null;
}

export function dashboardStats(
  firearms: Firearm[],
  sessions: Session[],
  matches: Match[],
  classifiers: { date: string; percent: number | null; division: string }[],
  ammo: Ammunition[]
): DashboardStats {
  const liveFireRounds = totalRounds(firearms, sessions, matches);
  const liveSessions = sessions.filter(s => !s.planned && s.type !== 'dry_fire').length;
  const drySessions = sessions.filter(s => !s.planned && s.type === 'dry_fire').length;
  const totalSess = sessions.filter(s => !s.planned).length;
  const ammoInventory = ammo.reduce((s, a) => s + (a.quantity || 0), 0);

  // Classification: find all divisions, pick the one with the highest average.
  const divs = [...new Set(classifiers.map(c => c.division).filter(Boolean))];
  let classification: DashboardStats['classification'] = null;
  for (const div of divs) {
    const scores = classifiers.filter(c => c.division === div);
    const prog = classificationProgress(scores);
    if (prog.average !== null) {
      if (!classification || prog.average > (classification.average ?? 0)) {
        classification = { ...prog, division: div };
      }
    }
  }

  // Training since
  const dates = sessions.filter(s => !s.planned).map(s => s.date).sort();
  let trainingSince: string | null = null;
  if (dates.length > 0) {
    const d = new Date(dates[0] + 'T00:00:00');
    trainingSince = d.toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  return {
    liveFireRounds, liveSessions, drySessions,
    totalSessions: totalSess, ammoInventory,
    classification, trainingSince
  };
}

// ---- Firearm status summaries (for the status cards) ----

export interface FirearmStatusSummary {
  id: string;
  name: string;
  liveRounds: number;
  dryReps: number;
  /** Deep clean progress: rounds since / interval. */
  deepClean: { rounds: number; interval: number; level: 'ok' | 'warn' | 'due' };
  /** Last field strip date or null. */
  lastFieldStrip: string | null;
}

// ---- Alert dismissal ----

/**
 * Key for a dismissable alert. Encodes enough to know when to un-dismiss:
 * a dismissed alert reappears once the underlying trigger resets (e.g.,
 * the user logs maintenance and then hits the threshold again).
 */
export function alertDismissKey(firearmId: string, type: string, level: string): string {
  return `alert:${firearmId}:${type}:${level}`;
}

/**
 * Should this alert be shown? It's hidden if it was dismissed AND the
 * trigger hasn't changed since dismissal.
 */
export function isAlertDismissed(
  key: string,
  dismissed: Record<string, string>,
  currentDetail: string
): boolean {
  return dismissed[key] === currentDetail;
}

// ---- Backup reminder (event-threshold nudge) ----

/**
 * Stores whose records count as "meaningful changes" toward the backup nudge
 * (spec decision 2). Deletes aren't counted in v1 — a removed record leaves no
 * stamp to read.
 */
export const BACKUP_TRACKED_STORES = [
  'sessions', 'matches', 'firearms', 'optics', 'ammunition',
  'magazines', 'parts', 'drills', 'maintenance', 'purchases', 'goals'
] as const;

/**
 * How many un-backed-up changes before the Home nudge appears. Fixed in v1; a
 * user-settable threshold is the planned fast-follow.
 */
export const BACKUP_REMINDER_THRESHOLD = 10;

/**
 * Count records created or edited since the last backup. `since` is the
 * lastBackupAt timestamp (0 = never backed up, so everything counts). Pure and
 * tested; the Home screen gathers the records and calls this.
 */
export function changesSinceBackup(records: { updatedAt?: number }[], since: number): number {
  return records.filter(r => (r.updatedAt ?? 0) > since).length;
}

// ---- Top Personal Records (PT dashboard parity) ----

export interface PersonalRecord {
  /** Drill name (DrillDef.name). */
  name: string;
  scoring: string;
  /** How many times it's been logged. */
  attempts: number;
  /** Best attempt on record, with the date it was set. Null = no scoreable attempt yet. */
  best: (DrillResult & { date: string }) | null;
}

/**
 * One row per distinct drill name the shooter has logged, with the best
 * attempt picked per the drill's scoring style: lowest time, highest score,
 * or highest score/time (hit-factor proxy) for time_score. Mirrors PT's
 * personalRecords(), sorted by how often the drill is run.
 */
export function personalRecords(
  sessions: Pick<Session, 'date' | 'drills'>[],
  drillDefs: Pick<DrillDef, 'name' | 'scoring'>[]
): PersonalRecord[] {
  const scoringByName = new Map(drillDefs.map(d => [d.name, d.scoring]));
  const groups = new Map<string, (DrillResult & { date: string })[]>();
  for (const s of sessions) {
    for (const d of s.drills ?? []) {
      if (!d.name) continue;
      const list = groups.get(d.name) ?? [];
      list.push({ ...d, date: s.date });
      groups.set(d.name, list);
    }
  }

  const prs: PersonalRecord[] = [];
  for (const [name, list] of groups) {
    const scoring = scoringByName.get(name) ?? 'time';
    let best: (DrillResult & { date: string }) | null = null;
    if (scoring === 'time') {
      const timed = list.filter(r => r.time != null && r.time > 0);
      if (timed.length) best = timed.reduce((a, b) => ((a.time as number) <= (b.time as number) ? a : b));
    } else if (scoring === 'score') {
      const scored = list.filter(r => r.score != null);
      if (scored.length) best = scored.reduce((a, b) => ((a.score as number) >= (b.score as number) ? a : b));
    } else if (scoring === 'time_score') {
      const both = list.filter(r => r.score != null && r.time != null && (r.time as number) > 0);
      if (both.length) {
        best = both.reduce((a, b) =>
          ((a.score as number) / (a.time as number)) >= ((b.score as number) / (b.time as number)) ? a : b
        );
      }
    }
    prs.push({ name, scoring, attempts: list.length, best });
  }
  prs.sort((a, b) => b.attempts - a.attempts);
  return prs;
}

/** Plain-language rendering of a drill result for the given scoring style. */
export function formatDrillScore(
  r: Pick<DrillResult, 'time' | 'score' | 'maxScore'> | null,
  scoring: string
): string {
  if (!r) return '—';
  if (scoring === 'time') return r.time != null ? `${r.time.toFixed(2)}s` : '—';
  if (scoring === 'score') return r.score != null ? `${r.score}${r.maxScore ? '/' + r.maxScore : ''}` : '—';
  if (scoring === 'time_score') {
    if (r.score == null || r.time == null) return '—';
    const hf = r.time > 0 ? (r.score / r.time).toFixed(2) : '—';
    return `${r.score}/${r.maxScore ?? '?'} in ${r.time.toFixed(2)}s (HF ${hf})`;
  }
  return '—';
}

// ---- Multi-division classification (PT dashboard parity) ----

export interface DivisionClass extends ClassProgress {
  division: string;
}

/**
 * USPSA classification progress for every division Michael has classifier
 * scores in, highest average first. PT showed a row of these when Michael
 * was tracking more than one division.
 */
export function allClassifications(
  classifiers: { date: string; percent: number | null; division: string }[]
): DivisionClass[] {
  const divs = [...new Set(classifiers.map(c => c.division).filter(Boolean))];
  const out: DivisionClass[] = [];
  for (const division of divs) {
    const prog = classificationProgress(classifiers.filter(c => c.division === division));
    if (prog.average !== null) out.push({ ...prog, division });
  }
  out.sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  return out;
}
