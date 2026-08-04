// The storage half of the CSV importer: commitImportBatch, undoImportBatch, and
// the boundary that reads the file.
//
// Runs against fake-indexeddb (an in-memory IndexedDB) so the real db.ts logic
// executes, exactly as tests/db.test.ts does.
//
// EVERY TEST BELOW WAS WRITTEN AGAINST A DEFECT THAT SHIPPED ONCE, and each was
// checked the only way that means anything: the guard was deleted and the named
// test was watched go red. The one that matters most is the nine-store scan.
// An earlier build's undo looked at `sessions` alone, so removing an import
// hard-deleted a gun that a match, a magazine or a maintenance entry still
// named. Nothing crashed, because every screen falls back to a dash, and the
// gun on a match quietly became "-". The per-store loop below exists because
// the earlier test for that same widening still passed with the whole widening
// deleted: one case per store, each failing on its own.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  clearAllData, commitImportBatch, getAll, getImportHistory, putOne, undoImportBatch,
} from '../src/lib/db.ts';
import type { StoreName } from '../src/lib/db.ts';
import type { CsvImportRowCounts, Firearm, Session } from '../src/lib/types.ts';
import { readCsvFile } from '../src/ui/importCsvFile.ts';
import { MAX_IMPORT_FILE_BYTES } from '../src/lib/inputLimits.ts';

const COUNTS: CsvImportRowCounts = {
  rowsTotal: 3, rowsPlanned: 3, rowsFailed: 0, rowsSkipped: 0,
  duplicatesInFile: 0, duplicatesInLog: 0,
};

const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);

function gun(id: string, batchId: string | null, name = id): Firearm {
  return {
    id, createdAt: 1, updatedAt: 1, name, manufacturer: '', model: '', caliber: '9mm',
    category: 'Pistol', serialNumber: null, dateAcquired: '', startingRoundCount: 0,
    photoIds: [], referenceId: null, notes: '',
    legacy: batchId ? { source: 'csv', importBatch: batchId } : undefined,
  };
}

function session(id: string, firearmId: string, batchId: string | null): Session {
  return {
    id, createdAt: 1, updatedAt: 1, date: '2026-01-02', type: 'practice',
    guns: [{ firearmId, rounds: 50 }], location: '', distances: '', notes: '',
    ammoUsage: [], drills: [], targetMediaIds: [], malfunctions: [], selfRating: null,
    rangeFee: null, planned: false, checklist: null,
    legacy: batchId ? { source: 'csv', importBatch: batchId } : undefined,
  };
}

/** One import of one session and one freshly created gun. */
async function importOne(batchId: string, filename = 'range-log.csv') {
  return commitImportBatch({
    batchId,
    filename,
    sessions: [session(`se-${batchId}`, `fa-${batchId}`, batchId)],
    firearms: [gun(`fa-${batchId}`, batchId, `Gun ${batchId}`)],
    counts: COUNTS,
    now: 1_700_000_000_000,
  });
}

// ---------------------------------------------------------------------------
// commitImportBatch
// ---------------------------------------------------------------------------

test('commitImportBatch writes the sessions, the guns and a readable history entry', async () => {
  await clearAllData();
  const entry = await importOne('b1', 'my-range-log.csv');

  assert.ok(has(await getAll('sessions'), 'se-b1'), 'the session landed');
  assert.ok(has(await getAll('firearms'), 'fa-b1'), 'the gun landed');
  assert.equal(entry.counts.sessions, 1);
  assert.equal(entry.counts.firearms, 1);
  assert.equal(entry.filename, 'my-range-log.csv');

  // Written AND readable. A history that only ever gets written makes undo
  // unreachable the moment the report is dismissed.
  const history = await getImportHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].batchId, 'b1');
  assert.equal(history[0].counts.rowsTotal, 3);
});

test('the history counts what actually went in, not what the plan hoped for', async () => {
  await clearAllData();
  const entry = await commitImportBatch({
    batchId: 'b-counts',
    filename: 'x.csv',
    sessions: [session('se-c1', 'fa-c1', 'b-counts'), session('se-c2', 'fa-c1', 'b-counts')],
    firearms: [gun('fa-c1', 'b-counts')],
    // A plan claiming five rows planned cannot make the entry say five sessions.
    counts: { ...COUNTS, rowsPlanned: 5 },
    now: 1,
  });
  assert.equal(entry.counts.sessions, 2);
  assert.equal(entry.counts.firearms, 1);
});

test('B7: an unstorable record rolls the WHOLE import back, history included', async () => {
  await clearAllData();
  await importOne('b-keep');

  // Shape-valid but unstorable: IndexedDB cannot clone a function, so the put
  // throws mid-transaction and the transaction aborts. The gun is queued BEFORE
  // the sessions, so a non-atomic commit would leave it behind.
  const poisoned = { ...session('se-poison', 'fa-poison', 'b-bad'), oops: () => {} } as unknown as Session;
  await assert.rejects(commitImportBatch({
    batchId: 'b-bad',
    filename: 'bad.csv',
    sessions: [poisoned],
    firearms: [gun('fa-poison', 'b-bad')],
    counts: COUNTS,
    now: 2,
  }));

  const firearms = await getAll<{ id: string }>('firearms');
  const sessions = await getAll<{ id: string }>('sessions');
  assert.ok(!has(firearms, 'fa-poison'), 'no gun from the failed import');
  assert.ok(!has(sessions, 'se-poison'), 'no session from the failed import');
  assert.ok(has(firearms, 'fa-b-keep'), 'the earlier import survived untouched');

  const history = await getImportHistory();
  assert.equal(history.length, 1, 'no history entry for an import that never landed');
  assert.equal(history[0].batchId, 'b-keep');
});

// ---------------------------------------------------------------------------
// undoImportBatch: the tagged set, and only the tagged set
// ---------------------------------------------------------------------------

test('undo removes exactly the tagged set and leaves everything else alone', async () => {
  await clearAllData();
  await importOne('bA');
  await importOne('bB');
  // Hand-entered records, carrying no import tag at all.
  await putOne('firearms', gun('fa-hand', null, 'Hand entered'));
  await putOne('sessions', session('se-hand', 'fa-hand', null));

  const result = await undoImportBatch('bA');
  assert.equal(result.sessionsRemoved, 1);
  assert.equal(result.firearmsRemoved, 1);
  assert.deepEqual(result.firearmsKept, []);

  const sessions = await getAll<{ id: string }>('sessions');
  const firearms = await getAll<{ id: string }>('firearms');
  assert.ok(!has(sessions, 'se-bA') && !has(firearms, 'fa-bA'), 'batch A is gone');
  assert.ok(has(sessions, 'se-bB') && has(firearms, 'fa-bB'), 'batch B is untouched');
  assert.ok(has(sessions, 'se-hand') && has(firearms, 'fa-hand'), 'hand-entered records untouched');

  const history = await getImportHistory();
  assert.deepEqual(history.map((e) => e.batchId), ['bB'], 'only the removed import left the history');
});

test('undo keeps a gun a MAGAZINE still lists, and names it', async () => {
  await clearAllData();
  await importOne('bMag');
  // firearmIds is an ARRAY, and one magazine can serve several guns. This is the
  // reference shape a scan written from memory misses.
  await putOne('magazines', {
    id: 'mag-1', createdAt: 1, updatedAt: 1, label: 'Mag 3',
    firearmIds: ['fa-other', 'fa-bMag'], active: true, totalRounds: 0,
    springHistory: [], notes: '',
  });

  const result = await undoImportBatch('bMag');
  assert.equal(result.sessionsRemoved, 1, 'the session still goes');
  assert.equal(result.firearmsRemoved, 0, 'the gun does not');
  assert.equal(result.firearmsKept.length, 1);
  assert.equal(result.firearmsKept[0].name, 'Gun bMag', 'the kept gun is NAMED, not just counted');
  assert.deepEqual(result.firearmsKept[0].referencedBy, ['magazines']);
  assert.ok(has(await getAll('firearms'), 'fa-bMag'), 'the gun is still in the log');
});

// Every store that holds a firearm id, one case each, so no single case can
// stand in for the others: delete any one branch of the scan and exactly one of
// these goes red.
const REFERENCE_CASES: { store: StoreName; label: string; record: (gunId: string) => object }[] = [
  {
    store: 'sessions', label: 'sessions',
    record: (id) => ({ ...session('se-later', id, null), date: '2026-05-05' }),
  },
  { store: 'maintenance', label: 'maintenance entries', record: (id) => ({ id: 'mt-ref', createdAt: 1, updatedAt: 1, date: '2026-02-02', firearmId: id, type: 'Deep clean', performedBy: '', partsReplaced: '', notes: '' }) },
  { store: 'malfunctions', label: 'malfunctions', record: (id) => ({ id: 'mf-ref', createdAt: 1, updatedAt: 1, sessionId: null, date: '2026-02-02', firearmId: id, type: 'Failure to feed', resolution: '', notes: '' }) },
  { store: 'magazines', label: 'magazines', record: (id) => ({ id: 'mg-ref', createdAt: 1, updatedAt: 1, label: 'Mag 1', firearmIds: [id], active: true, totalRounds: 0, springHistory: [], notes: '' }) },
  { store: 'optics', label: 'optics', record: (id) => ({ id: 'op-ref', createdAt: 1, updatedAt: 1, firearmId: id, make: '', model: '', installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '', settingsSnapshot: '', batteryLog: [], notes: '' }) },
  { store: 'parts', label: 'parts', record: (id) => ({ id: 'pt-ref', createdAt: 1, updatedAt: 1, firearmId: id, name: 'Recoil spring', quantity: 1, partNumber: '', datePurchased: '', notes: '' }) },
  { store: 'skillSets', label: 'timed skills', record: (id) => ({ id: 'ss-ref', createdAt: 1, updatedAt: 1, sessionId: 'se-other', date: '2026-03-03', skill: 'draw', firearmId: id, dryFire: false, count: 10, bestSec: 1.4, cold: false, notes: '' }) },
  { store: 'matches', label: 'matches', record: (id) => ({ id: 'mc-ref', createdAt: 1, updatedAt: 1, date: '2026-04-04', name: 'Club match', matchType: 'USPSA', division: 'CO', powerFactor: 'Minor', firearmId: id, totalRounds: null, overallPlace: null, overallOf: null, divisionPlace: null, divisionOf: null, matchPercent: null, stages: [], entryFee: null, practiScoreUrl: '', notes: '' }) },
  { store: 'reminders', label: 'reminders', record: (id) => ({ id: 'rm-ref', createdAt: 1, updatedAt: 1, title: 'Change the spring', notes: '', source: 'custom', trigger: 'rounds', everyRounds: 5000, baselineRounds: 0, firearmId: id, enabled: true }) },
];

for (const scanCase of REFERENCE_CASES) {
  test(`undo keeps an imported gun that ${scanCase.store} still points at`, async () => {
    await clearAllData();
    const batchId = `b-${scanCase.store}`;
    await importOne(batchId);
    await putOne(scanCase.store, scanCase.record(`fa-${batchId}`));

    const result = await undoImportBatch(batchId);
    assert.equal(result.sessionsRemoved, 1, 'the import\'s own session is still removed');
    assert.equal(result.firearmsRemoved, 0, `a gun named by ${scanCase.store} must not be deleted`);
    assert.deepEqual(
      result.firearmsKept.map((f) => f.id), [`fa-${batchId}`],
      `the gun ${scanCase.store} points at has to come back as kept`,
    );
    assert.ok(
      result.firearmsKept[0].referencedBy.includes(scanCase.label),
      `the result has to say it is ${scanCase.label} holding the gun`,
    );
    assert.ok(has(await getAll('firearms'), `fa-${batchId}`), 'and the gun is still stored');
  });
}

test('the import\'s OWN sessions are not a reason to keep its gun', async () => {
  await clearAllData();
  await importOne('b-self');
  // Nothing outside the batch points at the gun: the only session naming it is
  // the one this undo is about to delete.
  const result = await undoImportBatch('b-self');
  assert.equal(result.firearmsRemoved, 1);
  assert.deepEqual(result.firearmsKept, []);
  assert.ok(!has(await getAll('firearms'), 'fa-b-self'));
});

test('a session in the Trash still counts as a reason to keep the gun', async () => {
  await clearAllData();
  await importOne('b-trash');
  await putOne('sessions', { ...session('se-soft', 'fa-b-trash', null), deletedAt: Date.now() });
  const result = await undoImportBatch('b-trash');
  // Soft-deleted is restorable, so removing the gun would break a session the
  // shooter can bring back with one tap.
  assert.equal(result.firearmsRemoved, 0);
  assert.deepEqual(result.firearmsKept.map((f) => f.id), ['fa-b-trash']);
});

test('undoing an import that is already gone changes nothing and does not throw', async () => {
  await clearAllData();
  await importOne('b-once');
  await undoImportBatch('b-once');
  const result = await undoImportBatch('b-once');
  assert.deepEqual(result, { sessionsRemoved: 0, firearmsRemoved: 0, firearmsKept: [] });
});

// ---------------------------------------------------------------------------
// The file boundary
// ---------------------------------------------------------------------------

test('the size cap is checked BEFORE the file is read', async () => {
  let readIt = false;
  const outcome = await readCsvFile({
    name: 'huge.csv',
    size: MAX_IMPORT_FILE_BYTES + 1,
    text: async () => { readIt = true; return 'date,gun,rounds\n'; },
  });
  assert.equal(outcome.ok, false, 'an outsized file is refused');
  // The whole point. An earlier build pulled the file into memory in full and
  // refused afterwards, on the device least able to afford it.
  assert.equal(readIt, false, 'not one byte of an outsized file may be read');
});

test('a readable file comes back with its text and its name', async () => {
  const outcome = await readCsvFile({
    name: 'log.csv', size: 40, text: async () => 'date,gun,rounds\n2026-01-01,Apollo,50\n',
  });
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.name, 'log.csv');
    assert.match(outcome.text, /Apollo/);
  }
});

test('a file that will not read, and an empty one, are refused in plain words', async () => {
  const failed = await readCsvFile({
    name: 'x.csv', size: 10, text: async () => { throw new Error('gone'); },
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.problem, /Nothing was changed/);

  const empty = await readCsvFile({ name: 'x.csv', size: 3, text: async () => '   ' });
  assert.equal(empty.ok, false);
});

// ---------------------------------------------------------------------------
// The screen's own structure, and its words
// ---------------------------------------------------------------------------

const uiSource = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/ui/${name}`, import.meta.url)), 'utf8');

test('the screen reaches the raw storage functions ONLY inside its refreshing wrappers', () => {
  const src = uiSource('ImportCsvScreen.tsx');
  // The stale-snapshot defect came back last time through a handler that used
  // the storage function directly and forgot the refresh. Two call sites, one
  // inside each wrapper, is the whole contract.
  const rawCalls = [...src.matchAll(/(?:commitImportBatchRaw|undoImportBatchRaw)\s*\(/g)];
  assert.equal(rawCalls.length, 2, 'exactly two raw call sites: one per wrapper');
  assert.match(src, /async function commitImportBatch\(/, 'the plain name is the wrapper');
  assert.match(src, /async function undoImportBatch\(/, 'the plain name is the wrapper');
  assert.match(src, /const entry = await commitImportBatchRaw\(input\);\s*\n\s*return \{ entry, log: await loadLog\(\) \};/);
  assert.match(src, /const result = await undoImportBatchRaw\(batchId\);\s*\n\s*return \{ result, log: await loadLog\(\) \};/);
});

test('no em dash reaches anything the import screen can show', () => {
  for (const name of ['ImportCsvScreen.tsx', 'importCsvFile.ts']) {
    assert.doesNotMatch(uiSource(name), /—/, `${name} must carry no em dash`);
  }
});

test('the screen claims no quality for the app', () => {
  const src = uiSource('ImportCsvScreen.tsx');
  for (const word of ['accurate', 'accurately', 'careful', 'carefully', 'smart', 'expert', 'better than', 'simply']) {
    assert.doesNotMatch(src.toLowerCase(), new RegExp(`\\b${word}\\b`), `"${word}" praises the app rather than serving the shooter`);
  }
});
