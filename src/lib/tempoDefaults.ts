/** Where the tempo trainer's two starting values come from: the division of
 *  the shooter's latest Steel Challenge match, and his latest logged typical
 *  draw. Pure functions over arrays the screen has already read. Nothing here
 *  reads or writes stored data, and the trainer itself saves nothing. */
import { canonicalDivision, suggestDivision } from './competition.ts';
import { SCSA_PEAKS, SCSA_STAGES } from './scsaPeaks.ts';
import { stockDrillId } from './stockDrills.ts';
import { isTrashed, trashedIdSet } from './softDelete.ts';
import { activeSkillSets } from './skillSets.ts';

/** Lets a caller ask "is this a division the peak table has?" without ever
 *  indexing the table with a name it may not hold. */
function hasPeaks(division: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCSA_PEAKS, division);
}

const PEAK_DIVISIONS: readonly string[] = Object.keys(SCSA_PEAKS);

/** The peak-table division a stored match division means, or the trimmed
 *  text unchanged when it means none. A results import can store a short
 *  code ("CO", "PCCO") or different capitals exactly as the file had them,
 *  so the stored text goes through the same reader the match screens use
 *  (suggestDivision), limited to the sixteen divisions that have peaks.
 *  Read-only: nothing is corrected in the log. */
function peakDivisionOf(stored: string): string {
  const t = stored.trim();
  if (hasPeaks(t)) return t;
  return suggestDivision(stored, PEAK_DIVISIONS) ?? canonicalDivision(t);
}

/** A YYYY-MM-DD day-key. Anything else cannot be ordered as a date. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dayKeyOf(v: unknown): string | null {
  return typeof v === 'string' && DAY_KEY.test(v) ? v : null;
}

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** The fields this module reads from a match. All optional: a record that is
 *  missing one is skipped, never trusted. */
export interface MatchLike {
  id?: string;
  date?: string;
  division?: string;
  scoringType?: string;
  deletedAt?: number | null;
  createdAt?: number;
}

/** The division of the most recent match that is not in the Trash, is scored
 *  as Steel Challenge, and names a division the peak table holds. Old rimfire
 *  names ("Rimfire Pistol Open") are translated on the way out by
 *  canonicalDivision, the same read-time alias the match screens use. Null
 *  when there is no such match.
 *
 *  "Most recent" is by the match date; two matches on one day are split by
 *  when the record was created, then by id, so the answer never depends on
 *  the order the store happened to return them in. */
export function latestSteelDivision(matches: readonly MatchLike[]): string | null {
  let best: { date: string; createdAt: number; id: string; division: string } | null = null;
  for (const m of matches ?? []) {
    if (!m || typeof m !== 'object') continue;
    if (isTrashed(m)) continue;
    if (m.scoringType !== 'steel') continue;
    const date = dayKeyOf(m.date);
    if (date === null || typeof m.division !== 'string') continue;
    const division = peakDivisionOf(m.division);
    if (!hasPeaks(division)) continue;
    const cand = { date, createdAt: numOr0(m.createdAt), id: typeof m.id === 'string' ? m.id : '', division };
    if (best === null || isLater(cand, best)) best = cand;
  }
  return best === null ? null : best.division;
}

function isLater(
  a: { date: string; createdAt: number; id: string },
  b: { date: string; createdAt: number; id: string }
): boolean {
  if (a.date !== b.date) return a.date > b.date;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

export interface SessionLike {
  id: string;
  date?: string;
  deletedAt?: number | null;
}

export interface SkillSetLike {
  id?: string;
  sessionId: string;
  date?: string;
  skill?: string;
  typicalSec?: number | null;
  createdAt?: number;
}

export interface TypicalDraw {
  /** The logged typical draw, in seconds, exactly as stored. */
  sec: number;
  /** Day-key of the session it was logged on. */
  date: string;
}

/** The typical time of the most recent draw set that has one, from a session
 *  that is not in the Trash. Null when there is none.
 *
 *  A set counts when its skill is 'draw' and its typicalSec is a finite
 *  number above zero. Its date is the owning session's date; the set's own
 *  copy of that date is used only when the session record is not in the list
 *  (the same sets every other screen still counts, see activeSkillSets). Ties
 *  on the date are split by when the set was created, then by id. */
export function latestTypicalDraw(
  sets: readonly SkillSetLike[], sessions: readonly SessionLike[]
): TypicalDraw | null {
  const liveSessions = (sessions ?? []).filter((s) => !!s && typeof s === 'object' && typeof s.id === 'string');
  const trashed = trashedIdSet(liveSessions);
  const sessionDate = new Map<string, string | null>();
  for (const s of liveSessions) sessionDate.set(s.id, dayKeyOf(s.date));
  const usable = (sets ?? []).filter((s) => !!s && typeof s === 'object' && typeof s.sessionId === 'string');

  let best: { date: string; createdAt: number; id: string; sec: number } | null = null;
  for (const s of activeSkillSets(usable, trashed)) {
    if (s.skill !== 'draw') continue;
    const sec = s.typicalSec;
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) continue;
    const date = sessionDate.get(s.sessionId) ?? dayKeyOf(s.date);
    if (date === null) continue;
    const cand = { date, createdAt: numOr0(s.createdAt), id: typeof s.id === 'string' ? s.id : '', sec };
    if (best === null || isLater(cand, best)) best = cand;
  }
  return best === null ? null : { sec: best.sec, date: best.date };
}

/** Which Steel Challenge stage a drill in the library is, as an index into
 *  SCSA_STAGES, or -1 when it is not one of the eight built-in stage drills.
 *
 *  Matched on the built-in drill's fixed id and nothing else. Every built-in
 *  id is 'drs-' plus a slug of the name it was seeded with, and it never
 *  changes afterwards, so this one test covers both halves of "is a built-in
 *  AND is that stage": a shooter's own drill has a 'drx-' id and can never
 *  match, however it is named, and a built-in stage the shooter has renamed
 *  on the Edit Drill form still matches, exactly as it still sits in the
 *  Steel Challenge section (drillGroups.ts decides that by id too, for the
 *  reason its own comment gives: "Accelerator (Steel)" and "Steel Challenge:
 *  Accelerator" are different drills that name text alone cannot tell apart). */
export function steelStageIndexForDrill(drillId: unknown): number {
  if (typeof drillId !== 'string') return -1;
  return STEEL_STAGE_DRILL_IDS.indexOf(drillId);
}

const STEEL_STAGE_DRILL_IDS: readonly string[] =
  SCSA_STAGES.map((s) => stockDrillId(`Steel Challenge: ${s.name}`));
