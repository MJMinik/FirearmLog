// D9 fix (session 141; string overload added in the same session's cold
// audit, finding F2): the class of "a filter/picker names a deleted item and
// reads 'All ...' while still filtering by the dead id." Pure, no React, no DOM
// -- its own file for the same reason selectOptions.ts is (lib/selectOptions.ts
// docstring): the unit runner cannot load JSX, and a rule this load-bearing has
// to be testable directly rather than only through a browser. Every <select>
// bound to a stored/filter id (or, for CompeteFilterBar's Match type/Division,
// a plain string) that can go stale calls this ONE function, so the fix is
// closed as a class rather than one patch per site that can drift apart.
//
// THE RULE THIS ENFORCES: when the bound value is non-empty and does not
// resolve in the freshly-loaded list, the caller gets one extra option
// {value: id, label: '(removed)'} to render above the real list -- so the
// <select> shows "(removed)" (truthful: the shooter can see something is
// filtering, and picking any real option clears it) instead of silently
// falling through to the browser's default "first option" (a lie: the select
// reads "All ..." while the list stays filtered by the dead id, and the
// active-filter badge still counts it). Returns an array (0 or 1 items) so
// call sites can use the same `.map()` idiom as lib/selectOptions.ts's
// fieldOptions rather than a special-cased conditional at every site.
//
// Two overloads, one implementation: most call sites hold a list of records
// with an `id` field; CompeteFilterBar's Match type / Division filters hold
// their own value as the identity (a bare string list), so a caller there
// isn't forced to map its list into throwaway {id} wrappers on every render
// just to call this.
export function removedOption(
  id: string,
  list: readonly string[],
): { value: string; label: string }[];
export function removedOption(
  id: string,
  list: readonly { id: string }[],
): { value: string; label: string }[];
export function removedOption(
  id: string,
  list: readonly (string | { id: string })[],
): { value: string; label: string }[] {
  if (id === '') return [];
  const present = list.some((item) => (typeof item === 'string' ? item : item.id) === id);
  if (present) return [];
  return [{ value: id, label: '(removed)' }];
}
