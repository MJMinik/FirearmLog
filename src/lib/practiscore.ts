// PractiScore match-results importer — pure parser (spec §7.3, M8, build 1).
// Turns a pasted/loaded PractiScore USPSA match-results export (CSV) into a
// structured preview the UI shows BEFORE anything is written. No DB access here,
// so it's fully unit-testable.
//
// Two shapes reach this parser, and both are now covered by real captures
// rather than by guesswork:
//   1. A comma-separated export with a "Match Name,..." metadata block.
//   2. The text of a PractiScore "Html Results" table, copied out of a browser
//      and therefore TAB separated, with the match name and date on a title
//      line above the table. This is the shape a shooter can actually obtain:
//      PractiScore's public results pages carry no download of any kind
//      (every link and button on the results page, the Html Results page and
//      the Match Breakdown page was enumerated on 5 August 2026 — there is no
//      export, no CSV, no download).
// Columns are matched by header NAME with fallbacks and the delimiter is
// sniffed, so a real export with slightly different headers or separators can
// be adapted without code changes for the common cases.
import { splitCsvLine, looseNum, findCol, DELIMITER_CANDIDATES } from './csv.ts';

const num = looseNum;

export interface PsStage {
  number: number;
  percent: number | null;
}

export interface PsCompetitor {
  overallPlace: number | null;
  divisionPlace: number | null;
  name: string;
  memberNumber: string;
  division: string;
  classLetter: string;
  powerFactor: string;
  matchPoints: number | null;
  matchPercent: number | null;
  stages: PsStage[];
}

export interface PsMatch {
  name: string;
  date: string; // YYYY-MM-DD if found, else ''
  stageCount: number | null;
  competitors: PsCompetitor[];
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.join(' ').toLowerCase();
  const hasPlace = /\bplace\b|\bpos\b|finish/.test(joined);
  const hasOther = /division|\bdiv\b|\bclass\b|name|competitor|shooter|power|stage|percent|match\s*%/.test(joined);
  return hasPlace && hasOther;
}

/**
 * Parse a PractiScore results export into a match + its competitors.
 * Throws a plain-language Error if it can't find a results table.
 *
 * The separator is chosen by RESULT, not by guesswork: the text is parsed once
 * per candidate and the reading that finds the most competitors wins, ties
 * going to the earlier candidate so a comma export can never be displaced.
 *
 * An earlier version scored the candidates with a heuristic over line shapes,
 * and an audit broke it in four different ways in one sitting. Prose lines
 * containing a comma out-voted the real table, a ragged final row sank it, and
 * a category cell full of semicolons swept a genuine CSV. All of those are
 * questions about which SPLIT YIELDS A TABLE, so the honest measure is to make
 * the table and count it. Page furniture produces no competitors under any
 * separator, which is precisely why it cannot win.
 */
export function parsePractiScore(text: string): PsMatch {
  let best: PsMatch | null = null;
  let firstError: Error | null = null;
  for (const delim of DELIMITER_CANDIDATES) {
    try {
      const attempt = parseWith(text, delim);
      if (best === null || attempt.competitors.length > best.competitors.length) best = attempt;
    } catch (e) {
      if (firstError === null && e instanceof Error) firstError = e;
    }
  }
  if (best === null) throw firstError ?? new Error('I could not read that as a results table.');
  return best;
}

function parseWith(text: string, delim: string): PsMatch {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // Locate the results header row; anything above it that looks like "key,value"
  // is treated as match metadata (name / date / stage count).
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (isHeaderRow(splitCsvLine(lines[i], delim))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    throw new Error("I couldn't find a results table in that. It needs a row of column headings like Place, Name, Div — copy the whole Combined results page from PractiScore and paste it again.");
  }

  // ---- Metadata block (optional) ----
  let name = '';
  let date = '';
  let titleName = '';
  let titleDate = '';
  let stageCount: number | null = null;
  for (let i = 0; i < headerIdx; i++) {
    const raw = lines[i].trim();
    if (raw === '') continue;
    const cells = splitCsvLine(raw, delim);
    if (cells.length < 2) continue;
    const key = cells[0].toLowerCase();
    const value = cells.slice(1).join(',').trim();
    if (/date/.test(key)) {
      const m = value.match(/\d{4}-\d{2}-\d{2}/);
      date = m ? m[0] : '';
    } else if (/stage/.test(key)) {
      stageCount = num(value);
    } else if (/name/.test(key)) {
      name = value;
    }
  }

  // PractiScore's Html Results pages carry no "key,value" metadata block. They
  // put the match name and date on a single title line above the table, as
  // "<match name> - YYYY-MM-DD". Read that only when the block above did not
  // already supply the field, so an explicit "Match Date" row always wins.
  //
  // The LAST such line before the table wins, not the first. A copied page can
  // carry other dated lines above the results — a link to the next club match,
  // a previous week's fixture — and taking the first one wrote a wrong date
  // into the saved record with nothing to give it away, because the field was
  // populated rather than empty. The line nearest the table is the one that
  // titles it. All three dashes are accepted; a browser copy may carry any.
  if (name === '' || date === '') {
    for (let i = 0; i < headerIdx; i++) {
      const cells = splitCsvLine(lines[i], delim).filter((c) => c !== '');
      const candidate = cells.length > 0 ? cells[cells.length - 1] : '';
      const m = candidate.match(/^(.*\S)\s+[-\u2013\u2014]\s+(\d{4}-\d{2}-\d{2})$/);
      if (m) {
        // No break: keep overwriting so the last match before the table wins.
        if (name === '') titleName = m[1].trim();
        if (date === '') titleDate = m[2];
      }
    }
    if (name === '') name = titleName;
    if (date === '') date = titleDate;
  }

  // ---- Header column mapping ----
  const headers = splitCsvLine(lines[headerIdx], delim);
  const claimed = new Set<number>();
  const col = {
    overallPlace: findCol(headers, claimed, [/overall\s*place/i, /^place$/i, /\bplace\b/i, /^pos$/i, /^rank$/i, /finish/i]),
    divisionPlace: findCol(headers, claimed, [/division\s*place/i, /div\.?\s*place/i, /class\s*place/i]),
    matchPercent: findCol(headers, claimed, [/match\s*%/i, /match\s*percent/i, /final\s*%/i, /^%$/i]),
    // "Match Pts" is what PractiScore's own results tables call this column;
    // without the abbreviation the points were silently dropped. The bare
    // /\bpts\b/ that sat here as well is deliberately absent: it claimed the
    // "Stage 1 Pts" column on a per-stage table and wrote a single stage's
    // points into the record as the match score.
    matchPoints: findCol(headers, claimed, [/match\s*point/i, /match\s*pts/i, /\bpoints?\b/i]),
    powerFactor: findCol(headers, claimed, [/power\s*factor/i, /^pf$/i]),
    // "No." is the member-number column heading on a PractiScore Html Results
    // table; it matched none of the earlier patterns. It is also what a table
    // calls its row counter, so the values are checked below before it is
    // believed — see the guard after the stage scan.
    memberNumber: findCol(headers, claimed, [/uspsa/i, /member/i, /\bnumber\b/i, /^no\.?$/i, /#/]),
    division: findCol(headers, claimed, [/division/i, /\bdiv\b/i]),
    classLetter: findCol(headers, claimed, [/^class$/i, /\bclass\b/i]),
    name: findCol(headers, claimed, [/^name$/i, /competitor/i, /shooter/i]),
    firstName: -1,
    lastName: -1,
  };
  if (col.name === -1) {
    col.firstName = findCol(headers, claimed, [/first\s*name/i, /^first$/i]);
    col.lastName = findCol(headers, claimed, [/last\s*name/i, /^last$/i]);
  }

  // Stage columns: any header like "Stage 3" / "Stage 3 %".
  const stageCols: { idx: number; number: number }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const m = headers[i].match(/^stage\s*(\d+)/i);
    if (m) stageCols.push({ idx: i, number: Number(m[1]) });
  }
  stageCols.sort((a, b) => a.number - b.number);

  // A column headed "No." is the member number on a PractiScore results table
  // and a plain row counter on plenty of others. A USPSA member number always
  // carries a letter prefix (A185321, TY112817, L5268); a row counter never
  // does. So the heading alone is not trusted: if every value under it is
  // nothing but digits, the column is released rather than believed. Without
  // this, importing such a table wrote "Imported from PractiScore (USPSA# 1)"
  // into the saved record — a member number nobody has, invented by us.
  if (col.memberNumber >= 0 && /^no\.?$/i.test(headers[col.memberNumber] ?? '')) {
    let sawALetter = false;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const v = splitCsvLine(lines[i], delim)[col.memberNumber];
      if (v != null && v !== '' && /[^0-9]/.test(v)) { sawALetter = true; break; }
    }
    if (!sawALetter) col.memberNumber = -1;
  }

  const cell = (row: string[], idx: number): string | undefined => (idx >= 0 ? row[idx] : undefined);

  // ---- Data rows ----
  const competitors: PsCompetitor[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const row = splitCsvLine(lines[i], delim);
    const singleName = cell(row, col.name);
    const combinedName = [cell(row, col.firstName), cell(row, col.lastName)]
      .filter((x) => x && x.trim()).join(' ').trim();
    const personName = (singleName && singleName.trim()) || combinedName;
    const place = num(cell(row, col.overallPlace));
    // Skip blank/total rows that carry neither a name nor a place.
    if (!personName && place == null) continue;

    competitors.push({
      overallPlace: place,
      divisionPlace: num(cell(row, col.divisionPlace)),
      name: personName,
      memberNumber: (cell(row, col.memberNumber) ?? '').trim(),
      division: (cell(row, col.division) ?? '').trim(),
      classLetter: (cell(row, col.classLetter) ?? '').trim(),
      powerFactor: (cell(row, col.powerFactor) ?? '').trim(),
      matchPoints: num(cell(row, col.matchPoints)),
      matchPercent: num(cell(row, col.matchPercent)),
      stages: stageCols.map((sc) => ({ number: sc.number, percent: num(row[sc.idx]) })),
    });
  }

  if (competitors.length === 0) {
    throw new Error('I found the column headings but no shooters under them. Copy the whole Combined results page, headings and rows together, and paste it again.');
  }

  return { name, date, stageCount, competitors };
}

/** How many competitors are in a given division (for "X of Y" division place). */
export function countInDivision(competitors: PsCompetitor[], division: string): number {
  const d = division.trim().toLowerCase();
  return competitors.filter((c) => c.division.trim().toLowerCase() === d).length;
}

// A realistic, self-contained sample so Michael can try the importer before he
// has a real export. Mirrored in src/lib/samples/practiscore-sample.csv.
export const SAMPLE_PRACTISCORE_CSV = `Match Name,Spring Classic USPSA Level 1
Match Date,2026-05-17
Stages,5

Overall Place,Division Place,First Name,Last Name,USPSA #,Division,Class,Power Factor,Match Points,Match %,Stage 1 %,Stage 2 %,Stage 3 %,Stage 4 %,Stage 5 %
1,1,Jordan,Vance,A12345,Carry Optics,A,Minor,720.5000,100.00,100.00,95.20,100.00,98.10,100.00
2,1,Sam,Okafor,A33321,Limited,A,Major,701.2000,100.00,98.40,100.00,96.70,100.00,99.10
3,2,Chris,Calder,TY79901,Carry Optics,C,Minor,612.3400,84.98,80.10,88.30,79.50,91.20,86.40
4,3,Dana,Whitfield,A44419,Carry Optics,B,Minor,585.0000,81.20,79.00,84.10,77.30,85.60,80.00
5,4,Pat,Rosario,A55512,Carry Optics,B,Minor,560.1200,77.74,75.00,80.00,70.20,82.10,79.90
`;
