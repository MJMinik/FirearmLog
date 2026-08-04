// The field registry and the value readers (design doc 3.2 and 3.3). Pure
// logic, no storage, no DOM.
//
// The registry is one declarative list: what our fields are called in plain
// English, which ones a row cannot do without, what kind of value each holds,
// and the header names other apps tend to use for it. The mapping screen
// renders this list, the planner validates against it, and a saved template is
// just a set of choices made against it. One source of truth, no per-table
// screen code.
//
// The field keys and labels line up with the CSV EXPORT columns in
// lib/csvTables.ts on purpose: a file this app writes has to be a file this app
// can read back.
//
// NOTE ON PUNCTUATION: nothing in this file, comments included, uses an em
// dash. Every string here can reach a shooter's screen.

import { looseNum } from '../csv.ts';
import { ammoLabel } from '../csvTables.ts';
import type { Ammunition, Firearm } from '../types.ts';

export type FieldKind = 'date' | 'number' | 'integer' | 'text' | 'gunRef' | 'ammoRef' | 'choice' | 'yesNo';

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  kind: FieldKind;
  /** One plain-English line, shown under the field name on the mapping screen. */
  description: string;
  /** Header names this field answers to, best guess first. */
  matchPatterns: RegExp[];
}

/**
 * Sessions: the table the "can I bring my log over" question is actually about
 * (design doc section 6, stage 2). One row becomes one session with one gun.
 */
export const SESSION_FIELDS: FieldSpec[] = [
  {
    key: 'date',
    label: 'Date',
    required: true,
    kind: 'date',
    description: 'The day you shot.',
    matchPatterns: [/^date$/, /^day$/, /^date fired$/, /date/, /\bwhen\b/],
  },
  {
    key: 'type',
    label: 'Type',
    required: false,
    kind: 'choice',
    description: 'Practice, dry fire, or a class.',
    matchPatterns: [/^type$/, /^session type$/, /^kind$/, /type/],
  },
  {
    key: 'gun',
    label: 'Gun',
    required: true,
    kind: 'gunRef',
    description: 'Which gun you shot, by name.',
    matchPatterns: [/^gun$/, /^firearm$/, /^pistol$/, /^rifle$/, /^weapon$/, /gun/, /firearm/],
  },
  {
    key: 'rounds',
    label: 'Rounds',
    required: true,
    kind: 'integer',
    description: 'How many rounds you fired. Whole numbers, zero or more.',
    matchPatterns: [/^rounds?$/, /^rds?$/, /^shots?$/, /^round count$/, /^count$/, /round/, /\brds\b/],
  },
  {
    key: 'location',
    label: 'Location',
    required: false,
    kind: 'text',
    description: 'Where you shot.',
    matchPatterns: [/^location$/, /^range$/, /^place$/, /^venue$/, /^where$/, /location/, /range name/],
  },
  {
    key: 'distances',
    label: 'Distances',
    required: false,
    kind: 'text',
    description: 'The distances you shot at.',
    matchPatterns: [/^distances?$/, /^yards?$/, /^metres?$/, /^meters?$/, /distance/],
  },
  {
    key: 'ammo',
    label: 'Ammo used',
    required: false,
    kind: 'ammoRef',
    description: 'Which ammunition you fired, by name.',
    matchPatterns: [/^ammo$/, /^ammunition$/, /^ammo used$/, /^load$/, /ammo/],
  },
  {
    key: 'rangeFee',
    label: 'Range fee',
    required: false,
    kind: 'number',
    description: 'What the range cost that day, in dollars.',
    matchPatterns: [/^range fee$/, /^fee$/, /^cost$/, /^price$/, /fee/, /cost/],
  },
  {
    key: 'instructor',
    label: 'Instructor',
    required: false,
    kind: 'text',
    description: 'Who taught, for a class.',
    matchPatterns: [/^instructor$/, /^coach$/, /^teacher$/, /instructor/],
  },
  {
    key: 'planned',
    label: 'Planned',
    required: false,
    kind: 'yesNo',
    description: 'Yes for a session you planned but have not shot yet.',
    matchPatterns: [/^planned$/, /^plan$/, /planned/],
  },
  {
    key: 'notes',
    label: 'Notes',
    required: false,
    kind: 'text',
    description: 'Anything you wrote about the day.',
    matchPatterns: [/^notes?$/, /^comments?$/, /^remarks?$/, /note/, /comment/],
  },
  {
    key: 'drillName',
    label: 'Drill',
    required: false,
    kind: 'text',
    description: 'The drill you ran, if the row records one.',
    matchPatterns: [/^drills?$/, /^drill name$/, /drill/],
  },
  {
    key: 'drillTime',
    label: 'Drill time',
    required: false,
    kind: 'number',
    description: 'The time you ran it in, in seconds.',
    matchPatterns: [/^time$/, /^drill time$/, /^seconds$/, /time/],
  },
  {
    key: 'drillScore',
    label: 'Drill score',
    required: false,
    kind: 'number',
    description: 'What you scored on the drill.',
    matchPatterns: [/^score$/, /^drill score$/, /^points$/, /score/],
  },
];

export function fieldByKey(registry: readonly FieldSpec[], key: string | null): FieldSpec | null {
  if (!key) return null;
  return registry.find((f) => f.key === key) ?? null;
}

/** One column of their file and what we think it is. */
export interface ColumnGuess {
  index: number;
  header: string;
  /** Our field key, or null for "skip this column". */
  fieldKey: string | null;
  /** True when the engine picked it, so the screen can show it as a guess. */
  guessed: boolean;
}

const normalizeHeader = (header: string): string =>
  header.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');

/**
 * Pre-fill the mapping by header name, in the spirit of findCol (csv.ts:43) but
 * across the whole registry at once.
 *
 * Priority is by how exactly a header matches, not by the order the columns
 * happen to appear: "Range fee" matches the range-fee field's exact pattern
 * before it matches the location field's loose /range/ one, so the fee column
 * does not land in Location. Every field and every column is claimed at most
 * once.
 */
export function guessMapping(headers: readonly string[], registry: readonly FieldSpec[]): ColumnGuess[] {
  interface Candidate { column: number; fieldKey: string; rank: number }
  const candidates: Candidate[] = [];
  headers.forEach((header, column) => {
    const text = normalizeHeader(header);
    if (text === '') return;
    for (const field of registry) {
      const rank = field.matchPatterns.findIndex((re) => re.test(text));
      if (rank >= 0) candidates.push({ column, fieldKey: field.key, rank });
    }
  });
  candidates.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.column - b.column));

  const takenColumns = new Set<number>();
  const takenFields = new Set<string>();
  const assigned = new Map<number, string>();
  for (const c of candidates) {
    if (takenColumns.has(c.column) || takenFields.has(c.fieldKey)) continue;
    takenColumns.add(c.column);
    takenFields.add(c.fieldKey);
    assigned.set(c.column, c.fieldKey);
  }

  return headers.map((header, index) => ({
    index,
    header,
    fieldKey: assigned.get(index) ?? null,
    guessed: assigned.has(index),
  }));
}

/** Which required fields still have no column pointing at them. */
export function missingRequiredFields(
  assignments: readonly (string | null)[],
  registry: readonly FieldSpec[],
): FieldSpec[] {
  const mapped = new Set(assignments.filter((a): a is string => !!a));
  return registry.filter((f) => f.required && !mapped.has(f.key));
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export interface LooseNumber {
  /** Never NaN. A value we cannot read is null, so nothing poisons the math. */
  value: number | null;
  /** Exactly what the cell said, so the preview can show it back. */
  raw: string;
  /** What was taken off to get the number, so a wrong strip is visible. */
  stripped: string[];
}

const NUMERIC_SHAPE = /^[+-]?[\d.,\s%eE+-]+$/;
const NUMBER_CORE = /[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+-]?\d*\.\d+|[+-]?\d+/;

/**
 * Read a number out of a cell that may carry units, a currency symbol,
 * thousands separators or a percent sign, and say what was taken off.
 *
 * The final conversion always goes through looseNum (csv.ts:29) so the
 * magnitude cap at csv.ts:36 to 38 stays the one place that decides a number is
 * absurd. "1e308" is still refused; it is not quietly read as 1.
 */
export function parseLooseNumber(input: string | number | null | undefined): LooseNumber {
  const raw = input == null ? '' : String(input);
  const text = raw.trim();
  if (text === '') return { value: null, raw, stripped: [] };
  if (!/\d/.test(text)) return { value: null, raw, stripped: [text] };

  if (NUMERIC_SHAPE.test(text)) {
    const stripped: string[] = [];
    if (text.includes('%')) stripped.push('%');
    if (/\d,\d/.test(text)) stripped.push(',');
    return { value: looseNum(text), raw, stripped };
  }

  const match = NUMBER_CORE.exec(text);
  if (!match) return { value: null, raw, stripped: [text] };
  const core = match[0];
  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index + core.length).trim();
  const stripped = [before, after].filter((s) => s !== '');
  if (/\d,\d/.test(core)) stripped.push(',');
  return { value: looseNum(core), raw, stripped };
}

/** The preview line for a cell we had to strip something off. */
export function strippedNote(label: string, read: LooseNumber): string | null {
  if (read.value === null || read.stripped.length === 0) return null;
  return `${label}: read "${read.raw.trim()}" as ${read.value}.`;
}

// ---------------------------------------------------------------------------
// Gun and ammo references, matched by name
// ---------------------------------------------------------------------------

export interface RefMatch {
  id: string | null;
  /** The name as their file wrote it, so the resolution step can show it back. */
  name: string;
  matched: boolean;
}

const normalizeName = (name: string): string =>
  String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function matchByName(name: string, entries: readonly { id: string; names: string[] }[]): RefMatch {
  const raw = String(name ?? '').trim();
  const wanted = normalizeName(raw);
  if (wanted === '') return { id: null, name: raw, matched: false };
  for (const entry of entries) {
    if (entry.names.some((n) => normalizeName(n) === wanted)) {
      return { id: entry.id, name: raw, matched: true };
    }
  }
  return { id: null, name: raw, matched: false };
}

/** Match a gun by name, forgiving case and spacing drift. */
export function matchGunRef(name: string, records: readonly Firearm[]): RefMatch {
  return matchByName(name, records.map((f) => ({ id: f.id, names: [f.name] })));
}

/**
 * Match ammunition by the label the export writes ("Brand 9mm 124gr FMJ") or by
 * the brand on its own, which is what a hand-kept spreadsheet usually holds.
 */
export function matchAmmoRef(name: string, records: readonly Ammunition[]): RefMatch {
  return matchByName(name, records.map((a) => ({ id: a.id, names: [ammoLabel(a), a.brand] })));
}
