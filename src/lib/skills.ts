// Skill self-assessments (spec §5.13, §10.2). The 8 areas carried over from
// Pistol Tracker. Pure helpers — averages, latest, ordering — so the Progress
// screen owns only JSX/state.
import type { SkillAssessment } from './types.ts';

export interface SkillArea { key: string; label: string; }

export const SKILL_AREAS: SkillArea[] = [
  { key: 'draw', label: 'Draw' },
  { key: 'reload', label: 'Reload' },
  { key: 'splits', label: 'Splits' },
  { key: 'transitions', label: 'Transitions' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'movement', label: 'Movement' },
  { key: 'mental', label: 'Mental Game' },
  { key: 'recoil', label: 'Recoil Control' }
];

/** Mean of the rated areas (1–10), or null if nothing's rated. */
export function assessmentAverage(ratings: Record<string, number>): number | null {
  const vals = SKILL_AREAS
    .map((a) => ratings[a.key])
    .filter((v): v is number => typeof v === 'number' && v > 0);
  if (vals.length === 0) return null;
  return vals.reduce((t, v) => t + v, 0) / vals.length;
}

/** Most recent assessment (by date), or null. */
export function latestAssessment(list: SkillAssessment[]): SkillAssessment | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
}

/** Assessments oldest→newest (for trend charts). */
export function assessmentsByDate(list: SkillAssessment[]): SkillAssessment[] {
  return [...list].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// F7 (batch 2): the bridge from the Skills Check (a dated OPINION) to the
// MEASURED evidence (the timer's numbers). Curated, IN CODE — not user config —
// mapping a skill to where its measurement lives: named stock drills, or the
// "Accuracy across matches" card. Movement, Mental Game, and Recoil Control have
// no honest single-drill proxy, so they're deliberately absent — no link, and no
// apology for it. Drill names must match the stock library (src/lib/stockDrills.ts).
export type SkillEvidence =
  | { kind: 'drills'; drills: string[] } // one or more drills' history
  | { kind: 'accuracy' };                // the "Accuracy across matches" match card

export const SKILL_EVIDENCE: Record<string, SkillEvidence> = {
  draw: { kind: 'drills', drills: ['Draw to First Shot'] },
  reload: { kind: 'drills', drills: ['1-Reload-1'] },
  transitions: { kind: 'drills', drills: ['Transitions', 'Wide Transitions'] },
  splits: { kind: 'drills', drills: ['Doubles / Hammers'] },
  accuracy: { kind: 'accuracy' },
};

/**
 * Resolve a skill's evidence against what's ACTUALLY logged — FAIL SAFE. A mapped
 * drill with no logged runs (or since deleted) drops out; a skill left with no
 * surviving evidence resolves to null so the UI renders no link (never a dead
 * end). `loggedDrills` = names of drills that have at least one logged run;
 * `accuracyAvailable` = whether the "Accuracy across matches" card is showing.
 */
export function resolveSkillEvidence(
  skillKey: string,
  loggedDrills: Set<string>,
  accuracyAvailable: boolean
): { kind: 'drills'; drills: string[] } | { kind: 'accuracy' } | null {
  const ev = SKILL_EVIDENCE[skillKey];
  if (!ev) return null;
  if (ev.kind === 'accuracy') return accuracyAvailable ? { kind: 'accuracy' } : null;
  const drills = ev.drills.filter((d) => loggedDrills.has(d));
  return drills.length > 0 ? { kind: 'drills', drills } : null;
}

/**
 * One skill's self-ratings over time: chronological (oldest→newest) dated points,
 * dropping checks where that area wasn't rated. Feeds the self-rating trend chart.
 */
export function skillRatingSeries(
  list: SkillAssessment[],
  key: string
): { date: string; rating: number }[] {
  const out: { date: string; rating: number }[] = [];
  for (const a of assessmentsByDate(list)) {
    const r = a.ratings[key];
    if (typeof r === 'number' && r > 0) out.push({ date: a.date, rating: r });
  }
  return out;
}
