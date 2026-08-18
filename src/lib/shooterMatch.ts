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

// A member-number confirmation was specified alongside this and is deliberately
// NOT here. It would have had nothing to compare against: the settings card asks
// for names and only names, so the check could only ever return "no
// confirmation", and a function that cannot say yes is decoration with a
// comment on it. If the card ever gains an optional member number, the whole of
// it is: normalise both sides, compare, and mark the match — a few lines, added
// when there is an input for them.
//
// Worth recording either way, because it is why the number is not the key: on
// PractiScore a member number lives on each match REGISTRATION rather than on an
// account, so it does not carry over and is regularly wrong or missing.
// Michael's own Gun Craft row reads A185321 where A185231 is correct, and six of
// that match's seventy-eight rows carry no number at all.
