// The dry run (design doc 3.4). Pure logic: this module writes nothing, opens
// no database and knows no React. It takes a parsed file, the shooter's column
// choices and the log as it stands, and returns every record that WOULD be
// created plus every row that cannot be, each with its line number and a plain
// reason.
//
// FOUR RULES THIS FILE HOLDS, each one learned by measurement:
//
//  1. ONE CSV ROW IS ONE SESSION, with one gun. Same-day rows are never merged
//     (Michael, answer 2 of the CSV design). A wrong merge is invisible in a
//     preview; a split day is a two-minute fix by hand.
//  2. ROUNDS AND FEES GET THE FORM'S OWN VALIDATION. SessionForm.tsx:829 blocks
//     a fractional or negative round count on hand entry and SessionForm.tsx:874
//     blocks a negative range fee. An importer that quietly accepts what the
//     form refuses would subtract from lifetime round totals, costs and
//     maintenance-due, so a violation here is that ROW's problem: not a silent
//     coercion, and not a reason to refuse the file.
//  3. A ROW WITH THREE THINGS WRONG IS ONE FAILED ROW. rowsFailed counts rows,
//     not problems, so the headline count matches the number of rows the
//     shooter has to look at.
//  4. NOTHING FROM THE FILE BECOMES A KEY WE TRUST. Header names arrive as
//     object keys in the legacy bag, so the prototype-pollution guard from
//     pistolTracker.ts:83 to 90 applies to them.
//
// NOTE ON PUNCTUATION: nothing in this file, comments included, uses an em
// dash. Every string here can reach a shooter's screen.

import type { Ammunition, DrillResult, Firearm, Session, SessionGun } from '../types.ts';
import { deductUsageFromStock, usageThatMovedStock } from '../costing.ts';
import { ammoLabel } from '../csvTables.ts';
import { guessCategory } from './pistolTracker.ts';
import { cellAt } from './csvParse.ts';
import type { ParsedCsv } from './csvParse.ts';
import { convertDateValue } from './csvDates.ts';
import type { DateFormat } from './csvDates.ts';
import { SESSION_FIELDS, fieldByKey, matchAmmoRef, matchGunRef, parseLooseNumber, strippedNote } from './csvFields.ts';
import type { FieldSpec } from './csvFields.ts';

/** The shooter's choices: one field key (or null to skip) per column. */
export interface ImportMapping {
  assignments: (string | null)[];
  dateFormat: DateFormat;
}

/** What to do about a gun name in the file that is not in the log yet. */
export type GunResolution =
  | { action: 'create' }
  | { action: 'use'; firearmId: string }
  | { action: 'skip' };

export interface ExistingLog {
  firearms: readonly Firearm[];
  sessions: readonly Session[];
  ammunition?: readonly Ammunition[];
}

export interface PlanOptions {
  /** Off by default: rows that look like records already in the log are skipped. */
  includeDuplicates?: boolean;
  /** What a row with no type column becomes. */
  defaultSessionType?: string;
  /** The registry to plan against. Sessions unless a caller says otherwise. */
  registry?: readonly FieldSpec[];
}

export interface RowProblem {
  row: number;
  line: number;
  message: string;
}

/** Something worth showing but not worth failing a row over. */
export interface RowNote {
  row: number;
  line: number;
  message: string;
}

export type SkipReason = 'duplicateInFile' | 'duplicateInLog' | 'unknownGun';

export interface SkippedRow {
  row: number;
  line: number;
  reason: SkipReason;
  message: string;
}

export interface ImportPlan {
  sessions: Session[];
  /** Guns the shooter asked us to create, part of the same plan and commit. */
  firearms: Firearm[];
  problems: RowProblem[];
  notes: RowNote[];
  skipped: SkippedRow[];
  rowsTotal: number;
  rowsPlanned: number;
  /** Rows, not problems: a row with three faults counts once. */
  rowsFailed: number;
  rowsSkipped: number;
  duplicatesInFile: number;
  duplicatesInLog: number;
}

// ---------------------------------------------------------------------------
// Saying what the plan does, in words that add up
// ---------------------------------------------------------------------------
//
// These live here, next to the counting, because the sentence and the numbers
// have to come from the same place. The screen used to write its own: it said
// "1 rows skipped, including 1 that look like sessions already in your log and
// 1 that repeat an earlier row in the file" for a plan that skipped one row and
// named two, because it read the duplicates COUNTERS (which count what was
// found) where it meant the SKIPPED LIST (which holds what was acted on). Every
// number below is counted off plan.skipped, so the parts cannot outrun the
// total.

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "a, b and c", the way a person lists things. */
function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function countSkipped(plan: ImportPlan, reason: SkipReason): number {
  return plan.skipped.filter((s) => s.reason === reason).length;
}

/**
 * What happened to the rows that are not being added, and what is happening to
 * the duplicates the shooter asked for anyway. One line each, in plain words.
 */
export function skippedSummaryLines(plan: ImportPlan): string[] {
  const lines: string[] = [];
  const inLog = countSkipped(plan, 'duplicateInLog');
  const inFile = countSkipped(plan, 'duplicateInFile');
  const unknownGun = countSkipped(plan, 'unknownGun');

  if (plan.rowsSkipped > 0) {
    const parts: string[] = [];
    if (inLog > 0) parts.push(`${inLog} that ${inLog === 1 ? 'looks' : 'look'} like a session already in your log`);
    if (inFile > 0) parts.push(`${inFile} that ${inFile === 1 ? 'repeats' : 'repeat'} an earlier row in this file`);
    if (unknownGun > 0) parts.push(`${unknownGun} using a gun name you chose to skip`);
    lines.push(parts.length === 0
      ? `${plural(plan.rowsSkipped, 'row', 'rows')} skipped.`
      : `${plural(plan.rowsSkipped, 'row', 'rows')} skipped: ${joinParts(parts)}.`);
  }

  // Counted but NOT skipped means the shooter turned the switch on. Saying so
  // is the difference between a count they can check and a count they cannot.
  const addedFromLog = plan.duplicatesInLog - inLog;
  const addedFromFile = plan.duplicatesInFile - inFile;
  const added: string[] = [];
  if (addedFromLog > 0) added.push(`${addedFromLog} that ${addedFromLog === 1 ? 'looks' : 'look'} like a session already in your log`);
  if (addedFromFile > 0) added.push(`${addedFromFile} that ${addedFromFile === 1 ? 'repeats' : 'repeat'} an earlier row in this file`);
  if (added.length > 0) {
    lines.push(`Being added because you asked for them: ${joinParts(added)}.`);
  }
  return lines;
}

/**
 * What this import does to the ammunition counts, said before it happens.
 *
 * An imported session that names ammunition takes those rounds off the can, the
 * way a session typed in by hand does, and removing the import puts them back.
 * The figures come from deductUsageFromStock, which is the call the commit
 * itself uses, so this cannot describe one thing and do another.
 *
 * A can cannot go below zero, so when the rows name more rounds than the can
 * holds, fewer come off than the rows asked for. This used to print the asking
 * figure and then promise that removing the import would put THAT back, which
 * was two false sentences at once: a can of 100 emptied by an import of 150 was
 * described as losing 150 and coming back to 150.
 */
export function ammoEffectLines(
  sessions: readonly Session[],
  ammunition: readonly Ammunition[],
): string[] {
  const { realised } = deductUsageFromStock([...ammunition], usageThatMovedStock(sessions));
  if (realised.length === 0) {
    return ['Your ammunition counts do not change: no row here names ammunition in your log.'];
  }
  const lines: string[] = [];
  for (const row of realised) {
    const can = ammunition.find((a) => a.id === row.ammoId);
    if (!can) continue;
    const left = (can.quantity || 0) - row.taken;
    lines.push(`${ammoLabel(can)}: ${plural(row.taken, 'round comes', 'rounds come')} off, leaving ${left}.`);
    if (row.requested > row.taken) {
      lines.push(
        `These rows name ${row.requested} rounds for that can, which is ${row.requested - row.taken} more than it holds. A can does not go below zero, so only what is there comes off.`,
      );
    }
  }
  lines.push('Removing this import puts back what it took.');
  return lines;
}

// Audit CR-4, as applied by pistolTracker.ts:83 to 90: these key names never get
// copied out of file content into a stored record.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * The whole source row, kept verbatim in the legacy bag so nothing in the file
 * is unrecoverable after an import (design doc 3.4, zero loss). Header names
 * come from the file, so they are filtered before being used as keys.
 */
export function sourceRowBag(headers: readonly string[], cells: readonly string[]): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  headers.forEach((header, i) => {
    const name = String(header ?? '').trim();
    if (name === '' || DANGEROUS_KEYS.has(name)) return;
    bag[name] = cellAt(cells, i);
  });
  // Any extra values a ragged row carried past the last header are kept too.
  for (let i = headers.length; i < cells.length; i++) {
    const name = `Extra value ${i - headers.length + 1}`;
    bag[name] = cells[i];
  }
  return bag;
}

const normalizeKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** date + gun + rounds, the "probably already yours" test (design doc 3.4). */
const sessionKey = (date: string, firearmId: string, rounds: number): string =>
  `${date}|${firearmId}|${rounds}`;

function existingSessionKeys(sessions: readonly Session[]): Set<string> {
  const keys = new Set<string>();
  for (const s of sessions) {
    if (s.deletedAt) continue;
    const guns: SessionGun[] = Array.isArray(s.guns) ? s.guns : [];
    if (guns.length === 0) continue;
    for (const g of guns) keys.add(sessionKey(s.date, g.firearmId, g.rounds));
  }
  return keys;
}

function readBoolean(value: string): boolean {
  return /^(y|yes|true|1)$/i.test(value.trim());
}

/** 'Dry fire' and 'dry_fire' are the same session type; anything else is kept. */
function readSessionType(value: string, fallback: string): string {
  const text = value.trim();
  if (text === '') return fallback;
  const normalized = text.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'dry_fire' || normalized === 'dryfire') return 'dry_fire';
  if (normalized === 'practice' || normalized === 'class') return normalized;
  return text;
}

/**
 * The distinct gun names in the file that no gun in the log answers to. One
 * decision per name, not one per row (design doc 3.4).
 */
export function collectUnmatchedGunNames(
  parsed: ParsedCsv,
  mapping: ImportMapping,
  firearms: readonly Firearm[],
): string[] {
  const column = mapping.assignments.indexOf('gun');
  if (column < 0) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of parsed.rows) {
    const raw = cellAt(row, column).trim();
    if (raw === '') continue;
    if (matchGunRef(raw, firearms).matched) continue;
    const k = normalizeKey(raw);
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(raw);
  }
  return names;
}

/**
 * Build the plan. Nothing here writes: the caller shows this to the shooter,
 * and only a later, separate commit turns it into records.
 */
export function planImport(
  parsed: ParsedCsv,
  mapping: ImportMapping,
  existingLog: ExistingLog,
  gunResolutions: Record<string, GunResolution>,
  makeId: (prefix: string) => string,
  now: number,
  options: PlanOptions = {},
): ImportPlan {
  const registry = options.registry ?? SESSION_FIELDS;
  const includeDuplicates = options.includeDuplicates === true;
  const defaultType = options.defaultSessionType ?? 'practice';

  const columnOf = (fieldKey: string): number => mapping.assignments.indexOf(fieldKey);
  const columns = new Map<string, number>();
  for (const field of registry) columns.set(field.key, columnOf(field.key));

  const sessions: Session[] = [];
  const createdFirearms: Firearm[] = [];
  const problems: RowProblem[] = [];
  const notes: RowNote[] = [];
  const skipped: SkippedRow[] = [];

  const resolutions = new Map<string, GunResolution>();
  for (const [name, resolution] of Object.entries(gunResolutions)) {
    resolutions.set(normalizeKey(name), resolution);
  }
  const createdByName = new Map<string, Firearm>();

  const logKeys = existingSessionKeys(existingLog.sessions);
  const fileKeys = new Set<string>();

  let duplicatesInFile = 0;
  let duplicatesInLog = 0;

  parsed.rows.forEach((cells, index) => {
    const line = parsed.rowLines[index] ?? index + 1;
    const rowProblems: string[] = [];
    const rowNotes: string[] = [];

    // Anything the parser already found about this row, in its own words, so
    // the same fault is never reported twice differently.
    for (const p of parsed.problems) {
      if (p.row === index) rowProblems.push(p.message);
    }

    const read = (fieldKey: string): string => {
      const column = columns.get(fieldKey) ?? -1;
      return column < 0 ? '' : cellAt(cells, column).trim();
    };
    const label = (fieldKey: string): string => fieldByKey(registry, fieldKey)?.label ?? fieldKey;

    // ---- date (required) ----
    const rawDate = read('date');
    let date = '';
    if (columns.get('date') === -1) {
      rowProblems.push('No column is pointed at the date.');
    } else if (rawDate === '') {
      rowProblems.push('This row has no date.');
    } else {
      const converted = convertDateValue(rawDate, mapping.dateFormat);
      if (converted === null) rowProblems.push(`"${rawDate}" is not a date we can read.`);
      else date = converted;
    }

    // ---- gun (required) ----
    const rawGun = read('gun');
    let firearmId = '';
    let skipReason: SkipReason | null = null;
    if (columns.get('gun') === -1) {
      rowProblems.push('No column is pointed at the gun.');
    } else if (rawGun === '') {
      rowProblems.push('This row has no gun name.');
    } else {
      const match = matchGunRef(rawGun, existingLog.firearms);
      if (match.matched && match.id) {
        firearmId = match.id;
      } else {
        const resolution = resolutions.get(normalizeKey(rawGun));
        if (!resolution) {
          rowProblems.push(`"${rawGun}" is not a gun in your log yet.`);
        } else if (resolution.action === 'skip') {
          skipReason = 'unknownGun';
        } else if (resolution.action === 'use') {
          firearmId = resolution.firearmId;
        } else {
          const existing = createdByName.get(normalizeKey(rawGun));
          if (existing) {
            firearmId = existing.id;
          } else {
            const gun: Firearm = {
              id: makeId('fa'),
              createdAt: now,
              updatedAt: now,
              name: rawGun,
              manufacturer: '',
              model: '',
              caliber: '',
              category: guessCategory({ name: rawGun }),
              serialNumber: null,
              dateAcquired: '',
              startingRoundCount: 0,
              photoIds: [],
              referenceId: null,
              notes: '',
              legacy: {
                source: 'csv',
                sourceLine: line,
                sourceRow: sourceRowBag(parsed.headers, cells),
              },
            };
            createdByName.set(normalizeKey(rawGun), gun);
            createdFirearms.push(gun);
            firearmId = gun.id;
          }
        }
      }
    }

    // ---- rounds (required, and the form's own rule) ----
    const rawRounds = read('rounds');
    let rounds = 0;
    if (columns.get('rounds') === -1) {
      rowProblems.push('No column is pointed at the round count.');
    } else if (rawRounds === '') {
      rowProblems.push('This row has no round count. Put 0 in the file for a day you fired nothing.');
    } else {
      const value = parseLooseNumber(rawRounds);
      if (value.value === null) {
        rowProblems.push(`"${rawRounds}" is not a round count we can read.`);
      } else if (!Number.isInteger(value.value) || value.value < 0) {
        // SessionForm.tsx:829 refuses this by hand, so the importer refuses it too.
        rowProblems.push(`Rounds need to be plain whole numbers, zero or more. This row says "${rawRounds}".`);
      } else {
        rounds = value.value;
        const note = strippedNote(label('rounds'), value);
        if (note) rowNotes.push(note);
      }
    }

    // ---- range fee (optional, and the form's own rule) ----
    let rangeFee: number | null = null;
    const rawFee = read('rangeFee');
    if (rawFee !== '') {
      const value = parseLooseNumber(rawFee);
      if (value.value === null) {
        rowNotes.push(`${label('rangeFee')}: "${rawFee}" could not be read as an amount, so this row has no fee.`);
      } else if (value.value < 0) {
        // SessionForm.tsx:874 blocks a negative fee because it subtracts from
        // lifetime costs. Same rule here.
        rowProblems.push(`The range fee needs to be a dollar amount of zero or more. This row says "${rawFee}".`);
      } else {
        rangeFee = value.value;
        const note = strippedNote(label('rangeFee'), value);
        if (note) rowNotes.push(note);
      }
    }

    // ---- optional drill result ----
    const drillName = read('drillName');
    let drills: DrillResult[] = [];
    if (drillName !== '') {
      const timeRead = parseLooseNumber(read('drillTime'));
      const scoreRead = parseLooseNumber(read('drillScore'));
      for (const [fieldKey, value] of [['drillTime', timeRead], ['drillScore', scoreRead]] as const) {
        if (value.raw.trim() !== '' && value.value === null) {
          rowNotes.push(`${label(fieldKey)}: "${value.raw.trim()}" could not be read as a number, so it was left empty.`);
        }
        const note = strippedNote(label(fieldKey), value);
        if (note) rowNotes.push(note);
      }
      drills = [{
        name: drillName,
        distance: read('distances'),
        time: timeRead.value,
        score: scoreRead.value,
        maxScore: null,
        notes: '',
      }];
    }

    // ---- optional ammunition ----
    const rawAmmo = read('ammo');
    const ammoUsage: { ammoId: string; rounds: number }[] = [];
    if (rawAmmo !== '') {
      const match = matchAmmoRef(rawAmmo, existingLog.ammunition ?? []);
      if (match.matched && match.id) {
        ammoUsage.push({ ammoId: match.id, rounds });
      } else {
        rowNotes.push(`"${rawAmmo}" is not ammunition in your log, so this row records no ammo use. The name is kept with the session.`);
      }
    }

    // A row the shooter chose to skip is skipped, not failed: they already
    // said what should happen to it, so listing its other faults is noise.
    if (skipReason === 'unknownGun') {
      skipped.push({
        row: index,
        line,
        reason: 'unknownGun',
        message: `Line ${line} uses "${rawGun}", which you chose to skip.`,
      });
      return;
    }

    for (const message of rowNotes) notes.push({ row: index, line, message });

    if (rowProblems.length > 0) {
      for (const message of rowProblems) problems.push({ row: index, line, message });
      return;
    }

    // ---- duplicates ----
    const identity = sessionKey(date, firearmId, rounds);
    const inFile = fileKeys.has(identity);
    const inLog = logKeys.has(identity);
    fileKeys.add(identity);
    if (inFile) duplicatesInFile++;
    else if (inLog) duplicatesInLog++;
    if ((inFile || inLog) && !includeDuplicates) {
      skipped.push({
        row: index,
        line,
        reason: inFile ? 'duplicateInFile' : 'duplicateInLog',
        message: inFile
          ? `Line ${line} repeats an earlier row in this file.`
          : `Line ${line} looks like a session already in your log.`,
      });
      return;
    }

    const session: Session = {
      id: makeId('se'),
      createdAt: now,
      updatedAt: now,
      date,
      type: readSessionType(read('type'), defaultType),
      // One row is one session with one gun. No merging (Michael, answer 2).
      guns: [{ firearmId, rounds }],
      location: read('location'),
      distances: read('distances'),
      notes: read('notes'),
      ammoUsage,
      drills,
      targetMediaIds: [],
      malfunctions: [],
      selfRating: null,
      rangeFee,
      planned: readBoolean(read('planned')),
      checklist: null,
      instructor: read('instructor') || null,
      legacy: {
        source: 'csv',
        sourceLine: line,
        sourceRow: sourceRowBag(parsed.headers, cells),
      },
    };
    sessions.push(session);
  });

  // Guns nobody ended up using (every row naming them failed) are not created.
  const usedGunIds = new Set(sessions.flatMap((s) => s.guns.map((g) => g.firearmId)));
  const firearms = createdFirearms.filter((f) => usedGunIds.has(f.id));

  const failedRows = new Set(problems.map((p) => p.row));

  return {
    sessions,
    firearms,
    problems,
    notes,
    skipped,
    rowsTotal: parsed.rows.length,
    rowsPlanned: sessions.length,
    // Rows, not problems: one row with three faults is one row to look at.
    rowsFailed: failedRows.size,
    rowsSkipped: skipped.length,
    duplicatesInFile,
    duplicatesInLog,
  };
}
