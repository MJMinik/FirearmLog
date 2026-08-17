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
import type {
  Firearm, Session, DrillDef, Ammunition, Purchase, MaintenanceEntry,
  MalfunctionEntry, Magazine, Optic, Part, Goal, SkillAssessment, SkillSet,
  Match, Classifier, Reference, Reminder, Media, TrashItem,
} from './types.ts';

export interface StoreShape {
  /** Fields the model declares as a plain required `string`. Never includes `id`. */
  readonly strings: readonly string[];
  /** Arrays of nested rows, and the plain-string fields of those rows. */
  readonly nested?: Readonly<Record<string, readonly string[]>>;
}

// ---- type-level keeper: the types below make RECORD_SHAPE's `satisfies` clause
// provable at compile time. They do not change runtime behaviour at all. ----

/**
 * Maps each store name to the record interface that backs it. This is the
 * single point where "store name" meets "record interface" for the type system.
 * `meta` is deliberately absent -- the same reason RECORD_SHAPE excludes it.
 */
interface RecordTypeForStore {
  firearms: Firearm;
  sessions: Session;
  drills: DrillDef;
  ammunition: Ammunition;
  purchases: Purchase;
  maintenance: MaintenanceEntry;
  malfunctions: MalfunctionEntry;
  magazines: Magazine;
  optics: Optic;
  parts: Part;
  goals: Goal;
  skills: SkillAssessment;
  skillSets: SkillSet;
  matches: Match;
  classifiers: Classifier;
  references: Reference;
  reminders: Reminder;
  media: Media;
  trash: TrashItem;
}

/**
 * The string-valued field names of T that are:
 *  - required (not optional),
 *  - not in the exclusion set (defaults to `id`),
 *  - typed as a plain `string` (NOT `string | null`, NOT `string | undefined`,
 *    NOT a string union that carries null/undefined).
 *
 * The `[T[K]] extends [string]` wrapper stops `string | null` from being
 * distributed into `string`. Without the tuple, `null extends string ? ... :
 * never` collapses exactly the way `strictNullChecks: false` would, which is
 * the class of hole the script's `strictNullChecks: true` line exists to close.
 */
type PlainStringKeys<T, Excl extends string = 'id'> = {
  [K in keyof T]-?: (
    object extends Pick<T, K> ? never :        // required only (optional fields fail this)
    K extends Excl ? never :                   // exclude by name
    K extends string ? (
      [T[K]] extends [string] ? K : never      // must be EXACTLY string, not string | null
    ) : never
  );
}[keyof T & string];

/** The element type of an array-typed property of T, or never. */
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/**
 * Property names of T whose values are arrays of object rows. Uses -? so that
 * optional array fields (e.g. marks?: Mark[]) are included -- the array field
 * exists and has row strings that need covering regardless of whether the field
 * itself is required on the interface. NonNullable strips the implicit undefined
 * that -? leaves on the value type when the original property was optional;
 * without it (Mark[] | undefined) extends readonly object[] = false because the
 * union is wider, so optional array fields are silently excluded.
 *
 * Correctly excludes unknown[] and string[]: neither satisfies `extends readonly
 * object[]` -- confirmed by probe during the auditor fix (session 108).
 */
type NestedArrayField<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly object[] ? K : never;
}[keyof T] & string;

/**
 * Stores whose model type has at least one nested array-of-object field.
 * Pre-computed at the RecordTypeForStore level so that ExpectedRecordShape can
 * distribute over a concrete union (string literals) rather than deferring a
 * conditional on a generic parameter -- TypeScript defers the latter, which
 * prevents the satisfies clause from resolving the nested-required vs
 * nested-absent branches at compile time.
 */
type StoresWithNested = {
  [S in keyof RecordTypeForStore]:
    [NestedArrayField<RecordTypeForStore[S]>] extends [never] ? never : S;
}[keyof RecordTypeForStore];

/**
 * The shape each store's entry in RECORD_SHAPE_LITERAL must have:
 *  - Stores in StoresWithNested are REQUIRED to declare `nested`, with exactly
 *    the fields NestedArrayField finds on their model type. A missing field is
 *    a missing-property error from the satisfies clause; a missing key inside a
 *    field is caught by the _AllNestedComplete assertion below.
 *  - Stores not in StoresWithNested keep `nested` absent (runtime shape
 *    unchanged). A spurious `nested` key would be an excess-property error.
 *  - In both branches the `strings` value must contain only valid
 *    PlainStringKeys for the store's model type.
 */
type ExpectedRecordShape = {
  readonly [S in keyof RecordTypeForStore]:
    S extends StoresWithNested
      ? {
          readonly strings: readonly PlainStringKeys<RecordTypeForStore[S]>[];
          readonly nested: {
            readonly [F in NestedArrayField<RecordTypeForStore[S]>]:
              readonly PlainStringKeys<ElementOf<RecordTypeForStore[S][F]>>[];
          };
        }
      : { readonly strings: readonly PlainStringKeys<RecordTypeForStore[S]>[] };
};

/**
 * One entry per persisted store. Derived by hand from `types.ts` and held to it
 * by two complementary type checks and one script check:
 *
 *  - The `satisfies ExpectedRecordShape` clause on RECORD_SHAPE_LITERAL: tsc
 *    refuses to compile when this map LISTS a field that is not a required plain
 *    string on the interface (stale key, renamed field, field made optional or
 *    `string | null`). Error names the broken store's key in the "actual" union.
 *    Remove it, or update `types.ts` if the change was wrong.
 *
 *    Also: for stores that have nested array fields, `satisfies` now enforces
 *    that `nested` is present and covers exactly the right fields. A missing
 *    nested key is a missing-property error on the `nested` object. A spurious
 *    nested key on a store with no array fields is an excess-property error.
 *
 *  - The AssertComplete lines below RECORD_SHAPE: tsc refuses to compile when a
 *    required plain-string field EXISTS on the interface but is ABSENT from this
 *    map. Error: "Type 'missing-key-name' does not satisfy the constraint 'never'".
 *    The type argument that fails names the missing key exactly. Add it here, in
 *    the right store's strings array. The _AllNestedComplete assertion below does
 *    the same for required string keys WITHIN each nested field's array, derived
 *    automatically across all (store, field) pairs rather than listed by hand.
 *
 *  - `scripts/check-shape.mjs`: checks three things the type system cannot express
 *    -- the `??` usage guard (a normalised field with a non-empty fallback reads
 *    as a live guard but can never fire), the "no unmapped nested row type" guard
 *    (a named interface used as an array element must appear in NESTED_FOR_TYPE
 *    or NESTED_EXEMPT), and the empty-model refusal.
 *
 * `meta` is absent on purpose: it holds a settings blob keyed by `key`, not
 * records, and `AppSettings` is written only by the app itself.
 */
const RECORD_SHAPE_LITERAL = {
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
    // magOverrides/magConditions added Aug 2026 (match-mags): both are nested
    // array-of-object fields, so NestedArrayField requires them here or the
    // `satisfies ExpectedRecordShape` clause fails to compile. magIds is a
    // plain string[] and is correctly excluded — same precedent as
    // SessionGun.magIds under `sessions.nested` above.
    nested: { stages: ['notes'], magOverrides: ['magId'], magConditions: ['magId', 'tag'] },
  },
  classifiers: { strings: ['date', 'code', 'name', 'division', 'notes'] },
  // `links` is inline-typed too -- the same shape as sessions.ammoUsage above.
  references: { strings: ['name', 'guidance', 'category'], nested: { links: ['label', 'url'] } },
  reminders: { strings: ['title', 'notes', 'source', 'trigger'] },
  media: { strings: ['ownerId', 'name', 'mime', 'ownerType', 'kind'], nested: { marks: ['color', 'label'] } },
  trash: { strings: ['recordType'] },
} as const satisfies ExpectedRecordShape;

export const RECORD_SHAPE: Readonly<Record<Exclude<StoreName, 'meta'>, StoreShape>> = RECORD_SHAPE_LITERAL;

// ---- completeness assertions: go red when a required plain-string key is absent
// from the map. The AssertComplete<Missing extends never> trick makes tsc name
// the missing key in the error: "Type 'missing-key' does not satisfy the
// constraint 'never'". These are pure compile-time; they produce no runtime code.
//
// If a missing key is reported, add it to the right store's strings array above.
// If a missing nested key is reported, add it to the store's nested block above.

/** Fails -- naming the offending key -- when MissingKeys is not empty. */
type AssertComplete<MissingKeys extends never> = MissingKeys;

/** Keys declared as plain required strings on store S that are absent from the map. */
type MissingStrings<S extends keyof RecordTypeForStore> =
  Exclude<PlainStringKeys<RecordTypeForStore[S]>, typeof RECORD_SHAPE_LITERAL[S]['strings'][number]>;

// One assertion per store. A new `field: string` on any of these interfaces goes
// red here, naming the field, until it is added to RECORD_SHAPE_LITERAL above.
export type _FirearmsComplete     = AssertComplete<MissingStrings<'firearms'>>;
export type _SessionsComplete     = AssertComplete<MissingStrings<'sessions'>>;
export type _DrillsComplete       = AssertComplete<MissingStrings<'drills'>>;
export type _AmmunitionComplete   = AssertComplete<MissingStrings<'ammunition'>>;
export type _PurchasesComplete    = AssertComplete<MissingStrings<'purchases'>>;
export type _MaintenanceComplete  = AssertComplete<MissingStrings<'maintenance'>>;
export type _MalfunctionsComplete = AssertComplete<MissingStrings<'malfunctions'>>;
export type _MagazinesComplete    = AssertComplete<MissingStrings<'magazines'>>;
export type _OpticsComplete       = AssertComplete<MissingStrings<'optics'>>;
export type _PartsComplete        = AssertComplete<MissingStrings<'parts'>>;
export type _GoalsComplete        = AssertComplete<MissingStrings<'goals'>>;
export type _SkillsComplete       = AssertComplete<MissingStrings<'skills'>>;
export type _SkillSetsComplete    = AssertComplete<MissingStrings<'skillSets'>>;
export type _MatchesComplete      = AssertComplete<MissingStrings<'matches'>>;
export type _ClassifiersComplete  = AssertComplete<MissingStrings<'classifiers'>>;
export type _ReferencesComplete   = AssertComplete<MissingStrings<'references'>>;
export type _RemindersComplete    = AssertComplete<MissingStrings<'reminders'>>;
export type _MediaComplete        = AssertComplete<MissingStrings<'media'>>;
export type _TrashComplete        = AssertComplete<MissingStrings<'trash'>>;

// Nested key completeness: DERIVED, not hand-listed.
// The satisfies clause (above) enforces that every nested FIELD is present and
// that no extra fields exist (both directions from ExpectedRecordShape). The
// assertion below covers the remaining gap: missing string KEYS within each
// field's array -- across ALL stores and ALL nested fields, derived from the
// model automatically. A new `field: string` on any nested row type goes red
// here naming the field, until it is added to RECORD_SHAPE_LITERAL above.
// A future store that gains a new nested array field and declares it in the map
// with an incomplete key list is caught here without a new hand-written line.
//
// How it works: for each S in StoresWithNested, for each F in the store's nested
// keys, compute the plain-string keys of the element type that are absent from
// the listed array. Union them all. The whole union must be never.

/**
 * For each (store, nested-field) pair, the plain-string keys of that field's
 * element type that are missing from the RECORD_SHAPE_LITERAL list. Must be
 * never at rest; names missing keys exactly in the TS2344 error when non-never.
 *
 * The intersection `& NestedArrayField<RecordTypeForStore[S]>` on F serves two
 * roles: it tells the type system that `RecordTypeForStore[S][F]` is an array of
 * objects (so ElementOf gives a useful element type, not never), and it ensures
 * the F index is valid on the record interface (NestedArrayField extends keyof T).
 * NonNullable strips the implicit undefined from optional array fields before
 * ElementOf so marks?: Mark[] contributes its row keys rather than being excluded.
 */
/** The literal `nested` object for store S cast to `Record<string, readonly string[]>`.
 *  The cast is safe: `satisfies ExpectedRecordShape` already verified every value
 *  is a `readonly PlainStringKeys[]`. Pulling it out as a named alias lets TypeScript
 *  resolve the shape before mapping over F, which avoids the deferred-generic index
 *  error that `(typeof RECORD_SHAPE_LITERAL)[S]['nested'][F]` hits when S and F are
 *  both still generic parameters in the same mapped-type expression. */
type LiteralNested<S extends StoresWithNested> =
  (typeof RECORD_SHAPE_LITERAL)[S]['nested'] & Record<string, readonly string[]>;

type MissingNestedKeys = {
  [S in StoresWithNested]: {
    [F in keyof LiteralNested<S> & NestedArrayField<RecordTypeForStore[S]>]:
      Exclude<
        PlainStringKeys<ElementOf<NonNullable<RecordTypeForStore[S][F]>>>,
        LiteralNested<S>[F][number]
      >;
  }[keyof LiteralNested<S> & NestedArrayField<RecordTypeForStore[S]>];
}[StoresWithNested];

export type _AllNestedComplete = AssertComplete<MissingNestedKeys>;

/** A store that carries records rather than the settings blob. */
function shapeFor(store: StoreName): StoreShape | undefined {
  return (RECORD_SHAPE as Readonly<Record<string, StoreShape | undefined>>)[store];
}

/**
 * The one place that decides what a non-string becomes. Returns `undefined` when
 * the value must be LEFT ALONE -- the add-never-replace rule in one function.
 */
function stringFor(value: unknown): string | undefined {
  if (typeof value === 'string') return undefined;          // already fine
  if (value === undefined || value === null) return '';     // absent: safe to fill
  // A number is the one non-string that plainly denotes the same information --
  // a hand-edited backup carrying `date: 20260802` means that date. Converting
  // keeps the value AND stops the crash.
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  // A boolean is converted too, and the tradeoff is written down because it went
  // back and forth twice. `String(false)` is the TRUTHY text "false", so a render
  // guard reading `if (rec.notes)` changes behaviour -- that is the cost. The
  // alternative is leaving it, and `false.trim()` then takes the screen down,
  // which is the thing this module exists to prevent and the higher-severity of
  // the two (zero-crash outranks a cosmetic surprise). No importer can produce a
  // boolean here -- all four coerce -- so this is a hand-edited-backup shape either
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
 * and boxed primitives -- spreading any of those into `{...}` destroys them. An
 * audit measured `stages: [new Date(...)]` becoming `{notes: ''}` and a boxed
 * `new String('note')` becoming `{0:'n',1:'o',...}`. All of these survive
 * IndexedDB's structured clone, so they are storable, and `parseFlog` does no
 * per-record validation -- so they are reachable.
 */
function isPlainRow(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * True when nothing may usefully be done to this row -- either it already
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
 * array itself carries. `arr.map()` alone drops them -- measured: a `stages`
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
    // so the earlier test dropped them -- the same data loss this loop exists to
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
  // isPlainRow, not `typeof === 'object'` -- the same guard the nested rows use.
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
      // the top -- the version that replaced this with [] deleted every stage of
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
