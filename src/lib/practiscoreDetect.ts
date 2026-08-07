// Detector for PractiScore new-style results page pastes.
//
// PractiScore.com's default results viewer ("new style") cannot be parsed by the
// PractiScore importer, which expects the tab-separated Html Results table. When
// the parser refuses a paste, the UI calls looksLikeNewStyleResults to decide
// whether to show a plain error or a targeted guide to the old-style page.
//
// SIGNAL TAXONOMY — the function requires AT LEAST TWO INDEPENDENT signals.
// Three families are defined; each family counts as at most one signal even if
// matched many times within itself.
//
// Family A — Division-name + power-factor adjacency.
//   The new-style viewer renders full division names (e.g. "Limited Optics",
//   "Carry Optics") followed on the SAME line by "MINOR" or "MAJOR" (the power
//   factor, uppercase in the real capture). The old-style table uses short codes
//   (CO, LO, O) and abbreviated PF (Min) in separate tab-separated columns, so
//   this pattern cannot appear in a parseable table. 21 occurrences in the real
//   Take Aim Mini fixture.
//   Matched case-insensitively at word boundaries (so prose like "reopen major"
//   cannot fire); requires the division name and PF word to sit on one line with
//   at most a tab or spaces between them.
//
// Family B — Place glued to name with a hyphen at line start.
//   The new-style viewer renders "1-Matt Olinchak" (place-hyphen-name) as the
//   first token of each shooter line: one to three digits, a hyphen, then a
//   letter. Requiring the letter keeps line-leading dates (2026-08-04) and phone
//   numbers (1-800...) from matching. The old-style table has bare integers in a
//   Place column, separated by tabs from the name. 21+ occurrences in the fixture.
//
// Family C — Page furniture unique to the new-style viewer.
//   Literal strings that appear in the new-style page but never in the old-style
//   results table: "Old style results", "Score Edit History", "Horizontal Scroll".
//   Each hit is a distinct string, but the entire family counts as ONE signal so
//   three hits of furniture alone cannot satisfy the two-signal rule.
//
// FALSE-POSITIVE CONSTRAINT:
//   A truncated old-style paste (data rows without the header) contains short
//   division codes (CO, LO, O) and "Min" — not full division names next to
//   MINOR/MAJOR, not "^\d+-name" lines, and none of the furniture strings.
//   None of the three families fire on such a paste, so looksLikeNewStyleResults
//   returns false. Empty strings, whitespace-only strings, and garbage prose also
//   return false.

/** Full USPSA division names as used by the new-style viewer. */
const DIVISION_NAMES = [
  'Limited Optics',
  'Carry Optics',
  'Open',
  'Production',
  'Limited',
  'Single Stack',
  'Revolver',
  'PCC',
];

/**
 * A single regex that matches a full division name followed (on the same line,
 * optionally with whitespace/tabs between) by MINOR or MAJOR.
 * Built once at module load, not per call.
 */
const DIVISION_PF_RE = new RegExp(
  '\\b(?:' + DIVISION_NAMES.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')' +
    '[\\t ]+(?:MINOR|MAJOR)\\b',
  'i',
);

/** Lines starting with 1-3 digits, a hyphen, then a letter (place glued to name). */
const PLACE_HYPHEN_RE = /^\d{1,3}-[A-Za-z]/m;

/** Page furniture strings unique to the new-style viewer. */
const FURNITURE_STRINGS = ['Old style results', 'Score Edit History', 'Horizontal Scroll'];

/**
 * Returns true only when the text carries at least TWO independent signals of
 * the PractiScore new-style results viewer. Each of the three signal families
 * (A/B/C above) counts as at most one signal.
 *
 * Pure function — reads the string only, imports nothing from the parser.
 * Safe to call on any input including empty string.
 */
export function looksLikeNewStyleResults(text: string): boolean {
  if (!text || !text.trim()) return false;

  let signals = 0;

  // Family A: full division name + MINOR/MAJOR on the same line.
  if (DIVISION_PF_RE.test(text)) signals++;

  // Family B: lines starting with place-hyphen (e.g. "1-Matt Olinchak").
  if (PLACE_HYPHEN_RE.test(text)) signals++;

  // Family C: any piece of page furniture unique to the new-style viewer.
  // The whole family counts once, no matter how many strings match.
  if (signals < 2) {
    for (const marker of FURNITURE_STRINGS) {
      if (text.includes(marker)) { signals++; break; }
    }
  }

  return signals >= 2;
}
