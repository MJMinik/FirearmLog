// The general CSV import engine, in one door (spec section 7.2, design doc
// section 3). Parse, map, convert, plan: all of it pure logic with no storage
// access, so the screen that follows in the next pass imports from here and the
// tests exercise the same code the app runs.
//
// Nothing in this engine writes a record. It produces a PLAN, and a separate
// commit turns a plan the shooter has approved into stored data.
//
// NOTE ON PUNCTUATION: nothing in this file, comments included, uses an em
// dash. Every string the engine produces can reach a shooter's screen.

export { parseCsv, detectDelimiter, columnName, rowLooksLikeData, cellAt } from './csvParse.ts';
export type { ParsedCsv, ParseCsvOptions, CsvParseProblem } from './csvParse.ts';

export {
  SESSION_FIELDS, fieldByKey, guessMapping, missingRequiredFields,
  parseLooseNumber, strippedNote, matchGunRef, matchAmmoRef,
} from './csvFields.ts';
export type { FieldSpec, FieldKind, ColumnGuess, LooseNumber, RefMatch } from './csvFields.ts';

export {
  DATE_FORMATS, analyseDateColumn, convertDateValue, distinguishingDateSample,
  orderCandidates, stripTime, dateFormatLabel, dateAmbiguityMessage,
} from './csvDates.ts';
export type { DateFormat, DateColumnAnalysis, DateAmbiguityReason } from './csvDates.ts';

export { planImport, collectUnmatchedGunNames, sourceRowBag } from './csvPlan.ts';
export type {
  ImportMapping, ImportPlan, GunResolution, ExistingLog, PlanOptions,
  RowProblem, RowNote, SkippedRow, SkipReason,
} from './csvPlan.ts';
