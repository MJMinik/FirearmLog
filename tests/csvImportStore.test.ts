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
  applyAmmoMerge, batchesMissingFromHistory, clearAllData, commitImportBatch, getAll,
  getImportHistory, putOne, REF_SCAN_STORES, undoImportBatch,
} from '../src/lib/db.ts';
import { repointAmmoUsage } from '../src/lib/ammoMerge.ts';
import type { StoreName } from '../src/lib/db.ts';
import type { CsvImportRowCounts, Firearm, Session } from '../src/lib/types.ts';
import { readCsvFile } from '../src/ui/importCsvFile.ts';
import { purgeSession } from '../src/ui/sessionDelete.ts';
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

// ---------------------------------------------------------------------------
// ...AND NEITHER IS ANYTHING ELSE THIS UNDO IS ABOUT TO DELETE
// ---------------------------------------------------------------------------
//
// The second instance of that class, measured. The scan excluded the SESSIONS
// being deleted and nothing else, while the malfunctions, timed-skill sets and
// photos filed against those sessions were worked out a dozen lines further
// down and deleted moments later. So a single malfunction on an imported
// session kept the imported gun alive, the shooter was told "Kept: you have
// used it in malfunctions since the import", and that malfunction was deleted
// by the same operation: the sentence was false before it finished rendering,
// the gun the import created outlived the import with nothing pointing at it,
// and it kept the batch tag, so a re-import matched it by name and no later
// undo could remove it either.
//
// NOT AN EDGE CASE. SessionForm defaults a new malfunction's gun to the
// session's own gun, and re-points malfunctions and timed-skill sets at it when
// the session's gun changes, so logging one malfunction on an imported session
// is all it takes.
const ATTACHED_REFERENCE_CASES: {
  store: StoreName;
  record: (sessionId: string, firearmId: string) => object;
}[] = [
  {
    store: 'malfunctions',
    record: (sid, fid) => ({
      id: 'mf-attached', createdAt: 1, updatedAt: 1, sessionId: sid, date: '2026-01-02',
      firearmId: fid, type: 'Failure to feed', resolution: '', notes: '',
    }),
  },
  {
    store: 'skillSets',
    record: (sid, fid) => ({
      id: 'ss-attached', createdAt: 1, updatedAt: 1, sessionId: sid, date: '2026-01-02',
      skill: 'draw', firearmId: fid, dryFire: false, count: 10, bestSec: 1.4,
      cold: true, notes: '',
    }),
  },
];

// THE CLASS, NOT THE TWO INSTANCES. A store that both belongs to a session and
// names a gun is a store whose rows this undo deletes AND consults, which is the
// exact shape of the defect. The list is read off the two tables in db.ts, so
// adding such a store next month makes THIS test red until it has a case above,
// rather than leaving a gap nothing reports.
test('every store that both belongs to a session and names a gun has a case here', () => {
  const both = REF_SCAN_STORES.session.filter((s) => REF_SCAN_STORES.firearm.includes(s));
  assert.deepEqual(
    ATTACHED_REFERENCE_CASES.map((c) => c.store).sort(),
    [...both].sort(),
    'a store the undo both deletes and reads has to be covered below',
  );
});

for (const attachedCase of ATTACHED_REFERENCE_CASES) {
  test(`a ${attachedCase.store} row on the import's own session is not a reason to keep its gun`, async () => {
    await clearAllData();
    const batchId = `b-att-${attachedCase.store}`;
    await importOne(batchId);
    await putOne(attachedCase.store, attachedCase.record(`se-${batchId}`, `fa-${batchId}`));

    const result = await undoImportBatch(batchId);
    assert.equal(result.attachedRemoved, 1, 'the row goes with the session it belongs to');
    assert.deepEqual(
      result.firearmsKept, [],
      'so it cannot also be given as the reason the gun was kept',
    );
    assert.equal(result.firearmsRemoved, 1);
    assert.ok(
      !has(await getAll('firearms'), `fa-${batchId}`),
      'the gun the import created does not outlive the import',
    );
    assert.equal((await getAll<{ id: string }>(attachedCase.store)).length, 0);
  });
}

test('a row on SOMEONE ELSE\'S session still keeps the gun, so the exclusion is not a blanket one', async () => {
  await clearAllData();
  await importOne('b-att-other');
  // A malfunction on a hand-entered session, naming the imported gun. Nothing
  // is deleting this one, so it is a real reason to keep the gun.
  await putOne('sessions', session('se-mine', 'fa-hand', null));
  await putOne('malfunctions', ATTACHED_REFERENCE_CASES[0].record('se-mine', 'fa-b-att-other'));

  const result = await undoImportBatch('b-att-other');
  assert.equal(result.attachedRemoved, 0, 'it belongs to a session that is staying');
  assert.equal(result.firearmsRemoved, 0);
  assert.deepEqual(result.firearmsKept.map((f) => f.referencedBy), [['malfunctions']]);
  assert.ok(has(await getAll('firearms'), 'fa-b-att-other'));
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

// ---------------------------------------------------------------------------
// The other half of the same class: records that point at a SESSION this undo
// is deleting. The firearm scan above was widened once and left this half open.
//
// A timed-skill set, a malfunction or a photo filed against an imported session
// is reachable from the session form the moment the import lands. If undo takes
// the session and leaves them, they point at an id that no longer exists: no
// screen can reach them, no screen can delete them, and activeSkillSets (which
// filters sets whose session is TRASHED, not sets whose session is GONE) keeps
// counting those draw times in every trend, PR and cold-versus-warm reading for
// good. The app's own permanent delete already does this correctly, in
// src/ui/sessionDelete.ts purgeSession.
const SESSION_CASCADE_CASES: {
  store: StoreName;
  record: (sessionId: string) => object;
  /** The same record shape, filed against a session this undo is NOT removing. */
  otherRecord: (sessionId: string) => object;
}[] = [
  {
    store: 'skillSets',
    record: (sid) => ({
      id: 'ss-orphan', createdAt: 1, updatedAt: 1, sessionId: sid, date: '2026-01-02',
      skill: 'draw', firearmId: 'fa-x', dryFire: false, count: 10, bestSec: 1.4,
      cold: true, notes: '',
    }),
    otherRecord: (sid) => ({
      id: 'ss-keep', createdAt: 1, updatedAt: 1, sessionId: sid, date: '2026-01-02',
      skill: 'draw', firearmId: 'fa-x', dryFire: false, count: 10, bestSec: 1.9,
      cold: false, notes: '',
    }),
  },
  {
    store: 'malfunctions',
    record: (sid) => ({
      id: 'mf-orphan', createdAt: 1, updatedAt: 1, sessionId: sid, date: '2026-01-02',
      firearmId: 'fa-x', type: 'Failure to feed', resolution: '', notes: '',
    }),
    otherRecord: (sid) => ({
      id: 'mf-keep', createdAt: 1, updatedAt: 1, sessionId: sid, date: '2026-01-02',
      firearmId: 'fa-x', type: 'Failure to eject', resolution: '', notes: '',
    }),
  },
  {
    store: 'media',
    record: (sid) => ({
      id: 'md-orphan', createdAt: 1, updatedAt: 1, ownerType: 'session', ownerId: sid,
      kind: 'image', name: 'target.jpg', annotations: [], mime: 'image/jpeg',
      data: new ArrayBuffer(8),
    }),
    otherRecord: (sid) => ({
      id: 'md-keep', createdAt: 1, updatedAt: 1, ownerType: 'session', ownerId: sid,
      kind: 'image', name: 'other.jpg', annotations: [], mime: 'image/jpeg',
      data: new ArrayBuffer(8),
    }),
  },
];

for (const cascade of SESSION_CASCADE_CASES) {
  test(`undo takes the ${cascade.store} filed against a session it removes`, async () => {
    await clearAllData();
    const batchId = `b-orphan-${cascade.store}`;
    await importOne(batchId);
    // A hand-entered session that is nothing to do with this import.
    await putOne('sessions', session('se-mine', 'fa-hand', null));
    await putOne(cascade.store, cascade.record(`se-${batchId}`));
    await putOne(cascade.store, cascade.otherRecord('se-mine'));

    await undoImportBatch(batchId);

    const rows = await getAll<{ id: string }>(cascade.store);
    assert.ok(
      !rows.some((r) => r.id.endsWith('-orphan')),
      `a ${cascade.store} row pointing at a deleted session is an orphan nothing can reach`,
    );
    assert.ok(
      rows.some((r) => r.id.endsWith('-keep')),
      `and a ${cascade.store} row on the shooter's own session must survive`,
    );
  });
}

test('undo says how many session-owned rows went with the sessions', async () => {
  await clearAllData();
  await importOne('b-count-orphans');
  await putOne('skillSets', SESSION_CASCADE_CASES[0].record('se-b-count-orphans'));
  await putOne('malfunctions', SESSION_CASCADE_CASES[1].record('se-b-count-orphans'));
  const result = await undoImportBatch('b-count-orphans');
  assert.equal(result.sessionsRemoved, 1);
  assert.equal(result.attachedRemoved, 2, 'the count is reported, not silently done');
});

test('the app\'s own permanent delete asks the SAME question the undo asks', async () => {
  // Not a new behaviour: purgeSession always did this correctly. It is here
  // because the two now share one derived answer instead of two hand-written
  // lists, and this is what proves the shared one still does the job.
  await clearAllData();
  await putOne('sessions', session('se-purge', 'fa-hand', null));
  await putOne('sessions', session('se-other', 'fa-hand', null));
  for (const cascade of SESSION_CASCADE_CASES) {
    await putOne(cascade.store, cascade.record('se-purge'));
    await putOne(cascade.store, cascade.otherRecord('se-other'));
  }

  await purgeSession('se-purge');

  for (const cascade of SESSION_CASCADE_CASES) {
    const rows = await getAll<{ id: string }>(cascade.store);
    assert.ok(!rows.some((r) => r.id.endsWith('-orphan')), `${cascade.store} filed against the purged session goes`);
    assert.ok(rows.some((r) => r.id.endsWith('-keep')), `${cascade.store} on another session stays`);
  }
  assert.ok(!has(await getAll('sessions'), 'se-purge'));
  assert.ok(has(await getAll('sessions'), 'se-other'));
});

// ---------------------------------------------------------------------------
// Ammunition: what the commit takes off the cans, the undo puts back
// ---------------------------------------------------------------------------

function can(id: string, quantity: number) {
  return {
    id, createdAt: 1, updatedAt: 1, brand: 'Range Brand', caliber: '9mm', grain: '124',
    bulletType: 'FMJ', quantity, costPerRound: 0.24, notes: '',
  };
}

const quantityOf = async (id: string): Promise<number> => {
  const rows = await getAll<{ id: string; quantity: number }>('ammunition');
  return rows.find((a) => a.id === id)?.quantity ?? -1;
};

function sessionUsing(id: string, batchId: string, ammoId: string, rounds: number, planned = false): Session {
  return {
    ...session(id, `fa-${batchId}`, batchId),
    guns: [{ firearmId: `fa-${batchId}`, rounds }],
    ammoUsage: [{ ammoId, rounds }],
    planned,
  };
}

test('an imported session takes its rounds off the can, the way hand entry does', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 1000));
  await commitImportBatch({
    batchId: 'b-ammo', filename: 'log.csv',
    sessions: [sessionUsing('se-a1', 'b-ammo', 'am-1', 150)],
    firearms: [gun('fa-b-ammo', 'b-ammo')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 850, 'on-hand has to fall by what the import recorded');
});

test('removing that import puts exactly those rounds back, and no more', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 1000));
  await commitImportBatch({
    batchId: 'b-ammo2', filename: 'log.csv',
    sessions: [sessionUsing('se-a2', 'b-ammo2', 'am-1', 150)],
    firearms: [gun('fa-b-ammo2', 'b-ammo2')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 850, 'the rounds have to come off before they can go back');
  await undoImportBatch('b-ammo2');
  // The measured defect: the commit never deducted, and the delete refunded, so
  // 1000 became 1150 and 150 rounds existed that never had.
  assert.equal(await quantityOf('am-1'), 1000, 'undo has to land back where the import found it');
});

test('a can holding less than the import uses empties, and comes back to what it held', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 100));
  await commitImportBatch({
    batchId: 'b-clamp', filename: 'log.csv',
    sessions: [sessionUsing('se-cl', 'b-clamp', 'am-1', 150)],
    firearms: [gun('fa-b-clamp', 'b-clamp')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 0, 'a can cannot go below zero');
  await undoImportBatch('b-clamp');
  // Measured at 150 before this: the commit could only take the 100 that were
  // there, and the undo handed back the 150 the rows asked for, so 50 rounds
  // appeared that were never bought and never fired.
  assert.equal(await quantityOf('am-1'), 100, 'undo hands back what the commit took, not what it asked for');
});

test('a year of history against a small can does not multiply it', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 100));
  // The ordinary shape of this feature, not an extreme one: importing a long
  // back-log against today's on-hand count reaches the floor almost every time.
  const sessions = Array.from({ length: 10 }, (_, i) => sessionUsing(`se-y${i}`, 'b-year', 'am-1', 150));
  await commitImportBatch({
    batchId: 'b-year', filename: 'log.csv', sessions,
    firearms: [gun('fa-b-year', 'b-year')], counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 0);
  await undoImportBatch('b-year');
  assert.equal(await quantityOf('am-1'), 100, '1500 rounds were asked for and 100 were there');
});

// THE CLASS, NOT THE TWO INSTANCES. Both defects in this area have been a
// commit and an undo that disagreed by some amount, and both were shipped with
// a test that could not reach the disagreement: the first because the two
// directions shared a function, the second because the fixture used a can far
// larger than the import. A round trip over a grid that straddles the floor
// cannot be passed by an asymmetric pair, whichever direction a future change
// breaks.
const ROUND_TRIP_ROUNDS = [0, 1, 99, 100, 101, 150, 1500];
for (const start of [0, 1, 50, 100, 999, 1000]) {
  test(`a can of ${start} is back at ${start} after any import is committed and removed`, async () => {
    for (const rounds of ROUND_TRIP_ROUNDS) {
      await clearAllData();
      await putOne('ammunition', can('am-1', start));
      const batchId = `b-rt-${start}-${rounds}`;
      await commitImportBatch({
        batchId, filename: 'log.csv',
        sessions: [sessionUsing(`se-rt-${rounds}`, batchId, 'am-1', rounds)],
        firearms: [gun(`fa-${batchId}`, batchId)],
        counts: COUNTS, now: 1,
      });
      const afterCommit = await quantityOf('am-1');
      assert.equal(
        afterCommit, Math.max(0, start - rounds),
        `a can of ${start} used for ${rounds} rounds has to read ${Math.max(0, start - rounds)}`,
      );
      await undoImportBatch(batchId);
      assert.equal(
        await quantityOf('am-1'), start,
        `removing an import of ${rounds} rounds has to leave the can of ${start} at ${start}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// THE ROUNDS DO NOT STAY ON THE CAN THE IMPORT NAMED
// ---------------------------------------------------------------------------
//
// The ledger records which can the import named. It is not a record of where
// the rounds are, and two ordinary features move them:
//
//  - combining cans repoints every session onto the kept can and DELETES the
//    other one (src/ui/AmmoScreens.tsx, applyAmmoMerge);
//  - editing an imported session's ammunition repoints that one session, with
//    SessionForm refunding the old can and deducting the new.
//
// Looking the ledger's can up in the log then finds a can that is gone, or one
// the rounds are no longer off, and the shooter's rounds are never handed back.
// Measured at 350 where 500 was owed, in both. It invents nothing, which is why
// it is silent, and it is permanent.

test('combining two cans still hands the rounds back, to the can that is left', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 200));
  await putOne('ammunition', can('am-2', 300));
  await commitImportBatch({
    batchId: 'b-merge', filename: 'log.csv',
    sessions: [sessionUsing('se-mg', 'b-merge', 'am-1', 150)],
    firearms: [gun('fa-b-merge', 'b-merge')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 50, 'the import took its rounds off the can it named');

  // The real merge, through the real call the Ammo screen makes: the 50 left on
  // am-1 land on am-2, every session is repointed, and am-1 is deleted.
  const sessions = await getAll<Session>('sessions');
  const repointed = repointAmmoUsage(sessions, 'am-1', 'am-2').map((change) => ({
    ...sessions.find((s) => s.id === change.id)!, ammoUsage: change.ammoUsage,
  }));
  await applyAmmoMerge({
    keptCan: can('am-2', 350), sessions: repointed, purchases: [], deleteCanId: 'am-1',
  });
  assert.equal(await quantityOf('am-2'), 350);

  await undoImportBatch('b-merge');
  // 350 before this: the ledger named am-1, am-1 was gone, and 150 rounds the
  // shooter owns were never handed back to anything.
  assert.equal(await quantityOf('am-2'), 500, 'the rounds go back to the can they are off now');
});

test('a session moved onto another can hands the rounds back to THAT can', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 200));
  await putOne('ammunition', can('am-2', 500));
  await commitImportBatch({
    batchId: 'b-repoint', filename: 'log.csv',
    sessions: [sessionUsing('se-rp', 'b-repoint', 'am-1', 150)],
    firearms: [gun('fa-b-repoint', 'b-repoint')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 50);

  // The shooter opens the imported session and picks a different can. That is
  // what SessionForm's save does: the old can is refunded, the new one deducted.
  const stored = (await getAll<Session>('sessions')).find((s) => s.id === 'se-rp');
  assert.ok(stored);
  await putOne('sessions', { ...stored, ammoUsage: [{ ammoId: 'am-2', rounds: 150 }] });
  await putOne('ammunition', can('am-1', 200));
  await putOne('ammunition', can('am-2', 350));

  await undoImportBatch('b-repoint');
  assert.equal(await quantityOf('am-2'), 500, 'measured at 350: the rounds are off am-2 now');
  assert.equal(await quantityOf('am-1'), 200, 'and the can they left is not credited twice');
});

test('a moved can is still held to what the commit could actually take', async () => {
  await clearAllData();
  // The clamp and the move at once: the can the import named held less than the
  // rows asked for, so 50 of the ask never came off anything and can never go
  // back, wherever the rest of the rounds have since been moved to.
  await putOne('ammunition', can('am-1', 100));
  await putOne('ammunition', can('am-2', 400));
  await commitImportBatch({
    batchId: 'b-mv-clamp', filename: 'log.csv',
    sessions: [sessionUsing('se-mv', 'b-mv-clamp', 'am-1', 150)],
    firearms: [gun('fa-b-mv-clamp', 'b-mv-clamp')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 0);

  // Combine am-1 into am-2: nothing left on am-1 to carry over, and the session
  // is repointed. The usage still reads 150 rounds; only 100 ever came off.
  const sessions = await getAll<Session>('sessions');
  const repointed = repointAmmoUsage(sessions, 'am-1', 'am-2').map((change) => ({
    ...sessions.find((s) => s.id === change.id)!, ammoUsage: change.ammoUsage,
  }));
  await applyAmmoMerge({
    keptCan: can('am-2', 400), sessions: repointed, purchases: [], deleteCanId: 'am-1',
  });

  await undoImportBatch('b-mv-clamp');
  assert.equal(await quantityOf('am-2'), 500, 'the 100 that came off go back, not the 150 asked for');
});

test('a PLANNED imported session moves no stock, in either direction', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 500));
  await commitImportBatch({
    batchId: 'b-planned', filename: 'log.csv',
    sessions: [sessionUsing('se-p1', 'b-planned', 'am-1', 100, true)],
    firearms: [gun('fa-b-planned', 'b-planned')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 500, 'a session you have not shot yet spends nothing');
  await undoImportBatch('b-planned');
  assert.equal(await quantityOf('am-1'), 500, 'and removing it hands nothing back');
});

test('a session already in the Trash is not refunded twice by undo', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 1000));
  await commitImportBatch({
    batchId: 'b-trashed-ammo', filename: 'log.csv',
    sessions: [sessionUsing('se-t1', 'b-trashed-ammo', 'am-1', 200)],
    firearms: [gun('fa-b-trashed-ammo', 'b-trashed-ammo')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 800);
  // Trashing a session hands its rounds back (src/ui/sessionDelete.ts), so the
  // stock is already whole. Undo must not hand them back a second time.
  const stored = (await getAll<Session>('sessions')).find((s) => s.id === 'se-t1');
  assert.ok(stored);
  await putOne('sessions', { ...stored, deletedAt: Date.now() });
  await putOne('ammunition', can('am-1', 1000));

  await undoImportBatch('b-trashed-ammo');
  assert.equal(await quantityOf('am-1'), 1000, 'no rounds may appear that were never fired');
});

test('an unstorable record rolls the ammunition deduction back with everything else', async () => {
  await clearAllData();
  await putOne('ammunition', can('am-1', 1000));
  const poisoned = { ...sessionUsing('se-bad', 'b-roll', 'am-1', 150), oops: () => {} } as unknown as Session;
  await assert.rejects(commitImportBatch({
    batchId: 'b-roll', filename: 'bad.csv',
    sessions: [poisoned], firearms: [gun('fa-b-roll', 'b-roll')],
    counts: COUNTS, now: 1,
  }));
  assert.equal(await quantityOf('am-1'), 1000, 'an import that never landed cannot have spent anything');
});

test('undoing an import that is already gone changes nothing and does not throw', async () => {
  await clearAllData();
  await importOne('b-once');
  await undoImportBatch('b-once');
  const result = await undoImportBatch('b-once');
  // attachedRemoved counts the timed-skill sets, malfunctions and photos that
  // went with the sessions; ammoLeftAlone says whether a can was deliberately
  // not touched. A second undo has nothing to do and nothing to explain.
  assert.deepEqual(result, {
    sessionsRemoved: 0, firearmsRemoved: 0, firearmsKept: [], attachedRemoved: 0,
    ammoLeftAlone: false,
  });
});

// ---------------------------------------------------------------------------
// The history is capped, so the ability to undo must not be capped with it
// ---------------------------------------------------------------------------

test('the 51st import does not make the 1st un-removable', async () => {
  await clearAllData();
  // THE CAN HOLDS LESS THAN THE FIRST IMPORT ASKS FOR. Seeded at 1000 against
  // 150 rounds, this test could not reach the defect at all: the clamp is the
  // only reason a rebuilt entry's missing ledger matters, and a roomy can never
  // clamps. 100 against 150 is the shape where it bites.
  await putOne('ammunition', can('am-1', 100));
  await commitImportBatch({
    batchId: 'b-old-1', filename: 'file-1.csv',
    sessions: [sessionUsing('se-b-old-1', 'b-old-1', 'am-1', 150)],
    firearms: [gun('fa-b-old-1', 'b-old-1')],
    counts: COUNTS, now: 1,
  });
  assert.equal(await quantityOf('am-1'), 0, 'the can gave up the 100 it had, not the 150 asked for');
  for (let i = 2; i <= 51; i++) await importOne(`b-old-${i}`, `file-${i}.csv`);

  const history = await getImportHistory();
  assert.ok(
    !history.some((e) => e.batchId === 'b-old-1'),
    'the cap is real: the oldest entry is pushed out of the stored list',
  );

  // Its records are still tagged, and undo works off the tag, so the ONLY thing
  // that was lost was the way to reach it. Rebuild it from the log itself.
  const sessions = await getAll<Session>('sessions');
  const firearms = await getAll<Firearm>('firearms');
  const recovered = batchesMissingFromHistory(sessions, firearms, history);
  const lost = recovered.find((e) => e.batchId === 'b-old-1');
  assert.ok(lost, 'an import that fell off the list is still offered');
  assert.equal(lost.counts.sessions, 1);
  assert.equal(lost.counts.firearms, 1);
  assert.equal(lost.filename, '', 'what was not kept is not invented');
  // The whole of the problem in one line: a rebuilt entry cannot carry a record
  // of what came off the cans, because nothing about the log holds one.
  assert.equal(lost.ammoDeducted, undefined);

  await putOne('meta', { key: 'csvImportHistory', value: [lost, ...history] });
  const result = await undoImportBatch('b-old-1');
  assert.ok(!has(await getAll('sessions'), 'se-b-old-1'), 'and removing it works');
  assert.ok(has(await getAll('sessions'), 'se-b-old-51'), 'the newer imports are untouched');

  // Measured at 150 before this: the fallback put the whole ASK back on a can
  // that had only ever given up 100, which is defect B a second time and 50
  // rounds out of nowhere. An entry with no record of what it took now changes
  // no count at all.
  assert.equal(await quantityOf('am-1'), 0, 'nothing may be invented from an entry that recorded nothing');
  assert.equal(result.ammoLeftAlone, true, 'and the screen is told, so it can say so');
});

test('an entry with no record of what it took says so only when a can was involved', async () => {
  await clearAllData();
  // The ordinary rebuilt entry: no ammunition anywhere in the import. There is
  // nothing to leave alone, so there is nothing to explain.
  await importOne('b-noammo');
  const history = await getImportHistory();
  const rebuilt = batchesMissingFromHistory(
    await getAll<Session>('sessions'), await getAll<Firearm>('firearms'), [],
  );
  assert.equal(rebuilt[0].ammoDeducted, undefined);
  await putOne('meta', { key: 'csvImportHistory', value: rebuilt });
  const result = await undoImportBatch('b-noammo');
  assert.equal(result.ammoLeftAlone, false);
  assert.equal(history.length, 1, 'the entry really had been replaced by the rebuilt one');
});

test('an import still in the history is not offered twice', async () => {
  await clearAllData();
  await importOne('b-listed');
  const history = await getImportHistory();
  const sessions = await getAll<Session>('sessions');
  const firearms = await getAll<Firearm>('firearms');
  assert.deepEqual(batchesMissingFromHistory(sessions, firearms, history), []);
});

test('hand-entered records carry no batch tag, so nothing is invented from them', async () => {
  await clearAllData();
  await putOne('sessions', session('se-hand-only', 'fa-hand', null));
  await putOne('firearms', gun('fa-hand', null));
  assert.deepEqual(
    batchesMissingFromHistory(
      await getAll<Session>('sessions'), await getAll<Firearm>('firearms'), [],
    ),
    [],
  );
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
