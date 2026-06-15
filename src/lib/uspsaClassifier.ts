// USPSA classifier-records importer — pure parser (spec §7.3, M8 build 2).
// Turns a pasted/loaded USPSA classifier history export (CSV) into a list of
// classifier results the UI previews before anything is written. No DB access,
// so it's fully unit-testable. Each row maps onto a Classifier record
// ({date, code, name, division, hitFactor, percent}) and feeds the existing
// C->B classification view.
//
// Michael has no real export, so this is built against the fabricated sample
// below (mirrored in src/lib/samples/uspsa-classifiers-sample.csv). Columns are
// matched by header NAME with fallbacks, and the import screen shows a preview,
// so a real export with slightly different headers can be adapted.
import { splitCsvLine, looseNum, findCol } from './csv.ts';

export interface UspsaClassifierRow {
  date: string;
  code: string;        // e.g. "99-11"
  name: string;        // e.g. "Down the Middle"
  division: string;    // e.g. "Carry Optics"
  hitFactor: number | null;
  percent: number | null;
}

function isHeaderRow(cells: string[]): boolean {
  const j = cells.join(' ').toLowerCase();
  // A classifier table has a date and either a classifier/code column or a
  // percent/hit-factor column, plus a division.
  return /\bdate\b/.test(j)
    && /classifier|code|percent|hit\s*factor|division/.test(j);
}

/**
 * Parse a USPSA classifier export into a list of classifier results.
 * Throws a plain-language Error if it can't find a results table.
 */
export function parseUspsaClassifiers(text: string): UspsaClassifierRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (isHeaderRow(splitCsvLine(lines[i]))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    throw new Error("This doesn't look like a USPSA classifier export — I couldn't find a table with Date, Classifier, Division, and Percent columns.");
  }

  const headers = splitCsvLine(lines[headerIdx]);
  const claimed = new Set<number>();
  const col = {
    date: findCol(headers, claimed, [/\bdate\b/i]),
    percent: findCol(headers, claimed, [/percent/i, /%/, /\bpct\b/i]),
    hitFactor: findCol(headers, claimed, [/hit\s*factor/i, /^hf$/i]),
    code: findCol(headers, claimed, [/^classifier$/i, /\bcode\b/i, /^cm$/i, /classifier\s*#/i]),
    name: findCol(headers, claimed, [/name/i, /title/i]),
    division: findCol(headers, claimed, [/division/i, /\bdiv\b/i]),
  };

  const cell = (row: string[], idx: number): string => (idx >= 0 ? (row[idx] ?? '') : '');

  const rows: UspsaClassifierRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const r = splitCsvLine(lines[i]);
    const dateRaw = cell(r, col.date);
    const dateMatch = dateRaw.match(/\d{4}-\d{2}-\d{2}/);
    const date = dateMatch ? dateMatch[0] : dateRaw.trim();
    const code = cell(r, col.code).trim();
    const division = cell(r, col.division).trim();
    const percent = looseNum(cell(r, col.percent));
    // Skip blank/summary rows that carry neither a classifier code nor a percent.
    if (!code && percent == null) continue;
    rows.push({
      date,
      code,
      name: cell(r, col.name).trim(),
      division,
      hitFactor: looseNum(cell(r, col.hitFactor)),
      percent,
    });
  }

  if (rows.length === 0) {
    throw new Error('I found the classifier header but no score rows under it.');
  }
  return rows;
}

/** Stable key for de-duping against classifiers already in the log. */
export function classifierKey(r: { date: string; code: string; division: string }): string {
  return `${r.date}|${r.code.toLowerCase()}|${r.division.toLowerCase()}`;
}

// A realistic, self-contained sample so Michael can try the importer before he
// has a real export. Mirrored in src/lib/samples/uspsa-classifiers-sample.csv.
export const SAMPLE_USPSA_CSV = `Date,Classifier,Name,Division,Hit Factor,Percent
2025-09-14,99-11,Down the Middle,Carry Optics,7.1234,72.40
2025-11-02,03-02,Can You Count,Carry Optics,5.8800,75.10
2026-01-18,06-03,Off the Clock,Carry Optics,6.4500,79.95
2026-02-22,08-01,Pucker Factor,Carry Optics,5.2100,68.30
2026-03-15,13-02,Down & Out,Carry Optics,7.8900,83.60
2026-04-19,18-04,Outer Limits,Carry Optics,6.9000,81.25
2026-05-10,99-63,Eye of the Tiger,Limited,5.5000,70.00
`;
