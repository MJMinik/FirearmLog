// Division normalisation helpers for the PractiScore importer (spec §3.3,
// branch import-division-normalise, session 108, 7 Aug 2026).
//
// Extracted from PractiScoreImport.tsx so this pure function is testable
// directly by node --test without loading JSX or React.
import { suggestDivision } from './competition.ts';

/**
 * True when the user has chosen a division genuinely different from the one
 * PractiScore scored them in -- meaning different from both the raw scored
 * string AND its canonical form (spec §3.3).
 *
 * Examples:
 *   scored="O",  selected="Open"          -> false (canonical of "O" is "Open")
 *   scored="O",  selected="O"             -> false (exact match of raw)
 *   scored="O",  selected="Limited"       -> true  (different division)
 *   scored="CO", selected="Carry Optics"  -> false (canonical match)
 *   scored="",   selected=""              -> false (both empty)
 *   scored="",   selected="Open"          -> true  (no division -> a division)
 */
export function divisionActuallyChanged(
  scored: string,
  selected: string,
  options: readonly string[],
): boolean {
  if (selected === scored) return false;
  const canonicalOfScored = suggestDivision(scored, options) ?? scored;
  return selected !== canonicalOfScored;
}
