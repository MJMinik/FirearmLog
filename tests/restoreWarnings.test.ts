// D-10: the older-backup warning is a pure read (no IndexedDB), so this runs
// without fake-indexeddb — countFor is a plain function the tests hand in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingStoreWarning } from '../src/lib/restoreWarnings.ts';
import { STORE_NAMES } from '../src/lib/db.ts';
import type { StoreName } from '../src/lib/db.ts';

/** A countFor that answers from a fixed table, 0 for anything not listed. */
function countsFrom(counts: Partial<Record<StoreName, number>>) {
  return async (store: StoreName) => counts[store] ?? 0;
}

test('a missing store with local records produces the exact rule-44 sentence', async () => {
  const warning = await missingStoreWarning(
    STORE_NAMES.filter((s) => s !== 'reminders' && s !== 'meta' && s !== 'media'),
    countsFrom({ reminders: 3 }),
  );
  assert.equal(
    warning,
    'This backup has no reminders section (it was saved by an older version of FirearmLog); '
    + 'this device holds 3 reminders, and loading the file will remove them.',
  );
});

test('a missing store with ONE local record uses the singular noun', async () => {
  const warning = await missingStoreWarning(
    STORE_NAMES.filter((s) => s !== 'reminders' && s !== 'meta' && s !== 'media'),
    countsFrom({ reminders: 1 }),
  );
  assert.equal(
    warning,
    'This backup has no reminders section (it was saved by an older version of FirearmLog); '
    + 'this device holds 1 reminder, and loading the file will remove it.',
  );
});

test('a missing store with no local records produces nothing', async () => {
  const warning = await missingStoreWarning(
    STORE_NAMES.filter((s) => s !== 'reminders' && s !== 'meta' && s !== 'media'),
    countsFrom({ reminders: 0 }),
  );
  assert.equal(warning, '');
});

test('a store the file DOES carry a section for produces nothing, however many local records exist', async () => {
  // Every store present (nothing filtered out of the file's own list).
  const warning = await missingStoreWarning(
    STORE_NAMES.filter((s) => s !== 'meta' && s !== 'media'),
    countsFrom({ reminders: 50, firearms: 12, ammunition: 4 }),
  );
  assert.equal(warning, '');
});

test('two missing stores each with local records produce two sentences, joined by a space', async () => {
  const warning = await missingStoreWarning(
    STORE_NAMES.filter((s) => s !== 'reminders' && s !== 'ammunition' && s !== 'meta' && s !== 'media'),
    countsFrom({ reminders: 2, ammunition: 5 }),
  );
  // In STORE_NAMES order (ammunition precedes reminders), since the function
  // walks that one canonical list rather than the order stores were named in.
  const sentences = [
    'This backup has no ammo cans section (it was saved by an older version of FirearmLog); '
    + 'this device holds 5 ammo cans, and loading the file will remove them.',
    'This backup has no reminders section (it was saved by an older version of FirearmLog); '
    + 'this device holds 2 reminders, and loading the file will remove them.',
  ];
  assert.equal(warning, sentences.join(' '));
});

test('an empty file store list with nothing local anywhere produces nothing', async () => {
  const warning = await missingStoreWarning([], countsFrom({}));
  assert.equal(warning, '');
});

test('meta and media are never named, even though STORE_NAMES lists them', async () => {
  // An empty file (missing every section, meta and media included) with a
  // pile of settings/photos would say nothing about either — they are not
  // record stores a shooter would recognise as a "section".
  const warning = await missingStoreWarning([], countsFrom({ meta: 1, media: 40 } as Partial<Record<StoreName, number>>));
  assert.equal(warning, '');
});

test('every record store except meta and media has a plural-noun entry', async () => {
  // Completeness pin for STORE_NOUNS, from the outside: if a store were
  // missing its noun, missingStoreWarning silently skips it (the `if (!noun)
  // continue` in restoreWarnings.ts) rather than throwing, so a hand count is
  // the only way to catch a store shipped with no sentence at all. Give every
  // real store a local record and check a sentence comes back for each one
  // named by its own noun.
  const recordStores = STORE_NAMES.filter((s) => s !== 'meta' && s !== 'media');
  const warning = await missingStoreWarning(
    [], // the file carries none of them
    countsFrom(Object.fromEntries(recordStores.map((s) => [s, 1])) as Partial<Record<StoreName, number>>),
  );
  const sentenceCount = warning.split('This backup has no ').length - 1;
  assert.equal(
    sentenceCount, recordStores.length,
    `expected one sentence per record store (${recordStores.length}); a store with no noun entry produces none`,
  );
});
