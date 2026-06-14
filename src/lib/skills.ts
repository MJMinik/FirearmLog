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
