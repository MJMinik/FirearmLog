// CSV parsing for the general importer (design doc 3.1). Pure logic: no
// storage, no DOM, no React, so the exact same code runs in the app and under
// `npm test`, in the pistolTracker.ts house style.
//
// Why a second parser when lib/csv.ts already has splitCsvLine: that helper
// splits ONE line, which is correct for the PractiScore and USPSA formats it
// serves and stays untouched here. An arbitrary spreadsheet can put a line
// break inside a quoted notes field, so this one walks the whole text instead
// of the file's lines. It also detects the separator (comma, semicolon, tab)
// rather than hard-coding a comma.
//
// NOTE ON PUNCTUATION: nothing in this file, comments included, uses an em
// dash. The engine's tests assert that, because every string in here can reach
// a shooter's screen.

import { looseNum } from '../csv.ts';

/**
 * One thing wrong with the file. `row` points into `rows` when the trouble
 * belongs to a single data row, so the planner can attach it to that row's
 * line rather than reporting it twice in different words.
 */
export interface CsvParseProblem {
  row: number | null;
  /** 1-based line in the source text, which is what the shooter can look at. */
  line: number;
  message: string;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** 1-based source line for each row in `rows`, same length as `rows`. */
  rowLines: number[];
  delimiter: string;
  /** True when the first row looks like data rather than column names. */
  headerLooksLikeData: boolean;
  /** True when a blank or repeated column name had to be given a name. */
  headersDisambiguated: boolean;
  problems: CsvParseProblem[];
}

export interface ParseCsvOptions {
  /** Force the separator instead of detecting it. */
  delimiter?: string;
  /** Pass false for "my file has no header row": columns become Column A, B, C. */
  hasHeader?: boolean;
}

const DELIMITER_CANDIDATES = [',', ';', '\t'];

interface RawRecord {
  cells: string[];
  line: number;
}

/**
 * Walk the whole text once. Quoted fields keep their separators and their line
 * breaks; a doubled quote inside a quoted field is one literal quote.
 */
function tokenize(text: string, delimiter: string, maxRecords = Number.POSITIVE_INFINITY): RawRecord[] {
  const records: RawRecord[] = [];
  let cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const pushCell = () => {
    cells.push(cur.trim());
    cur = '';
  };
  const pushRecord = () => {
    pushCell();
    records.push({ cells, line: recordLine });
    cells = [];
    recordLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      pushCell();
      continue;
    }
    if (ch === '\n') {
      line++;
      pushRecord();
      if (records.length >= maxRecords) return records;
      continue;
    }
    cur += ch;
  }
  if (cur !== '' || cells.length > 0) pushRecord();
  return records;
}

const isBlankRecord = (r: RawRecord): boolean => r.cells.every((c) => c === '');

/** The most common value in a list, or 0 for an empty list. */
function modal(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Which separator this file uses. Each candidate is tried on the first handful
 * of rows; the winner is the one that yields the most columns while staying
 * consistent from row to row. A file with one column has no separator to find,
 * so it falls back to a comma.
 */
export function detectDelimiter(text: string): string {
  let best = ',';
  let bestScore = 0;
  for (const candidate of DELIMITER_CANDIDATES) {
    const records = tokenize(text, candidate, 10).filter((r) => !isBlankRecord(r));
    if (records.length === 0) continue;
    const counts = records.map((r) => r.cells.length);
    const width = modal(counts);
    if (width < 2) continue;
    const consistency = counts.filter((c) => c === width).length / counts.length;
    const score = width * consistency;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Spreadsheet-style names for a file with no header row. */
export function columnName(index: number): string {
  let n = index;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Column ${name}`;
}

const DATE_SHAPE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;

/**
 * Does this row read as data rather than as column names? Used to warn before
 * the first row is thrown away as a header.
 */
export function rowLooksLikeData(cells: readonly string[]): boolean {
  const filled = cells.filter((c) => c !== '');
  if (filled.length === 0) return false;
  const dataish = filled.filter((c) => looseNum(c) !== null || DATE_SHAPE.test(c));
  return dataish.length * 2 >= filled.length;
}

/** Give every column a name, and say whether any name had to be invented. */
function nameHeaders(cells: readonly string[]): { headers: string[]; disambiguated: boolean } {
  const headers: string[] = [];
  const used = new Map<string, number>();
  let disambiguated = false;
  cells.forEach((raw, i) => {
    let name = raw.trim();
    if (name === '') {
      name = columnName(i);
      disambiguated = true;
    }
    const seen = used.get(name.toLowerCase()) ?? 0;
    used.set(name.toLowerCase(), seen + 1);
    if (seen > 0) {
      name = `${name} (${seen + 1})`;
      disambiguated = true;
    }
    headers.push(name);
  });
  return { headers, disambiguated };
}

/**
 * Read a whole CSV file. Never throws: a file we cannot use comes back with
 * empty rows and a plain reason in `problems`, so the screen can say what is
 * wrong instead of showing a crash.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): ParsedCsv {
  const normalized = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');

  const delimiter = options.delimiter ?? detectDelimiter(normalized);
  const records = tokenize(normalized, delimiter).filter((r) => !isBlankRecord(r));
  const problems: CsvParseProblem[] = [];

  if (records.length === 0) {
    return {
      headers: [], rows: [], rowLines: [], delimiter,
      headerLooksLikeData: false, headersDisambiguated: false,
      problems: [{ row: null, line: 1, message: 'There are no rows in this file to read.' }],
    };
  }

  const hasHeader = options.hasHeader !== false;
  const first = records[0];
  const headerLooksLikeData = rowLooksLikeData(first.cells);

  let headers: string[];
  let disambiguated: boolean;
  let dataRecords: RawRecord[];
  if (hasHeader) {
    const named = nameHeaders(first.cells);
    headers = named.headers;
    disambiguated = named.disambiguated;
    dataRecords = records.slice(1);
  } else {
    const width = Math.max(...records.map((r) => r.cells.length));
    headers = Array.from({ length: width }, (_, i) => columnName(i));
    disambiguated = false;
    dataRecords = records;
  }

  const rows: string[][] = [];
  const rowLines: number[] = [];
  dataRecords.forEach((rec) => {
    const index = rows.length;
    rows.push(rec.cells);
    rowLines.push(rec.line);
    if (rec.cells.length !== headers.length) {
      // Kept, not discarded. The planner turns this into a per-row problem so
      // one broken line never costs the file (design doc 3.4).
      problems.push({
        row: index,
        line: rec.line,
        message: `Line ${rec.line} has ${rec.cells.length} values but the header row has ${headers.length}.`,
      });
    }
  });

  if (rows.length === 0) {
    problems.push({
      row: null,
      line: first.line,
      message: 'This file has column names but no rows under them.',
    });
  }

  return {
    headers, rows, rowLines, delimiter,
    headerLooksLikeData, headersDisambiguated: disambiguated,
    problems,
  };
}

/** The value of one column in one row, or '' when the row is short. */
export function cellAt(row: readonly string[], index: number): string {
  if (index < 0 || index >= row.length) return '';
  return row[index] ?? '';
}
