// Dashboard aggregation logic — pure functions, no DOM, fully tested.
// Drives the Home screen's stat grid, Rounds by Month chart, training-gap
// alert, and self-rating trend alert.

import type { Session, Match, Ammunition, Firearm, DrillDef, DrillResult, GunCategory } from './types.ts';
import { sessionRounds, totalRounds } from './stats.ts';
import { dayKey } from './dates.ts';
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

// The ONE definition of a logged live vs dry session (Tester-2 Change-1, July 16
// 2026). Home's sessions tile, the ranged Home tiles, and the Trends "Dry : live
// sessions" ratio all count through these, so the three surfaces agree by
// construction — a session is counted only when it's NOT planned; dry-fire is
// "dry", everything else logged is "live". Matches are not sessions and never
// pass through here.
/** A logged (non-planned) live session — anything that isn't dry-fire. */
export function isLiveSession(s: Pick<Session, 'planned' | 'type'>): boolean {
  return !s.planned && s.type !== 'dry_fire';
}
/** A logged (non-planned) dry-fire session. */
export function isDrySession(s: Pick<Session, 'planned' | 'type'>): boolean {
  return !s.planned && s.type === 'dry_fire';
}

/**
 * True when a session is relevant to the gun/category filter — it used a gun
 * that matches (one gun wins over category). No filter = every session matches.
 * The boolean mirror of `sessionRoundsFiltered`'s relevance (Tester-2 Change-1):
 * the Trends session ratio counts a session iff this returns true. Named for its
 * RoundsFilter/gun basis so it can't be confused with searchFilter.ts's
 * LogFilter-based `sessionMatchesFilter` (rename after the cold audit, July 16).
 */
export function sessionUsedFilteredGun(
  s: Pick<Session, 'guns'>,
  filter: RoundsFilter | undefined,
  firearms: Pick<Firearm, 'id' | 'category'>[]
): boolean {
  if (!filter || (!filter.firearmId && !filter.category)) return true;
  return (s.guns ?? []).some((g) => {
    if (filter.firearmId) return g.firearmId === filter.firearmId;
    if (filter.category) return gunCategoryOf(g.firearmId, firearms) === filter.category;
    return false;
  });
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
  // Calendar-day arithmetic on day-keys (the repo's dates.ts convention).
  // Clock math here used to read "-1 days" before noon the morning after a
  // range day (code review M-7); a future-dated session clamps to 0.
  const last = new Date(newest + 'T12:00:00');
  const today = new Date(dayKey(now) + 'T12:00:00');
  return Math.max(0, Math.round((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24)));
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
  const liveSessions = sessions.filter(isLiveSession).length;
  const drySessions = sessions.filter(isDrySession).length;
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

export interface RangedActivity {
  liveFireRounds: number;
  liveSessions: number;
  drySessions: number;
  /**
   * Matches shot in the window. NOT added into liveSessions -- carried beside
   * it, the way drySessions already is.
   *
   * Michael asked what common practice was and the board was convened on it
   * (27 Aug 2026). The evidence split by domain. Strava has no separate race
   * record at all -- a race is a TAG on an ordinary activity -- and the
   * session-RPE literature says its method "is not only valid for assessing
   * the load relative to training sessions, but also to competition". But this
   * sport goes the other way: Stoeger and Park put it as "dryfire is your
   * practice, live fire is your test", and the shooting apps that log practice
   * (PractiScore's own Log app, Ranger) keep practice and matches apart.
   *
   * What EVERY convention agreed on is that competition is visible next to
   * training and labelled distinctly. None of them hides it. This app hid it:
   * a match contributed nothing to the tile and nothing on screen said so, so
   * a month of three matches and one practice read as "1 session". Merging
   * would have flattened a distinction the sport depends on; staying silent
   * was undercounting his range days. Carrying it alongside is the only option
   * that does neither.
   */
  matches: number;
}

/**
 * Live-fire rounds + session counts within a rolling window, for the Home stat tiles.
 * `cutoff` is an inclusive YYYY-MM-DD lower bound, or null for all-time. All-time keeps the
 * lifetime odometer (firearm starting counts + everything fired, via totalRounds); a bounded
 * window counts only rounds actually FIRED in it (live-session rounds + match rounds) — the
 * honest reading of "rounds in the last N months". Dry-fire counts as sessions, never rounds.
 * Both views count LINKED-firearm rounds only (Michael's rule, code review M-8) — a match or
 * session gun pointing at a deleted/blank firearm is excluded from both, so a bounded window
 * can never exceed all-time. Pure; never throws.
 */
export function rangedActivity(
  firearms: Firearm[], sessions: Session[], matches: Match[], cutoff: string | null
): RangedActivity {
  if (cutoff === null) {
    return {
      liveFireRounds: totalRounds(firearms, sessions, matches),
      liveSessions: sessions.filter(isLiveSession).length,
      drySessions: sessions.filter(isDrySession).length,
      matches: (matches ?? []).length,
    };
  }
  const owned = new Set((firearms ?? []).map((f) => f.id));
  let liveFireRounds = 0, liveSessions = 0, drySessions = 0, matchCount = 0;
  for (const s of sessions ?? []) {
    if (!s.date || s.date < cutoff) continue;
    if (isDrySession(s)) drySessions++;
    else if (isLiveSession(s)) {
      liveSessions++;
      for (const g of s.guns ?? []) {
        if (owned.has(g.firearmId)) liveFireRounds += g.rounds || 0;
      }
    }
  }
  for (const m of matches ?? []) {
    if (!m.date || m.date < cutoff) continue;
    // COUNTED WHATEVER GUN IT NAMES. The linked-firearm test below governs
    // ROUNDS only, and exists so a bounded window can never exceed all-time.
    // A match you shot with a gun since deleted is still a match you shot, and
    // this mirrors liveSessions above, which counts a session regardless of
    // which guns it names.
    matchCount += 1;
    if (m.firearmId && owned.has(m.firearmId)) liveFireRounds += m.totalRounds ?? 0;
  }
  return { liveFireRounds, liveSessions, drySessions, matches: matchCount };
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
  'magazines', 'parts', 'drills', 'maintenance', 'purchases', 'goals', 'reminders'
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

/** The number a drill is judged by for the given scoring style, or null if this
 * attempt has nothing scoreable: time drills use the raw time, score drills the
 * score, and time+score drills the hit-factor (score / time). */
export function drillMetric(
  r: Pick<DrillResult, 'time' | 'score'>, scoring: string
): number | null {
  if (scoring === 'time') return r.time != null && r.time > 0 ? r.time : null;
  if (scoring === 'score') return r.score != null ? r.score : null;
  if (scoring === 'time_score') {
    return r.score != null && r.time != null && r.time > 0 ? r.score / r.time : null;
  }
  return null;
}

/** True when a lower number is better for this scoring style (time drills). */
export function drillLowerIsBetter(scoring: string): boolean {
  return scoring === 'time';
}

/** The best attempt in a list for the given scoring style, or null if none is
 * scoreable. Ties keep the earliest-seen attempt. Shared by personalRecords and
 * drillHistory so "best" is computed one way everywhere. */
function drillBest<T extends Pick<DrillResult, 'time' | 'score'>>(
  list: T[], scoring: string
): T | null {
  const lower = drillLowerIsBetter(scoring);
  let best: T | null = null;
  let bestMetric = 0;
  for (const r of list) {
    const m = drillMetric(r, scoring);
    if (m == null) continue;
    if (best == null || (lower ? m < bestMetric : m > bestMetric)) {
      best = r; bestMetric = m;
    }
  }
  return best;
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
    prs.push({ name, scoring, attempts: list.length, best: drillBest(list, scoring) });
  }
  prs.sort((a, b) => b.attempts - a.attempts);
  return prs;
}

// ---- Per-drill history (T3-2): a read-only view over the drill results you
// already log — every attempt, the best, and the metric for the trend. ----

export interface DrillHistoryAttempt {
  sessionId: string;
  date: string; // YYYY-MM-DD
  time: number | null;
  score: number | null;
  maxScore: number | null;
  distance: string;
  notes: string;
  /** The trend number for this attempt (see drillMetric), or null if not scoreable. */
  metric: number | null;
}

export interface DrillHistory {
  name: string;
  scoring: string;
  lowerIsBetter: boolean;
  /** Every attempt, NEWEST first (for the list). */
  attempts: DrillHistoryAttempt[];
  /** The best scoreable attempt, or null when nothing is scoreable. */
  best: DrillHistoryAttempt | null;
}

/**
 * The full history of one drill (matched by name) across all given sessions:
 * every attempt (newest first), the best (same rule as personalRecords), and a
 * per-attempt metric for the trend. Pure read — no data-model change, no writes.
 * Sessions should already be de-trashed by the caller.
 */
export function drillHistory(
  sessions: Pick<Session, 'id' | 'date' | 'drills'>[],
  drillDefs: Pick<DrillDef, 'name' | 'scoring'>[],
  name: string
): DrillHistory {
  const scoring = drillDefs.find(d => d.name === name)?.scoring ?? 'time';
  const attempts: DrillHistoryAttempt[] = [];
  for (const s of sessions) {
    for (const d of s.drills ?? []) {
      if (d.name !== name) continue;
      attempts.push({
        sessionId: s.id, date: s.date,
        time: d.time, score: d.score, maxScore: d.maxScore,
        distance: d.distance, notes: d.notes,
        metric: drillMetric(d, scoring),
      });
    }
  }
  // Best is computed before sorting (it's a reference into the array); then the
  // list is ordered newest-first for display (stable YYYY-MM-DD string compare).
  const best = drillBest(attempts, scoring);
  attempts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { name, scoring, lowerIsBetter: drillLowerIsBetter(scoring), attempts, best };
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
