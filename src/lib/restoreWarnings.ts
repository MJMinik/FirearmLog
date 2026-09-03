// D-10 (db-trio spec, session 140): a read-only warning for the Load-from-File
// confirm sheet. It answers one question — does this backup predate a store
// this device actually has records in? — and says so in plain words BEFORE
// anything is touched. It changes nothing about the restore itself: `db.ts`'s
// restoreInner already clears and rewrites every store the app knows, and a
// store the file has no section for is treated as empty on purpose (a missing
// section has always meant "nothing to put back," never "leave it alone").
// That is correct for a file saved by THIS version of the app. It quietly
// erases a store on a device that has one when the file predates that store
// existing — the reminders store shipped mid-July 2026, so any backup taken
// before that has no reminders section, and loading one today would remove
// every reminder with no warning on the sheet. Nothing here stops that; it
// only makes sure the sheet says so first.
//
// Lives OUTSIDE db.ts on purpose (spec D-10, option 1's stated blast radius):
// it is a read, never a write, and needs nothing db.ts does not already
// export — the app's own store list and a way to count one store's records.

import { STORE_NAMES } from './db.ts';
import type { StoreName } from './db.ts';

/**
 * Plain-word nouns for the sentence below, singular and plural. Keyed by every
 * record store except `meta` (not a record collection) and `media` (photos
 * travel with the record that owns them, not as a section a shooter would
 * recognise by name) — checked for completeness by the test file, so a store
 * added to STORE_NAMES with no entry here fails loudly instead of silently
 * saying nothing.
 */
const STORE_NOUNS: Partial<Record<StoreName, { singular: string; plural: string }>> = {
  firearms: { singular: 'gun', plural: 'guns' },
  sessions: { singular: 'session', plural: 'sessions' },
  drills: { singular: 'drill', plural: 'drills' },
  ammunition: { singular: 'ammo can', plural: 'ammo cans' },
  purchases: { singular: 'purchase', plural: 'purchases' },
  maintenance: { singular: 'maintenance entry', plural: 'maintenance entries' },
  malfunctions: { singular: 'malfunction', plural: 'malfunctions' },
  magazines: { singular: 'magazine', plural: 'magazines' },
  optics: { singular: 'optic', plural: 'optics' },
  parts: { singular: 'part', plural: 'parts' },
  goals: { singular: 'goal', plural: 'goals' },
  // The Skills Check screen's 1-10 self-ratings — distinct from `skillSets`
  // (the Timed Skills stopwatch sets) below. Not named in the rule-44 copy
  // list this file's sentence was signed against, which named seventeen of
  // the eighteen record stores and skipped this one; added rather than left
  // silent, because a device with skill checks losing them to an old backup
  // with no warning is exactly the defect D-10 exists to catch.
  skills: { singular: 'skill check', plural: 'skill checks' },
  skillSets: { singular: 'timed skill', plural: 'timed skills' },
  matches: { singular: 'match', plural: 'matches' },
  classifiers: { singular: 'classifier', plural: 'classifiers' },
  references: { singular: 'care guide', plural: 'care guides' },
  reminders: { singular: 'reminder', plural: 'reminders' },
  trash: { singular: 'recently deleted item', plural: 'recently deleted items' },
};

/**
 * One sentence, rule-44 copy (signed): for a store the file has no section
 * for and this device holds N records in, say so and say what loading the
 * file will do to them. Several missing stores each get their own sentence,
 * joined by a space — one clause per store reads more plainly than one
 * sentence trying to list several nouns at once.
 *
 * `countFor` is injected rather than calling `countAll` from db.ts directly,
 * so this stays a pure read with no import of the danger-zone file's runtime
 * (only its STORE_NAMES list and StoreName type, both read-only) and so the
 * unit tests can hand it a fake without touching IndexedDB at all.
 */
export async function missingStoreWarning(
  fileStoreNames: readonly string[],
  countFor: (store: StoreName) => Promise<number>,
): Promise<string> {
  const present = new Set(fileStoreNames);
  const sentences: string[] = [];
  for (const store of STORE_NAMES) {
    if (store === 'meta' || store === 'media') continue;
    if (present.has(store)) continue;
    const noun = STORE_NOUNS[store];
    if (!noun) continue; // every real record store has an entry above; see the test that pins this
    const count = await countFor(store);
    if (count <= 0) continue;
    const word = count === 1 ? noun.singular : noun.plural;
    sentences.push(
      `This backup has no ${noun.plural} section (it was saved by an older version of FirearmLog); `
      + `this device holds ${count} ${word}, and loading the file will remove ${count === 1 ? 'it' : 'them'}.`
    );
  }
  return sentences.join(' ');
}
