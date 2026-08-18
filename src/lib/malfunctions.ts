// Malfunction option lists (App 2). The built-in types and clearing methods,
// plus the merge that folds in any custom values the shooter has already used —
// so a typed-in "Other" value sticks in the dropdown next time, with nothing
// extra to store or manage. Pure functions; unit-tested.

// Built-ins do NOT include "Other" — the form adds that as the last option.
export const MALF_TYPES = [
  'Failure to feed', 'Failure to fire', 'Failure to eject', 'Failure to extract',
  'Double feed', 'Stovepipe', 'Light strike',
];

export const CLEAR_METHODS = [
  'Tap-Rack-Bang', 'Tap-Rack-Reassess', 'Mortar (double feed)', 'Manual clear',
  'Disassembly required', 'Mag swap', 'Resolved itself',
];

/**
 * Built-in options first, then any custom values already saved — de-duplicated
 * case-insensitively, blanks and the literal "Other" dropped, customs sorted.
 */
export function mergeOptions(builtin: string[], saved: string[]): string[] {
  const seen = new Set(builtin.map((s) => s.toLowerCase()));
  const customs: string[] = [];
  for (const raw of saved) {
    const v = (raw ?? '').trim();
    const key = v.toLowerCase();
    if (v && key !== 'other' && !seen.has(key)) { seen.add(key); customs.push(v); }
  }
  customs.sort((a, b) => a.localeCompare(b));
  return [...builtin, ...customs];
}

/**
 * App 3a: the magazines to offer when logging a malfunction on a given gun.
 * Magazines explicitly linked to that firearm come first (the context-aware
 * pick); if none are linked, ALL magazines are returned as a fallback so the
 * picker is never empty and stays usable. Active magazines sort ahead of
 * retired ones. Pure; unit-tested. Generic so it can take the stored Magazine
 * shape without importing it here.
 */
export function magazinesForFirearm<T extends { firearmIds: string[]; active?: boolean }>(
  magazines: T[], firearmId: string,
): T[] {
  const fit = magazines.filter((m) => Array.isArray(m.firearmIds) && m.firearmIds.includes(firearmId));
  const list = fit.length ? fit : magazines;
  return [...list].sort((a, b) => Number(b.active !== false) - Number(a.active !== false));
}

/**
 * App 3a: parse the optional "round number when it happened" field. Empty or
 * non-numeric input becomes null (the field is optional). Negatives and
 * fractions are rejected to null — a round count is a positive whole number.
 */
export function parseRoundCount(input: string): number | null {
  const t = (input ?? '').trim();
  if (!t) return null;
  const num = Number(t);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
}

/**
 * The shared row shape a malfunctions section holds in its own form state —
 * moved here from SessionForm.tsx (session 126: the match form now shares
 * this row shape too, so the "blank row is skipped / partly-filled context
 * is never dropped" rule lives in ONE place instead of being copy-pasted
 * into a second form and drifting).
 */
export interface MalfRow {
  firearmId: string; type: string; resolution: string; notes: string;
  // App 3a: optional context. Held as strings in the form; '' means "not set".
  ammoId: string; magazineId: string; roundCount: string;
  // App 2: transient (not saved) — true while typing a custom "Other" value.
  otherType?: boolean; otherRes?: boolean;
}

// Cold-audit fix (session 78): the ONE predicate for "this row is worth
// keeping" — a row counts (and saves) if the shooter filled in ANYTHING:
// type, how-cleared, notes, ammo, magazine, or round number. A completely
// blank row (the state right after tapping "+ Add Malfunction") does not.
// Shared by the save path and the summary count, so the count on screen can
// never claim more rows than the save actually writes.
export function malfHasContent(m: MalfRow): boolean {
  return !!(m.type || m.resolution.trim() || m.notes.trim()
    || m.ammoId || m.magazineId || m.roundCount.trim());
}

/**
 * Order-stable reshuffle for a malfunction row's magazine dropdown (match
 * form, session 126): the mags the shooter has ALREADY picked for this match
 * sort first (in the order he picked them), everything else follows in its
 * original order — the mag that choked is almost always one he just told
 * the form he used. Unknown picked ids (not present in `items`) are ignored
 * rather than injected as phantom entries. Pure; unit-tested.
 */
/**
 * The one-line type summary a match detail card shows for its malfunctions
 * (session 126, cold-audit F3): distinct types in first-seen order, and a
 * BLANK type renders as "Malfunction" — the SAME word the Malfunctions
 * screen uses for a typeless row, deliberately not a new convention.
 */
export function malfTypeSummary(types: readonly string[]): string {
  return [...new Set(types.map((t) => t || 'Malfunction'))].join(', ');
}

export function magsPickedFirst<T extends { id: string }>(items: T[], pickedIds: string[]): T[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const picked = pickedIds
    .map((id) => byId.get(id))
    .filter((it): it is T => it !== undefined);
  const pickedIdSet = new Set(picked.map((it) => it.id));
  return [...picked, ...items.filter((it) => !pickedIdSet.has(it.id))];
}
