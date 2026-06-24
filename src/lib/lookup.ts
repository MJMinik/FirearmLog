// Tiny shared display helper (review 3.3/2.3). Resolve a referenced record's
// label for display, returning "(removed)" when the id no longer resolves (e.g.
// an ammo can or magazine that was deleted after a malfunction referenced it),
// or a caller-chosen placeholder when there's no id at all.
//
// The "no id" placeholder is a parameter ON PURPOSE: a printed report TABLE cell
// wants a dash ("-"), while an inline list subtitle wants to omit the bit
// entirely (""). Keeping that an explicit argument reconciles the two call sites
// that previously diverged, so a future reader won't "fix" one to match the other.
export function labelOrRemoved<T extends { id: string }>(
  list: T[],
  id: string | null | undefined,
  labelOf: (x: T) => string,
  none = '',
): string {
  if (!id) return none;
  const found = list.find((x) => x.id === id);
  return found ? labelOf(found) : '(removed)';
}
