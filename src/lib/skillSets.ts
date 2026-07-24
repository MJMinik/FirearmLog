// T3-1: timed-skill sets — pure engine functions only (no IndexedDB, no DOM),
// so trend/PR/cold-vs-warm math is unit-tested and reusable by the future
// benchmark aggregation (DATA_MOAT_SPEC §5: derived metrics come from the
// SAME functions the shooter's own screens use, so a benchmark can never
// disagree with what's on screen). Capture is per-SET, not per-rep (locked,
// session 76) — a set is one entry: skill, count, best, typical, notes.

import type { SkillSet, TimedSkill } from './types.ts';

/** The five v1 skills, in the order they're offered everywhere (spec §2). */
export const TIMED_SKILLS: { key: TimedSkill; label: string }[] = [
  { key: 'draw', label: 'Draw' },
  { key: 'reload', label: 'Reload' },
  { key: 'split', label: 'Splits' },
  { key: 'transition', label: 'Transitions' },
  { key: 'par', label: 'Par Drill' },
];

export function skillLabel(skill: string): string {
  return TIMED_SKILLS.find((s) => s.key === skill)?.label ?? skill;
}

/** Plain-language rendering of one set's headline number, e.g. "1.42s best". */
export function formatSec(v: number): string {
  return `${v.toFixed(2)}s`;
}

/**
 * The timed-skill sets that belong to a live (non-trashed) session. Mirrors
 * `activeMalfunctions` in lib/softDelete.ts — a set filed against a session
 * that's in the Trash is excluded from every trend, PR, and report, exactly
 * like that session's malfunctions are. `trashedIds` comes from
 * `trashedIdSet(sessions)`.
 */
export function activeSkillSets<T extends { sessionId: string }>(
  sets: T[],
  trashedIds: Set<string>
): T[] {
  return sets.filter((s) => !trashedIds.has(s.sessionId));
}

/** Every set logged on one session, in the order they were added. */
export function skillSetsForSession<T extends { sessionId: string }>(
  sets: T[],
  sessionId: string
): T[] {
  return sets.filter((s) => s.sessionId === sessionId);
}

/** Every set for one skill, unfiltered by date order (callers sort as needed). */
export function skillSetsFor<T extends Pick<SkillSet, 'skill'>>(sets: T[], skill: string): T[] {
  return sets.filter((s) => s.skill === skill);
}

export interface SkillTrendPoint {
  id: string;
  sessionId: string;
  date: string;
  bestSec: number;
  cold: boolean;
}

/**
 * One skill's best-time trend, OLDEST → NEWEST (chart reading order — mirrors
 * drillHistory's chrono ordering). Every set with a finite, positive bestSec
 * counts as a point; ties on date keep their original relative order (a
 * stable sort), so two sets logged the same day plot in the order they were
 * saved.
 */
export function skillTrend(sets: Pick<SkillSet, 'id' | 'sessionId' | 'date' | 'skill' | 'bestSec' | 'cold'>[], skill: string): SkillTrendPoint[] {
  return sets
    .filter((s) => s.skill === skill && Number.isFinite(s.bestSec) && s.bestSec > 0)
    .map((s) => ({ id: s.id, sessionId: s.sessionId, date: s.date, bestSec: s.bestSec, cold: s.cold }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface SkillPR {
  set: Pick<SkillSet, 'id' | 'sessionId' | 'date' | 'bestSec' | 'cold'>;
}

/**
 * The fastest logged set for a skill (lower is always better — a timed-skill
 * set is judged purely by its best rep). Cold sets are included: it's still a
 * real time the shooter posted, and cold-vs-warm is shown separately rather
 * than by quietly excluding cold runs from the record. Ties keep the
 * earliest-set PR (mirrors drillBest in dashboard.ts).
 */
export function skillPR(
  sets: Pick<SkillSet, 'id' | 'sessionId' | 'date' | 'skill' | 'bestSec' | 'cold'>[],
  skill: string
): SkillPR | null {
  let best: SkillPR['set'] | null = null;
  for (const s of sets) {
    if (s.skill !== skill) continue;
    if (!Number.isFinite(s.bestSec) || s.bestSec <= 0) continue;
    if (!best || s.bestSec < best.bestSec) best = s;
  }
  return best ? { set: best } : null;
}

export interface ColdWarmSplit {
  coldAvgSec: number | null;
  warmAvgSec: number | null;
  coldCount: number;
  warmCount: number;
}

/**
 * Average best time for a skill split by the cold flag — the honest
 * cold-vs-warm-up comparison the spec locks (a "cold" set is the day's first
 * work, no warmup). Either side is null when it has no scoreable sets, never
 * a divide-by-zero or a guessed number.
 */
export function coldVsWarm(
  sets: Pick<SkillSet, 'skill' | 'bestSec' | 'cold'>[],
  skill: string
): ColdWarmSplit {
  const scoreable = sets.filter((s) => s.skill === skill && Number.isFinite(s.bestSec) && s.bestSec > 0);
  const cold = scoreable.filter((s) => s.cold);
  const warm = scoreable.filter((s) => !s.cold);
  const avg = (list: typeof scoreable) => list.length
    ? list.reduce((sum, s) => sum + s.bestSec, 0) / list.length
    : null;
  return {
    coldAvgSec: avg(cold), warmAvgSec: avg(warm),
    coldCount: cold.length, warmCount: warm.length,
  };
}

/**
 * Which skills have at least one scoreable set — drives which chip/tab the
 * Progress card offers, so a shooter who's only logged draws isn't shown four
 * empty tabs.
 */
export function skillsWithData(sets: Pick<SkillSet, 'skill' | 'bestSec'>[]): TimedSkill[] {
  const present = new Set<TimedSkill>();
  for (const s of sets) {
    if (Number.isFinite(s.bestSec) && s.bestSec > 0) present.add(s.skill);
  }
  return TIMED_SKILLS.map((s) => s.key).filter((k) => present.has(k));
}

/**
 * Parse the optional rep-times entry field (comma/space separated seconds,
 * e.g. "1.42, 1.51 1.38") into a clean number[] — non-numeric or non-positive
 * tokens are dropped rather than rejecting the whole entry, so one typo
 * doesn't block the rest. Empty input returns an empty array (the caller
 * treats that as "not provided" — repTimesSec stays optional).
 */
export function parseRepTimes(input: string): number[] {
  return (input ?? '')
    .split(/[\s,]+/)
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** The rep-times entry field's text form, for re-editing a saved set. */
export function formatRepTimes(times: number[] | null | undefined): string {
  return (times ?? []).map((t) => String(t)).join(', ');
}
