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
