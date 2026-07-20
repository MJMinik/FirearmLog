// F-Universal-Guard (July 20 2026): tiny helper that turns a form's "current
// signature" into a dirty boolean, using the ReminderForm pattern already in
// the codebase but reduced to a one-liner call. Pass a JSON-serializable value
// summarising every field a user can change; the first non-null value seen is
// the baseline, everything after is compared to it. Together with Sheet's
// `dirty` prop, wiring an existing sheet-hosted form for the unsaved-changes
// guard becomes a two-line change.
//
// AUDIT FIX (July 20 2026): async-loaded edit forms latched their baseline on
// first render — BEFORE `getOne(...).then(...)` populated state — so every EDIT
// of an existing record looked dirty untouched, and "Discard changes?" fired on
// a clean close. The `ready` parameter fixes that: the hook does NOT seed its
// baseline until ready is true. New-record mode: pass ready=true immediately.
// Edit mode: pass ready=true once the load effect has populated form state
// (typically by setting a `loaded` flag when the getOne resolves).
//
// Signature TYPING: the shape must be JSON-safe (strings, numbers, booleans,
// null, arrays, plain objects). Dates/Maps/Sets/functions are NOT supported —
// JSON.stringify drops or misencodes them, so the "dirty" verdict would be
// wrong. The constraint below rejects those at compile time.
import { useEffect, useRef, useState } from 'react';

/** Values that JSON.stringify handles reliably (strings, numbers, booleans,
 *  null, arrays, plain-shape objects). Dates / Maps / Sets / functions /
 *  symbols would silently miscompare — this narrows against them via a
 *  distributive conditional (any of those types resolves to `never`), so
 *  passing one is a compile error. Structural interfaces (Mark[], etc.) pass
 *  because the check inspects known-bad constructors, not readonly-array or
 *  index-signature shape. See the isEqual() function below for the runtime. */
type NotJsonSafe<T> =
  T extends Date | Map<unknown, unknown> | Set<unknown> | RegExp
    | ((...a: unknown[]) => unknown) | symbol ? never : T;
export type JsonSafe<T = unknown> = NotJsonSafe<T>;

export function useDirtyTracker<T>(sig: JsonSafe<T>, ready: boolean = true): boolean {
  const [initial, setInitial] = useState<unknown>(undefined);
  // Track whether we've EVER seen a non-undefined signature: undefined itself
  // is a valid steady value (an empty form), so a strict "!== undefined" check
  // could keep re-baselining if the signature computation legitimately returns
  // undefined once. Latching on first pass matches the ReminderForm behavior.
  const seeded = useRef(false);
  useEffect(() => {
    // AUDIT FIX: only seed once `ready` is true — for edit forms this means
    // waiting until the async load has populated state, so the baseline is
    // the loaded record, not the empty initial values.
    if (!seeded.current && ready) { seeded.current = true; setInitial(sig); }
  }, [sig, ready]);
  if (!seeded.current) return false;
  return !isEqual(sig, initial);
}

// Reference equality first (fast path), then a JSON-shape comparison so plain
// data (strings, numbers, arrays, objects) compares by value. Deliberately
// scoped to the shape a form signature takes — no Dates, no Maps, no Sets
// (see JsonSafe above; those are compile-errors now, not silent bugs).
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
