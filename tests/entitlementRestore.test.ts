// The two rules that ride inside restoreInner's phase-2 transaction
// (ENTITLEMENT_SPEC_2026-09-18.md §5.6 and BACKUP_LINE_AFTER_RESTORE_SPEC_2026-09-18.md §2):
//   1. Loading a file that carries no license, or text that does not verify,
//      must not erase or replace a license on the device; a file whose license
//      VERIFIES wins. (The file's text is checked before the transaction opens;
//      the licenses below are really signed with a throwaway key.)
//   2. Loading a file stamps lastBackupAt, lastRestoreAt and
//      lastRestoreFileMadeAt as ONE extra put of the merged settings.
import 'fake-indexeddb/auto';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  restoreSnapshot, restoreFromFile, clearAllData, getAll, getSettings, putSettings, putOne,
  type RestoreSource,
} from '../src/lib/db.ts';
import { buildFlogBlob, parseFlogLazy } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';
import type { AppSettings } from '../src/lib/types.ts';
import type { LicencePayload } from '../src/lib/licence.ts';
import { signLicence } from '../licence-worker/sign.ts';

// Two really-signed licences (different owners) and one that is not.
let DEVICE_LICENCE = '';
let FILE_LICENCE = '';
const JUNK_LICENCE = 'FL1.not-a-real-payload.not-a-real-signature';
const g = globalThis as unknown as { __FL_E2E_LICENCE_KEY__?: unknown };
const payloadFor = (seq: number, to: string): LicencePayload =>
  ({ v: 1, kid: 'restore-test', iss: 'web', plan: 'founding', seq, ref: `txn_${seq}`, at: '2026-11-03', to });
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  g.__FL_E2E_LICENCE_KEY__ = { kid: 'restore-test', jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) };
  DEVICE_LICENCE = await signLicence(payloadFor(1, 'Device Owner'), priv);
  FILE_LICENCE = await signLicence(payloadFor(2, 'File Owner'), priv);
});
after(() => { delete g.__FL_E2E_LICENCE_KEY__; });
const MADE_AT = 1_694_000_000_000; // the file's exportedAt (a "9/8" backup)

const EMPTY_STORES = [
  'firearms', 'sessions', 'drills', 'ammunition', 'purchases', 'maintenance',
  'malfunctions', 'magazines', 'optics', 'parts', 'goals', 'skills', 'skillSets',
  'matches', 'classifiers', 'references', 'reminders', 'trash', 'meta',
];

function storesWith(over: Record<string, unknown[]>): Record<string, unknown[]> {
  const base: Record<string, unknown[]> = {};
  for (const n of EMPTY_STORES) base[n] = [];
  return { ...base, ...over };
}

/** A file source as Load from File hands one over: it knows when it was made. */
function fileSource(
  settings: Record<string, unknown> | null,
  over: Record<string, unknown[]> = {},
  made: { exportedAt: number | undefined } = { exportedAt: MADE_AT },
): RestoreSource {
  const meta = settings ? [{ key: 'settings', value: settings }] : [];
  return {
    stores: storesWith({ meta, ...over }),
    mediaCount: 0, mediaMeta: [], readMedia: async () => { throw new Error('no media'); },
    exportedAt: made.exportedAt,
  };
}

/** A device whose settings are exactly `settings` (Clear All keeps an analytics
 *  opt-out on purpose, so a plain merge would carry one test into the next). */
async function deviceWith(settings: Partial<AppSettings>): Promise<void> {
  await clearAllData();
  await putOne('meta', { key: 'settings', value: settings });
}

// --- (1) keep the licence ---------------------------------------------------

test('restore: a licence-free backup over a licensed device KEEPS the licence', async () => {
  await deviceWith({ licence: DEVICE_LICENCE, theme: 'device-theme' });
  await restoreFromFile(fileSource({ theme: 'file-theme' }, { firearms: [{ id: 'g-file' }] }));
  const s = await getSettings<AppSettings>();
  assert.equal(s?.licence, DEVICE_LICENCE, 'the device licence was erased by loading a file without one');
  assert.equal(s?.theme, 'file-theme', 'the rest of the file settings still win');
  assert.deepEqual((await getAll<{ id: string }>('firearms')).map((g) => g.id), ['g-file'], 'the restore still completed');
});

test("restore: a licensed backup over a licensed device keeps the FILE's licence", async () => {
  await deviceWith({ licence: DEVICE_LICENCE });
  await restoreFromFile(fileSource({ licence: FILE_LICENCE }));
  assert.equal((await getSettings<AppSettings>())?.licence, FILE_LICENCE);
});

test('restore: a licensed backup over an unlicensed device stores the licence', async () => {
  await deviceWith({ theme: 'device-theme' });
  await restoreFromFile(fileSource({ licence: FILE_LICENCE, theme: 'file-theme' }));
  const s = await getSettings<AppSettings>();
  assert.equal(s?.licence, FILE_LICENCE);
  assert.equal(s?.theme, 'file-theme');
});

test('restore: a file whose licence does NOT verify never replaces a valid device licence', async () => {
  for (const junk of [JUNK_LICENCE, `${FILE_LICENCE}x`, 'garbage', FILE_LICENCE.slice(0, -4)]) {
    await deviceWith({ licence: DEVICE_LICENCE, theme: 'device-theme' });
    await restoreFromFile(fileSource({ licence: junk, theme: 'file-theme' }));
    const s = await getSettings<AppSettings>();
    assert.equal(s?.licence, DEVICE_LICENCE, `file licence ${junk.slice(0, 20)} displaced the device licence`);
    assert.equal(s?.theme, 'file-theme', 'the rest of the file settings still win');
  }
});

test('restore: a verifying file licence over a valid device licence stores the file\'s', async () => {
  await deviceWith({ licence: DEVICE_LICENCE });
  await restoreFromFile(fileSource({ licence: `  ${FILE_LICENCE}\n` }));
  assert.equal((await getSettings<AppSettings>())?.licence, `  ${FILE_LICENCE}\n`, 'stored exactly as the file had it');
});

test('restore: a file licence that does not verify over an UNLICENSED device is stored as the file wrote it', async () => {
  // Documented choice: it is the shooter\'s own file, nothing is lost by keeping
  // it, and the Settings card says it is not valid and offers to remove it.
  await deviceWith({ theme: 'device-theme' });
  await restoreFromFile(fileSource({ licence: JUNK_LICENCE }));
  assert.equal((await getSettings<AppSettings>())?.licence, JUNK_LICENCE);
});

test('restore: with the test key OFF (the production list), even a really signed file licence does not displace the device\'s', async () => {
  const saved = g.__FL_E2E_LICENCE_KEY__;
  g.__FL_E2E_LICENCE_KEY__ = null;
  try {
    await deviceWith({ licence: DEVICE_LICENCE });
    await restoreFromFile(fileSource({ licence: FILE_LICENCE }));
    assert.equal((await getSettings<AppSettings>())?.licence, DEVICE_LICENCE);
  } finally { g.__FL_E2E_LICENCE_KEY__ = saved; }
});

test('restore: an unlicensed backup over an unlicensed device leaves no licence', async () => {
  await deviceWith({ theme: 'device-theme' });
  await restoreFromFile(fileSource({ theme: 'file-theme' }));
  assert.equal((await getSettings<AppSettings>())?.licence, undefined);
});

test('restore: a backup with NO settings row over a licensed device keeps the licence and still stamps', async () => {
  await deviceWith({ licence: DEVICE_LICENCE, theme: 'device-theme' });
  await restoreFromFile(fileSource(null, { firearms: [{ id: 'g-file' }] }));
  const s = await getSettings<AppSettings>();
  assert.equal(s?.licence, DEVICE_LICENCE);
  assert.equal(s?.lastBackupAt, MADE_AT);
  assert.equal(s?.lastRestoreFileMadeAt, MADE_AT);
  assert.equal(s?.theme, undefined, 'the file had no settings, so the device theme is gone as before');
});

test('restore: an empty or non-text licence in the file does not shadow the device licence', async () => {
  for (const bad of ['', '   ', null, 42]) {
    await deviceWith({ licence: DEVICE_LICENCE });
    await restoreFromFile(fileSource({ licence: bad, theme: 't' }));
    assert.equal((await getSettings<AppSettings>())?.licence, DEVICE_LICENCE, `file licence ${JSON.stringify(bad)}`);
  }
});

test('restore: a malformed settings row (not an object) does not stop the restore or lose the licence', async () => {
  await deviceWith({ licence: DEVICE_LICENCE });
  const src = fileSource(null, { firearms: [{ id: 'g-file' }] });
  src.stores.meta = [{ key: 'settings', value: null }];
  await restoreFromFile(src);
  assert.equal((await getSettings<AppSettings>())?.licence, DEVICE_LICENCE);
  assert.deepEqual((await getAll<{ id: string }>('firearms')).map((g) => g.id), ['g-file']);
});

test('restore: other meta rows in the file still land (the extra put touches settings only)', async () => {
  await deviceWith({ licence: DEVICE_LICENCE });
  const src = fileSource({ theme: 'x' });
  src.stores.meta = [...src.stores.meta, { key: 'instructors', value: ['Sam'] }];
  await restoreFromFile(src);
  const rows = await getAll<{ key: string; value: unknown }>('meta');
  assert.deepEqual(rows.find((r) => r.key === 'instructors')?.value, ['Sam']);
});

// --- (2) the three stamps ----------------------------------------------------

test('restore: the three stamps are the file\'s exportedAt, now, and the file\'s exportedAt', async () => {
  await deviceWith({ lastBackupAt: 1, lastBackupBytes: 111 });
  const before = Date.now();
  await restoreFromFile(fileSource({ lastBackupAt: MADE_AT - 86_400_000, lastBackupBytes: 319, lastBackupVideoBytes: 300 }));
  const after = Date.now();
  const s = await getSettings<AppSettings>();
  assert.equal(s?.lastBackupAt, MADE_AT, 'lastBackupAt is the file\'s own creation time, not its one-save-old stamp');
  assert.equal(s?.lastRestoreFileMadeAt, MADE_AT);
  assert.ok(s!.lastRestoreAt! >= before && s!.lastRestoreAt! <= after, 'lastRestoreAt is now');
  assert.equal(s?.lastBackupBytes, 319, 'sizes stay as the file carried them');
  assert.equal(s?.lastBackupVideoBytes, 300);
});

test('restore: through a real .flog (parseFlogLazy), the stamps use the archive\'s exportedAt', async () => {
  const snap: Snapshot = {
    exportedAt: MADE_AT, lastModified: MADE_AT,
    stores: storesWith({ meta: [{ key: 'settings', value: { lastBackupAt: MADE_AT - 5 } }] }),
    media: [],
  };
  const blob = await buildFlogBlob({ exportedAt: snap.exportedAt, lastModified: snap.lastModified, stores: snap.stores, media: [] });
  await clearAllData();
  await restoreFromFile(await parseFlogLazy(blob));
  const s = await getSettings<AppSettings>();
  assert.equal(s?.lastBackupAt, MADE_AT);
  assert.equal(s?.lastRestoreFileMadeAt, MADE_AT);
});

test('restore: a source that does not know when it was made (exportedAt 0 or absent) writes no stamps', async () => {
  for (const at of [0, undefined, Number.NaN]) {
    await deviceWith({ lastBackupAt: 42 });
    await restoreFromFile(fileSource({ theme: 't', lastBackupAt: 7 }, {}, { exportedAt: at }));
    const s = await getSettings<AppSettings>();
    assert.equal(s?.lastBackupAt, 7, 'the file value stands');
    assert.equal(s?.lastRestoreAt, undefined);
    assert.equal(s?.lastRestoreFileMadeAt, undefined);
  }
});

test('restoreSnapshot (the sample log, the setup wizard) writes no stamps but keeps the licence', async () => {
  await deviceWith({ licence: DEVICE_LICENCE });
  const snap: Snapshot = {
    exportedAt: MADE_AT, lastModified: MADE_AT,
    stores: storesWith({ meta: [{ key: 'settings', value: { sampleLogLoaded: true } }] }), media: [],
  };
  await restoreSnapshot(snap);
  const s = await getSettings<AppSettings>();
  assert.equal(s?.sampleLogLoaded, true);
  assert.equal(s?.licence, DEVICE_LICENCE);
  assert.equal(s?.lastRestoreAt, undefined, 'loading the sample is not "a backup made on date X"');
});

test('save after a restore moves lastBackupAt and the sizes and leaves both restore fields alone', async () => {
  await deviceWith({});
  await restoreFromFile(fileSource({}));
  const later = MADE_AT + 10 * 86_400_000;
  // The exact shape of SyncCard's save write.
  await putSettings<AppSettings>({ lastBackupAt: later, lastBackupBytes: 5, lastBackupVideoBytes: 0 });
  const s = await getSettings<AppSettings>();
  assert.equal(s?.lastBackupAt, later);
  assert.equal(s?.lastRestoreFileMadeAt, MADE_AT);
  assert.ok(typeof s?.lastRestoreAt === 'number');
});

test('SyncCard\'s save write names neither restore field (source guard)', () => {
  const src = readFileSync(new URL('../src/ui/SyncCard.tsx', import.meta.url), 'utf8');
  const call = /putSettings<AppSettings>\(\{ lastBackupAt: now[^}]*\}\)/.exec(src);
  assert.ok(call, 'the save write was not found');
  assert.ok(!/lastRestore/.test(call[0]));
});

// --- Clear All ---------------------------------------------------------------

test('clearAllData removes the licence (spec §5.6) and keeps only the analytics opt-out', async () => {
  await deviceWith({ licence: DEVICE_LICENCE, analyticsOptOut: true, theme: 'x' });
  await clearAllData();
  const s = await getSettings<AppSettings>();
  assert.equal(s?.licence, undefined);
  assert.equal(s?.analyticsOptOut, true);
  assert.equal(s?.theme, undefined);
});

test('clearAllData with nothing to carry leaves no settings row at all', async () => {
  await deviceWith({ licence: DEVICE_LICENCE });
  await clearAllData();
  assert.equal(await getSettings<AppSettings>(), undefined);
});

test('clearAllData({ keepLicence: true }) (the sample banner exit) keeps only the licence', async () => {
  await deviceWith({ licence: DEVICE_LICENCE, theme: 'x', sampleLogLoaded: true });
  await putOne('firearms', { id: 'g1' });
  await clearAllData({ keepLicence: true });
  const s = await getSettings<AppSettings>();
  assert.deepEqual(s, { licence: DEVICE_LICENCE });
  assert.deepEqual(await getAll('firearms'), []);
});
