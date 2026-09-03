// Stage-scores importer -- PASS 1 (pure logic only). STAGE_SCORES_SPEC.md,
// signed 24 Aug 2026, section 6a's board conditions all adopted.
//
// Turns a pasted PractiScore "Stage Results - Review" page (the rich
// per-shooter hit breakdown, Time and printed Hit Factor -- spec section 3a)
// into the same Layer-2 shape a hand-entered stage already carries
// (alphas/charlies/deltas/misses/noShoots/procedurals + time), or a typed
// refusal that explains itself and writes nothing.
//
// PURE. Zero storage, zero UI, zero React: this module imports nothing from
// db.ts and touches no screen. It extends the shipped PractiScore importer
// family (practiscore.ts, practiscoreDetect.ts) rather than moving anything
// onto the general CSV engine (S-12) -- same reasoning, one more format.
//
// THE HONESTY GATE (spec section 4, the Steel importer's refusal rule
// applied here -- scsaImport.ts "refusal 3"): before a stage is ever offered
// for saving, the app re-derives its score with its OWN scorer
// (competition.ts scoreStageHits) from the parsed hit breakdown + the
// match's own power factor + the parsed time, and compares that derived hit
// factor against the number the results page printed. Anything that does
// not reproduce -- B-zone hits (classic-target artifact; USPSA cardboard has
// never had a B zone, spec section 6a Seat 12 condition 10), the AP column,
// a power-factor disagreement with the stored match, or a source edit --
// refuses that one stage and writes nothing for it. The app never writes a
// number it cannot reproduce.
//
// This module carries NO user-facing copy. The signed handoff notes pass 1
// "has almost no user-facing copy" and permits refusal-message TEXT
// constants here if that's where convention puts them; the call made here
// is to keep pass 1 structured-data only, because the approved refusal
// shape (ground rules) NAMES THE STAGE NUMBER, and pass 1 has no way to know
// which stage slot a paste landed in -- that is Seat 8's "identity gap"
// (condition 1), and resolving it is explicitly a pass-2 confirm-step job.
// Every refusal variant below carries the structured facts (the row, the
// derived score, the printed number, the candidates) pass 2's copy needs;
// it writes none of the sentences itself.

import { splitCsvLine, looseNum, findCol, DELIMITER_CANDIDATES } from './csv.ts';
import { scoreStageHits, suggestPowerFactor, isMajor, type StageScore } from './competition.ts';
import { isOwnName, memberNumberVerdict } from './shooterMatch.ts';

// ---------------------------------------------------------------------------
// A parsed Review-page row
// ---------------------------------------------------------------------------

/**
 * One shooter's row off a Stage Results - Review page, columns mapped by
 * header NAME (spec section 3(a)'s literal header list), never by position.
 *
 * `memberNumber` is normalised at parse time to the "no number" contract
 * (spec section 3a): a literal `0` or a blank cell both become `''` here, so
 * every downstream reader gets ONE shape for "this row carries no number"
 * rather than having to know the raw string might be either. Real numbers
 * (mixed case included -- a127575, Fy59806) are kept exactly as printed;
 * case-insensitive comparison happens at match time, in shooterMatch.ts.
 *
 * `time` is `null` only when the Time cell itself could not be read as a
 * number (a malformed or unexpectedly-dashed cell outside the all-dash DNF
 * shape) -- scoreStageHits already treats a null/non-positive time as "no
 * hit factor", so this degrades to a refusal rather than a crash.
 */
export interface StageReviewRow {
  name: string;
  memberNumber: string;
  squad: string;
  classLetter: string;
  category: string;
  division: string;
  /** The row's own PF cell (e.g. "Min"/"Maj"), as printed -- NOT the match's
   *  stored power factor. The honesty gate scores against the match's own
   *  power factor (spec section 4); a disagreement between the two shows up
   *  as a natural hit-factor mismatch, with no special-case code for it. */
  powerFactor: string;
  alphas: number;
  bravos: number;
  charlies: number;
  deltas: number;
  misses: number;
  noShoots: number;
  procedurals: number;
  /** The AP (additional penalty) column. Not modelled by scoreStageHits, so
   *  a nonzero value here naturally produces a hit-factor mismatch and this
   *  module needs no special case for it -- kept on the row for a refusal
   *  message (pass 2) that wants to say why. */
  additionalPenalties: number;
  time: number | null;
  /** The page's own printed Hit Factor cell, parsed. `null` means the cell
   *  itself could not be read as a number (dash/blank) on a row that is NOT
   *  all-dash -- the "unparseable printed HF" refusal (spec section 6a Seat
   *  8 condition 3), distinct from the DNF branch below. */
  printedHitFactor: number | null;
  /** Time-of-day cell with a trailing "[N]" edit marker stripped off. */
  timeOfDay: string;
  /** True when this row carried a trailing "[N]" edit marker. */
  edited: boolean;
  /** True when every stat cell INCLUDING Time read '-' on the source row
   *  (spec section 3a / 6a Seat 8 condition 2) -- the "did not shoot" shape,
   *  recorded directly off the raw cells at parse time rather than inferred
   *  from the zeroed-out fields above, which a genuine (if unusual) real
   *  all-zero scored row could otherwise be mistaken for. */
  dnf: boolean;
}

// ---------------------------------------------------------------------------
// Surface detection -- which kind of PractiScore page is this?
// ---------------------------------------------------------------------------

export type StagePageSurface = 'review' | 'combined' | 'overall' | 'unknown';

interface LocatedHeader {
  delim: string;
  headerIdx: number;
  headers: string[];
  lines: string[];
  surface: StagePageSurface;
}

function cellEquals(cells: readonly string[], name: string): boolean {
  const lower = name.toLowerCase();
  return cells.some((c) => c.trim().toLowerCase() === lower);
}

/**
 * Classify a candidate header row by the header NAMES it carries -- never by
 * position or by which delimiter produced it.
 *
 * Review pages carry both "Member#" and "TOD" (spec section 3(a)'s literal
 * column list); nothing else does, so that pair alone identifies the rich
 * per-shooter page this importer is built for.
 *
 * Combined pages (stage-level: spec section 3(b)) carry "Stage Pts" and/or
 * "Stage %" and no Member#/TOD. The overall results page (the page the
 * SHIPPED PractiScore importer already reads -- practiscore.ts) carries
 * "Match Pts" and/or "Match %" instead. A header matching neither known
 * shape is 'unknown' -- covers a truly mutated/renamed table.
 */
function classifySurface(cells: readonly string[]): StagePageSurface {
  if (cellEquals(cells, 'Member#') || cellEquals(cells, 'Member #')) {
    if (cellEquals(cells, 'TOD')) return 'review';
  }
  if (cellEquals(cells, 'Stage Pts') || cellEquals(cells, 'Stage %')) return 'combined';
  if (cellEquals(cells, 'Match Pts') || cellEquals(cells, 'Match %')) return 'overall';
  return 'unknown';
}

/**
 * Find the header row and its surface, trying each delimiter candidate in
 * order (comma, tab, semicolon -- csv.ts's own preference order) and, within
 * a delimiter, each line top to bottom. The first line, under the first
 * delimiter, that both splits into at least two cells AND classifies as a
 * known surface wins -- mirroring practiscore.ts's own "which reading
 * yields a real table" approach, simplified for this format's narrower
 * shape. A page's title line ("Stage Results - Review") sits above the
 * header with no blank line between them on a real capture; it never
 * matches (a single cell under every delimiter that can split the real
 * header), so it is skipped without any special-casing.
 *
 * Returns `null` when NO line under ANY delimiter classifies as a known
 * surface at all -- true garbage, or a header renamed past recognition.
 */
function locateHeader(text: string): LocatedHeader | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const delim of DELIMITER_CANDIDATES) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      const cells = splitCsvLine(lines[i], delim);
      if (cells.length < 2) continue;
      const surface = classifySurface(cells);
      if (surface !== 'unknown') return { delim, headerIdx: i, headers: cells, lines, surface };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Review-row parsing
// ---------------------------------------------------------------------------

/** The Review page's required columns (spec section 3(a)'s literal list,
 *  minus the descriptive-only Squad/Class/Category, which stay optional --
 *  losing one of those loses nothing this module scores or gates on). A
 *  renamed/missing column in this set is exactly the "mutated header"
 *  refusal (spec section 6a Seat 8 condition 5's synthetic-fixture floor). */
interface ReviewCols {
  name: number;
  memberNumber: number;
  squad: number;
  classLetter: number;
  category: number;
  division: number;
  powerFactor: number;
  alphas: number;
  bravos: number;
  charlies: number;
  deltas: number;
  misses: number;
  noShoots: number;
  procedurals: number;
  additionalPenalties: number;
  time: number;
  hitFactor: number;
  tod: number;
}

function mapReviewCols(headers: string[]): ReviewCols {
  const claimed = new Set<number>();
  return {
    name: findCol(headers, claimed, [/^name$/i]),
    memberNumber: findCol(headers, claimed, [/^member\s*#?$/i]),
    squad: findCol(headers, claimed, [/^squad$/i]),
    classLetter: findCol(headers, claimed, [/^class$/i]),
    category: findCol(headers, claimed, [/^category$/i]),
    division: findCol(headers, claimed, [/^div$/i]),
    powerFactor: findCol(headers, claimed, [/^pf$/i]),
    alphas: findCol(headers, claimed, [/^a$/i]),
    bravos: findCol(headers, claimed, [/^b$/i]),
    charlies: findCol(headers, claimed, [/^c$/i]),
    deltas: findCol(headers, claimed, [/^d$/i]),
    misses: findCol(headers, claimed, [/^m$/i]),
    noShoots: findCol(headers, claimed, [/^ns$/i]),
    procedurals: findCol(headers, claimed, [/^proc$/i]),
    additionalPenalties: findCol(headers, claimed, [/^ap$/i]),
    time: findCol(headers, claimed, [/^time$/i]),
    hitFactor: findCol(headers, claimed, [/^hit\s*factor$/i]),
    tod: findCol(headers, claimed, [/^tod$/i]),
  };
}

/** The columns without which this module cannot parse or score a row at
 *  all. Squad/classLetter/category are deliberately absent from this list
 *  (see ReviewCols above). */
const REQUIRED_REVIEW_COLS: (keyof ReviewCols)[] = [
  'name', 'memberNumber', 'division', 'powerFactor',
  'alphas', 'bravos', 'charlies', 'deltas', 'misses', 'noShoots',
  'additionalPenalties', 'procedurals', 'time', 'hitFactor', 'tod',
];

function hasAllRequiredCols(cols: ReviewCols): boolean {
  return REQUIRED_REVIEW_COLS.every((k) => cols[k] !== -1);
}

const cellAt = (row: string[], idx: number): string => (idx >= 0 ? (row[idx] ?? '') : '');

/** Strip a trailing " [N]" edit marker off a TOD cell. Real captures carry
 *  it as part of the SAME cell as the time-of-day, after a space (spec
 *  section 3a) -- never as a separate column, and never anywhere else. */
function stripEditMarker(raw: string): { value: string; edited: boolean } {
  const m = raw.match(/^(.*?)\s*\[\d+\]\s*$/);
  if (m) return { value: m[1].trim(), edited: true };
  return { value: raw.trim(), edited: false };
}

/** Member#: a literal `0` and a blank cell both mean "no number" (spec
 *  section 3a) -- normalised to `''` here so every downstream reader has
 *  one shape for "this row carries no number" rather than two. */
function normaliseRowMemberNumber(raw: string): string {
  const t = raw.trim();
  return (t === '' || t === '0') ? '' : t;
}

/** The nine stat columns an all-dash row (spec section 3a / 6a Seat 8
 *  condition 2) reads across -- A B C D M NS Proc AP Time, "every stat
 *  column including Time". Checked as raw strings, BEFORE any dash becomes
 *  a zero, so the DNF branch runs first and a DNF row is never handed to
 *  the scorer as a wall of zeros. */
function allDashCells(row: string[], cols: ReviewCols): string[] {
  return [
    cellAt(row, cols.alphas), cellAt(row, cols.bravos), cellAt(row, cols.charlies),
    cellAt(row, cols.deltas), cellAt(row, cols.misses), cellAt(row, cols.noShoots),
    cellAt(row, cols.procedurals), cellAt(row, cols.additionalPenalties),
    cellAt(row, cols.time),
  ];
}

function isAllDashRow(row: string[], cols: ReviewCols): boolean {
  return allDashCells(row, cols).every((c) => c.trim() === '-');
}

/** '-' reads as zero -- but this is called only AFTER isAllDashRow has
 *  already been checked and found false (spec section 3a / 6a Seat 8
 *  condition 2: the DNF branch runs first). */
function dashToZero(raw: string): number {
  const t = raw.trim();
  if (t === '-') return 0;
  return looseNum(t) ?? 0;
}

/** Parse every data row on a located Review page into StageReviewRow[].
 *  Blank lines are skipped; a short/ragged line is skipped rather than
 *  crashing (the same "a row with too few cells is not a row" posture as
 *  the shipped importers). */
function parseReviewRows(located: LocatedHeader, cols: ReviewCols): StageReviewRow[] {
  const out: StageReviewRow[] = [];
  for (let i = located.headerIdx + 1; i < located.lines.length; i++) {
    if (located.lines[i].trim() === '') continue;
    const row = splitCsvLine(located.lines[i], located.delim);
    if (row.length < 2) continue;
    const name = cellAt(row, cols.name).trim();
    if (name === '') continue;

    const dnf = isAllDashRow(row, cols);
    const time = dnf ? null : looseNum(cellAt(row, cols.time));
    const printedHitFactor = dnf ? null : looseNum(cellAt(row, cols.hitFactor));
    const tod = stripEditMarker(cellAt(row, cols.tod));

    out.push({
      name,
      memberNumber: normaliseRowMemberNumber(cellAt(row, cols.memberNumber)),
      squad: cellAt(row, cols.squad).trim(),
      classLetter: cellAt(row, cols.classLetter).trim(),
      category: cellAt(row, cols.category).trim(),
      division: cellAt(row, cols.division).trim(),
      powerFactor: cellAt(row, cols.powerFactor).trim(),
      alphas: dnf ? 0 : dashToZero(cellAt(row, cols.alphas)),
      bravos: dnf ? 0 : dashToZero(cellAt(row, cols.bravos)),
      charlies: dnf ? 0 : dashToZero(cellAt(row, cols.charlies)),
      deltas: dnf ? 0 : dashToZero(cellAt(row, cols.deltas)),
      misses: dnf ? 0 : dashToZero(cellAt(row, cols.misses)),
      noShoots: dnf ? 0 : dashToZero(cellAt(row, cols.noShoots)),
      procedurals: dnf ? 0 : dashToZero(cellAt(row, cols.procedurals)),
      additionalPenalties: dnf ? 0 : dashToZero(cellAt(row, cols.additionalPenalties)),
      time,
      printedHitFactor,
      timeOfDay: tod.value,
      edited: tod.edited,
      dnf,
    });
  }
  return out;
}

/** True when a row is the "did not shoot" shape (spec section 3a / 6a Seat
 *  8 condition 2). A thin, named accessor over the row's own `dnf` field --
 *  kept as a function (rather than reading `row.dnf` at every call site) so
 *  a test or a caller asks the same question the same way everywhere. */
export function isDnfRow(row: StageReviewRow): boolean {
  return row.dnf;
}

// ---------------------------------------------------------------------------
// Shooter-row selection: the match's stored member number first, name second
// ---------------------------------------------------------------------------

export type ShooterSelection =
  | { kind: 'found'; row: StageReviewRow }
  | { kind: 'not-found' }
  | { kind: 'collision'; candidates: StageReviewRow[] };

/**
 * Which row on the page is the shooter's own (spec section 4 / 6a Seat 8
 * condition 5).
 *
 * MEMBER NUMBER FIRST: every row whose own Member# (already normalised to
 * '' for "no number") agrees with the stored number via shooterMatch.ts's
 * own digit-tolerant memberNumberVerdict (so a renewed A->TY->L prefix
 * still matches) is a number-match candidate. Exactly one -> found. Two or
 * more (a genuine duplicate number on the page) -> collision, same as a
 * name collision below -- never silently pick the first.
 *
 * NAME SECOND, only when the number step found none: every row whose name
 * is one of the shooter's own stored names (shooterMatch.ts's own
 * isOwnName, EXACT on the normalised form -- no fuzzy distance, same
 * reasoning as findOwnRows: a near miss that lifts a stranger is worse than
 * no lift at all). Exactly one -> found. Two or more -> collision (the
 * household case -- two shooters who share a stored name sitting in the
 * same field; spec section 6a Seat 8 condition 5's near-veto). None ->
 * not-found.
 */
export function selectShooterRow(
  rows: readonly StageReviewRow[],
  memberNumber: string | undefined,
  storedNames: readonly string[],
): ShooterSelection {
  const byNumber = rows.filter((r) => memberNumberVerdict(memberNumber, r.memberNumber) === 'match');
  if (byNumber.length === 1) return { kind: 'found', row: byNumber[0] };
  if (byNumber.length > 1) return { kind: 'collision', candidates: byNumber };

  const byName = rows.filter((r) => isOwnName(r.name, storedNames));
  if (byName.length === 1) return { kind: 'found', row: byName[0] };
  if (byName.length > 1) return { kind: 'collision', candidates: byName };

  return { kind: 'not-found' };
}

// ---------------------------------------------------------------------------
// The honesty gate: compare the app's own derivation to the printed number
// ---------------------------------------------------------------------------

/** -0 reads as 0 for this comparison (spec section 6a Seat 8 condition 3).
 *  `n === 0` is already `true` for `n = -0` in JS (`-0 === 0`), so this is
 *  the normalisation the comparison contract asks for, made explicit rather
 *  than relied on implicitly. */
function normaliseZero(n: number): number {
  return n === 0 ? 0 : n;
}

/** Both sides through the SAME round-to-4-decimals path (spec section 6a
 *  Seat 8 condition 3) -- competition.ts's own round4 is not exported, so
 *  this reimplements the identical `Math.round(x * 10000) / 10000` rather
 *  than diverging from it; scoreStageHits's returned hitFactor has already
 *  been through that exact rounding, so round-then-compare here is a no-op
 *  for the derived side and the real work happens on the printed side. */
function round4(n: number): number {
  return normaliseZero(Math.round(n * 10000) / 10000);
}

/** Exact match at 4 decimals -> true. Either side missing (an unparseable
 *  printed cell, or a time too degenerate to derive a hit factor at all)
 *  -> false, never a guessed pass. */
export function hitFactorsAgree(derived: number | null, printed: number | null): boolean {
  if (derived === null || printed === null) return false;
  return round4(derived) === round4(printed);
}

/** Cold audit M-3 (original), corrected by cold audit M-2 (power-factor-codes
 *  verify pass): whether a Review row's own PF cell ('Min'/'Maj', or the full
 *  word -- both observed) names a DIFFERENT power factor than the one the
 *  MATCH actually scores against. A disagreement here is a detectable, plain
 *  cause of an hf-mismatch refusal -- scoreStageHits scores against the
 *  match's power factor, never the row's own -- so hiding it sends the
 *  shooter looking for a phantom range-officer penalty instead of the
 *  match's own PF setting. Never a guess on the ROW side: an unrecognised PF
 *  cell (neither Min/Minor nor Maj/Major) returns false rather than claiming
 *  a disagreement it can't support.
 *
 *  M-2's fix: the match side is compared through isMajor -- what
 *  scoreStageHits ACTUALLY does with the match's power factor -- rather than
 *  requiring the match value to be independently recognised first. A blank
 *  or unrecognised match value ('', '???', a hand-edited record) still
 *  scores Minor in scoreStageHits (isMajor returns false for it), so a 'Maj'
 *  row against such a match IS a real disagreement in effect and must be
 *  reported as one; the earlier `matchPf !== null &&` guard silently hid
 *  exactly that case. Both sides route through this module's single source
 *  of truth for what a power-factor string means -- suggestPowerFactor for
 *  the row, isMajor (itself suggestPowerFactor-based) for what the match
 *  scores as -- so there is no private min/maj table here to drift from it
 *  (decision 2a). */
export function rowPowerFactorDisagrees(rowPowerFactor: string, matchPowerFactor: string): boolean {
  const rowPf = suggestPowerFactor(rowPowerFactor);
  return rowPf !== null && (rowPf === 'Major') !== isMajor(matchPowerFactor);
}

// ---------------------------------------------------------------------------
// Wrong-surface detection (pure detection only -- pass 2 owns the copy)
// ---------------------------------------------------------------------------

/**
 * Look for the target shooter's row on a Combined-shaped or overall-shaped
 * page (both carry Place/Name/No. columns -- practiscore-schema-FINDINGS.md
 * and the README's overall-page header agree on that much) and report their
 * name when it is marked '(DQ)' with blank stats (spec section 3a: "DQ'd
 * shooters are ABSENT from Review pages entirely... Combined pages show
 * '(DQ) Name' rows with blank stat cells"). This is what lets a wrong-
 * surface paste return the more informative 'dq-absent' refusal instead of
 * the generic wrong-surface one, when the reason IS knowable from the page
 * actually pasted -- pass 2's neutral DQ note (spec section 6a Seat 11
 * condition 9) reads off this rather than off a guess.
 */
function findDqOnOtherSurface(
  located: LocatedHeader,
  memberNumber: string | undefined,
  storedNames: readonly string[],
): string | null {
  const claimed = new Set<number>();
  const nameCol = findCol(located.headers, claimed, [/^name$/i]);
  const noCol = findCol(located.headers, claimed, [/^no\.?$/i]);
  if (nameCol === -1) return null;

  for (let i = located.headerIdx + 1; i < located.lines.length; i++) {
    if (located.lines[i].trim() === '') continue;
    const row = splitCsvLine(located.lines[i], located.delim);
    const rawName = cellAt(row, nameCol);
    if (!rawName.startsWith('(DQ)')) continue;
    const cleanName = rawName.replace(/^\(DQ\)\s*/, '').trim();
    const rowNumber = noCol >= 0 ? cellAt(row, noCol).trim() : '';
    const nameMatches = isOwnName(cleanName, storedNames);
    const numberMatches = memberNumberVerdict(memberNumber, rowNumber) === 'match';
    if (nameMatches || numberMatches) return cleanName;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The zero-based stage-index <-> human stage-number mapping
// ---------------------------------------------------------------------------

/**
 * PractiScore's own stage-page URLs are zero-based (spec section 3: "stage0-
 * review" is Stage 1). Two small pure conversions so a future how-to /
 * confirm-step (pass 2) never has to re-derive the off-by-one by hand.
 * `humanStageNumber` returns `null` for a negative index (nothing to name);
 * `zeroBasedStageIndex` returns `null` for a stage number below 1 (there is
 * no "Stage 0").
 */
export function humanStageNumber(zeroBasedIndex: number): number | null {
  return Number.isInteger(zeroBasedIndex) && zeroBasedIndex >= 0 ? zeroBasedIndex + 1 : null;
}

export function zeroBasedStageIndex(humanNumber: number): number | null {
  return Number.isInteger(humanNumber) && humanNumber >= 1 ? humanNumber - 1 : null;
}

// ---------------------------------------------------------------------------
// The result type pass 2's UI renders from
// ---------------------------------------------------------------------------

/** What an accepted stage carries -- the parsed Layer-2 fields + time (spec
 *  section 4: "the six Layer-2 fields + time onto the existing MatchStage")
 *  plus the derived numbers (points, hit factor, all-alpha comparison) for
 *  the confirm step, and the printed hit factor it was checked against. */
export interface AcceptedStageScore {
  row: StageReviewRow;
  hits: {
    alphas: number; charlies: number; deltas: number;
    misses: number; noShoots: number; procedurals: number;
  };
  time: number;
  derived: StageScore;
  printedHitFactor: number;
}

export type StageScoreResult =
  | { ok: true; accepted: AcceptedStageScore }
  /** The pasted text has no header row this module recognises under any
   *  delimiter, OR it looks like a Review page but is missing one of the
   *  columns this module depends on (a renamed/mutated header -- spec
   *  section 6a Seat 8 condition 5's synthetic-fixture floor). */
  | { ok: false; code: 'unknown-header' }
  /** This is a stage-level Combined page (Place/Name/No./.../Stage Pts),
   *  not a Review page -- pass 2 auto-routes (spec section 6a Seat 11
   *  condition 9). */
  | { ok: false; code: 'wrong-surface-combined' }
  /** This is the overall match-results page (Place/Name/No./.../Match Pts),
   *  the shape the SHIPPED PractiScore importer reads -- pass 2 auto-routes
   *  the other direction. */
  | { ok: false; code: 'wrong-surface-overall' }
  /** The pasted Combined/overall page shows the target shooter as a DQ'd
   *  '(DQ) Name' row with blank stats -- the neutral "no stage scores are
   *  published for a DQ" case (spec section 3a / 6a Seat 11 condition 9),
   *  distinguishable from a plain wrong-surface paste because the page
   *  actually pasted names the reason. */
  | { ok: false; code: 'dq-absent'; name: string }
  /** No row on the page matched the stored member number OR any stored
   *  name. */
  | { ok: false; code: 'shooter-not-found' }
  /** Two or more rows matched (member number first, name second -- spec
   *  section 6a Seat 8 condition 5's near-veto). Never silently pick the
   *  first; pass 2 must ask. */
  | { ok: false; code: 'name-collision'; candidates: StageReviewRow[] }
  /** The shooter's row is the all-dash "did not shoot" shape (spec section
   *  6a Seat 8 condition 2) -- "no data", never zeros handed to the scorer. */
  | { ok: false; code: 'dnf' }
  /** The shooter's row is not all-dash, but its printed Hit Factor cell
   *  itself could not be read as a number (spec section 6a Seat 8 condition
   *  3: "an unparseable printed-HF cell -> REFUSE, never skip the check"). */
  | { ok: false; code: 'unparseable-hf'; row: StageReviewRow }
  /** The app's own derivation does not reproduce the page's printed Hit
   *  Factor to 4 decimals -- the honesty gate (spec section 4). Also the code
   *  for the forced-refusal case (cold audit L-3): a B>0 or AP>0 row refuses
   *  even when the two hit factors happen to agree (both floor to 0.0000, or
   *  any other coincidence), because neither column is modelled by the
   *  scorer at all, so agreement there proves nothing. Carries both numbers
   *  plus the full derivation so pass 2's confirm/refusal copy can say what
   *  it needs to, plus `powerFactorDisagrees` (cold audit M-3) -- true when
   *  the row's own PF cell names a different power factor than the match's
   *  stored one, a detectable and much more likely cause than an RO penalty
   *  that the refusal copy should not hide. */
  | { ok: false; code: 'hf-mismatch'; row: StageReviewRow; derived: StageScore; printedHitFactor: number; powerFactorDisagrees: boolean };

export interface StageScoreContext {
  /** The MATCH's stored power factor -- NOT the row's own PF cell. Typed
   *  `string`, not the 'Major' | 'Minor' this comment used to claim: by
   *  design (decision 1a/2a, the power-factor-codes fix) any spelling is
   *  accepted here -- 'Min'/'Maj' short codes, the full words, even '' or
   *  something unrecognised -- and isMajor()/suggestPowerFactor() in
   *  competition.ts are what decide what it means. scoreStageHits scores
   *  against this via isMajor(); a disagreement between the two shows up as
   *  a natural hit-factor mismatch, with no special-case code needed for it. */
  powerFactor: string;
  /** The shooter's own stored USPSA# (AppSettings.uspsaMemberNumber),
   *  confirmation-grade per shooterMatch.ts's memberNumberVerdict:
   *  undefined/blank means "nothing to check a row's number against",
   *  which naturally falls through to name-only selection. */
  memberNumber?: string;
  /** The shooter's own stored names (AppSettings.shooterNames). */
  storedNames: readonly string[];
}

/**
 * Score one specific Review row directly, bypassing selectShooterRow --
 * PASS 2 addition (session 132): when the UI has already resolved a
 * name/member-number collision to one row itself (the shooter tapped which
 * one they are), this runs the identical honesty-gate tail parseStagePaste
 * uses for an automatic match, so a collision resolution is held to exactly
 * the same standard -- never a second, looser code path that could drift
 * from the first. parseStagePaste's own tail now calls this rather than
 * duplicating it (refactor only; its return values are unchanged).
 */
export function scoreReviewRow(row: StageReviewRow, powerFactor: string): StageScoreResult {
  if (isDnfRow(row)) return { ok: false, code: 'dnf' };
  if (row.printedHitFactor === null) return { ok: false, code: 'unparseable-hf', row };

  const hits = {
    alphas: row.alphas, charlies: row.charlies, deltas: row.deltas,
    misses: row.misses, noShoots: row.noShoots, procedurals: row.procedurals,
  };
  const derived = scoreStageHits(hits, powerFactor, row.time);
  // Unreachable in practice: isDnfRow already excluded the only shape
  // (every count 0 AND time null) that makes hasHitBreakdown false, and a
  // non-DNF row always has a real (possibly zero) count in at least one
  // field. Guarded anyway rather than asserted past, because scoring code
  // is exactly where "this can't happen" earns the least trust.
  if (derived === null) return { ok: false, code: 'unparseable-hf', row };

  const powerFactorDisagrees = rowPowerFactorDisagrees(row.powerFactor, powerFactor);

  // L-3 (cold audit, session 133): B (bravos) and AP (additional penalties)
  // are both columns scoreStageHits never models -- they contribute NOTHING
  // to `derived`. When the real Hit Factor is small, both sides can floor to
  // the SAME rounded value (0.0000 vs 0.0000, or any other coincidence) even
  // though the row carries a B or AP the app quietly dropped, and the
  // ordinary agreement check below has zero power to catch that: it would
  // accept a stage minus its B hits. Refuse UNCONDITIONALLY whenever either
  // column is nonzero, before the HF comparison even runs -- agreement here
  // proves nothing about a column that was never compared in the first place.
  if (row.bravos > 0 || row.additionalPenalties > 0) {
    return { ok: false, code: 'hf-mismatch', row, derived, printedHitFactor: row.printedHitFactor, powerFactorDisagrees };
  }

  if (!hitFactorsAgree(derived.hitFactor, row.printedHitFactor)) {
    return { ok: false, code: 'hf-mismatch', row, derived, printedHitFactor: row.printedHitFactor, powerFactorDisagrees };
  }

  // The cast is safe, not asserted: hitFactorsAgree just returned true,
  // which requires derived.hitFactor !== null, which scoreStageHits only
  // ever produces when its own `time` argument (row.time) was a real
  // positive number -- so row.time cannot be null on this path.
  return {
    ok: true,
    accepted: { row, hits, time: row.time as number, derived, printedHitFactor: row.printedHitFactor },
  };
}

/**
 * Parse one pasted stage-results page and either accept a stage's Layer-2
 * fields + time, or refuse with a reason pass 2 can render (spec section 4,
 * 5, 6a in full). Throws nothing; every input, including empty/garbage
 * text, resolves to one of the StageScoreResult variants above.
 */
export function parseStagePaste(text: string, ctx: StageScoreContext): StageScoreResult {
  const located = locateHeader(text);
  if (located === null) return { ok: false, code: 'unknown-header' };

  if (located.surface === 'combined' || located.surface === 'overall') {
    const dqName = findDqOnOtherSurface(located, ctx.memberNumber, ctx.storedNames);
    if (dqName !== null) return { ok: false, code: 'dq-absent', name: dqName };
    return { ok: false, code: located.surface === 'combined' ? 'wrong-surface-combined' : 'wrong-surface-overall' };
  }

  // located.surface === 'review'
  const cols = mapReviewCols(located.headers);
  if (!hasAllRequiredCols(cols)) return { ok: false, code: 'unknown-header' };

  const rows = parseReviewRows(located, cols);
  const selection = selectShooterRow(rows, ctx.memberNumber, ctx.storedNames);
  if (selection.kind === 'not-found') return { ok: false, code: 'shooter-not-found' };
  if (selection.kind === 'collision') return { ok: false, code: 'name-collision', candidates: selection.candidates };

  return scoreReviewRow(selection.row, ctx.powerFactor);
}

// Re-exported so tests and a future pass-2 screen can reach the header
// classifier directly without re-deriving "what surface is this" from a
// StageScoreResult's refusal code.
export function detectStagePageSurface(text: string): StagePageSurface {
  return locateHeader(text)?.surface ?? 'unknown';
}
