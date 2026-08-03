import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CSV_TABLES, csvTable, buildLookup, ammoLabel, expandSessions, expandDrillResults,
} from '../src/lib/csvTables.ts';
import type { CsvStores } from '../src/lib/csvTables.ts';
import type { Firearm, Session, Ammunition, Magazine } from '../src/lib/types.ts';

const base = { createdAt: 0, updatedAt: 0 };

const gun = (id: string, name: string): Firearm => ({
  ...base, id, name, manufacturer: '', model: '', caliber: '9mm', category: 'Pistol',
  serialNumber: 'SECRET-123', dateAcquired: '', startingRoundCount: 0,
  photoIds: [], referenceId: null, notes: '',
} as Firearm);

const ammo = (id: string, brand: string): Ammunition => ({
  ...base, id, brand, caliber: '9mm', grain: '124', bulletType: 'FMJ',
  quantity: 100, costPerRound: 0.2, notes: '',
} as Ammunition);

const mag = (id: string, label: string): Magazine => ({
  ...base, id, label, firearmIds: [], active: true, totalRounds: 0,
  springHistory: [], notes: '',
} as Magazine);

const session = (o: Partial<Session>): Session => ({
  ...base, id: 's1', date: '2026-08-02', type: 'practice', guns: [], location: '',
  distances: '', notes: '', ammoUsage: [], drills: [], targetMediaIds: [],
  malfunctions: [], selfRating: null, rangeFee: null, planned: false, checklist: null,
  ...o,
} as Session);

// ---------------------------------------------------------------------------
// Lookups — a reference exports as a NAME
// ---------------------------------------------------------------------------

test('a gun reference exports as the gun name, not the id', () => {
  const stores: CsvStores = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [session({ guns: [{ firearmId: 'f1', rounds: 300 }] })],
  };
  const text = csvTable('sessions')!.toText(stores, buildLookup(stores));
  assert.ok(text.includes('Apollo'), 'expected the gun NAME in the file');
  assert.ok(!text.includes('f1'), 'the raw id must not appear');
});

test('a DANGLING reference exports as an empty cell, never a raw id', () => {
  const stores: CsvStores = {
    firearms: [],
    sessions: [session({ guns: [{ firearmId: 'gone', rounds: 50 }] })],
  };
  const text = csvTable('sessions')!.toText(stores, buildLookup(stores));
  assert.ok(!text.includes('gone'), 'a dangling id must not leak into the file');
  // The row still exports — losing a session because its gun was deleted would
  // be worse than an empty cell.
  assert.ok(text.includes('2026-08-02'));
  assert.ok(text.includes('50'));
});

test('ammunition gets a composed label because it has no name field', () => {
  assert.equal(ammoLabel({ brand: 'Blazer', caliber: '9mm', grain: '124', bulletType: 'FMJ' }),
    'Blazer 9mm 124gr FMJ');
  // Missing pieces simply drop out rather than leaving gaps or the word undefined.
  assert.equal(ammoLabel({ brand: 'Blazer', caliber: '', grain: '', bulletType: '' }), 'Blazer');
});

test('buildLookup resolves ammo and magazines too', () => {
  const lk = buildLookup({ ammunition: [ammo('a1', 'Blazer')], magazines: [mag('m1', 'Mag 3')] });
  assert.equal(lk.ammoName('a1'), 'Blazer 9mm 124gr FMJ');
  assert.equal(lk.magLabel('m1'), 'Mag 3');
  assert.equal(lk.gunName('anything'), '');
  assert.equal(lk.ammoName(null), '');
  assert.equal(lk.ammoName(undefined), '');
});

// ---------------------------------------------------------------------------
// One row = one session with one gun
// ---------------------------------------------------------------------------

test('a two-gun session expands into TWO rows, numbered so it does not read as a duplicate', () => {
  const rows = expandSessions([session({
    guns: [{ firearmId: 'f1', rounds: 200 }, { firearmId: 'f2', rounds: 100 }],
  })]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.gun.rounds), [200, 100]);
  assert.deepEqual(rows.map((r) => `${r.gunIndex} of ${r.gunCount}`), ['1 of 2', '2 of 2']);
});

test('a one-gun session leaves the "guns in session" cell blank', () => {
  const stores: CsvStores = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [session({ guns: [{ firearmId: 'f1', rounds: 300 }] })],
  };
  const text = csvTable('sessions')!.toText(stores, buildLookup(stores));
  assert.ok(!text.includes(' of 1'), 'a single-gun session should say nothing about counts');
});

test('a session with NO gun still exports rather than vanishing', () => {
  const rows = expandSessions([session({ guns: [] })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gun.rounds, 0);
});

// ---------------------------------------------------------------------------
// The Trash must never be exported
// ---------------------------------------------------------------------------

test('a session in the Trash is excluded from the export', () => {
  const stores: CsvStores = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [
      session({ id: 'live', guns: [{ firearmId: 'f1', rounds: 300 }] }),
      session({ id: 'dead', date: '2026-07-01', deletedAt: 123, guns: [{ firearmId: 'f1', rounds: 999 }] }),
    ],
  };
  const t = csvTable('sessions')!;
  const text = t.toText(stores, buildLookup(stores));
  assert.ok(!text.includes('999'), 'a deleted session must not appear in the file');
  assert.ok(!text.includes('2026-07-01'));
  assert.equal(t.count(stores), 1);
  // Why this matters: a record in the Trash is already hidden from every list,
  // chart and round count in the app. Exporting it would hand the user rows
  // they believe they deleted.
});

test('drill results from a trashed session are excluded FROM THE FILE, not just the count', () => {
  const stores: CsvStores = {
    sessions: [session({ id: 'dead', deletedAt: 1, drills: [
      { name: 'GHOST-DRILL', distance: '7', time: 3.2, score: null, maxScore: null, notes: '' },
    ] })],
  };
  const t = csvTable('drill-results')!;
  // Asserting the COUNT alone is what let a sibling bug ship: a cold audit
  // sabotaged toText to skip the filter and all fourteen tests still passed,
  // because none of them read the file. Every exclusion test in this file now
  // asserts on the text.
  assert.ok(!t.toText(stores, buildLookup(stores)).includes('GHOST-DRILL'));
  assert.equal(t.count(stores), 0);
});

test('a malfunction filed against a TRASHED session is excluded from the file', () => {
  // The bug this replaces: `live()` was applied to sessions only, so deleting a
  // session made its malfunction vanish from every screen in the app and stay
  // in the export. Somebody could email that file to a gunsmith.
  const stores: CsvStores = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [
      session({ id: 'liveS' }),
      session({ id: 'deadS', deletedAt: 99 }),
    ],
    malfunctions: [
      { ...base, id: 'm1', sessionId: 'liveS', date: '2026-08-02', firearmId: 'f1',
        type: 'Failure to feed', resolution: 'Tap rack', notes: 'KEEP-ME' },
      { ...base, id: 'm2', sessionId: 'deadS', date: '2026-07-01', firearmId: 'f1',
        type: 'Squib', resolution: 'Stopped', notes: 'SHOULD-BE-GONE' },
    ] as CsvStores['malfunctions'],
  };
  const t = csvTable('malfunctions')!;
  const text = t.toText(stores, buildLookup(stores));
  assert.ok(text.includes('KEEP-ME'));
  assert.ok(!text.includes('SHOULD-BE-GONE'));
  assert.equal(t.count(stores), 1);
});

test('a malfunction belonging to NO session is kept', () => {
  const stores: CsvStores = {
    sessions: [session({ id: 'deadS', deletedAt: 99 })],
    malfunctions: [
      { ...base, id: 'm3', sessionId: null, date: '2026-08-02', firearmId: '',
        type: 'Light strike', resolution: '', notes: 'STANDALONE' },
    ] as CsvStores['malfunctions'],
  };
  assert.ok(csvTable('malfunctions')!.toText(stores, buildLookup(stores)).includes('STANDALONE'));
});

// ---------------------------------------------------------------------------
// Malformed records must not take the export down
// ---------------------------------------------------------------------------

test('EVERY array field on a session can be the wrong shape without throwing', () => {
  // Imported records are stored verbatim, so a legacy or hand-edited record can
  // hold an object where an array belongs. This threw inside count(), which the
  // screen calls during render, so one odd record replaced the whole screen.
  //
  // Driven off the FIELD LIST rather than one hand-picked field. The first
  // version of this test set only `guns`, and a cold audit found `drills` still
  // unguarded underneath it — a sabotage matrix proves the tests guard what was
  // written and says nothing about what was forgotten, so the loop is the fix.
  const arrayFields = ['guns', 'drills', 'ammoUsage', 'targetMediaIds', 'malfunctions'] as const;
  for (const field of arrayFields) {
    for (const junk of [{ nope: 1 }, 'string', 42, null]) {
      const broken = session({ [field]: junk } as unknown as Partial<Session>);
      const stores: CsvStores = { sessions: [broken] };
      for (const t of CSV_TABLES) {
        assert.doesNotThrow(() => t.count(stores),
          `${t.key} threw on count() with ${field} = ${JSON.stringify(junk)}`);
        assert.doesNotThrow(() => t.toText(stores, buildLookup(stores)),
          `${t.key} threw on toText() with ${field} = ${JSON.stringify(junk)}`);
      }
    }
  }
});

test('a timed-skill set from a TRASHED session is excluded from the file', () => {
  // The same defect as the malfunctions one, and it shipped INSIDE the fix for
  // it: this table was added in the same change and did not inherit the filter.
  // Every store carrying a sessionId needs the trash check, and that list is
  // checked against the data model, not against memory.
  const stores = {
    sessions: [session({ id: 'liveS' }), session({ id: 'deadS', deletedAt: 7 })],
    skillSets: [
      { ...base, id: 'ss1', sessionId: 'liveS', date: '2026-08-02', skill: 'draw',
        firearmId: '', dryFire: true, count: 5, bestSec: 1.2, cold: false, notes: 'KEEP-ME' },
      { ...base, id: 'ss2', sessionId: 'deadS', date: '2026-07-01', skill: 'draw',
        firearmId: '', dryFire: true, count: 10, bestSec: 0.99, cold: false, notes: 'SHOULD-BE-GONE' },
    ],
  } as unknown as CsvStores;
  const t = csvTable('timed-skills')!;
  const text = t.toText(stores, buildLookup(stores));
  assert.ok(text.includes('KEEP-ME'));
  assert.ok(!text.includes('SHOULD-BE-GONE'));
  assert.equal(t.count(stores), 1);
});

test('the Skill column reads the way the app labels it, not the raw enum', () => {
  const stores = {
    sessions: [session({ id: 'liveS' })],
    skillSets: [{ ...base, id: 'ss1', sessionId: 'liveS', date: '2026-08-02', skill: 'split',
      firearmId: '', dryFire: false, count: 1, bestSec: 0.18, cold: false, notes: '' }],
  } as unknown as CsvStores;
  const text = csvTable('timed-skills')!.toText(stores, buildLookup(stores));
  assert.ok(!/,split,/.test(text), 'the raw enum value should not reach the file');
});

test('a NULL entry inside a store does not throw', () => {
  const stores = {
    firearms: [null, gun('f1', 'Apollo')],
    sessions: [null, session({ guns: [{ firearmId: 'f1', rounds: 10 }] })],
    ammunition: [null],
    magazines: [undefined],
  } as unknown as CsvStores;
  for (const t of CSV_TABLES) {
    assert.doesNotThrow(() => t.count(stores), `${t.key} threw on count()`);
    const text = t.toText(stores, buildLookup(stores));
    assert.ok(text.length > 0, `${t.key} produced nothing`);
  }
  assert.equal(csvTable('firearms')!.count(stores), 1);
});

test('a store that is not an array at all does not throw', () => {
  const stores = { sessions: {}, firearms: 'nope', purchases: null } as unknown as CsvStores;
  for (const t of CSV_TABLES) {
    assert.doesNotThrow(() => t.count(stores), `${t.key} threw`);
    assert.equal(t.count(stores), 0);
  }
});

// ---------------------------------------------------------------------------
// A dangling reference loses the NAME, never the fact
// ---------------------------------------------------------------------------

test('ammo used keeps its round count when the ammunition record is gone', () => {
  const stores: CsvStores = {
    firearms: [gun('f1', 'Apollo')],
    ammunition: [],
    sessions: [session({
      guns: [{ firearmId: 'f1', rounds: 300 }],
      ammoUsage: [{ ammoId: 'deleted', rounds: 150 }],
    })],
  };
  const text = csvTable('sessions')!.toText(stores, buildLookup(stores));
  // Dropping the cell entirely used to lose the 150 silently, so a 300-round
  // session accounted for none of it and an ammo reconciliation came out wrong.
  assert.ok(text.includes('150'), 'the rounds fired must survive the deleted can');
  assert.ok(!text.includes('deleted'), 'but not the raw id');
});

// ---------------------------------------------------------------------------
// The two skill tables
// ---------------------------------------------------------------------------

test('timed skills export their individual rep times, not just best and typical', () => {
  const stores = {
    firearms: [gun('f1', 'Apollo')],
    skillSets: [{ ...base, id: 'k1', sessionId: 's1', date: '2026-08-02', skill: 'draw',
      firearmId: 'f1', dryFire: true, count: 3, bestSec: 1.11, typicalSec: 1.3,
      parSec: 1.5, cold: false, repTimesSec: [1.4, 1.2, 1.11], notes: '' }],
  } as unknown as CsvStores;
  const text = csvTable('timed-skills')!.toText(stores, buildLookup(stores));
  assert.ok(text.includes('1.11'));
  assert.ok(text.includes('1.4; 1.2; 1.11'), 'every rep, so the distribution survives');
  assert.ok(text.includes('Apollo'));
});

test('skill ratings get ONE COLUMN PER AREA so a spreadsheet can chart them', () => {
  const stores = {
    skills: [{ ...base, id: 'a1', date: '2026-08-02',
      ratings: { draw: 5, accuracy: 7 }, notes: '' }],
  } as unknown as CsvStores;
  const text = csvTable('skill-ratings')!.toText(stores, buildLookup(stores));
  const [header, row] = text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  assert.ok(header.includes('Draw'));
  assert.ok(header.includes('Accuracy'));
  assert.ok(header.includes('Recoil Control'));
  const cells = row.split(',');
  assert.equal(cells[header.split(',').indexOf('Draw')], '5');
  assert.equal(cells[header.split(',').indexOf('Accuracy')], '7');
  // An unrated area is blank, not a zero — zero would be a rating.
  assert.equal(cells[header.split(',').indexOf('Movement')], '');
});

// ---------------------------------------------------------------------------
// Drill results are their own table
// ---------------------------------------------------------------------------

test('every drill in a session becomes its own row, carrying the session date', () => {
  const rows = expandDrillResults([session({ date: '2026-08-02', drills: [
    { name: 'Bill Drill', distance: '7', time: 3.2, score: 30, maxScore: 30, notes: '' },
    { name: 'Doubles', distance: '10', time: 1.8, score: null, maxScore: null, notes: '' },
  ] })]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.drill.name), ['Bill Drill', 'Doubles']);
  assert.ok(rows.every((r) => r.session.date === '2026-08-02'));
});

// ---------------------------------------------------------------------------
// Privacy and shape
// ---------------------------------------------------------------------------

test('a gun SERIAL NUMBER is never exported', () => {
  const stores: CsvStores = { firearms: [gun('f1', 'Apollo')] };
  const text = csvTable('firearms')!.toText(stores, buildLookup(stores));
  assert.ok(text.includes('Apollo'));
  assert.ok(!text.includes('SECRET-123'), 'the serial identifies a specific firearm and stays out');
  assert.ok(!/serial/i.test(text), 'not even the column header');
});

test('every table produces a header row on an empty log and none of them throw', () => {
  for (const t of CSV_TABLES) {
    const text = t.toText({}, buildLookup({}));
    assert.ok(text.length > 0, `${t.key} produced nothing`);
    assert.ok(text.trimEnd().split('\r\n').length === 1, `${t.key} should be header-only`);
    assert.equal(t.count({}), 0);
  }
});

test('every table has a unique key, a label and a one-line description', () => {
  const keys = new Set<string>();
  for (const t of CSV_TABLES) {
    assert.ok(!keys.has(t.key), `duplicate key ${t.key}`);
    keys.add(t.key);
    assert.ok(t.label.length > 0, `${t.key} has no label`);
    assert.ok(t.describes.length > 0, `${t.key} has no description`);
  }
  assert.equal(csvTable('nope'), undefined);
});

test('counts match the number of data rows the file actually contains', () => {
  const stores: CsvStores = {
    firearms: [gun('f1', 'Apollo'), gun('f2', 'Erebus')],
    sessions: [session({ guns: [{ firearmId: 'f1', rounds: 1 }, { firearmId: 'f2', rounds: 2 }] })],
  };
  for (const t of CSV_TABLES) {
    const lines = t.toText(stores, buildLookup(stores)).trimEnd().split('\r\n');
    assert.equal(lines.length - 1, t.count(stores), `${t.key}: count disagrees with the file`);
  }
  // The count is what the screen shows the user before they tap. If it can
  // disagree with the file, the screen is lying.
});
