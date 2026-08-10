// PractiScore "SCSA upload form" download file — reader.
//
// WHAT THIS IS. PractiScore publishes a downloadable file per match at
// https://practiscore.com/reports/scsaForm/<match-uuid>. It is plain text, one
// line per fact, every line padded to exactly 26 comma-separated columns, and
// column 0 is a two-letter record type. Unlike the results web page it carries
// EVERY individual run for EVERY competitor. Full decoding, with the evidence
// behind every claim below, is in SCSA_DOWNLOAD_FILE_FORMAT.md; the build spec
// is "Steel Challenge importer from the PractiScore download file (2026-08-10)".
//
// THIS MODULE IS PURE. It reads text and returns data or a refusal. It touches
// no database, no screen, and no settings, and it computes no score — scoring
// stays in competition.ts so an imported match is scored by exactly the same
// code as a hand-typed one.
//
// WHAT THE SAMPLES TAUGHT. Eleven real Steel matches from eleven clubs, plus one
// USPSA match pushed through the same form, were parsed and checked by script
// before a line of this was written. Drop-the-worst reconciled on 2,595 of 2,595
// score rows and match totals on 446 of 446 competitors. The rules below that
// look paranoid are each holding a real file upright, and the comment says which.

import { splitCsvLine } from './csv.ts';

/** The eight official SCSA stages, keyed by the stage code the file carries.
 *  Names and string counts mirror STEEL_STAGES in competition.ts exactly — this
 *  map exists so an official stage lands under the app's OWN name rather than
 *  the club's spelling of it. Clubs write "5 To Go", "Five To Go", "Smoke And
 *  Hope" and "The Pendulum" for stages this app calls "5 to Go", "Smoke & Hope"
 *  and "Pendulum". */
export const SCSA_OFFICIAL_STAGES: Readonly<Record<string, { name: string; strings: 4 | 5 }>> = {
  'SC-101': { name: '5 to Go', strings: 5 },
  'SC-102': { name: 'Showdown', strings: 5 },
  'SC-103': { name: 'Smoke & Hope', strings: 5 },
  'SC-104': { name: 'Outer Limits', strings: 4 },
  'SC-105': { name: 'Accelerator', strings: 5 },
  'SC-106': { name: 'Pendulum', strings: 5 },
  'SC-107': { name: 'Speed Option', strings: 5 },
  'SC-108': { name: 'Roundabout', strings: 5 },
};

/** Division code -> the name this app already stores (STEEL_DIVISIONS in
 *  competition.ts). Every one of these sixteen codes was observed in a real
 *  Steel file; nothing here is inferred from the letters.
 *
 *  This is a TRANSLATION, never a migration: a stored record keeps its own name
 *  and nothing is renamed. Two deliberate mismatches with the file's own wording:
 *
 *   - OSR: the file's clubs write "Open Revolver"; this app stores "Optical
 *     Sight Revolver", which is the rulebook's name (Appendix D).
 *   - RFPO / RFRO / RRO: the export writes all three SINGULAR ("Rimfire Pistol
 *     Optic", "Rimfire Rifle Optic", "Rimfire Revolver Optic"). This app stores
 *     the first two plural and the third singular. Michael decided on 10 Aug 2026
 *     to keep the stored names as they are (decision 1); the disagreement is
 *     recorded rather than resolved, per decision 25. Mapping by CODE means the
 *     importer is unaffected either way. */
export const SCSA_DIVISION_BY_CODE: Readonly<Record<string, string>> = {
  OPN: 'Open',
  LTD: 'Limited',
  LO: 'Limited Optics',
  PROD: 'Production',
  SS: 'Single Stack',
  CO: 'Carry Optics',
  OSR: 'Optical Sight Revolver',
  ISR: 'Iron Sight Revolver',
  PCCO: 'PCC Optics',
  PCCI: 'PCC Iron',
  RFPO: 'Rimfire Pistol Optics',
  RFPI: 'Rimfire Pistol Iron',
  RFRO: 'Rimfire Rifle Optics',
  RFRI: 'Rimfire Rifle Iron',
  RRO: 'Rimfire Revolver Optic',
  RRI: 'Rimfire Revolver Iron',
};

export interface ScsaRun {
  /** Seconds, exactly as recorded. PENALTY SECONDS ARE ALREADY INSIDE THIS
   *  NUMBER — proved on 2,595 rows. Never add them again. */
  time: number;
  /** How many plates were missed on this run. Observed 0 to 4. */
  penalties: number;
  /** The third element of each triple. FALSE on all 1,848 strings of the first
   *  two files and every string since. Meaning unknown; read, never acted on. */
  flag: boolean;
}

export interface ScsaStageScore {
  /** The club's running order, NOT the stage's identity. One club runs
   *  Roundabout as its stage 1. */
  stageNumber: number;
  /** The official stage code, or '' when the club invented the stage. */
  officialCode: string;
  /** The club's own name for the stage, verbatim. */
  clubStageName: string;
  /** The app's canonical name — set ONLY for the official eight. Null means a
   *  club-invented or foreign-coded stage, which imports under its club name. */
  canonicalStageName: string | null;
  /** The string count the file DECLARES for this stage (ST column 6). This is
   *  the authority, not the stage's name: one club ran a genuine four-string
   *  stage called "Plate Rack Plus". */
  declaredStrings: number;
  runs: ScsaRun[];
  /** The stage total as the file states it. Kept for cross-checking only; the
   *  app recomputes the real one from the runs. */
  fileStageTotal: number;
}

export interface ScsaEntry {
  competitorNumber: number;
  firstName: string;
  lastName: string;
  /** As printed, letter case and all. */
  membership: string;
  /** Uppercased membership, or null when blank. THE ONLY SAFE KEY for deciding
   *  that two entries are the same person. Names cannot do it: one club enters
   *  the same shooter twice under byte-identical names, and another glues a "Z-"
   *  onto the surname of only some second entries. Blanks are never grouped —
   *  at one club 36 of 49 shooters have none, and grouping them would weld
   *  strangers into a single phantom shooter. */
  groupKey: string | null;
  matchIndex: number | null;
  matchName: string;
  divisionCode: string;
  /** The club's own name for the division, from its DR row. */
  divisionName: string;
  /** The name this app stores, mapped by code; null for an unrecognised code,
   *  which is shown with the club's name and never guessed at. */
  storedDivision: string | null;
  /** Overall place WITHIN THE MATCH across all divisions — not a division place. */
  place: number | null;
  /** The match total as the file states it; null when the entry has no ES row. */
  fileTotal: number | null;
  stages: ScsaStageScore[];
  /** False when this entry cannot be imported; blockedReason says why in the
   *  words the user should see. */
  importable: boolean;
  blockedReason: string | null;
}

export interface ScsaForm {
  clubCode: string;
  matchName: string;
  /** YYYYMMDD, the date the match was SHOT. Never the download date. */
  matchDate: string;
  downloadDate: string;
  /** Match index -> name. Indices are NOT contiguous and match 1 may not exist:
   *  most files skip 4, and one file has only 2 and 3 (no Main Match at all).
   *  Keyed by the index itself for exactly that reason. */
  matches: Map<number, string>;
  entries: ScsaEntry[];
  /** Match indices whose stages cannot be scored by Steel rules — see
   *  DEGENERATE_MIN_STRINGS. */
  degenerateMatches: Set<number>;
}

export type ScsaRefusalCode =
  | 'not-scsa-form'
  | 'incomplete'
  | 'line-count'
  | 'division-conflict'
  | 'all-degenerate';

export type ScsaParseResult =
  | { ok: true; form: ScsaForm }
  | { ok: false; code: ScsaRefusalCode; message: string };

/** A stage declaring fewer than this many strings cannot be scored by Steel
 *  rules, because dropping the worst run would leave nothing behind.
 *
 *  THIS IS THE MOST IMPORTANT GUARD IN THE FILE. A USPSA match pushed through
 *  the Steel form declares ONE string per stage; drop-the-worst then scores
 *  every stage as zero while real 18-to-30-second runs sit recorded inside it,
 *  and the file is internally consistent about it all the way up to the match
 *  totals. 450 of that file's 525 score rows are one-string. A reader that
 *  trusted the totals would import a match in which nothing happened — a
 *  plausible-looking record that is false, which is the failure this log exists
 *  to prevent.
 *
 *  It keys on the DECLARED string count and nothing else. In particular it must
 *  never fire on times that merely look odd: a stage where every run is exactly
 *  30.00 seconds is legal and real (a shooter timing out on every run), and
 *  nineteen such stages appear across the samples. */
export const DEGENERATE_MIN_STRINGS = 2;

/** Records, in the order they must appear. Verified identical across all twelve
 *  samples. FE closes the COMPETITOR list and sits about a third of the way
 *  down — it is not the end of the file, and a reader that stops there gets the
 *  entry list and none of the scores. */
const SECTION_ORDER = ['AA', 'ER', 'EC', 'FE', 'MR', 'DR', 'ST', 'CO', 'ES', 'SS', 'ZZ'] as const;
const REQUIRED_TYPES = ['AA', 'ER', 'EC', 'MR', 'DR', 'ST', 'CO', 'SS', 'ZZ'] as const;

/** Seconds -> whole hundredths. The file writes the same value as `30.00`,
 *  `30.0` and `30` — sometimes within one shooter's rows — so times are never
 *  compared as text; and comparing them as ordinary decimals invites the
 *  floating-point noise that makes 0.1 + 0.2 come out as 0.30000000000000004.
 *  Working in whole hundredths (the timer's own resolution) makes the
 *  cross-checks exact. */
export function toHundredths(seconds: number): number {
  return Math.round(seconds * 100);
}

/** Strict non-negative number, or null. Deliberately NOT csv.ts's looseNum:
 *  that one strips commas to be forgiving of pasted text, and here a comma
 *  inside a numeric field would mean the line was mis-split — which is a fault
 *  to surface, not to paper over. */
function num(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function intOrNull(s: string | undefined): number | null {
  const v = num(s);
  return v !== null && Number.isInteger(v) ? v : null;
}

/** Cheap, certain detection: every sample file's first line is `AA,2,1,700`.
 *  Used both to route a chosen file here and to let the USPSA TEXT importer
 *  refuse a download file that was pasted or dropped into it by mistake. */
export function looksLikeScsaForm(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  return /^AA\s*,/.test(firstLine.replace(/^\uFEFF/, ''));
}

/**
 * Read a PractiScore SCSA download file.
 *
 * Returns the whole match — every competitor, every entry, every run — or a
 * refusal carrying a message written for the person holding the file. It never
 * throws and never half-reads: a refusal returns no data at all.
 */
export function parseScsaForm(text: string): ScsaParseResult {
  if (!looksLikeScsaForm(text)) {
    return {
      ok: false,
      code: 'not-scsa-form',
      message:
        "This doesn't look like a PractiScore Steel Challenge download file. " +
        'Generate the file from the match page on PractiScore and choose that file.',
    };
  }

  const clean = text.replace(/^\uFEFF/, '');
  // Split on \n and tolerate \r: every sample uses Unix line endings, but a file
  // that has been through a Windows editor must not fail on invisible bytes.
  const rawLines = clean.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  // A trailing newline produces one empty final element; every sample has one.
  const lines = rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
    ? rawLines.slice(0, -1)
    : rawLines;

  const rows: string[][] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    // A REAL CSV split, not a split on commas. Two of the sample match names
    // contain a comma inside their quotes ("Medford Steel Challenge: Aug 9,
    // 2026"), which a naive split corrupts along with every column after it.
    rows.push(splitCsvLine(line));
  }
  if (rows.length === 0) {
    return { ok: false, code: 'incomplete', message: 'That file is empty.' };
  }

  const byType = new Map<string, string[][]>();
  for (const r of rows) {
    // Dispatch on column 0 and nothing else. Never search the file for text:
    // `SS` is both the score-line record type and the division code for Single
    // Stack, which appears in a real Steel match.
    const t = r[0];
    const list = byType.get(t);
    if (list) list.push(r);
    else byType.set(t, [r]);
  }

  for (const t of REQUIRED_TYPES) {
    if (!byType.has(t)) {
      return {
        ok: false,
        code: 'incomplete',
        message:
          'That download file looks incomplete — it is missing part of its contents. ' +
          'Try downloading it from PractiScore again.',
      };
    }
  }

  // Section order. Each record type must appear as one unbroken run, and the
  // runs must be in the documented order.
  const seenOrder: string[] = [];
  for (const r of rows) {
    if (seenOrder[seenOrder.length - 1] !== r[0]) seenOrder.push(r[0]);
  }
  let cursor = -1;
  for (const t of seenOrder) {
    const idx = SECTION_ORDER.indexOf(t as (typeof SECTION_ORDER)[number]);
    if (idx === -1 || idx <= cursor) {
      return {
        ok: false,
        code: 'incomplete',
        message:
          'That download file is out of order or damaged. ' +
          'Try downloading it from PractiScore again.',
      };
    }
    cursor = idx;
  }

  // ZZ COUNTS ITSELF. 405 means 405 lines including the ZZ line — checking the
  // count of lines BEFORE ZZ fails on every valid file.
  const zz = byType.get('ZZ')![0];
  const declaredLines = intOrNull(zz[1]);
  if (declaredLines !== null && declaredLines !== lines.length) {
    return {
      ok: false,
      code: 'line-count',
      message:
        'That download file appears truncated — it says how many lines it should have, ' +
        'and some are missing. Try downloading it from PractiScore again.',
    };
  }

  const er = byType.get('ER')![0];
  const clubCode = er[1] ?? '';
  const matchName = er[3] ?? '';
  const matchDate = er[4] ?? '';
  const downloadDate = er[5] ?? '';

  const matches = new Map<number, string>();
  for (const r of byType.get('MR')!) {
    const idx = intOrNull(r[1]);
    if (idx === null) continue;
    matches.set(idx, r[2] ?? '');
  }

  // Divisions. Two real defects live here, each seen in exactly one file:
  // a completely empty DR row, and the same division listed twice.
  const divisionNames = new Map<string, string>();
  for (const r of byType.get('DR')!) {
    const name = (r[1] ?? '').trim();
    const code = (r[2] ?? '').trim();
    if (code === '' && name === '') continue; // the empty row; defines nothing
    if (code === '') continue;
    const existing = divisionNames.get(code);
    if (existing === undefined) {
      divisionNames.set(code, name);
    } else if (existing !== name) {
      // Never observed. It would mean the file disagrees with itself about what
      // a division is called, and guessing which one is right is not our place.
      return {
        ok: false,
        code: 'division-conflict',
        message:
          `That download file gives two different names for the division "${code}", ` +
          'so it cannot be read safely. Nothing was imported.',
      };
    }
    // An identical duplicate collapses to one, which is the observed case.
  }

  // Stages, keyed by (match index, stage number). The same physical stage is
  // repeated once per parallel match, so this is not one stage per line.
  interface StageDef { name: string; code: string; strings: number }
  const stageDefs = new Map<string, StageDef>();
  for (const r of byType.get('ST')!) {
    const stageNumber = intOrNull(r[1]);
    const matchIndex = intOrNull(r[5]);
    const strings = intOrNull(r[6]);
    if (stageNumber === null || matchIndex === null) continue;
    stageDefs.set(`${matchIndex}:${stageNumber}`, {
      name: r[2] ?? '',
      code: (r[3] ?? '').trim(),
      strings: strings ?? 0,
    });
  }

  // Which matches cannot be scored by Steel rules at all.
  const degenerateMatches = new Set<number>();
  const matchHasStage = new Set<number>();
  for (const [key, def] of stageDefs) {
    const matchIndex = Number(key.slice(0, key.indexOf(':')));
    matchHasStage.add(matchIndex);
    if (def.strings < DEGENERATE_MIN_STRINGS) degenerateMatches.add(matchIndex);
  }
  const scorableMatches = [...matchHasStage].filter((m) => !degenerateMatches.has(m));
  if (matchHasStage.size > 0 && scorableMatches.length === 0) {
    return {
      ok: false,
      code: 'all-degenerate',
      message:
        "This file can't be imported as a Steel Challenge match. It declares only one run " +
        'per stage, and Steel Challenge scoring drops the worst run — so the file’s own ' +
        'math scored every stage as zero, even though real times are recorded inside it. ' +
        'This usually means a different kind of match (such as USPSA) was put through the ' +
        'Steel Challenge download form. Nothing was imported.',
    };
  }

  // Competitor -> match + division.
  interface CompMatch { matchIndex: number | null; divisionCode: string }
  const compMatch = new Map<number, CompMatch>();
  for (const r of byType.get('CO')!) {
    const comp = intOrNull(r[1]);
    if (comp === null) continue;
    // One real row is `CO,13,13,13,,` — an entered competitor with no match and
    // no division. Trusting these columns would look up match "" and division "".
    compMatch.set(comp, { matchIndex: intOrNull(r[4]), divisionCode: (r[5] ?? '').trim() });
  }

  // Match totals and places. Four real competitors across the samples have no
  // ES row at all, so nothing may assume one exists.
  const esByComp = new Map<number, { place: number | null; total: number | null }>();
  for (const r of byType.get('ES') ?? []) {
    const comp = intOrNull(r[2]);
    if (comp === null) continue;
    esByComp.set(comp, { place: intOrNull(r[4]), total: num(r[6]) });
  }

  // Scores.
  const ssByComp = new Map<number, string[][]>();
  for (const r of byType.get('SS')!) {
    const comp = intOrNull(r[3]);
    if (comp === null) continue;
    const list = ssByComp.get(comp);
    if (list) list.push(r);
    else ssByComp.set(comp, [r]);
  }

  const entries: ScsaEntry[] = [];
  for (const r of byType.get('EC')!) {
    const comp = intOrNull(r[1]);
    if (comp === null) continue;
    const membership = (r[2] ?? '').trim();
    const cm = compMatch.get(comp);
    const matchIndex = cm?.matchIndex ?? null;
    const divisionCode = cm?.divisionCode ?? '';
    const es = esByComp.get(comp);

    const stages: ScsaStageScore[] = [];
    for (const s of ssByComp.get(comp) ?? []) {
      const stageNumber = intOrNull(s[2]);
      const fileStageTotal = num(s[4]);
      if (stageNumber === null || fileStageTotal === null) continue;
      const def = stageDefs.get(`${matchIndex}:${stageNumber}`);

      // Walk the triples until an empty time. The row has room for seven; real
      // files use 1, 2, 4 or 5, and the count varies by stage as well as by file.
      const runs: ScsaRun[] = [];
      for (let i = 5; i + 2 < s.length; i += 3) {
        if ((s[i] ?? '') === '') break;
        const t = num(s[i]);
        if (t === null) break;
        runs.push({
          time: t,
          penalties: intOrNull(s[i + 1]) ?? 0,
          flag: (s[i + 2] ?? '').trim().toUpperCase() === 'TRUE',
        });
      }

      const code = def?.code ?? '';
      const official = SCSA_OFFICIAL_STAGES[code];
      stages.push({
        stageNumber,
        officialCode: code,
        clubStageName: def?.name ?? '',
        canonicalStageName: official ? official.name : null,
        // The file's declared count is the authority. Where the file says
        // nothing, fall back to however many runs are actually present rather
        // than to an assumption about the stage's name.
        declaredStrings: def && def.strings > 0 ? def.strings : runs.length,
        runs,
        fileStageTotal,
      });
    }
    stages.sort((a, b) => a.stageNumber - b.stageNumber);

    let importable = true;
    let blockedReason: string | null = null;
    if (stages.length === 0) {
      importable = false;
      blockedReason = 'No scores in this file';
    } else if (matchIndex !== null && degenerateMatches.has(matchIndex)) {
      importable = false;
      blockedReason = 'Only one run per stage — not Steel Challenge scoring';
    }

    entries.push({
      competitorNumber: comp,
      firstName: r[3] ?? '',
      lastName: r[4] ?? '',
      membership,
      groupKey: membership === '' ? null : membership.toUpperCase(),
      matchIndex,
      matchName: matchIndex !== null ? (matches.get(matchIndex) ?? '') : '',
      divisionCode,
      divisionName: divisionNames.get(divisionCode) ?? '',
      storedDivision: SCSA_DIVISION_BY_CODE[divisionCode] ?? null,
      place: es?.place ?? null,
      fileTotal: es?.total ?? null,
      stages,
      importable,
      blockedReason,
    });
  }

  return {
    ok: true,
    form: { clubCode, matchName, matchDate, downloadDate, matches, entries, degenerateMatches },
  };
}

/** Steel scoring in the file's own terms: the stage total is the sum of the runs
 *  minus the single slowest one. Held on 2,595 of 2,595 real rows.
 *
 *  This exists ONLY to check the file against itself before anything is written.
 *  The number that reaches the log is computed by scoreSteelStage in
 *  competition.ts, so an imported match is scored by the same code as a typed one. */
export function fileDropWorstHundredths(stage: ScsaStageScore): number | null {
  if (stage.runs.length === 0) return null;
  const hs = stage.runs.map((r) => toHundredths(r.time));
  const sum = hs.reduce((a, b) => a + b, 0);
  return sum - Math.max(...hs);
}

export interface ScsaCrossCheck {
  ok: boolean;
  /** Stage numbers whose recorded total disagrees with the drop-worst rule. */
  stageMismatches: number[];
  /** True when the stage totals do not add up to the entry's own match total. */
  totalMismatch: boolean;
  /** Stages carrying fewer or more runs than the file said they would. */
  stringCountMismatches: number[];
}

/** Prove a single entry is internally consistent before anything is written.
 *  The app never writes numbers it cannot independently reproduce. */
export function crossCheckEntry(entry: ScsaEntry): ScsaCrossCheck {
  const stageMismatches: number[] = [];
  const stringCountMismatches: number[] = [];
  let sum = 0;
  for (const st of entry.stages) {
    if (st.runs.length !== st.declaredStrings) stringCountMismatches.push(st.stageNumber);
    const computed = fileDropWorstHundredths(st);
    if (computed === null || computed !== toHundredths(st.fileStageTotal)) {
      stageMismatches.push(st.stageNumber);
    }
    sum += toHundredths(st.fileStageTotal);
  }
  const totalMismatch =
    entry.fileTotal !== null && entry.stages.length > 0 && sum !== toHundredths(entry.fileTotal);
  return {
    ok: stageMismatches.length === 0 && !totalMismatch && stringCountMismatches.length === 0,
    stageMismatches,
    totalMismatch,
    stringCountMismatches,
  };
}

/** Group a form's entries by person for the picker.
 *
 *  Entries with a membership number group together, compared without regard to
 *  letter case (`TY154861`, `Ty146515` and `a127575` all occur). Entries WITHOUT
 *  one each stand alone — at one club 36 of 49 shooters have no number, and
 *  grouping blanks would merge strangers. Names are never used for either job:
 *  one club enters the same shooter twice under byte-identical names. */
export function groupEntriesByPerson(entries: ScsaEntry[]): ScsaEntry[][] {
  const groups: ScsaEntry[][] = [];
  const byKey = new Map<string, ScsaEntry[]>();
  for (const e of entries) {
    if (e.groupKey === null) {
      groups.push([e]);
      continue;
    }
    const g = byKey.get(e.groupKey);
    if (g) g.push(e);
    else {
      const created = [e];
      byKey.set(e.groupKey, created);
      groups.push(created);
    }
  }
  return groups;
}
