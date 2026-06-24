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
