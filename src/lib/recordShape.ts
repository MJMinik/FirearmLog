// The read boundary: make the model's own type declarations true.
//
// THE PROBLEM THIS EXISTS FOR (session 107, 6 Aug 2026).
// `types.ts` declares most record fields as a plain, required `string`. Nothing
// enforced it. `flog.ts`'s restore is `stores: d.stores` — whatever was in the
// backup becomes the app's data — and the CSV/PractiScore importers can write a
// record that never set a field. So `undefined` arrives where the type promises
// a string, TypeScript cannot see it, and the first `.localeCompare` or
// `.startsWith` in a render path throws. React then unmounts the WHOLE SCREEN
// rather than one row, and the offending record becomes unreachable: the screen
// that would let you edit or delete it is the screen that just died.
//
// Measured instance: a match with no `date` took down the Compete tab with
// "COULDN'T LOAD THIS SCREEN". A sweep found dozens of unguarded call sites of
// the same class across more than twenty files, and a large share of them were
// not sorts at all — `CompeteScreen.tsx:98` is a `.startsWith` filter on the same
// screen as the sort that crashed. Guarding the sorts would have left that screen
// still dying on that record, which is why the fix is HERE, at the one place
// every record passes through, rather than at each call site.
//
// (No call-site count is written down, deliberately. Two different sweeps of the
// same code returned different totals depending on whether `.trim()` on local form
// state was counted, and a figure in a comment has no keeper. What IS kept is the
// list in RECORD_SHAPE, and `scripts/check-shape.mjs` proves that list matches the
// model on every build.)
//
// WHY A BOUNDARY AND NOT 47 GUARDS. A fix that names the instances it found has
// not closed a class; the test is whether an instance written TOMORROW is also
// correct. Normalising on read makes every existing call site correct as
// written and every future one correct by default, and `scripts/check-imports.mjs`
// fails the build if the model gains a plain-string field this map does not
// know about. That check is the keeper. Without it this file goes stale the
// first time somebody adds a field, silently, which is the failure mode the
// whole exercise is about.
//
// THE ONE RULE THIS FILE OBEYS: ADD, NEVER REPLACE. Nothing here may destroy
// information that was on disk. The first version broke that rule three ways and
// a cold audit caught all three: it blanked a `stages` value stored as an object
// rather than an array, it replaced a drill row stored as a bare string with an
// empty row, and it overwrote a date stored as a number with ''. Each turned a
// rendering bug into permanent data loss, because a normalised record CAN reach
// disk (see WHAT REACHES DISK below). A crash is recoverable; a deleted stage is
// not.
//
// THE CONTRACT, deliberately narrow:
//   - A field the model declares as a plain `string` is filled with `''` ONLY
//     when it is absent, `undefined`, or `null`.
//   - A field holding a non-string PRIMITIVE (a hand-edited backup can carry
//     `date: 20260802`, and `20260802..localeCompare` throws exactly like
//     `undefined` does) is converted with `String(value)` — which fixes the
//     crash AND keeps the value. It is never blanked.
//   - A field holding an OBJECT is left exactly as it is. There is no honest
//     string for it, and inventing one would delete whatever it was. If a screen
//     then throws on it, that is a pre-existing bug and it is visible; silently
//     emptying the field would hide the bug and lose the data with it.
//   - A field declared `string | null` is NEVER touched. There, `null` means
//     "not recorded" and `''` would be a different fact — rewriting it would
//     make the record assert something the user never said.
//   - An optional field (`instructor?: string`) is never created. Absent is its
//     normal state; adding the key would make every session claim to have an
//     empty instructor.
//   - `id` is deliberately absent from every list. IndexedDB uses it as the key
//     path, so a record without one could never have been stored; filling it
//     with `''` would invent a colliding key for a record that cannot exist.
//   - A nested value that is not an array, and a nested row that is not an
//     object, are both LEFT ALONE. They cannot be normalised without guessing,
//     and guessing here means deleting.
//   - When nothing is missing the ORIGINAL object is returned, not a copy.
//     `media` records carry raw ArrayBuffers; cloning every read would be a real
//     cost on a large log in exchange for nothing. (Even when a copy IS made the
//     buffer is shared by reference — measured, not assumed.)
//
// WHAT REACHES DISK, stated accurately because the first version of this comment
// got it wrong and said "read only, nothing is written". This module never
// writes. But several app-initiated paths READ records and write them straight
// back with no user involvement: retiring a gun rewrites its optics, magazines
// and parts (`GunRemoveSheet`), undoing an import rewrites ammunition
// (`undoImportBatchInner`), the photo cleanup rewrites media (`PhotoCleanupCard`),
// combining ammo cans rewrites sessions and purchases, and `exportSnapshot` puts
// every store into the `.flog` backup and the sync file. A normalised record travelling any
// of those paths PERSISTS its filled-in blanks. That is acceptable only because
// of the one rule above: what persists is an absent field becoming `''`, or a
// number becoming the same number as text. Nothing is lost either way. It would
// NOT be acceptable if this module could blank a value — which is precisely why
// it no longer can.
import type { StoreName } from './db.ts';

export interface StoreShape {
  /** Fields the model declares as a plain required `string`. Never includes `id`. */
  readonly strings: readonly string[];
  /** Arrays of nested rows, and the plain-string fields of those rows. */
  readonly nested?: Readonly<Record<string, readonly string[]>>;
}

/**
 * One entry per persisted store. Derived by hand from `types.ts` and held to it
 * by the check in `scripts/check-imports.mjs` — if the two ever disagree, the
 * build fails and names the field.
 *
 * `meta` is absent on purpose: it holds a settings blob keyed by `key`, not
 * records, and `AppSettings` is written only by the app itself.
 */
export const RECORD_SHAPE: Readonly<Record<Exclude<StoreName, 'meta'>, StoreShape>> = {
  firearms: { strings: ['name', 'manufacturer', 'model', 'caliber', 'dateAcquired', 'notes', 'category'] },
  sessions: {
    strings: ['date', 'type', 'location', 'distances', 'notes'],
    // `ammoUsage` is typed inline (`{ ammoId: string; rounds: number }[]`) rather
    // than as a named interface. The original regex-based check could not see that
    // shape and a cold audit had to find it; the compiler-based check does see it.
    // `costing.ts` indexes `lotsBySku[u.ammoId]` with it.
    nested: { guns: ['firearmId'], drills: ['name', 'distance', 'notes'], ammoUsage: ['ammoId'] },
  },
  drills: { strings: ['name', 'briefDescription', 'fullDescription', 'scoring', 'fire'] },
  ammunition: { strings: ['brand', 'caliber', 'grain', 'bulletType', 'notes'] },
  purchases: { strings: ['date', 'category', 'item', 'vendor', 'notes'] },
  maintenance: { strings: ['date', 'firearmId', 'type', 'performedBy', 'partsReplaced', 'notes'] },
  malfunctions: { strings: ['date', 'firearmId', 'type', 'resolution', 'notes'] },
  magazines: { strings: ['label', 'notes'] },
  optics: {
    strings: ['firearmId', 'make', 'model', 'installDate', 'dotSize', 'zeroDist',
      'mountHeight', 'torqueSpec', 'settingsSnapshot', 'notes'],
  },
  parts: { strings: ['firearmId', 'name', 'partNumber', 'datePurchased', 'notes'] },
  goals: { strings: ['text', 'category', 'target', 'dateSet', 'dateAchieved'] },
  skills: { strings: ['date', 'notes'] },
  skillSets: { strings: ['sessionId', 'date', 'firearmId', 'notes', 'skill'] },
  matches: {
    strings: ['date', 'name', 'matchType', 'division', 'powerFactor', 'firearmId',
      'practiScoreUrl', 'notes'],
    nested: { stages: ['notes'] },
  },
  classifiers: { strings: ['date', 'code', 'name', 'division', 'notes'] },
  // `links` is inline-typed too — the same shape as sessions.ammoUsage above.
  references: { strings: ['name', 'guidance', 'category'], nested: { links: ['label', 'url'] } },
  reminders: { strings: ['title', 'notes', 'source', 'trigger'] },
  media: { strings: ['ownerId', 'name', 'mime', 'ownerType', 'kind'], nested: { marks: ['color', 'label'] } },
  trash: { strings: ['recordType'] },
} as const;

/** A store that carries records rather than the settings blob. */
function shapeFor(store: StoreName): StoreShape | undefined {
  return (RECORD_SHAPE as Readonly<Record<string, StoreShape | undefined>>)[store];
}

/**
 * The one place that decides what a non-string becomes. Returns `undefined` when
 * the value must be LEFT ALONE — the add-never-replace rule in one function.
 */
function stringFor(value: unknown): string | undefined {
  if (typeof value === 'string') return undefined;          // already fine
  if (value === undefined || value === null) return '';     // absent: safe to fill
  // A number is the one non-string that plainly denotes the same information —
  // a hand-edited backup carrying `date: 20260802` means that date. Converting
  // keeps the value AND stops the crash.
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  // A boolean is converted too, and the tradeoff is written down because it went
  // back and forth twice. `String(false)` is the TRUTHY text "false", so a render
  // guard reading `if (rec.notes)` changes behaviour — that is the cost. The
  // alternative is leaving it, and `false.trim()` then takes the screen down,
  // which is the thing this module exists to prevent and the higher-severity of
  // the two (zero-crash outranks a cosmetic surprise). No importer can produce a
  // boolean here — all four coerce — so this is a hand-edited-backup shape either
  // way, and the visible, editable outcome beats the dead screen.
  if (typeof value === 'boolean') return String(value);
  // Objects, symbols and functions are left alone. There is no honest string for
  // them, and blanking would delete whatever was there.
  return undefined;
}

/**
 * A value we may safely treat as a record row: a PLAIN object.
 *
 * Not `typeof x === 'object'`, which is also true of arrays, Dates, Maps, Sets
 * and boxed primitives — spreading any of those into `{...}` destroys them. An
 * audit measured `stages: [new Date(...)]` becoming `{notes: ''}` and a boxed
 * `new String('note')` becoming `{0:'n',1:'o',…}`. All of these survive
 * IndexedDB's structured clone, so they are storable, and `parseFlog` does no
 * per-record validation — so they are reachable.
 */
function isPlainRow(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * True when nothing may usefully be done to this row — either it already
 * satisfies its declared shape, or it is not a shape we are allowed to touch.
 * (Deliberately not named "isValid": a bare string row returns true here and is
 * still capable of crashing a screen. What it means is "leave it as it is.")
 */
function rowNeedsNoWork(row: unknown, fields: readonly string[]): boolean {
  if (!isPlainRow(row)) return true;
  for (const f of fields) if (stringFor(row[f]) !== undefined) return false;
  return true;
}

/** Copy a row, filling only the declared fields that may safely be filled. */
function fixRow(row: unknown, fields: readonly string[]): unknown {
  if (!isPlainRow(row)) return row;                         // untouchable: hand it back
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) {
    const filled = stringFor(out[f]);
    if (filled !== undefined) out[f] = filled;
  }
  return out;
}

/**
 * Rebuild a nested array with its rows repaired, keeping any own properties the
 * array itself carries. `arr.map()` alone drops them — measured: a `stages`
 * array with `importedFrom: 'ps.csv'` on it lost that property on read, and the
 * next backup wrote the loss.
 */
function fixRows(arr: unknown[], fields: readonly string[]): unknown[] {
  const out = arr.map((row) => fixRow(row, fields));
  for (const key of Object.keys(arr)) {
    // A canonical array index round-trips through Number: '01' and '4294967296'
    // do not, and are ordinary own properties that a regex on digits would drop.
    // Deliberately generous: anything that is not a CANONICAL array index gets
    // copied. `'-1'` and `'NaN'` stringify back to themselves and are not indices,
    // so the earlier test dropped them — the same data loss this loop exists to
    // prevent, found by a fourth audit round.
    const asIndex = Number(key);
    const isIndex = Number.isInteger(asIndex) && asIndex >= 0
      && asIndex < 2 ** 32 - 1 && String(asIndex) === key;
    if (!isIndex) {
      (out as unknown as Record<string, unknown>)[key] = (arr as unknown as Record<string, unknown>)[key];
    }
  }
  return out;
}

/**
 * Fill in any plain-`string` field this store's records are missing.
 *
 * Returns the SAME object when nothing needed filling.
 */
export function normalizeRecord<T>(store: StoreName, record: T): T {
  const shape = shapeFor(store);
  // isPlainRow, not `typeof === 'object'` — the same guard the nested rows use.
  // With the looser test a top-level record that was an Array or a Date fell
  // through to the repair path, where `fixRow` handed the same object back and the
  // nested loop then MUTATED the caller's object in place. The only place this
  // module could write to something it did not create.
  if (!shape || !isPlainRow(record)) return record;
  const src = record as Record<string, unknown>;

  let whole = rowNeedsNoWork(src, shape.strings);
  if (whole && shape.nested) {
    for (const [key, fields] of Object.entries(shape.nested)) {
      const arr = src[key];
      // Not an array: untouchable, so it counts as whole. See the one rule at
      // the top — the version that replaced this with [] deleted every stage of
      // any match whose `stages` arrived as a keyed object, permanently, because
      // the blanked record is what the next backup writes.
      if (!Array.isArray(arr)) continue;
      if (!arr.every((row) => rowNeedsNoWork(row, fields))) { whole = false; break; }
    }
  }
  if (whole) return record;

  const out = fixRow(src, shape.strings) as Record<string, unknown>;
  if (shape.nested) {
    for (const [key, fields] of Object.entries(shape.nested)) {
      const arr = out[key];
      if (!Array.isArray(arr)) continue;       // left exactly as found
      out[key] = fixRows(arr, fields);
    }
  }
  return out as unknown as T;
}

/**
 * `normalizeRecord` over a list. Returns the same array when nothing changed.
 *
 * The identity return is asserted in the tests, not just documented: mutating it
 * to always return the mapped copy survived the whole suite until a test was
 * written for it.
 */
export function normalizeRecords<T>(store: StoreName, records: T[]): T[] {
  let changed = false;
  const out = records.map((r) => {
    const n = normalizeRecord(store, r);
    if (n !== r) changed = true;
    return n;
  });
  return changed ? out : records;
}
