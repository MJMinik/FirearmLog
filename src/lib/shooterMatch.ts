// Finding the shooter in an imported field, by the names they have told us are
// theirs. Pure — no React, no DOM, no storage — so the rule can be tested
// directly rather than only through a browser.
//
// Michael, 5 August 2026, asking for it: "In settings there should be a place to
// file your name so that after the import you can suggest which name to use. It
// has to be a selection because sometimes husband and wife or father and child
// may both attend a match and they have to be able to choose between the two."
//
// The second sentence governs everything here. This module SUGGESTS. It never
// decides, it never returns "the" shooter, and it is deliberately incapable of
// expressing confidence — it answers only "is this row one of the names you gave
// me", and the screen puts the answers at the top for a human to tap.

/**
 * Reduce a name to the form two spellings of the same person share.
 *
 * Everything here was driven by real rows from a real match — a copy of Michael's
 * own Gun Craft results of 2 August 2026, which in one field contained
 * `Santiago, Yaritsa "PewPew"`, `Araniego, Segismond (Joey)`, `PIMENTEL, JUAN`
 * and `coon, elliott`. A rule written against tidy names would have missed all
 * four.
 *
 * What it does, and each step earns its place:
 *   - drops anything parenthesised or quoted, which is where nicknames live;
 *   - lower-cases, because a results page shouts some names and whispers others;
 *   - collapses whitespace and strips punctuation that carries no identity;
 *   - and finally SORTS the remaining words, which is what makes "Minik, Michael"
 *     and "Michael Minik" the same string without having to know which
 *     convention a page follows.
 */
export function normaliseName(raw: string): string {
  const cleaned = String(raw ?? '')
    // Nicknames, in curly quotes of either kind and in straight DOUBLE quotes.
    // The straight apostrophe is deliberately NOT a delimiter here: it is far
    // more often part of a surname than the start of a nickname, and treating it
    // as an opening quote shredded O'Brien into nothing. It is removed further
    // down as ordinary punctuation, so O'Brien and OBrien agree.
    .replace(/["“”‘’][^"“”‘’]*["“”‘’]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    // Apostrophes are DELETED rather than turned into a separator, so O'Brien,
    // O’Brien and OBrien are one person. A separator would have made the first
    // two agree with each other and with neither of the ways somebody types
    // their own name in a hurry.
    .replace(/['’]/g, '')
    // Fold accents to their base letters, so José Peña and Jose Pena are one
    // person. Results pages and keyboards disagree about this constantly.
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

  // `Last, First` is the convention PractiScore writes; `First Last` is how a
  // person types their own name. The comma is what tells them apart, so use it
  // rather than guessing: everything before the first comma is the family name
  // and moves to the end.
  //
  // NOT by sorting the words, which is what the first version did. Sorting made
  // the two conventions agree and ALSO made "Martin, Lee" agree with
  // "Lee, Martin" — two different people, lifted to the top of the field under
  // "This looks like you". Surname order carries meaning; a rule that discards
  // it manufactures exactly the wrong-person tap this feature exists to prevent.
  const comma = cleaned.indexOf(',');
  const ordered = comma === -1
    ? cleaned
    : `${cleaned.slice(comma + 1)} ${cleaned.slice(0, comma)}`;

  return ordered
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * The stored name list, made safe to use.
 *
 * Settings arrive from IndexedDB and from any `.flog` a shooter loads, and the
 * restore path checks the SHAPE of a meta row but never the shape of its value.
 * A record carrying `shooterNames: "Minik, Michael"` — a string rather than a
 * list — took the Settings screen down with "names.map is not a function", and
 * the error screen it left behind hid the Clear-all-data button that would have
 * fixed it. The same defect one field over is already handled this way in
 * lib/checklist.ts; this is that guard, applied here.
 */
export function normaliseStoredNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** A member number, compared the way a person would read it aloud. */
export function normaliseMemberNumber(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}]+/gu, '').toUpperCase();
}

export interface NameMatch {
  /** Index of the competitor in the list handed in — the screen's own ordering. */
  index: number;
  /** Which stored name it matched, exactly as the shooter typed it. */
  matchedName: string;
}

/**
 * Which rows in an imported field carry one of the shooter's own names.
 *
 * EXACT on the normalised form, deliberately. There is no fuzzy distance score
 * and there should not be one: the whole point of the feature is to reduce the
 * chance of tapping the wrong person, and a near-miss that lifts a stranger to
 * the top of the list makes that MORE likely, not less. A name we cannot match
 * confidently is better left where it is, in a field the shooter can still read.
 *
 * The member number is a confirmation and never a key. On PractiScore it lives
 * on each match registration rather than on an account, so it does not carry
 * over and is regularly wrong or absent — Michael's own Gun Craft row reads
 * A185321 where A185231 is correct, and six of that match's seventy-eight rows
 * carry no number at all. Keying on it would have failed him on the first
 * match he tried.
 *
 * Returns every match, in the order the rows arrived. Two matches is the
 * household case working, not an error to resolve.
 */
export function findOwnRows(
  competitors: readonly { name: string; memberNumber: string }[],
  storedNames: readonly string[]
): NameMatch[] {
  const wanted = new Map<string, string>();
  for (const n of storedNames) {
    const key = normaliseName(n);
    if (key && !wanted.has(key)) wanted.set(key, n.trim());
  }
  if (wanted.size === 0) return [];

  const out: NameMatch[] = [];
  for (let i = 0; i < competitors.length; i++) {
    const c = competitors[i];
    const matchedName = wanted.get(normaliseName(c.name ?? ''));
    if (matchedName === undefined) continue;
    out.push({ index: i, matchedName });
  }
  return out;
}

/**
 * Whether a single name is one of the shooter's own — the Steel Challenge
 * screen's version of findOwnRows, for the one place it needs a single
 * yes/no rather than a list of rows to lift.
 *
 * Written after the Steel screen shipped its own inline `.toLowerCase()`
 * compare instead of reusing normaliseName, and it paid for that: Michael's
 * Settings held "Minik, Michael" but his Hansen Steel Challenge file of
 * 12 Aug 2026 wrote his name across separate first/last fields as "Michael
 * Minik", and the raw compare never saw they were the same person — the
 * suggestion stayed silent (diagnosed session 126, fixed 18 Aug 2026).
 *
 * Same contract as findOwnRows: this SUGGESTS and never decides, and it is
 * EXACT on the normalised form — no fuzzy distance, because a near miss that
 * lifts a stranger makes the wrong-person tap MORE likely, not less.
 */
export function isOwnName(fullName: string, storedNames: readonly string[]): boolean {
  const key = normaliseName(fullName);
  if (!key) return false;
  return storedNames.some((n) => normaliseName(n) === key);
}

// The member-number confirmation sketched above finally has an input to
// compare against (MEMBER_NUMBER_SPEC.md, 18 Aug 2026 — Settings gained a
// USPSA # field, and the existing SCSA # became visible and editable). It is
// why the number is not the key: on PractiScore a member number lives on each
// match REGISTRATION rather than on an account, so it does not carry over and
// is regularly wrong or missing. Michael's own Gun Craft row reads A185321
// where A185231 is correct, and six of that match's seventy-eight rows carry
// no number at all.

/**
 * Whether a stored member number and an imported row's member number describe
 * the same shooter — a CONFIRMATION beside a name match, never a key (spec
 * §6). `null` means no verdict is possible: nothing to say, not "no match".
 *
 * Not equal after normalising can still be a `match` when the DIGITS alone
 * agree: USPSA prefixes change with membership type as a member renews
 * (A -> TY -> L) while the digits stay theirs. Without this a renewed shooter
 * would see "Member # differs" on every import forever, on a number that is
 * genuinely theirs. The real defect this exists to catch stays caught:
 * A185321 vs A185231 (the transposed Gun Craft registration) differ in
 * digits too, so they still read as `differs`.
 */
export function memberNumberVerdict(
  stored: string | undefined,
  rowValue: string | undefined
): 'match' | 'differs' | null {
  const a = normaliseMemberNumber(stored ?? '');
  const b = normaliseMemberNumber(rowValue ?? '');
  if (!a || !b) return null;
  if (a === b) return 'match';
  const digitsA = a.replace(/\D+/g, '');
  const digitsB = b.replace(/\D+/g, '');
  if (digitsA && digitsB && digitsA === digitsB) return 'match';
  return 'differs';
}

/**
 * The fill-only-when-empty contract for a remembered member number (Decision
 * 4, extended by MEMBER_NUMBER_SPEC.md §3): an import may FILL a blank field,
 * and must never overwrite one the shooter can see — typed or previously
 * filled, it is theirs to keep or correct. Pure so the contract can be
 * mutation-tested on its own, apart from the screen that calls it.
 */
export function shouldRememberScsaNumber(
  existing: string | undefined,
  incoming: string | undefined
): boolean {
  return (incoming ?? '').trim() !== '' && (existing ?? '').trim() === '';
}

// --- Member-number PROVENANCE (MEMBER_NUMBER_PROVENANCE_SPEC.md, 19 Aug 2026,
// --- session 128). Michael's own tap-test screenshot: a Steel import showed
// --- Don Webster, a stranger, under "These look like you" — an earlier test
// --- import, a match Michael never attended, had silently written Don's
// --- number into Michael's settings, and a stored-number match alone lifted
// --- a Steel row with no name check at all. The fix keeps Decision 4's net
// --- for a number the shooter TYPED and takes it away from a number the app
// --- brought home on its own.

/**
 * The read rule for whether a stored SCSA number may LIFT a Steel Challenge
 * group on its own (spec §3, §6). True when the trimmed number is non-empty
 * AND the app KNOWS where it came from — either the shooter typed it in
 * Settings ('typed') or they answered "Yes — it's mine" to the adoption
 * question ('imported'). Both are the shooter saying the number is theirs,
 * which is the thing that was missing when Don Webster's number arrived.
 *
 * What fails closed is the UNKNOWN: a source that is absent (every settings
 * record written before this build, and every restore of an older .flog
 * backup) or corrupt (a hand-edited file). Nobody recorded how those numbers
 * arrived, and the one we know about was a stranger's. They may confirm a
 * suggested row, never lift one.
 *
 * REVISED 19 Aug 2026 (session 128), by Michael, after CI went red. The first
 * cut allowed only 'typed' to lift — which silently retired Decision 4's whole
 * purpose for anyone who adopts from an import, and made the adoption
 * question's own promise ("entries with this number go to the top of the
 * list") FALSE. A passing E2E round-trip test caught what the spec, two cold
 * audits and the implementer all missed, because the spec contradicted itself:
 * §4's copy promised the lift and §2 forbade it. The confirmation tap is what
 * earns the lift; requiring the Settings visit as well bought no protection
 * the tap had not already bought.
 *
 * Defence is at the reader, not the writer.
 */
export function numberMayLift(stored: string | undefined, source: unknown): boolean {
  if ((stored ?? '').trim() === '') return false;
  return source === 'typed' || source === 'imported';
}

/**
 * Whether a Steel save has exactly one number to ask about, and what it is
 * (spec §4, §6). Null means don't ask:
 *  - the stored number is already non-empty — the app never asks to overwrite
 *    a value the shooter can see, only to fill a blank one;
 *  - or the picked entries carry no non-empty membership at all;
 *  - or they carry two DIFFERENT ones (uppercased, mirroring groupKey's own
 *    compare) — the household case, two shooters picked in one sitting, where
 *    asking would be a guess. Silence, not a guess.
 * Otherwise the first membership AS WRITTEN in the file, trimmed — never
 * uppercased for storage, only for the disagreement check.
 */
export function scsaAdoptionCandidate(
  memberships: readonly string[],
  stored: string | undefined
): string | null {
  const trimmed = memberships.map((m) => m.trim()).filter((m) => m !== '');
  if (trimmed.length === 0) return null;
  const first = trimmed[0];
  const disagree = trimmed.some((m) => m.toUpperCase() !== first.toUpperCase());
  if (disagree) return null;
  // The fill-only-when-empty contract, CALLED rather than restated. An earlier
  // draft inlined the same `stored is non-empty -> null` check here, which was
  // behaviourally identical and left shouldRememberScsaNumber dead in
  // production — two copies of one rule, free to drift apart, which is exactly
  // what §3's "the read rule, stated once and used everywhere" forbids (cold
  // audit, 19 Aug 2026, session 128).
  return shouldRememberScsaNumber(stored, first) ? first : null;
}

/**
 * The Settings SCSA # write rule (spec §3), as a function so it can be
 * mutation-tested apart from the screen: the two keys are always written
 * together, in the same patch, so number and source can never drift apart.
 *  - Changed and non-empty: the shooter just typed this — both keys, source
 *    'typed'.
 *  - Changed to empty: clearing the field also clears its provenance — the
 *    number key empties and the source key becomes undefined (which the
 *    merge stores as absent, and a .flog backup drops entirely — same
 *    meaning either way).
 *  - Unchanged (a blur with no edit): the number key only, with NO source
 *    key in the patch at all. A blur is not an affirmation — leaving the
 *    field without editing it must never upgrade an inherited number to
 *    typed (the exact defect this build exists to close).
 */
export function scsaNumberPatch(
  next: string,
  committed: string
): { scsaMemberNumber: string; scsaMemberNumberSource?: 'typed' | undefined } {
  if (next === committed) return { scsaMemberNumber: next };
  if (next === '') return { scsaMemberNumber: '', scsaMemberNumberSource: undefined };
  return { scsaMemberNumber: next, scsaMemberNumberSource: 'typed' };
}
