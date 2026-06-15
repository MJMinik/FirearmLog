// PractiScore match-results importer — pure parser (spec §7.3, M8, build 1).
// Turns a pasted/loaded PractiScore USPSA match-results export (CSV) into a
// structured preview the UI shows BEFORE anything is written. No DB access here,
// so it's fully unit-testable.
//
// Michael has no real export yet, so this is built against the fabricated sample
// below (also mirrored in src/lib/samples/practiscore-sample.csv for reference).
// Columns are matched by header NAME with fallbacks, and the import screen shows
// a preview, so a real export with slightly different headers can be adapted
// without code changes for the common cases.
import { splitCsvLine, looseNum, findCol } from './csv.ts';

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
 */
export function parsePractiScore(text: string): PsMatch {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // Locate the results header row; anything above it that looks like "key,value"
  // is treated as match metadata (name / date / stage count).
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (isHeaderRow(splitCsvLine(lines[i]))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    throw new Error("This doesn't look like a PractiScore results export — I couldn't find a results table (a row of column headings like Place, Division, Name).");
  }

  // ---- Metadata block (optional) ----
  let name = '';
  let date = '';
  let stageCount: number | null = null;
  for (let i = 0; i < headerIdx; i++) {
    const raw = lines[i].trim();
    if (raw === '') continue;
    const cells = splitCsvLine(raw);
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

  // ---- Header column mapping ----
  const headers = splitCsvLine(lines[headerIdx]);
  const claimed = new Set<number>();
  const col = {
    overallPlace: findCol(headers, claimed, [/overall\s*place/i, /^place$/i, /\bplace\b/i, /^pos$/i, /^rank$/i, /finish/i]),
    divisionPlace: findCol(headers, claimed, [/division\s*place/i, /div\.?\s*place/i, /class\s*place/i]),
    matchPercent: findCol(headers, claimed, [/match\s*%/i, /match\s*percent/i, /final\s*%/i, /^%$/i]),
    matchPoints: findCol(headers, claimed, [/match\s*point/i, /\bpoints?\b/i]),
    powerFactor: findCol(headers, claimed, [/power\s*factor/i, /^pf$/i]),
    memberNumber: findCol(headers, claimed, [/uspsa/i, /member/i, /\bnumber\b/i, /#/]),
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

  const cell = (row: string[], idx: number): string | undefined => (idx >= 0 ? row[idx] : undefined);

  // ---- Data rows ----
  const competitors: PsCompetitor[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const row = splitCsvLine(lines[i]);
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
    throw new Error('I found the results header but no competitor rows under it.');
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
3,2,Michael,Minik,TY79901,Carry Optics,C,Minor,612.3400,84.98,80.10,88.30,79.50,91.20,86.40
4,3,Dana,Whitfield,A44419,Carry Optics,B,Minor,585.0000,81.20,79.00,84.10,77.30,85.60,80.00
5,4,Pat,Rosario,A55512,Carry Optics,B,Minor,560.1200,77.74,75.00,80.00,70.20,82.10,79.90
`;
