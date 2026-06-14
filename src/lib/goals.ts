// Training goals (spec §10.4, req 26). Pure helpers — sorting + counts — so
// the Progress screen owns only the JSX/state.
import type { Goal } from './types.ts';

/** Open goals first (newest-set first), then achieved (newest-achieved first). */
export function sortGoals(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => {
    if (a.achieved !== b.achieved) return a.achieved ? 1 : -1;
    if (a.achieved) return (b.dateAchieved || '').localeCompare(a.dateAchieved || '');
    return (b.dateSet || '').localeCompare(a.dateSet || '');
  });
}

/** Distinct past goal categories, most-used kept, for the suggest field. */
export function goalCategories(goals: Goal[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of goals) {
    const c = (g.category || '').trim();
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    out.push(c);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function goalStats(goals: Goal[]): { open: number; achieved: number; total: number } {
  const achieved = goals.filter((g) => g.achieved).length;
  return { open: goals.length - achieved, achieved, total: goals.length };
}
