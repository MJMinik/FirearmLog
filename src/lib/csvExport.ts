// CSV export — turning stored records into a file any spreadsheet can open.
//
// Build-queue stage 1 of the CSV work (design: vault note "FirearmLog - CSV
// import & column mapping — analysis and design (2026-08-02)", Michael's
// answer 6a). This half is deliberately first because it is READ-ONLY: it
// never writes, edits or deletes a stored record, so it carries none of the
// import side's blast radius.
//
// This module is PURE — no storage access, no DOM, no browser APIs — so the
// whole thing is unit-testable, in the house style set by lib/import/
// pistolTracker.ts. Delivery of the finished text to the user is somebody
// else's job: ui/deliverFile.ts already solves that (and solved the installed-
// iOS-PWA blank-screen bug in the process). Do not re-solve it here.
//
// What this format is, stated plainly because the copy has to match: a CSV is
// a flat, readable view of the log for spreadsheets and for moving data to
// another program. The complete, lossless backup is the .flog file — it is the
// one that carries photos, videos and every nested detail. Both exist on
// purpose and they are not substitutes.

/** One column: the header a spreadsheet shows, and how to read it off a record. */
export interface CsvColumn<T> {
  header: string;
  get: (row: T) => unknown;
}

/**
 * RFC 4180 field escaping.
 *
 * A field is quoted when it contains the delimiter, a double quote, or a line
 * break; embedded quotes are doubled. Everything else is emitted bare.
 *
 * Two deliberate choices worth naming:
 *
 * 1. `null` and `undefined` become an EMPTY field, never the strings "null" or
 *    "undefined". A blank cell is what a spreadsheet user reads as "no value";
 *    the literal word `null` in a column is the tell of an export nobody
 *    checked. (The importer's `looseNum` already treats empty as "no value",
 *    which keeps the round trip honest.)
 * 2. A value that a spreadsheet would execute as a FORMULA is neutralised —
 *    see `neutralizeFormula`.
 */
export function escapeCsvField(value: unknown, delimiter = ','): string {
  if (value === null || value === undefined) return '';

  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);

  s = neutralizeFormula(s);

  const mustQuote = s.includes(delimiter) || s.includes('"') || /[\r\n]/.test(s);
  if (!mustQuote) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * CSV INJECTION GUARD.
 *
 * Excel, Numbers and Google Sheets treat a cell beginning `=`, `+`, `-` or `@`
 * as a formula. A note a user typed as `=cmd|' /c calc'!A1` — or, far more
 * likely on this app's data, a perfectly innocent note beginning with a minus
 * sign — is then executed or mangled when the file is opened. That is somebody
 * else's spreadsheet running our file's content, which is not a risk this app
 * gets to hand to a user by accident.
 *
 * The fix is the OWASP-recommended one: prefix the field with a single quote,
 * which every major spreadsheet reads as "this cell is text". The visible value
 * is unchanged in the cell; the leading quote lives only in the file.
 *
 * Note this runs on a per-FIELD basis before quoting, so it survives escaping.
 *
 * ONE REFINEMENT, because the blunt version costs the user something real. The
 * usual advice neutralises every field starting `=`, `+`, `-` or `@`, which
 * turns every negative number in the log into TEXT in the spreadsheet —
 * unsortable, unsummable, right-alignment gone. So `+` and `-` are exempted
 * when the whole field is a well-formed number: Excel reads `-5` as the number
 * minus five, not as a formula, so there is nothing to defend against. It does
 * evaluate `-1+1`, and it chokes on `-2 seconds on the draw` — neither of which
 * is a number, so both are still neutralised. `=` and `@` are never exempt.
 */
export function neutralizeFormula(s: string): string {
  if (s === '') return s;
  const first = s[0];
  if (first === '=' || first === '@' || first === '\t' || first === '\r') {
    return `'${s}`;
  }
  if (first === '+' || first === '-') {
    // A plain signed number is safe and must stay numeric in the spreadsheet.
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return s;
    return `'${s}`;
  }
  return s;
}

/**
 * Serialise rows to CSV text.
 *
 * Line endings are CRLF, which is what RFC 4180 specifies and what Excel on
 * Windows expects; every other reader accepts it. A trailing newline is
 * emitted so the file ends the way a text file should.
 *
 * `withBom` prepends the UTF-8 byte-order mark. Excel needs it to read
 * non-ASCII text correctly (a gun named with an accent, a note in any language
 * but English, the ° in a weather note) — without it Excel guesses the legacy
 * codepage and the characters arrive mangled. The parser on the import side
 * strips a BOM, so this does not poison a round trip.
 */
export function toCsvText<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  opts: { delimiter?: string; withBom?: boolean } = {},
): string {
  const delimiter = opts.delimiter ?? ',';
  const withBom = opts.withBom ?? true;

  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvField(c.header, delimiter)).join(delimiter));
  for (const row of rows) {
    lines.push(columns.map((c) => safeCell(c, row, delimiter)).join(delimiter));
  }

  const body = lines.join('\r\n') + '\r\n';
  return withBom ? '﻿' + body : body;
}

/**
 * A column accessor that throws must not take the whole export down with it.
 *
 * One bad record breaking a whole screen is the failure class the charter puts
 * above features and polish, and an export is exactly where a single malformed
 * legacy record would otherwise cost a user the entire file. The cell reads
 * `#ERROR` — visible, honest, and confined to itself.
 */
function safeGet<T>(column: CsvColumn<T>, row: T): unknown {
  try {
    return column.get(row);
  } catch {
    return '#ERROR';
  }
}

/**
 * The guard has to cover the SERIALISATION as well as the accessor.
 *
 * It did not, and the comment above claimed otherwise, which made the stated
 * contract false rather than merely incomplete: `escapeCsvField` itself throws
 * on a Date holding NaN (`RangeError: Invalid time value`) and on a circular
 * object (`JSON.stringify`), and both survive IndexedDB's structured clone.
 * Neither is reachable from anything this app writes today, so this is a one
 * line repair to a promise rather than a fix to a live defect — but a promise
 * that only holds for values nobody passes is not worth making.
 */
function safeCell<T>(column: CsvColumn<T>, row: T, delimiter: string): string {
  try {
    return escapeCsvField(safeGet(column, row), delimiter);
  } catch {
    return '#ERROR';
  }
}

/** Join a list into one cell without colliding with the delimiter. */
export function joinCell(values: readonly unknown[] | null | undefined, sep = '; '): string {
  if (!values || values.length === 0) return '';
  return values
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => String(v))
    .join(sep);
}

/**
 * A filename that sorts, is unambiguous, and is legal everywhere.
 *
 * `FirearmLog-sessions-2026-08-02.csv`. The date is the export date in the
 * user's own local time — a UTC date would read as "tomorrow" to anyone east
 * of Greenwich late in the evening, and the file's name is the one thing the
 * user reads before opening it.
 */
export function exportFilename(table: string, now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const safeTable = table.replace(/[^a-zA-Z0-9_-]/g, '');
  return `FirearmLog-${safeTable}-${y}-${m}-${d}.csv`;
}
