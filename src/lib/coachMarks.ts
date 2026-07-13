import { getOne, putOne } from './db.ts';

// Session 59: persistence for the first-run coach marks (ui/CoachMark.tsx).
// Dismissals live in the meta store (key 'coachMarksDismissed', the
// dismissedAlerts shape) so a closed mark stays closed across visits — and
// because Clear All / the sample exit wipe meta, a fresh start honestly gets
// its guidance back. Kept in lib/ (not the component) so the node test runner
// can exercise it against fake-indexeddb like the rest of the data layer.

export type CoachMarkKey = 'goalPick' | 'gunSave';

export async function coachMarkDismissals(): Promise<Partial<Record<CoachMarkKey, true>>> {
  try {
    const row = await getOne<{ key: string; value: Partial<Record<CoachMarkKey, true>> }>(
      'meta', 'coachMarksDismissed');
    return row?.value ?? {};
  } catch {
    return {}; // fail safe: a storage hiccup shows guidance rather than hiding it
  }
}

export async function dismissCoachMark(key: CoachMarkKey): Promise<void> {
  try {
    const current = await coachMarkDismissals();
    await putOne('meta', { key: 'coachMarksDismissed', value: { ...current, [key]: true } });
  } catch { /* worst case: the mark reappears next visit — never block the tap */ }
}
