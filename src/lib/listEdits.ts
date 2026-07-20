// Pure logic for the Manage Lists feature (§6 of SPEC_MANAGE_LISTS.md).
// No IndexedDB access here — all persistence is done by the caller via putOne /
// putSettings. Fully unit-tested in tests/listEdits.test.ts.

import { recentValues } from './suggest.ts';
import type { Ammunition, Firearm, Goal, Optic, Part, Purchase, Session } from './types.ts';

// ---------------------------------------------------------------------------
// List definitions (§3 source map)
// ---------------------------------------------------------------------------

export interface ListSource {
  store: 'sessions' | 'ammunition' | 'firearms' | 'purchases' | 'parts' | 'optics' | 'goals';
  field: string;
  /**
   * Which record property to use as the recency key for recentValues() ordering.
   * Must match exactly what the corresponding form's recentValues() call uses:
   *   sessions  → 'date'   (ISO date string, e.g. '2026-01-15')
   *   purchases → 'date'   (ISO date string)
   *   all others → 'updatedAt' (ms timestamp, converted to string)
   */
  recencyField: 'date' | 'updatedAt';
}

export interface ListDef {
  id: string;
  uiName: string;
  /** The per-store field(s) that make up this list. */
  sources: ListSource[];
  /** Plain noun for use in confirmation copy (sessions / ammo cans / etc.) */
  recordsWord: (store: ListSource['store']) => string;
}

export const LIST_DEFS: ListDef[] = [
  {
    id: 'locations',
    uiName: 'Locations',
    sources: [{ store: 'sessions', field: 'location', recencyField: 'date' }],
    recordsWord: () => 'sessions',
  },
  {
    id: 'instructors',
    uiName: 'Instructors',
    sources: [{ store: 'sessions', field: 'instructor', recencyField: 'date' }],
    recordsWord: () => 'sessions',
  },
  {
    id: 'ammo-brands',
    uiName: 'Ammo brands',
    sources: [{ store: 'ammunition', field: 'brand', recencyField: 'updatedAt' }],
    recordsWord: () => 'ammo cans',
  },
  {
    id: 'calibers',
    uiName: 'Calibers',
    sources: [
      { store: 'ammunition', field: 'caliber', recencyField: 'updatedAt' },
      { store: 'firearms', field: 'caliber', recencyField: 'updatedAt' },
    ],
    recordsWord: (store) => store === 'firearms' ? 'guns' : 'ammo cans',
  },
  {
    id: 'vendors',
    uiName: 'Vendors',
    sources: [
      { store: 'purchases', field: 'vendor', recencyField: 'date' },
      { store: 'parts', field: 'vendor', recencyField: 'updatedAt' },
    ],
    recordsWord: (store) => store === 'parts' ? 'parts' : 'purchases',
  },
  {
    id: 'purchase-items',
    uiName: 'Purchase items',
    sources: [{ store: 'purchases', field: 'item', recencyField: 'date' }],
    recordsWord: () => 'purchases',
  },
  {
    id: 'part-names',
    uiName: 'Part names',
    sources: [{ store: 'parts', field: 'name', recencyField: 'updatedAt' }],
    recordsWord: () => 'parts',
  },
  {
    id: 'optic-makes',
    uiName: 'Optic makes',
    sources: [{ store: 'optics', field: 'make', recencyField: 'updatedAt' }],
    recordsWord: () => 'optics',
  },
  {
    id: 'optic-models',
    uiName: 'Optic models',
    sources: [{ store: 'optics', field: 'model', recencyField: 'updatedAt' }],
    recordsWord: () => 'optics',
  },
  {
    id: 'goal-categories',
    uiName: 'Goal categories',
    sources: [{ store: 'goals', field: 'category', recencyField: 'updatedAt' }],
    recordsWord: () => 'goals',
  },
];

// ---------------------------------------------------------------------------
// Record-by-store type
// ---------------------------------------------------------------------------

export type RecordsByStore = {
  sessions?: Session[];
  ammunition?: Ammunition[];
  firearms?: Firearm[];
  purchases?: Purchase[];
  parts?: Part[];
  optics?: Optic[];
  goals?: Goal[];
};

// ---------------------------------------------------------------------------
// collectValues — derive visible + hidden value lists for a list def
// ---------------------------------------------------------------------------

/** Get the raw field value from a record for a given store+field source. */
function getField(record: Record<string, unknown>, field: string): string {
  const v = record[field];
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Collect all distinct values across the list's source stores, then split into
 * visible (not hidden) and hidden arrays. Reuses recentValues() for ordering
 * and case-insensitive deduplication.
 */
export function collectValues(
  recordsByStore: RecordsByStore,
  def: ListDef,
  hiddenNormalized: Set<string>,
): { visible: string[]; hidden: string[] } {
  // Build rows for recentValues(): each record contributes a { date, value } row.
  const rows: { date: string; value: string }[] = [];
  for (const src of def.sources) {
    const records = (recordsByStore[src.store] ?? []) as unknown as Record<string, unknown>[];
    for (const rec of records) {
      const v = getField(rec, src.field);
      if (!v.trim()) continue;
      // Use updatedAt (ms) as the date key for ordering — convert to a string
      // that sorts correctly (zero-padded numeric string sorts like a number).
      const rawKey = src.recencyField === 'date'
        ? String(rec['date'] ?? '')
        : String(rec['updatedAt'] ?? 0).padStart(15, '0');
      const dateKey = rawKey;
      rows.push({ date: dateKey, value: v });
    }
  }

  const all = recentValues(rows);
  const visible: string[] = [];
  const hidden: string[] = [];
  for (const v of all) {
    if (hiddenNormalized.has(v.toLowerCase())) {
      hidden.push(v);
    } else {
      visible.push(v);
    }
  }
  return { visible, hidden };
}

// ---------------------------------------------------------------------------
// countMatches — dry-run counts per store before a rename
// ---------------------------------------------------------------------------

export interface StoreCount {
  store: ListSource['store'];
  count: number;
}

/**
 * Count how many records in each source store have the given value (case-
 * insensitive, trimmed equality). Used for the confirmation dialog.
 */
export function countMatches(
  recordsByStore: RecordsByStore,
  def: ListDef,
  oldValue: string,
): StoreCount[] {
  const needle = oldValue.trim().toLowerCase();
  const result: StoreCount[] = [];
  for (const src of def.sources) {
    const records = (recordsByStore[src.store] ?? []) as unknown as Record<string, unknown>[];
    let count = 0;
    for (const rec of records) {
      const v = getField(rec, src.field).trim().toLowerCase();
      if (v === needle) count += 1;
    }
    result.push({ store: src.store, count });
  }
  return result;
}

// ---------------------------------------------------------------------------
// applyRename — produce changed records (pure; caller persists via putOne)
// ---------------------------------------------------------------------------

export interface RenamedRecord {
  store: ListSource['store'];
  record: Record<string, unknown>;
}

/**
 * Return every record that needs to be updated: matching records get their
 * field rewritten to newValue (exact casing, trimmed) and updatedAt bumped to
 * `now`. Nothing else on the record changes.
 *
 * Matching is trimmed + case-insensitive.
 * Null/undefined/empty-string fields are never matched and never written to
 * (satisfies the "null-instructor safety" edge case in §5.5).
 */
export function applyRename(
  recordsByStore: RecordsByStore,
  def: ListDef,
  oldValue: string,
  newValue: string,
  now: number,
): RenamedRecord[] {
  const needle = oldValue.trim().toLowerCase();
  const replacement = newValue.trim();
  const result: RenamedRecord[] = [];
  for (const src of def.sources) {
    const records = (recordsByStore[src.store] ?? []) as unknown as Record<string, unknown>[];
    for (const rec of records) {
      const v = getField(rec, src.field);
      if (!v.trim()) continue; // never touch blank/null fields
      if (v.trim().toLowerCase() !== needle) continue;
      result.push({
        store: src.store,
        record: { ...rec, [src.field]: replacement, updatedAt: now },
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// filterHidden — used at each suggestion site to strip hidden values
// ---------------------------------------------------------------------------

/**
 * Filter a suggestion array by removing any values that are hidden for this
 * list. Apply at each SuggestField site; does NOT redesign SuggestField itself.
 */
export function filterHidden(
  values: string[],
  hiddenSuggestions: Record<string, string[]> | undefined,
  listId: string,
): string[] {
  const hiddenRaw = hiddenSuggestions?.[listId];
  if (!hiddenRaw || hiddenRaw.length === 0) return values;
  const hiddenSet = new Set(hiddenRaw.map((v) => v.toLowerCase()));
  return values.filter((v) => !hiddenSet.has(v.toLowerCase()));
}
