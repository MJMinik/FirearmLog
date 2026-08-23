// Duplicate-import detection (DUPLICATE_IMPORT_DETECTION_SPEC.md, 22 Aug
// 2026, session 129/130). Pure — no React, no storage — so the rule can be
// tested and mutation-tested directly rather than only through a screen.
//
// Origin (spec's own recon, 22 Aug 2026, cold code read): importing the same
// PractiScore file twice has always created a duplicate match, and since
// match-mags shipped, a duplicate with mags picked DOUBLE-COUNTS every round
// on those magazines' lifetime odometers — the exact number a rounds-based
// maintenance schedule reads.
//
// Three facts shape this module (spec §1's recon):
//  1. `Match` has NO club field — the club only ever lives inside the
//     free-text `name`, and both import flows hard-code `practiScoreUrl` to
//     '' — so date + normalised name is the only identity anchor reliably
//     present. Deliberately NOT keyed on `legacy` (untyped, importer-
//     specific, absent on hand-entered matches), `practiScoreUrl` (empty by
//     construction on every import), or division/firearm — a genuine
//     re-import after picking a DIFFERENT gun is still a duplicate of the
//     same match: "the gun is what the shooter changed, not the match"
//     (spec §1's changed-gun line).
//  2. A Steel save can write several sibling records in ONE batch sharing
//     identical date+name (multi-gun) — so the check must compare only
//     against matches already in the log BEFORE this save, never within the
//     batch. That exclusion falls out for free here: this function only
//     ever sees the caller's `matches` argument, and both save paths call it
//     before writing anything (batch siblings are never yet in the log when
//     it runs).
//  3. Same date + same normalised name is a strong hint, not proof — a
//     shoot-off saved under the same name, or a legitimately re-created
//     match, can share both. A hint warns (spec §2's ConfirmSheet); it never
//     silently skips or blocks.

import type { Match } from './types.ts';

/**
 * Whether an already-logged, non-deleted match looks like the SAME match as
 * `(date, name)` — same date string, same name once normalised (trimmed,
 * case-folded, whitespace-collapsed). Normalisation happens INSIDE this
 * helper so every call site passes its raw value and gets one honest rule,
 * never two copies free to drift apart.
 *
 * `date` empty returns null unconditionally. Both save paths already guard
 * the date before this ever runs (a blank date is refused earlier with its
 * own "Pick the match date" message), but the helper fails safe on its own
 * rather than trusting a caller that might one day skip that guard.
 *
 * `name` empty matches only another empty name — ordinary string equality
 * after normalisation, no special case needed: an empty name normalises to
 * an empty string on both sides, and two empty strings are equal.
 *
 * Returns the FIRST hit, in the order `matches` was handed in, or null.
 */
export function findLikelyDuplicate(
  date: string,
  name: string,
  matches: readonly Match[]
): Match | null {
  if (date === '') return null;
  const wanted = name.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const m of matches) {
    if (m.deletedAt) continue;
    if (m.date !== date) continue;
    // String(), not bare m.name: a hand-edited or corrupt-restored record can
    // carry a non-string name even though the type says otherwise (the same
    // defensive posture magCleaning.ts takes on magLabel), and this helper
    // must stay total — a corrupt record reads as an empty name and simply
    // fails to match, never throws.
    const have = String(m.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (have === wanted) return m;
  }
  return null;
}
