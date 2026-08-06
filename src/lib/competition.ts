// Competition math and vocabulary (spec §11). Pure logic, fully tested.

import type { Match, MatchStage } from './types.ts';

export const MATCH_TYPES = [
  'USPSA Level 1 (club match)',
  'USPSA Level 2',
  'USPSA Level 3',
  'USPSA Section Championship',
  'USPSA State Championship',
  'USPSA Area Championship',
  'USPSA Nationals',
  'IDPA Match',
  'IDPA Sanctioned (Tier 2+)',
  'Steel Challenge',
  'Local / Outlaw',
  'Other'
];

export const DIVISIONS = [
  'Carry Optics', 'Open', 'Limited', 'Limited Optics', 'Production',
  'Single Stack', 'Revolver', 'PCC', 'Other'
];

/** IDPA's 8 divisions (official 2026.2 IDPA Rulebook Sec 8.1.1.1) -- a distinct set from
 *  USPSA's above. Used for the division picker when a match's scoringType is 'idpa'. */
export const IDPA_DIVISIONS = [
  'Stock Service Pistol (SSP)', 'Enhanced Service Pistol (ESP)', 'Custom Defensive Pistol (CDP)',
  'Compact Carry Pistol (CCP)', 'Revolver (REV)', 'Backup Gun (BUG)', 'Carry Optics (CO)',
  'Pistol Caliber Carbine (PCC)'
];

/** SCSA Steel Challenge competition divisions -- the EXACT names a shooter registers
 *  and is classified in, taken verbatim from the official SCSA classification records
 *  (https://scsa.org/classification), cross-checked against the 2026-03 SCSA Rulebook
 *  Appendix D. A distinct set from USPSA's and IDPA's above; used for the division picker
 *  when a match's scoringType is 'steel'. Steel is largely a rimfire sport, so the old
 *  USPSA list (no rimfire) was wrong here.
 *
 *  Naming is intentionally NON-uniform -- reproduced exactly as the official source has it,
 *  not normalized: rimfire pistol/rifle use "Open"/"Iron", PCC uses "Optics"/"Iron", and
 *  revolver uses "Optical Sight"/"Iron Sight". Rimfire Revolver is PROVISIONAL (Rulebook
 *  Appendix D11, RRO/RRI; not yet in the classification tables), listed last following the
 *  records-page rimfire Open/Iron convention. */
export const STEEL_DIVISIONS = [
  'Open', 'Limited', 'Limited Optics', 'Production', 'Single Stack', 'Carry Optics',
  'Optical Sight Revolver', 'Iron Sight Revolver',
  'PCC Optics', 'PCC Iron',
  'Rimfire Pistol Optics', 'Rimfire Pistol Iron',
  'Rimfire Rifle Optics', 'Rimfire Rifle Iron',
  'Rimfire Revolver Optic', 'Rimfire Revolver Iron',
  'Other'
];

/** SCSA has no rimfire "Open" division. Appendix A2, the scsa.org peak-time
 *  table and SCSA announcement 683 all say Optics, and the word Open appears in
 *  none of them for rimfire. The app shipped the wrong three names, so records
 *  already saved carry them.
 *
 *  This is an ALIAS rather than a migration, deliberately. Nothing rewrites a
 *  stored record: an old name is translated on the way OUT. That matters
 *  because the match form snaps a division it does not recognise to the first
 *  in the list -- so a bare rename would have turned a saved rimfire match into
 *  centerfire "Open" the next time it was opened and saved. It also means a
 *  .flog backup taken before today still restores correctly, and that undoing
 *  this is deleting a map rather than reversing a write.
 *
 *  Note "Rimfire Revolver Optic" is SINGULAR in SCSA's own list while pistol
 *  and rifle are plural. That inconsistency is theirs; we match it exactly. */
export const STEEL_DIVISION_ALIASES: Readonly<Record<string, string>> = {
  'Rimfire Pistol Open': 'Rimfire Pistol Optics',
  'Rimfire Rifle Open': 'Rimfire Rifle Optics',
  'Rimfire Revolver Open': 'Rimfire Revolver Optic',
};

/** Translates a stored division name to the one SCSA actually uses. Anything
 *  not in the alias map comes back untouched, so this is safe to call on every
 *  division from any sport. */
export function canonicalDivision(division: string): string {
  return STEEL_DIVISION_ALIASES[division] ?? division;
}

/** ---------------------------------------------------------------------------
 *  A PICKER MUST BE ABLE TO SHOW WHAT THE RECORD HOLDS (session 106, 6 Aug 2026)
 *
 *  A <select> whose value matches no <option> renders the FIRST option. So a match
 *  stored with division "O" -- which is what the PractiScore importer writes, because
 *  it stores that column verbatim (practiscore.ts, `division: (cell(...) ?? '').trim()`)
 *  -- displayed as "Carry Optics", DIVISIONS[0], while the record still said "O".
 *  Save wrote "O" straight back. The screen and the record disagreed and the screen
 *  was the one lying.
 *
 *  The repair pattern was already in this codebase and had been applied to exactly one
 *  of three pickers: `pickableGuns(list, keepIds)` forces the referenced gun into its
 *  own option list so a match on a retired gun does not silently reassign itself. These
 *  two helpers extend that principle to the pickers that were missed.
 *
 *  Read STEEL_DIVISION_ALIASES above for the evidence that this defect was already
 *  KNOWN: that map exists, in its author's own words, because "the match form snaps a
 *  division it does not recognise to the first in the list". It routed around the bug.
 *  This fixes it, so the next rename does not need a workaround.
 *  ------------------------------------------------------------------------- */

/** USPSA short codes that appear in PractiScore results tables. DELIBERATELY SHORT and
 *  deliberately conservative: a wrong suggestion is worse than no suggestion, because
 *  the whole point is that the user decides. Codes that are genuinely ambiguous are
 *  LEFT OUT rather than guessed -- "L" could be Limited or a truncated Limited Optics,
 *  and "R" could be Revolver or Rimfire, so neither is here. IDPA and Steel codes are
 *  not listed because they do not need to be: those division names carry their own code
 *  in parentheses, and matchesParentheticalCode() below derives the mapping from the
 *  option list itself rather than from a table somebody has to maintain. */
export const DIVISION_CODE_ALIASES: Readonly<Record<string, string>> = {
  O: 'Open',
  CO: 'Carry Optics',
  LO: 'Limited Optics',
  LTD: 'Limited',
  PROD: 'Production',
  SS: 'Single Stack',
  REV: 'Revolver',
};

/** The option list, plus the stored value when the list cannot represent it.
 *
 *  Returns the list UNCHANGED when the stored value is already in it (including via the
 *  Steel alias map), so the common path allocates nothing new and the picker is
 *  untouched for every record that was already fine. An empty or whitespace stored value
 *  is NOT injected: "no division chosen" is representable as an empty select, and adding
 *  a blank option would be inventing a choice.
 *
 *  The caller renders the injected entry with its own label; this returns raw values so
 *  the SAVED STRING round-trips byte-for-byte. Anything that decorated the value here
 *  would write the decoration back on save, which is the defect in a new costume. */
export function optionsWithStored(options: readonly string[], stored: string): string[] {
  const list = options.slice();
  // A BLANK division is a real stored state, not an absence: the PractiScore importer
  // writes '' when the results table has no division column, and PractiScoreImport.tsx
  // already branches on `me.division === ''`. An earlier version of this function
  // returned the list untouched here and its comment claimed 'no division chosen' was
  // representable as an empty select. Measured by a cold audit: it is not. There is no
  // empty <option>, so value='' fell through to the first one and a blank division
  // rendered as 'Carry Optics'. Injecting the empty string gives it an option of its own.
  if (stored === undefined || stored === null) return list;
  // The test is on the RAW stored string, because the raw string is what the <select>
  // is bound to. Two earlier versions tested a trimmed or canonicalised form and let
  // through exactly the values this function exists for:
  //
  //   'Rimfire Pistol Open'  -- canonicalises INTO the Steel list, so nothing was
  //     injected, and the select then matched no option and rendered 'Open'. A rimfire
  //     match read as centerfire while the callout underneath said otherwise. That is
  //     the population STEEL_DIVISION_ALIASES was written to protect.
  //   'Open ' (trailing space) -- trimmed to a member, so nothing was injected, and the
  //     select silently showed 'Carry Optics' with no callout at all.
  //
  // Both were found by a cold audit of the first version of this file.
  if (list.includes(stored)) return list;
  return [stored, ...list];
}

/** True when `option` carries `code` as its parenthetical, e.g. "Carry Optics (CO)"
 *  for "CO". Case-insensitive. This is what lets IDPA and any future coded division
 *  set work with no table entry at all. */
function matchesParentheticalCode(option: string, code: string): boolean {
  const m = option.match(/\(([^)]+)\)\s*$/);
  return !!m && m[1].trim().toLowerCase() === code.toLowerCase();
}

/** Why a stored division differs from the division it probably means. The callout used
 *  to say "saved as X, which is not one of the divisions in the list, it probably means
 *  X" whenever the only difference was whitespace or case -- which a cold audit measured
 *  and which reads as nonsense, because HTML collapses the space and the two look
 *  identical on screen. Naming the actual difference is what makes the sentence true and
 *  the button's effect predictable. */
export function divisionMismatchKind(stored: string, suggestion: string): 'spacing' | 'spelling' | 'unlisted' {
  const s = stored ?? '';
  if (s !== s.trim() && s.trim() === suggestion) return 'spacing';
  if (s.trim().toLowerCase() === suggestion.toLowerCase()) return 'spelling';
  return 'unlisted';
}

/** The division this stored value most likely means, or null when there is no confident
 *  answer. NEVER applied automatically -- the caller offers it and the user decides,
 *  which is the whole of decision 2a: nothing is written that Michael did not say.
 *
 *  Resolution order, most certain first:
 *    1. It already IS an option (case-insensitively, or via the Steel alias map).
 *    2. It is an option's parenthetical code -- "SSP" for "Stock Service Pistol (SSP)".
 *    3. It is a known USPSA short code AND that division is in this option list.
 *  Anything else returns null. A suggestion is only ever returned when it is present in
 *  the options passed in, so this can never propose a division from another sport. */
export function suggestDivision(stored: string, options: readonly string[]): string | null {
  const s = (stored ?? '').trim();
  if (!s) return null;

  const exact = options.find((o) => o.toLowerCase() === s.toLowerCase());
  // Compare against the RAW stored value, not the trimmed one: 'Open ' trims to an
  // exact member and used to return null, which is how a padded division reached the
  // screen with no correction offered.
  if (exact) return exact === stored ? null : exact;

  const aliased = canonicalDivision(s);
  if (aliased !== s && options.includes(aliased)) return aliased;

  const byCode = options.find((o) => matchesParentheticalCode(o, s));
  if (byCode) return byCode;

  const mapped = DIVISION_CODE_ALIASES[s.toUpperCase()];
  if (mapped && options.includes(mapped)) return mapped;

  return null;
}

export const POWER_FACTORS = ['Minor', 'Major'];

/** T3-6a guardrail: these four USPSA divisions score Minor power factor ONLY --
 *  Major buys no points there, so letting the match form show an inflated Major
 *  reading was a display bug, not a real choice. Corrected from the pro-grade
 *  audit's original list (which missed Limited Optics) after Seat 12 (Domain)
 *  checked it against the current rulebook (session 76, July 23 2026).
 *
 *  Source: the official USPSA Competition Rules, edition 2026-03, Appendix D's
 *  per-division equipment tables -- rules.uspsa.org/uspsa/appendix/D4 (Production),
 *  /D7 (Carry Optics), /D8 (PCC), /D9 (Limited Optics). Each division's "Power
 *  Factor" row reads Major: "Not Applicable" / Minimum for Minor: "125" (PCC's row
 *  states it outright: "125 (Minor Scoring Only)"). CAVEAT: the rulebook PDF itself
 *  (uspsa.org/documents/rules/current/USPSA-Competition-Rules.pdf) is
 *  robots-disallowed from this sandbox and a direct retrieval attempt was
 *  proxy-rejected, so the lines above were read from the rules site's own HTML
 *  appendix pages via a retrieve-and-extract tool rather than a raw verbatim PDF
 *  dump -- flagged in the handoff notes for a follow-up pass to copy the literal
 *  PDF wording once someone has unrestricted access. Independently corroborated
 *  (July 23 2026) by the two
 *  secondary sources named in the build spec:
 *  https://www.targetbarn.com/broad-side/uspsa-divisions/ ("All four of these
 *  divisions are limited to minor power factor scoring") and
 *  https://www.swampfoxoptics.com/uspsa-divisions-explained ("Everyone is scored
 *  Minor" -- Production; "Scored Minor only" -- Limited Optics). */
export const MINOR_ONLY_DIVISIONS = ['Production', 'Carry Optics', 'Limited Optics', 'PCC'];

/** True when a USPSA division scores Minor power factor only (T3-6a). */
export function isMinorOnly(division: string): boolean {
  return (MINOR_ONLY_DIVISIONS as readonly string[]).includes(division);
}

/** Stage hit factor: points per second. */
export function hitFactor(points: number | null, time: number | null): number | null {
  if (points === null || time === null || !(time > 0) || points < 0) return null;
  return Math.round((points / time) * 10000) / 10000;
}

/** Exact rulebook quotes for USPSA stage scoring, so the in-app wiki can show the
 *  source verbatim rather than paraphrasing. Direct quotations from the official
 *  USPSA Competition Rules, edition 2026-03 (rules.uspsa.org/uspsa); `section`
 *  locates each. The A/C/D point values live in Appendix B1's scoring-zone table. */
export const USPSA_SCORING_QUOTES = [
  { section: 'Appendix B1 (Scoring Zones – All Cardboard Targets)', quote:
    'A 5 5 · C 4 3 · D 2 1 (Scoring Zone / Major Power Factor / Minor Power Factor).' },
  { section: 'Rule 9.2.2.1 (Comstock)', quote:
    'A competitor’s score is calculated by adding the highest value stipulated number of hits per target, minus penalties, divided by the total time (recorded to two decimal places) taken by the competitor to complete the course of fire, to arrive at a hit factor.' },
  { section: 'Rule 9.4.4 (miss)', quote:
    'Each miss will be penalized twice the value of the maximum scoring hit available on that target…' },
  { section: 'Rule 9.4.2 (no-shoot)', quote:
    'Each hit visible on the scoring area of a cardboard no-shoot will be penalized the equivalent of twice the point value of a maximum scoring hit.' },
  { section: 'Rule 10.1.2 (procedural)', quote:
    'If the maximum available scoring hit on a cardboard target is 5 points, each procedural penalty will be minus 10 points.' },
] as const;

/** Exact rulebook quotes for USPSA classification. Direct quotations from the
 *  official USPSA Classification System document (github.com/USPSA-public/Classification,
 *  the source USPSA publishes at uspsa.org/classification/about). */
export const USPSA_CLASS_QUOTES = [
  { section: 'Earning A Classification', quote:
    'If more than four scores are in the database when the averages are calculated, the best six of the most recent eight valid scores will be used.' },
  { section: 'Classification Bracket Percentages', quote:
    'Grand Master 95 to 110% · Master 85 to 94.9% · A 75 to 84.9% · B 60 to 74.9% · C 40 to 59.9% · D 2 to 40%.' },
  { section: 'Score Ceiling', quote:
    'Score Ceiling Increase: From 100% to 110% of HHF.' },
] as const;

/** USPSA classification bands. */
export const USPSA_CLASSES = [
  { name: 'GM', min: 95 },
  { name: 'M', min: 85 },
  { name: 'A', min: 75 },
  { name: 'B', min: 60 },
  { name: 'C', min: 40 },
  { name: 'D', min: 2 }
] as const;

/** Clears IEEE-754 noise at the unit scale before any comparison. Six scores
 *  summing to exactly 240.00 divide to 39.99999999999999, which without this
 *  reads as D when the shooter is a C. */
export function snapPct(percent: number): number {
  return Math.round(percent * 1e9) / 1e9;
}

/** Truncates to a hundredth for DISPLAY, never rounds up. The second snap is
 *  not redundant: a true 74.99 is held as 74.98999999999999488, so x100 puts
 *  the noise straight back and a bare Math.floor drops a whole hundredth. */
export function trunc2(percent: number): number {
  return Math.floor(Math.round(percent * 100 * 1e6) / 1e6) / 100;
}

/** USPSA's published bracket table starts at D = 2% and names NOTHING below it.
 *  Returns null there rather than inventing a letter -- and the null return type
 *  is the guard: TypeScript forces every display site to handle it, so a new
 *  screen cannot reintroduce the unsourced class the way the old `min: 0` did.
 *  Callers render null as an em dash; the progress line still says D starts at 2%. */
export function classFor(percent: number): string | null {
  const p = snapPct(percent);
  for (const band of USPSA_CLASSES) {
    if (p >= band.min) return band.name;
  }
  return null;
}

/** The ONLY way a classification percentage should reach a screen.
 *  `average` is already truncated to a hundredth, so two decimals render it
 *  exactly. Rendering it with toFixed(1) instead rounds 74.99 UP to "75.0" and
 *  prints a percent at the A line beside the letter B -- the number and the
 *  class contradicting each other in the same breath. Every display site goes
 *  through here so a new one cannot bring that back. */
export function formatClassPct(percent: number | null): string {
  return percent === null ? '—' : percent.toFixed(2) + '%';
}

/** Why a division shows no class letter, in one place, because there are TWO
 *  reasons and they are not interchangeable. Saying "6 of the 4 scores USPSA
 *  needs" to a shooter who HAS six is both the wrong reason and broken
 *  arithmetic on its face. Every surface that explains an absent class letter
 *  calls this, so a new one cannot pick the wrong reason. Returns null when a
 *  class exists and nothing needs explaining. */
export type UnclassifiedReason =
  | { kind: 'too-few'; scoresOnRecord: number; needed: number; text: string }
  | { kind: 'below-lowest'; band: string; threshold: number; text: string };

export function unclassifiedReason(p: ClassProgress): UnclassifiedReason | null {
  if (p.currentClass !== null) return null;
  if (p.scoresOnRecord < MIN_SCORES_FOR_CLASSIFICATION) {
    return {
      kind: 'too-few',
      scoresOnRecord: p.scoresOnRecord,
      needed: MIN_SCORES_FOR_CLASSIFICATION,
      text: `unclassified — ${p.scoresOnRecord} of ${MIN_SCORES_FOR_CLASSIFICATION} scores`,
    };
  }
  const lowest = USPSA_CLASSES[USPSA_CLASSES.length - 1];
  return {
    kind: 'below-lowest',
    band: lowest.name,
    threshold: lowest.min,
    text: `unclassified — below ${lowest.name}, which starts at ${lowest.min.toFixed(2)}%`,
  };
}

export interface ClassifierScore {
  date: string;
  percent: number | null;
  /** The classifier's own code (e.g. "99-11"). Optional because older callers
   *  and tests pass bare date/percent pairs — but WITHOUT it a re-shoot cannot
   *  be identified, so collapseReshoots leaves such scores untouched. Every
   *  real call site passes full Classifier records, which carry it. */
  code?: string;
}

/** USPSA collapses repeat attempts at the SAME classifier before it averages
 *  anything, and it does so two different ways. Both are flags in USPSA's own
 *  published algorithm (github.com/USPSA-public/Classification, "Score Flags"):
 *
 *    S — Same Day Average:    "Multiple attempts at the same classifier on the
 *                              same day will be averaged into a single score"
 *    M — Most Recent Override: "For classifiers shot on different days, only the
 *                              most recent attempt will count"
 *
 *  The app counted every attempt as its own score, which is neither rule. A
 *  shooter who re-shot 99-11 at 60% in January and 90% in February had the 60
 *  still dragging his average down months later; measured, that reached two
 *  classes of error. Note the SDA grouping is per classifier PER DIVISION per
 *  day — callers already filter to one division, so grouping by code+date here
 *  is the same thing.
 *
 *  Scores with no code pass through untouched: without the classifier's
 *  identity there is no way to know what is a repeat of what, and guessing
 *  would be worse than doing nothing. */
export function collapseReshoots<T extends ClassifierScore>(scores: T[]): T[] {
  const byCode = new Map<string, T[]>();
  const passthrough: T[] = [];
  for (const s of scores) {
    // A blank percent is USPSA's flag N -- "this classifier will not count" --
    // an EXCLUSION, not an attempt. It must not enter the grouping at all:
    // letting it in made it the newest attempt, so MRO retired a real earned
    // score behind it and a Master went back to unclassified the day he logged
    // a classifier before its percentage was known. The same-day half already
    // treated a null as carrying no value; this is that rule applied to the
    // different-day half, where it was missing.
    if (s.percent === null || !Number.isFinite(s.percent)) { passthrough.push(s); continue; }
    // Codes are compared case-insensitively and trimmed: a hand-typed "99-11 "
    // or "99-11" vs "99-11" is the same classifier, and failing to see that
    // silently restores the every-attempt-counts bug for that stage.
    const code = (s.code ?? '').trim().toUpperCase();
    if (!code) { passthrough.push(s); continue; }
    const list = byCode.get(code);
    if (list) list.push(s); else byCode.set(code, [s]);
  }

  const collapsed: T[] = [];
  for (const attempts of byCode.values()) {
    // MRO: only the most recent DAY's attempts survive.
    let latest = attempts[0].date;
    for (const a of attempts) if (a.date.localeCompare(latest) > 0) latest = a.date;
    const sameDay = attempts.filter((a) => a.date === latest);
    if (sameDay.length === 1) { collapsed.push(sameDay[0]); continue; }
    // SDA: several attempts on that day average into one score. A null percent
    // carries no value, so it cannot pull the average down -- it is excluded
    // from the mean rather than treated as a zero.
    const vals = sameDay.map((a) => a.percent as number);
    const rep = sameDay[0];
    collapsed.push({ ...rep, percent: snapPct(vals.reduce((x, y) => x + y, 0) / vals.length) });
  }
  return [...collapsed, ...passthrough];
}

/** The ordering USPSA states for the revolving window: "the scores are sorted by
 *  the match date in descending order. For matches that have more than one
 *  classifier stage, the scores are sorted by the course percentage in
 *  descending order." The percent tiebreak decides which score falls out of the
 *  eight when a day carries more than one, so it is not cosmetic. */
function byRecencyThenPercent(a: ClassifierScore, b: ClassifierScore): number {
  const d = b.date.localeCompare(a.date);
  if (d !== 0) return d;
  return (b.percent ?? -Infinity) - (a.percent ?? -Infinity);
}

/** USPSA grants no classification until this many valid scores are on record
 *  ("Earning A Classification", USPSA Classification System). Below it, the
 *  average still shows progress but no class letter is granted. */
export const MIN_SCORES_FOR_CLASSIFICATION = 4;

/** USPSA caps an individual classifier score at 110% of the classifier's High
 *  Hit Factor — the official "Score Ceiling Increase: From 100% to 110% of HHF"
 *  update (USPSA Classification System). A run fast enough to compute higher
 *  counts as 110%, never more, so the best-6 average can't be inflated past the
 *  top of the Grand Master band (95–110%). Confirmed against the rulebook before
 *  implementing (M-10); the retired sub-2% "Flag G" is deliberately NOT applied
 *  (USPSA retired it April 2025). */
export const MAX_CLASSIFIER_PERCENT = 110;

export interface ClassProgress {
  average: number | null;   // best 6 of the most recent 8 scores
  scoresUsed: number[];     // the percents that made the average
  scoresOnRecord: number;   // how many valid scores exist at all
  currentClass: string | null; // null until MIN_SCORES_FOR_CLASSIFICATION scores exist
  next: { name: string; threshold: number } | null;
}

/** USPSA-style progress: best 6 of the most recent 8 valid scores. No class
 *  is granted below MIN_SCORES_FOR_CLASSIFICATION (the sport's own rule) —
 *  surfaces show "unclassified" with the score count instead of a letter. */
export function classificationProgress(scores: ClassifierScore[]): ClassProgress {
  const valid = collapseReshoots(scores)
    .filter((s) => s.percent !== null && Number.isFinite(s.percent))
    .sort(byRecencyThenPercent);
  // M-10: apply USPSA's 110% score ceiling to each of the recent scores before
  // the best-6 average, so a single over-ceiling percent (possible when a
  // percentage is derived from a hit factor rather than taken from a USPSA
  // export, which is already capped) can't push the class up.
  const recent = valid.slice(0, 8).map((s) => Math.min(s.percent as number, MAX_CLASSIFIER_PERCENT));
  const used = [...recent].sort((a, b) => b - a).slice(0, 6);
  if (used.length === 0) {
    return { average: null, scoresUsed: [], scoresOnRecord: 0, currentClass: null, next: null };
  }
  // Classify the EXACT average, then truncate for display. Rounding to two
  // decimals BEFORE classifying promoted a shooter across a class line: a true
  // 74.9983 average was classified as 75.00 and reported as A while the shooter
  // was still B, and the error only ever ran UPWARD. The marketing site's
  // calculator carried the identical defect and was fixed; this is that fix.
  // Truncating the display means no screen ever shows a percent the shooter has
  // not actually reached.
  const exact = snapPct(used.reduce((s, p) => s + p, 0) / used.length);
  const average = trunc2(exact);
  const wouldBeClass = classFor(exact);
  const currentClass = valid.length >= MIN_SCORES_FOR_CLASSIFICATION ? wouldBeClass : null;
  // The next-band target is derived from the would-be class, so the progress
  // line ("B starts at 60%") keeps working while unclassified. Below 2% there
  // is no class letter, but D's 2% threshold is sourced and still worth showing.
  const band = USPSA_CLASSES.findIndex((b) => b.name === wouldBeClass);
  const lowest = USPSA_CLASSES[USPSA_CLASSES.length - 1];
  const next = wouldBeClass === null
    ? { name: lowest.name, threshold: lowest.min }
    : band > 0
      ? { name: USPSA_CLASSES[band - 1].name, threshold: USPSA_CLASSES[band - 1].min }
      : null;
  return { average, scoresUsed: used, scoresOnRecord: valid.length, currentClass, next };
}

/** One row of the "which scores count" window (T3-5): the same recent-8 slice
 *  classificationProgress reasons about, but with each score's identity kept so
 *  the UI can show it as a real list instead of just an average. */
export interface ClassifierWindowFields {
  percent: number;   // capped at MAX_CLASSIFIER_PERCENT, same as the average uses
  counts: boolean;    // true when this score is one of the best-6 that made the average
  dropsNext: boolean; // true for the oldest row, but only once 8+ valid scores exist
}

/**
 * classificationProgress's windowed view: the most recent 8 valid scores, newest
 * first, each flagged with whether it counts toward the best-6 average and
 * whether it's the one a new score would push out of the window. Generic over T
 * so callers can pass their own record type (e.g. a Classifier with code/name)
 * and get it back annotated, rather than a bare {date, percent} tuple.
 *
 * Deliberately reuses classificationProgress's own selection rule (top-6 by
 * capped percent, ties broken toward the more recent score via a stable sort
 * over the already-newest-first array) so the two can never quietly disagree --
 * a unit test asserts the same average from both paths.
 */
export function classificationWindow<T extends ClassifierScore>(
  scores: T[]
): (Omit<T, 'percent'> & ClassifierWindowFields)[] {
  // Collapse re-shoots FIRST, exactly as classificationProgress does. If this
  // listed every attempt while the average counted one, the "which scores
  // count" reveal would contradict the number printed above it.
  const valid = collapseReshoots(scores)
    .filter((s) => s.percent !== null && Number.isFinite(s.percent))
    .sort(byRecencyThenPercent);
  const recent = valid.slice(0, 8);
  if (recent.length === 0) return [];
  const cappedPercents = recent.map((s) => Math.min(s.percent as number, MAX_CLASSIFIER_PERCENT));
  const rank = cappedPercents
    .map((p, i) => ({ i, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 6)
    .map((r) => r.i);
  const usedIdx = new Set(rank);
  // The window is "most recent 8" -- once 8+ valid scores are on record, a new
  // score always displaces the CURRENT oldest-of-window, whether or not that
  // oldest score was one of the ones counting toward the average.
  const oldestDrops = valid.length >= 8;
  return recent.map((s, i) => ({
    ...s,
    percent: cappedPercents[i],
    counts: usedIdx.has(i),
    dropsNext: oldestDrops && i === recent.length - 1,
  }));
}

/** best-min(6,n) average of a set of (already-capped) percents -- the same
 *  selection rule classificationProgress uses, factored out so
 *  nextClassifierNeeded can evaluate it for a hypothetical score. */
function bestAverage(percents: number[]): number {
  if (percents.length === 0) return 0;
  const used = [...percents].sort((a, b) => b - a).slice(0, Math.min(6, percents.length));
  return used.reduce((s, p) => s + p, 0) / used.length;
}

/** Round UP to one decimal -- used only for the minimal classifier score in
 *  nextClassifierNeeded, so the number shown never overstates what's needed. */
function roundUpTenth(x: number): number {
  const scaled = x * 10;
  const nearest = Math.round(scaled);
  // Binary search converges within float noise of the true boundary; snap to the
  // nearest tenth when we're within that noise so an exact boundary (e.g. 90.0)
  // doesn't get bumped to 90.1 by a stray epsilon.
  return (Math.abs(scaled - nearest) < 1e-6 ? nearest : Math.ceil(scaled)) / 10;
}

/**
 * T3-5's "next-classifier" line: the minimal single score S (0 < S <= 110) that
 * would move the shooter up to the next class, or 'impossible' if even a 110
 * doesn't clear it, or null when there's no meaningful next-class claim to make
 * (fewer than MIN_SCORES_FOR_CLASSIFICATION valid scores -- still unclassified --
 * or already at the top of the ladder with nothing higher to reach).
 *
 * The math: USPSA's window is the most recent 8 valid scores. A new score always
 * enters the window; if 8 (or more) already exist, the CURRENT oldest of the
 * window drops to make room (a window over 8 already-recorded scores keeps only
 * the 7 most recent of them before the new one is added). The new window's
 * best-min(6, size) average must clear the next band's threshold. Pure; never
 * throws; the search is a binary search over S because the best-6 average is
 * monotonically non-decreasing in S, so there's exactly one boundary to find.
 */
export function nextClassifierNeeded(scores: ClassifierScore[]): { percent: number } | 'impossible' | null {
  const valid = collapseReshoots(scores)
    .filter((s) => s.percent !== null && Number.isFinite(s.percent))
    .sort(byRecencyThenPercent);
  if (valid.length < MIN_SCORES_FOR_CLASSIFICATION) return null; // still unclassified -- no "move up" claim yet
  const progress = classificationProgress(scores);
  if (!progress.next) return null; // top of the ladder -- nothing higher to reach

  const threshold = progress.next.threshold;
  const capped = valid.map((s) => Math.min(s.percent as number, MAX_CLASSIFIER_PERCENT));
  const currentWindow = capped.slice(0, 8);
  // Drop the current oldest-of-window ONLY when a new score would actually
  // displace one (8+ on record); otherwise every existing score is kept.
  const keep = currentWindow.slice(0, Math.min(7, currentWindow.length));

  const avgWith = (s: number): number => bestAverage([s, ...keep]);

  if (avgWith(MAX_CLASSIFIER_PERCENT) < threshold) return 'impossible';

  let lo = 0;
  let hi = MAX_CLASSIFIER_PERCENT;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (avgWith(mid) >= threshold) hi = mid; else lo = mid;
  }
  let percent = roundUpTenth(hi);
  // Safety net (bounded, so it can never loop forever): if rounding somehow left
  // the shown number just short of the bar, nudge up until it provably clears --
  // never show a number that wouldn't actually move the shooter up.
  for (let guard = 0; guard < 20 && avgWith(percent) < threshold; guard++) {
    percent = Math.round((percent + 0.1) * 10) / 10;
  }
  if (percent > MAX_CLASSIFIER_PERCENT) return 'impossible';
  if (percent <= 0) percent = 0.1; // S must be a real, positive classifier score
  return { percent };
}

// ---- Match-after analysis (Layer 1: derive + rank, no new stored data) ----

export interface StageInsight {
  number: number;
  points: number | null;
  time: number | null;
  hitFactor: number | null;   // derived: points / time
  percent: number | null;     // stage % of the stage winner (as recorded)
  notes: string;
  rank: number | null;        // 1 = strongest by the ranking metric; null = unranked
  isToughest: boolean;
  isStrongest: boolean;
  score: StageScore | null;   // Layer 2: derived hit-breakdown score, when present
}

export interface MatchInsights {
  stages: StageInsight[];                     // original order, annotated
  rankedBy: 'percent' | 'hitFactor' | 'none'; // which metric drove the ranking
  strongest: StageInsight | null;             // only when >= 2 stages are rankable
  toughest: StageInsight[];                   // 1-2 lowest; only when >= 2 rankable
}

/**
 * Layer-1 match-after analysis: derive each stage's hit factor, rank the stages
 * by stage percent (or hit factor when percents aren't recorded), and flag the
 * toughest and strongest. Pure and defensive -- any missing/partial data degrades
 * gracefully and never throws.
 *
 * Honest scope: this reasons ONLY about points vs time vs percent. It does NOT
 * infer accuracy-vs-speed -- that needs the A/C/D/miss breakdown, which is Layer 2.
 */
export function analyzeMatch(stages: MatchStage[], powerFactor = 'Minor'): MatchInsights {
  const insights: StageInsight[] = (stages ?? []).map((st) => {
    // When a stage has a hit breakdown, its hit factor is DERIVED from the hits
    // (so a breakdown-only stage still ranks); otherwise use the manual points/time.
    const score = scoreStageHits(st, powerFactor, st.time);
    return {
      number: st.number,
      points: st.points,
      time: st.time,
      hitFactor: score ? score.hitFactor : hitFactor(st.points, st.time),
      percent: st.percent,
      notes: st.notes ?? '',
      rank: null,
      isToughest: false,
      isStrongest: false,
      score,
    };
  });

  const hasPercent = insights.some((s) => s.percent !== null && Number.isFinite(s.percent));
  const hasHf = insights.some((s) => s.hitFactor !== null);
  const rankedBy: MatchInsights['rankedBy'] = hasPercent ? 'percent' : hasHf ? 'hitFactor' : 'none';

  const metric = (s: StageInsight): number | null =>
    rankedBy === 'percent' ? s.percent : rankedBy === 'hitFactor' ? s.hitFactor : null;

  if (rankedBy === 'none') {
    return { stages: insights, rankedBy, strongest: null, toughest: [] };
  }

  // Rank only stages that have the chosen metric; highest first, ties broken by
  // stage number so the order is deterministic. These are the same object refs
  // as in `insights`, so setting flags here annotates the returned stages too.
  const ranked = insights
    .filter((s) => metric(s) !== null)
    .sort((a, b) => (metric(b) as number) - (metric(a) as number) || a.number - b.number);
  ranked.forEach((s, i) => { s.rank = i + 1; });

  if (ranked.length < 2) {
    return { stages: insights, rankedBy, strongest: null, toughest: [] };
  }

  const strongest = ranked[0];
  strongest.isStrongest = true;
  const toughCount = ranked.length >= 4 ? 2 : 1;
  const toughest = ranked.slice(ranked.length - toughCount);
  toughest.forEach((s) => { s.isToughest = true; });

  return { stages: insights, rankedBy, strongest, toughest };
}

// ---- Layer 2: per-stage hit breakdown -> derived USPSA scoring ----
// Scoring values (verified against USPSA scoring; to be cited in the in-app wiki):
//   alpha A = 5 (both PFs); charlie C = 4 (Major) / 3 (Minor); delta D = 2 (Major)
//   / 1 (Minor); miss / no-shoot / procedural = -10 each; hit factor = points /
//   time. A stage's points cannot go below zero (floored at 0).
// We DERIVE from the breakdown; we never store points/HF as independent truth, so
// they can't contradict the entered hits.

export type StageHitFields = Pick<MatchStage,
  'alphas' | 'charlies' | 'deltas' | 'misses' | 'noShoots' | 'procedurals'>;

export interface StageScore {
  powerFactor: 'Major' | 'Minor';
  alphas: number; charlies: number; deltas: number;
  misses: number; noShoots: number; procedurals: number;
  stagePoints: number;          // floored at 0 (after miss/no-shoot/procedural penalties)
  rawHitPoints: number;         // 5*A + cVal*C + dVal*D — hit-zone points BEFORE penalties
  availablePoints: number;      // 5 * scoring shots (A + C + D + M)
  pctAvailable: number | null;  // stagePoints / availablePoints (0.9 = 90%)
  hitFactor: number | null;     // stagePoints / time
  allAlphaHitFactor: number | null; // if every scoring shot were an A (NS/proc kept)
  allAlphaDelta: number | null;     // allAlphaHitFactor - hitFactor (the gain)
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const nonNeg = (x: number | null | undefined): number =>
  (typeof x === 'number' && Number.isFinite(x) && x > 0) ? x : 0;

/** True when a stage has ANY hit-breakdown value entered (0 counts as entered). */
export function hasHitBreakdown(s: StageHitFields): boolean {
  return [s.alphas, s.charlies, s.deltas, s.misses, s.noShoots, s.procedurals]
    .some((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Derive a stage's USPSA score from its hit breakdown + power factor + time.
 * Returns null when NO breakdown is entered (caller falls back to legacy
 * points/time). Pure; floors stage points at 0; never throws on missing/partial
 * data. "All alphas" turns every scoring shot (including misses) into an A at the
 * same time, but keeps no-shoot/procedural penalties -- those are separate errors,
 * not accuracy, so the all-A hypothetical can't erase them (honest by design).
 */
export function scoreStageHits(
  hits: StageHitFields, powerFactor: string, time: number | null
): StageScore | null {
  if (!hasHitBreakdown(hits)) return null;
  const major = powerFactor === 'Major';
  const cVal = major ? 4 : 3;
  const dVal = major ? 2 : 1;
  const A = nonNeg(hits.alphas), C = nonNeg(hits.charlies), D = nonNeg(hits.deltas);
  const M = nonNeg(hits.misses), NS = nonNeg(hits.noShoots), P = nonNeg(hits.procedurals);
  const rawHitPoints = 5 * A + cVal * C + dVal * D;
  const penalties = 10 * (M + NS + P);
  const stagePoints = Math.max(0, rawHitPoints - penalties);
  const scoringShots = A + C + D + M;
  const availablePoints = 5 * scoringShots;
  const pctAvailable = availablePoints > 0 ? round4(stagePoints / availablePoints) : null;
  const t = (typeof time === 'number' && time > 0) ? time : null;
  const hitFactor = t ? round4(stagePoints / t) : null;
  const allAlphaStagePoints = Math.max(0, availablePoints - 10 * (NS + P));
  const allAlphaHitFactor = t ? round4(allAlphaStagePoints / t) : null;
  const allAlphaDelta = (hitFactor !== null && allAlphaHitFactor !== null)
    ? round4(allAlphaHitFactor - hitFactor) : null;
  return {
    powerFactor: major ? 'Major' : 'Minor',
    alphas: A, charlies: C, deltas: D, misses: M, noShoots: NS, procedurals: P,
    stagePoints, rawHitPoints, availablePoints, pctAvailable, hitFactor, allAlphaHitFactor, allAlphaDelta,
  };
}

// ---- Steel Challenge (SCSA) scoring: time-only, best-4-of-5 ----
// Cited (SCSA rulebook; to be shown in the in-app "How the numbers work" wiki):
//   Each string scores its raw time + 3.00s per missed plate, capped at 30.00s;
//   a string whose stop plate is never hit scores the 30.00s maximum. A stage takes
//   the best 4 of 5 strings (drop the single slowest); "Outer Limits" is 4 strings
//   scored best 3 of 4 (also drop the single slowest). Match total = sum of stage
//   times; LOWEST wins.

export const STEEL_MAX_STRING = 30;   // seconds — per-string maximum / stop-plate-missed value
export const STEEL_MISS_PENALTY = 3;  // seconds added per missed plate

/** Exact rulebook quotes for Steel Challenge scoring, so the in-app wiki can show
 *  the source verbatim. Direct quotations from the official Steel Challenge Rules,
 *  edition 2026-03 (rules.uspsa.org/scsa); `section` locates each.
 *  Outer Limits (rule 9.1.2) counts "the best three out of four strings" — the slowest
 *  of its four strings is dropped, which is exactly what scoreSteelStage does. */
export const STEEL_RULE_QUOTES = [
  { section: 'Rule 9.3 (misses – standard plates)', quote:
    'Each Miss on a standard plate will result in a 3 second penalty, added to the competitor’s time for that string.' },
  { section: 'Rule 9.2 / 9.2.1 (maximum time)', quote:
    'The maximum score for any string is 30 seconds, no matter how many misses or penalties may have been accrued during the string.' },
  { section: 'Rule 9.4 (misses – stop plate)', quote:
    'If the stop plate is not hit, the score for that string is 30 seconds.' },
  { section: 'Rule 9.1.2 (strings counted)', quote:
    'The best four out of five strings will be counted as the total score for each stage, except for Outer Limits, which will be the best three out of four strings.' },
] as const;

/** The 8 official SCSA classifier stages; Outer Limits is the only 4-string stage. */
export const STEEL_STAGES: { name: string; strings: 4 | 5 }[] = [
  { name: '5 to Go', strings: 5 },
  { name: 'Showdown', strings: 5 },
  { name: 'Smoke & Hope', strings: 5 },
  { name: 'Outer Limits', strings: 4 },
  { name: 'Accelerator', strings: 5 },
  { name: 'Pendulum', strings: 5 },
  { name: 'Speed Option', strings: 5 },
  { name: 'Roundabout', strings: 5 },
];

export interface SteelStringScore {
  raw: number | null;
  misses: number;
  stopMissed: boolean;
  capped: number | null; // min(raw + misses*3, 30); 30 if stop plate missed; null if not entered
}
export interface SteelStageScore {
  strings: SteelStringScore[];
  stringsExpected: 4 | 5;
  droppedIndex: number | null; // index of the single dropped (slowest) string; null when none dropped
  stageTime: number | null;    // sum of the counted strings; null if nothing entered
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Number of strings SHOT: Outer Limits is 4 (scored best 3 of 4); every other stage is 5 (best 4 of 5). */
export function steelStringsExpected(steelStage?: string): 4 | 5 {
  return steelStage === 'Outer Limits' ? 4 : 5;
}

export interface SteelStageInput {
  strings?: (number | null)[];
  stringMisses?: (number | null)[];
  stringStopMissed?: boolean[];
  steelStage?: string;
}

/**
 * Score a Steel Challenge stage. Pure; never throws; unentered strings are ignored.
 * Drops the single slowest string: best 4 of 5, and best 3 of 4 on Outer Limits.
 * (Partial entries keep whatever is entered; nothing drops until the full set is in.)
 * Times round to 0.01s (the timer's resolution).
 */
export function scoreSteelStage(stage: SteelStageInput): SteelStageScore {
  const raws = stage.strings ?? [];
  const missesArr = stage.stringMisses ?? [];
  const stopArr = stage.stringStopMissed ?? [];
  const expected = steelStringsExpected(stage.steelStage);
  const scored: SteelStringScore[] = raws.map((raw, i) => {
    const misses = nonNeg(missesArr[i]);
    const stopMissed = stopArr[i] === true;
    const rawNum = (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) ? raw : null;
    let capped: number | null;
    if (stopMissed) capped = STEEL_MAX_STRING;
    else if (rawNum !== null) capped = Math.min(round2(rawNum + misses * STEEL_MISS_PENALTY), STEEL_MAX_STRING);
    else capped = null; // not entered
    return { raw: rawNum, misses, stopMissed, capped };
  });
  const counted = scored.map((s, i) => (s.capped !== null ? i : -1)).filter((i) => i >= 0);
  if (counted.length === 0) {
    return { strings: scored, stringsExpected: expected, droppedIndex: null, stageTime: null };
  }
  // Drop the single slowest string: best 4 of 5, and best 3 of 4 on Outer Limits
  // (SCSA rule 9.1.2). keepCount clamps below, so nothing drops until the full set
  // is entered (a partial stage keeps whatever was logged).
  const keepCount = expected - 1;
  const byTimeAsc = [...counted].sort((a, b) => (scored[a].capped as number) - (scored[b].capped as number));
  const keep = byTimeAsc.slice(0, Math.min(keepCount, byTimeAsc.length));
  const dropped = byTimeAsc.slice(Math.min(keepCount, byTimeAsc.length));
  const droppedIndex = dropped.length === 1 ? dropped[0] : null;
  const stageTime = round2(keep.reduce((sum, i) => sum + (scored[i].capped as number), 0));
  return { strings: scored, stringsExpected: expected, droppedIndex, stageTime };
}

/** Steel match total = sum of stage times; lowest wins. Null if no stage is scored. */
export function steelMatchTotal(stages: SteelStageInput[]): number | null {
  let total = 0;
  let any = false;
  for (const st of stages ?? []) {
    const s = scoreSteelStage(st);
    if (s.stageTime !== null) { total += s.stageTime; any = true; }
  }
  return any ? round2(total) : null;
}

// ---- IDPA scoring (time-plus): stage = raw time + points down (1s each) + penalties ----
// Values verified against the official 2026.2 IDPA Rulebook. The in-app "How the numbers
// work" wiki shows each with its VERBATIM rulebook quote + section (see IDPA_RULE_QUOTES).
// FTN ("Failure to Neutralize") was REMOVED -- it is absent from the 2026 rulebook; too-few
// hits show up as misses (-5 each) plus a PE, not a separate penalty. A non-threat hit is
// the 5s HNT penalty and is NOT also counted as points down (no double-count). Match total
// = sum of stage times; LOWEST wins.
export const IDPA_SECONDS_PER_POINT_DOWN = 1;
export const IDPA_DOWN1_POINTS = 1; // points down for a -1 hit
export const IDPA_DOWN3_POINTS = 3; // points down for a -3 hit
export const IDPA_MISS_POINTS = 5; // points down for a miss (-5)
export const IDPA_HNT_SECONDS = 5; // seconds per hit on a non-threat
export const IDPA_PE_SECONDS = 3; // seconds per procedural error
export const IDPA_FP_SECONDS = 10; // seconds per flagrant penalty
export const IDPA_FTDR_SECONDS = 20; // seconds for a failure to do right

/** Exact rulebook quotes for each value, so the in-app wiki can show the source verbatim.
 *  Direct quotations from the official 2026.2 IDPA Rulebook; `section` locates each. */
export const IDPA_RULE_QUOTES = [
  { section: 'Sec 4', quote: 'Each point down adds 1 second to the time for the stage.' },
  { section: 'Sec 4.1.3', quote:
    'The raw time is added to the total points down for the stage multiplied by 1 second, and then added to any other penalties if applicable.' },
  { section: 'Sec 4.12.1.1', quote: 'Threat targets will be scored as marked, as -0, -1, -3, and a miss is -5.' },
  { section: 'Sec 4.11.2', quote: 'Each hit on a Non-Threat adds 5 seconds to the shooter’s score.' },
  { section: 'Sec 5.1.1', quote: 'Procedural Errors add 3 seconds per infraction.' },
  { section: 'Sec 5.2.1', quote: 'A Flagrant Penalty (FP) adds ten (10) seconds.' },
  { section: 'Sec 5.3.1', quote: 'A 20 second Failure To Do Right penalty is assessed for gross unsportsmanlike conduct.' },
] as const;

export interface IdpaStageInput {
  time?: number | null; // raw time from the timer (seconds)
  idpaDown0?: number | null;
  idpaDown1?: number | null;
  idpaDown3?: number | null;
  idpaMisses?: number | null;
  idpaNonThreatHits?: number | null;
  idpaProceduralErrors?: number | null;
  idpaFlagrantPenalties?: number | null;
  idpaFailureToDoRight?: number | null;
}

export interface IdpaStageScore {
  rawTime: number | null;
  down0: number; down1: number; down3: number; misses: number;
  nonThreatHits: number; proceduralErrors: number; flagrantPenalties: number; failureToDoRight: number;
  pointsDown: number; // down1*1 + down3*3 + misses*5
  accuracySeconds: number; // pointsDown x 1s -- the time cost of dropped points
  penaltySeconds: number; // HNT*5 + PE*3 + FP*10 + FTDR*20
  stageTime: number | null; // raw + accuracy + penalty; null until a raw time is recorded
  cleanTime: number | null; // raw + penalty (every hit -0): the honest down-zero reference
}

/**
 * Score an IDPA stage (time-plus). Pure; never throws; negative/blank counts are ignored.
 * pointsDown converts hit zones to seconds at 1s each (-1 = 1, -3 = 3, miss = 5); penalties
 * add their fixed seconds. A non-threat hit is the 5s HNT penalty ONLY (never also points
 * down). stageTime is null until a raw time is recorded (nothing to add penalties to yet).
 * Times round to 0.01s. `cleanTime` is an honest "if every hit were -0" reference that KEEPS
 * penalties (they aren't accuracy), so the down-zero hypothetical can't erase a procedural.
 */
export function scoreIdpaStage(stage: IdpaStageInput): IdpaStageScore {
  const down0 = nonNeg(stage.idpaDown0), down1 = nonNeg(stage.idpaDown1),
    down3 = nonNeg(stage.idpaDown3), misses = nonNeg(stage.idpaMisses);
  const hnt = nonNeg(stage.idpaNonThreatHits), pe = nonNeg(stage.idpaProceduralErrors),
    fp = nonNeg(stage.idpaFlagrantPenalties), ftdr = nonNeg(stage.idpaFailureToDoRight);
  const pointsDown = down1 * IDPA_DOWN1_POINTS + down3 * IDPA_DOWN3_POINTS + misses * IDPA_MISS_POINTS;
  const accuracySeconds = pointsDown * IDPA_SECONDS_PER_POINT_DOWN;
  const penaltySeconds =
    hnt * IDPA_HNT_SECONDS + pe * IDPA_PE_SECONDS + fp * IDPA_FP_SECONDS + ftdr * IDPA_FTDR_SECONDS;
  const rawTime =
    typeof stage.time === 'number' && Number.isFinite(stage.time) && stage.time >= 0 ? stage.time : null;
  const stageTime = rawTime !== null ? round2(rawTime + accuracySeconds + penaltySeconds) : null;
  const cleanTime = rawTime !== null ? round2(rawTime + penaltySeconds) : null;
  return {
    rawTime, down0, down1, down3, misses,
    nonThreatHits: hnt, proceduralErrors: pe, flagrantPenalties: fp, failureToDoRight: ftdr,
    pointsDown, accuracySeconds, penaltySeconds, stageTime, cleanTime,
  };
}

/** IDPA match total = sum of stage times; lowest wins. Null if no stage has a time. */
export function idpaMatchTotal(stages: IdpaStageInput[]): number | null {
  let total = 0;
  let any = false;
  for (const st of stages ?? []) {
    const s = scoreIdpaStage(st);
    if (s.stageTime !== null) { total += s.stageTime; any = true; }
  }
  return any ? round2(total) : null;
}

/** Reconcile a FirearmLog-computed time against an entered official time (for the
 *  time-plus sports, Steel + IDPA). diff = official - ours (positive = the official is
 *  higher than ours), rounded to 0.01s; `matches` when within half a hundredth of a
 *  second. Null-safe: a blank side yields no diff. Pure. */
export function reconcileTime(ours: number | null, official: number | null): { diff: number | null; matches: boolean } {
  if (ours == null || official == null || !Number.isFinite(ours) || !Number.isFinite(official)) {
    return { diff: null, matches: false };
  }
  const diff = round2(official - ours);
  return { diff, matches: Math.abs(diff) < 0.005 };
}

/** Derive a match's scoring system from its match type (used to default new matches). */
export function scoringTypeFor(matchType: string): 'uspsa' | 'idpa' | 'steel' {
  if (matchType === 'Steel Challenge') return 'steel';
  if (matchType.startsWith('IDPA')) return 'idpa';
  return 'uspsa';
}

// ---- Match-level speed vs accuracy summary (descriptive; NO composite score) ----
// The sport produces no single "speed vs accuracy" number, so this returns the two
// dimensions SEPARATELY, per discipline, from data we already compute — never a blended
// dial. USPSA: hit-zone points kept (a miss lowers accuracy; no-shoots/procedurals are
// separate errors, NOT folded in). IDPA: the time-plus seconds split (time / dropped
// points / penalties). Steel: misses only (accuracy is nearly binary there). `overAccuracy`
// flags a very clean run (a deliberately conservative threshold) so the UI can ASK — never
// assert — whether there was room to push the pace. Returns null when nothing is computable
// (e.g. a USPSA match with no hit breakdown on any stage). Pure; never throws.

export const SPEED_ACCURACY_CLEAN_USPSA = 0.95; // >= 95% of points kept counts as "very clean"
export const SPEED_ACCURACY_CLEAN_IDPA = 0.05;  // dropped-point seconds < 5% of total time

export type SpeedAccuracy =
  | { discipline: 'uspsa'; pointsKept: number; pointsDown: number; availablePoints: number;
      misses: number; noShoots: number; procedurals: number;
      stagesUsed: number; stagesTotal: number; overAccuracy: boolean }
  | { discipline: 'idpa'; totalTime: number; timeSeconds: number; downSeconds: number;
      penaltySeconds: number; stagesUsed: number; stagesTotal: number; overAccuracy: boolean }
  | { discipline: 'steel'; misses: number; missSeconds: number;
      stagesUsed: number; stagesTotal: number };

export function matchSpeedAccuracy(
  stages: MatchStage[], scoringType: 'uspsa' | 'idpa' | 'steel', powerFactor = 'Minor'
): SpeedAccuracy | null {
  const all = stages ?? [];

  if (scoringType === 'steel') {
    let misses = 0, used = 0;
    for (const st of all) {
      const s = scoreSteelStage(st);
      if (s.stageTime !== null) {
        used++;
        misses += s.strings.reduce((n, str) => n + (str.capped !== null ? str.misses : 0), 0);
      }
    }
    if (used === 0) return null;
    return { discipline: 'steel', misses, missSeconds: round2(misses * STEEL_MISS_PENALTY),
      stagesUsed: used, stagesTotal: all.length };
  }

  if (scoringType === 'idpa') {
    let timeSeconds = 0, downSeconds = 0, penaltySeconds = 0, used = 0;
    for (const st of all) {
      const s = scoreIdpaStage(st);
      if (s.stageTime !== null && s.rawTime !== null) {
        used++;
        timeSeconds += s.rawTime;
        downSeconds += s.accuracySeconds;
        penaltySeconds += s.penaltySeconds;
      }
    }
    if (used === 0) return null;
    const totalTime = round2(timeSeconds + downSeconds + penaltySeconds);
    const overAccuracy = used >= 2 && totalTime > 0 && (downSeconds / totalTime) < SPEED_ACCURACY_CLEAN_IDPA;
    return { discipline: 'idpa', totalTime, timeSeconds: round2(timeSeconds),
      downSeconds: round2(downSeconds), penaltySeconds: round2(penaltySeconds),
      stagesUsed: used, stagesTotal: all.length, overAccuracy };
  }

  // USPSA (hit-factor): accuracy = hit-zone points kept.
  let rawHit = 0, available = 0, misses = 0, noShoots = 0, procedurals = 0, used = 0;
  for (const st of all) {
    const s = scoreStageHits(st, powerFactor, st.time);
    if (s) {
      used++;
      rawHit += s.rawHitPoints;
      available += s.availablePoints;
      misses += s.misses;
      noShoots += s.noShoots;
      procedurals += s.procedurals;
    }
  }
  if (used === 0 || available === 0) return null;
  const pointsKept = round4(rawHit / available);
  const overAccuracy = used >= 2 && pointsKept >= SPEED_ACCURACY_CLEAN_USPSA;
  return { discipline: 'uspsa', pointsKept, pointsDown: available - rawHit, availablePoints: available,
    misses, noShoots, procedurals, stagesUsed: used, stagesTotal: all.length, overAccuracy };
}

// ---- Speed/accuracy TREND across matches (phase 2) ----
// The board's point: one match is noise; the honest signal is the trend. This plots
// ACCURACY (USPSA points kept) per match over time — no pace line, because absolute
// pace isn't comparable across matches (pace enters only via the trend remark). USPSA
// only for v1 (the cleanest accuracy axis); IDPA/Steel use incompatible scales.

export interface AccuracyTrendPoint {
  matchId: string;
  name: string;
  date: string;       // YYYY-MM-DD
  pointsKept: number; // 0..1
}
export interface AccuracyTrend {
  points: AccuracyTrendPoint[]; // chronological (oldest → newest); USPSA matches with a hit breakdown
  /** The recent run has been very clean — a trend-backed (not one-match) basis for the
   *  "room to push?" remark. Conservative: needs >= 3 recent matches, all >= 95% kept. */
  consistentlyClean: boolean;
}

export function matchAccuracyTrend(matches: Match[]): AccuracyTrend {
  const points: AccuracyTrendPoint[] = [];
  for (const m of matches ?? []) {
    if ((m.scoringType ?? 'uspsa') !== 'uspsa') continue;
    const sa = matchSpeedAccuracy(m.stages, 'uspsa', m.powerFactor);
    if (sa && sa.discipline === 'uspsa') {
      points.push({ matchId: m.id, name: m.name || m.date, date: m.date, pointsKept: sa.pointsKept });
    }
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const recent = points.slice(-5);
  const consistentlyClean = recent.length >= 3
    && recent.every((p) => p.pointsKept >= SPEED_ACCURACY_CLEAN_USPSA);
  return { points, consistentlyClean };
}

// ---- "What it cost" (T3-4): the match-level cost of the day's mistakes, in the ----
// shooter's own units -- points and percent (USPSA), seconds (IDPA, Steel). Answers
// the drive-home question directly, from data already entered. All hypotheticals
// follow the codebase's honesty convention: no-shoot/procedural penalties are kept
// in every what-if (they're separate errors, not accuracy -- same rule as
// scoreStageHits's all-alpha and scoreIdpaStage's cleanTime), and a Steel string
// whose stop plate was never hit stays at the 30s maximum (its real time is unknown).
//
// The USPSA hypothetical percent is anchored to ENTERED stage percents: a stage's
// percent plus its hit factor implies the stage winner's hit factor, so the all-A
// run's percent against that same winner is derivable. It only appears when EVERY
// stage anchors (breakdown + time + percent) -- a partial-day "match percent" would
// be a guess, so the card stops at points instead. We deliberately do NOT estimate
// places gained: that would need the other shooters' results, which aren't stored.

export type WhatItCost =
  | { discipline: 'uspsa';
      misses: number; noShoots: number; procedurals: number;
      penaltyPoints: number;   // 10 per miss / no-shoot / procedural, summed
      pointsDown: number;      // hit-zone points dropped (C's, D's, and missed hits)
      stagesUsed: number; stagesTotal: number;
      actualPercent: number | null;       // recomputed from stage percents, weighted by available points
      hypotheticalPercent: number | null; // every scoring hit an A at the same times (capped at 100)
      exceeds100: boolean }               // the pre-cap hypothetical went over 100
  | { discipline: 'idpa';
      downSeconds: number; penaltySeconds: number; costSeconds: number;
      totalTime: number; cleanTotal: number; // every hit a -0 at the same times (penalties kept)
      stagesUsed: number; stagesTotal: number }
  | { discipline: 'steel';
      misses: number; missSeconds: number;
      totalTime: number; cleanTotal: number; // misses zeroed at the same times, best-N re-dropped
      stagesUsed: number; stagesTotal: number };

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Match-level "what did my mistakes cost me?", per discipline. Pure; never throws;
 * returns null when nothing is computable. Display math only -- reads the same
 * stage fields the debrief already uses and stores nothing.
 */
export function matchWhatItCost(
  stages: MatchStage[], scoringType: 'uspsa' | 'idpa' | 'steel', powerFactor = 'Minor'
): WhatItCost | null {
  const all = stages ?? [];

  if (scoringType === 'steel') {
    let misses = 0, total = 0, clean = 0, used = 0;
    for (const st of all) {
      const s = scoreSteelStage(st);
      if (s.stageTime === null) continue;
      used++;
      total += s.stageTime;
      misses += s.strings.reduce((n, str) => n + (str.capped !== null ? str.misses : 0), 0);
      // The clean what-if: same raw times, misses zeroed, stop-plate caps kept
      // (an unfinished string's true time is unknowable), best-N re-dropped.
      const cleanScore = scoreSteelStage({ ...st, stringMisses: (st.strings ?? []).map(() => 0) });
      clean += cleanScore.stageTime ?? 0;
    }
    if (used === 0) return null;
    return { discipline: 'steel', misses, missSeconds: round2(misses * STEEL_MISS_PENALTY),
      totalTime: round2(total), cleanTotal: round2(clean), stagesUsed: used, stagesTotal: all.length };
  }

  if (scoringType === 'idpa') {
    let down = 0, pen = 0, total = 0, clean = 0, used = 0;
    for (const st of all) {
      const s = scoreIdpaStage(st);
      if (s.stageTime === null || s.cleanTime === null) continue;
      used++;
      down += s.accuracySeconds;
      pen += s.penaltySeconds;
      total += s.stageTime;
      clean += s.cleanTime;
    }
    if (used === 0) return null;
    return { discipline: 'idpa', downSeconds: round2(down), penaltySeconds: round2(pen),
      costSeconds: round2(down + pen), totalTime: round2(total), cleanTotal: round2(clean),
      stagesUsed: used, stagesTotal: all.length };
  }

  // USPSA
  let misses = 0, noShoots = 0, procedurals = 0, pointsDown = 0, used = 0;
  let anchored = 0, actW = 0, hypW = 0, availW = 0;
  for (const st of all) {
    const s = scoreStageHits(st, powerFactor, st.time);
    if (!s) continue;
    used++;
    misses += s.misses;
    noShoots += s.noShoots;
    procedurals += s.procedurals;
    pointsDown += s.availablePoints - s.rawHitPoints;
    // Anchor guard: percent must be a real stage percent (0-100 -- the stage winner
    // is 100 by definition, so anything higher is a typo and would poison the anchor).
    if (st.percent !== null && Number.isFinite(st.percent) && st.percent > 0 && st.percent <= 100
        && s.hitFactor !== null && s.hitFactor > 0 && s.allAlphaHitFactor !== null
        && s.availablePoints > 0) {
      anchored++;
      // percent x (allAlphaHF / HF) = the all-A run's percent of the same stage winner.
      const hypPct = st.percent * (s.allAlphaHitFactor / s.hitFactor);
      actW += st.percent * s.availablePoints;
      hypW += hypPct * s.availablePoints;
      availW += s.availablePoints;
    }
  }
  if (used === 0) return null;
  const penaltyPoints = 10 * (misses + noShoots + procedurals);
  const fullyAnchored = anchored > 0 && anchored === all.length && availW > 0;
  const actualPercent = fullyAnchored ? round1(actW / availW) : null;
  const rawHyp = fullyAnchored ? hypW / availW : null;
  const exceeds100 = rawHyp !== null && rawHyp > 100;
  const hypotheticalPercent = rawHyp !== null ? round1(Math.min(rawHyp, 100)) : null;
  return { discipline: 'uspsa', misses, noShoots, procedurals, penaltyPoints, pointsDown,
    stagesUsed: used, stagesTotal: all.length, actualPercent, hypotheticalPercent, exceeds100 };
}

// ---- Coaching read (T3-4): the debrief paragraph, said in one place ----

/** "2 misses, 1 no-shoot" -- the error list, in words. Empty string when clean. */
function fmtErrors(misses: number, noShoots: number, procedurals: number): string {
  return [
    misses ? `${misses} miss${misses > 1 ? 'es' : ''}` : null,
    noShoots ? `${noShoots} no-shoot${noShoots > 1 ? 's' : ''}` : null,
    procedurals ? `${procedurals} procedural${procedurals > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(', ');
}

/** The reversible pace question -- asked, never asserted (same rule as the S&A nudge). */
export const PACE_QUESTION =
  'The pace question is the one worth sitting with: on the closer targets, was there room to push?';

/**
 * Assemble the coaching read: the debrief signals we already compute (toughest stage
 * and what it cost there, points kept, the trend-style pace question), said together
 * in one short paragraph. Questions, not verdicts. Returns [] when there's nothing
 * worth saying (the caller hides the card). Pure; never throws. USPSA gets the full
 * read; IDPA gets the pace question when the run was very clean; Steel has no
 * separate read (its whole story is the miss seconds, already on the cost card).
 */
export function coachingRead(
  insights: MatchInsights, sa: SpeedAccuracy | null
): string[] {
  const out: string[] = [];
  if (!sa) return out;

  if (sa.discipline === 'uspsa') {
    // "The expensive one" is the stage whose penalties cost the most points -- ranked
    // by actual cost, NOT by the toughest/strongest percent ranking (a low-percent
    // stage can be slow-but-clean while another stage bled the points; calling the
    // wrong one "expensive" would be a false claim). When the day had no penalties
    // anywhere, fall back to the toughest-ranked stage's dropped-points read.
    const cost = (s: StageScore): number => 10 * (s.misses + s.noShoots + s.procedurals);
    let expensive: StageInsight | null = null;
    for (const st of insights.stages) {
      if (st.score && cost(st.score) > 0
          && (expensive?.score == null || cost(st.score) > cost(expensive.score))) {
        expensive = st;
      }
    }
    if (expensive?.score) {
      const s = expensive.score;
      out.push(`Stage ${expensive.number} was the expensive one -- ${fmtErrors(s.misses, s.noShoots, s.procedurals)} there cost about ${cost(s)} points.`);
    } else {
      const tough = insights.toughest.length > 0
        ? insights.toughest[insights.toughest.length - 1] : null; // the very lowest-ranked
      if (tough?.score && tough.score.pctAvailable !== null && tough.score.pctAvailable < 1) {
        out.push(`Stage ${tough.number} was the expensive one -- no penalties, just dropped points: you kept ${Math.round(tough.score.pctAvailable * 100)}% of its points.`);
      } else if (tough) {
        out.push(`Stage ${tough.number} is where the most ground went.`);
      }
    }
    out.push(`Across the match you kept ${Math.round(sa.pointsKept * 100)}% of your points.`);
    if (sa.overAccuracy) out.push(PACE_QUESTION);
    return out;
  }

  if (sa.discipline === 'idpa' && sa.overAccuracy) {
    out.push(PACE_QUESTION);
  }
  return out;
}
