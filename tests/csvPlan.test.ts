// Planner tests (design doc section 5, the planner list).
//
// The planner is the dry run: it writes nothing, and every record it says it
// WOULD create is checked here before any screen exists to show it. Several of
// these tests exist because an earlier build of this engine got the thing
// wrong by measurement, and the title says which.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/lib/import/csvParse.ts';
import { csvTable, buildLookup } from '../src/lib/csvTables.ts';
import type { CsvStores } from '../src/lib/csvTables.ts';
import {
  planImport, collectUnmatchedGunNames, sourceRowBag, skippedSummaryLines, ammoEffectLines,
} from '../src/lib/import/csvPlan.ts';
import type { ImportMapping, GunResolution, ExistingLog } from '../src/lib/import/csvPlan.ts';
import type { Ammunition, Firearm, Session } from '../src/lib/types.ts';

const NOW = 1781200000000;
const base = { createdAt: 0, updatedAt: 0 };

const gun = (id: string, name: string): Firearm => ({
  ...base, id, name, manufacturer: '', model: '', caliber: '9mm', category: 'Pistol',
  serialNumber: null, dateAcquired: '', startingRoundCount: 0,
  photoIds: [], referenceId: null, notes: '',
});

const ammo = (id: string, brand: string): Ammunition => ({
  ...base, id, brand, caliber: '9mm', grain: '124', bulletType: 'FMJ',
  quantity: 100, costPerRound: 0.2, notes: '',
});

const session = (o: Partial<Session>): Session => ({
  ...base, id: 's1', date: '2026-03-04', type: 'practice', guns: [], location: '',
  distances: '', notes: '', ammoUsage: [], drills: [], targetMediaIds: [],
  malfunctions: [], selfRating: null, rangeFee: null, planned: false, checklist: null,
  ...o,
});

/** Deterministic ids so a plan can be asserted on. */
function idMaker(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

const emptyLog: ExistingLog = { firearms: [], sessions: [] };

/** Map by header name, the way the mapping screen will hand it over. */
function mappingFor(headers: readonly string[], byHeader: Record<string, string>): ImportMapping {
  return {
    assignments: headers.map((h) => byHeader[h] ?? null),
    dateFormat: 'ymd',
  };
}

function plan(
  text: string,
  byHeader: Record<string, string>,
  log: ExistingLog = emptyLog,
  resolutions: Record<string, GunResolution> = {},
  options: Parameters<typeof planImport>[6] = {},
) {
  const parsed = parseCsv(text);
  return planImport(parsed, mappingFor(parsed.headers, byHeader), log, resolutions, idMaker(), NOW, options);
}

const SESSION_MAP = { Date: 'date', Gun: 'gun', Rounds: 'rounds' };

// ---------------------------------------------------------------------------
// One row is one session
// ---------------------------------------------------------------------------

test('one CSV row becomes one session with one gun', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(result.sessions[0].guns, [{ firearmId: 'f1', rounds: 150 }]);
  assert.equal(result.sessions[0].date, '2026-03-04');
  assert.equal(result.rowsPlanned, 1);
  assert.equal(result.rowsFailed, 0);
});

test('LOCKED: same-day rows are never merged into one multi-gun session', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-04,Vesta,80\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo'), gun('f2', 'Vesta')], sessions: [] },
  );
  assert.equal(result.sessions.length, 2, 'two rows, two sessions');
  assert.equal(result.sessions[0].guns.length, 1);
  assert.equal(result.sessions[1].guns.length, 1);
  assert.deepEqual(result.sessions.map((s) => s.date), ['2026-03-04', '2026-03-04']);
});

test('the whole row is carried in legacy.sourceRow on every planned session', () => {
  const result = plan(
    'Date,Gun,Rounds,Wind\n2026-03-04,Apollo,150,gusty\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  const legacy = result.sessions[0].legacy;
  assert.ok(legacy, 'every imported record keeps its source row');
  assert.deepEqual(legacy.sourceRow, {
    Date: '2026-03-04', Gun: 'Apollo', Rounds: '150', Wind: 'gusty',
  });
  assert.equal(legacy.source, 'csv');
  assert.equal(legacy.sourceLine, 2);
});

test('optional columns land where they belong', () => {
  const result = plan(
    'Date,Gun,Rounds,Location,Notes,Range fee,Type,Drills,Time,Score\n' +
    '2026-03-04,Apollo,150,Rio,good day,$25.00,dry fire,Bill Drill,2.8,29\n',
    {
      Date: 'date', Gun: 'gun', Rounds: 'rounds', Location: 'location', Notes: 'notes',
      'Range fee': 'rangeFee', Type: 'type', Drills: 'drillName', Time: 'drillTime', Score: 'drillScore',
    },
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  const s = result.sessions[0];
  assert.equal(s.location, 'Rio');
  assert.equal(s.notes, 'good day');
  assert.equal(s.rangeFee, 25);
  assert.equal(s.type, 'dry_fire');
  assert.deepEqual(s.drills, [{ name: 'Bill Drill', distance: '', time: 2.8, score: 29, maxScore: null, notes: '' }]);
});

test('a stripped unit is reported as a note, not swallowed', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150 rds\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions[0].guns[0].rounds, 150);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0].message, /read "150 rds" as 150/);
});

test('ammunition is matched by name, and an unknown can is reported without failing the row', () => {
  const log: ExistingLog = { firearms: [gun('f1', 'Apollo')], sessions: [], ammunition: [ammo('a1', 'Blazer')] };
  const matched = plan(
    'Date,Gun,Rounds,Ammo used\n2026-03-04,Apollo,150,blazer\n',
    { ...SESSION_MAP, 'Ammo used': 'ammo' }, log,
  );
  assert.deepEqual(matched.sessions[0].ammoUsage, [{ ammoId: 'a1', rounds: 150 }]);

  const unknown = plan(
    'Date,Gun,Rounds,Ammo used\n2026-03-04,Apollo,150,Federal\n',
    { ...SESSION_MAP, 'Ammo used': 'ammo' }, log,
  );
  assert.deepEqual(unknown.sessions[0].ammoUsage, []);
  assert.equal(unknown.rowsFailed, 0, 'an unknown can is a note, not a lost row');
  assert.match(unknown.notes[0].message, /Federal/);
});

// ---------------------------------------------------------------------------
// GUARD: the form's own rules for rounds and fees
// ---------------------------------------------------------------------------

test('GUARD: a negative round count is that ROW\'s problem, not a silent import', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-05,Apollo,-20\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 1, 'the healthy row still imports');
  assert.equal(result.rowsFailed, 1);
  assert.equal(result.problems[0].line, 3);
  assert.match(result.problems[0].message, /whole numbers, zero or more/);
  // Nothing negative reaches a record, where it would subtract from lifetime
  // round totals, costs and maintenance-due.
  assert.ok(result.sessions.every((s) => s.guns.every((g) => g.rounds >= 0)));
});

test('GUARD: a fractional round count is refused the same way hand entry refuses it', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150.5\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 0);
  assert.equal(result.rowsFailed, 1);
  assert.match(result.problems[0].message, /whole numbers/);
});

test('GUARD: a negative range fee is refused, because it would subtract from costs', () => {
  const result = plan(
    'Date,Gun,Rounds,Range fee\n2026-03-04,Apollo,150,-25\n',
    { ...SESSION_MAP, 'Range fee': 'rangeFee' },
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 0);
  assert.match(result.problems[0].message, /zero or more/);
});

test('a fee of zero is a real fee and imports', () => {
  const result = plan(
    'Date,Gun,Rounds,Range fee\n2026-03-04,Apollo,150,0\n',
    { ...SESSION_MAP, 'Range fee': 'rangeFee' },
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions[0].rangeFee, 0);
});

test('a round count past the magnitude cap is refused rather than stored', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,99999999\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 0);
  assert.match(result.problems[0].message, /not a round count we can read/);
});

// ---------------------------------------------------------------------------
// GUARD: counting failed rows
// ---------------------------------------------------------------------------

test('GUARD: a row with three things wrong counts as ONE failed row', () => {
  const result = plan(
    'Date,Gun,Rounds,Range fee\n' +
    'not a date,Apollo,-20,-5\n' +
    '2026-03-05,Apollo,150,10\n',
    { ...SESSION_MAP, 'Range fee': 'rangeFee' },
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.problems.filter((p) => p.row === 0).length, 3, 'all three faults are listed');
  assert.equal(result.rowsFailed, 1, 'but the shooter has one row to look at');
  assert.equal(result.rowsPlanned, 1);
  assert.equal(result.rowsTotal, 2);
});

test('a ragged row fails once, with its line number, and the file still imports', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-05,Apollo\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 1);
  assert.equal(result.rowsFailed, 1);
  assert.equal(result.problems[0].line, 3);
});

test('an unreadable date is that row\'s problem, never a silent blank', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\nsometime,Apollo,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 1);
  assert.ok(result.sessions.every((s) => s.date !== ''));
  assert.match(result.problems[0].message, /"sometime" is not a date/);
});

// ---------------------------------------------------------------------------
// Guns that are not in the log yet
// ---------------------------------------------------------------------------

test('unmatched gun names are collected once each, not once per row', () => {
  const parsed = parseCsv(
    'Date,Gun,Rounds\n2026-03-04,G34 Competition,150\n2026-03-05,g34   competition,80\n2026-03-06,Apollo,50\n',
  );
  const names = collectUnmatchedGunNames(
    parsed,
    mappingFor(parsed.headers, SESSION_MAP),
    [gun('f1', 'Apollo')],
  );
  assert.deepEqual(names, ['G34 Competition']);
});

test('GUARD: a created gun carries legacy.sourceRow too', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Mossberg 590,25\n',
    SESSION_MAP,
    emptyLog,
    { 'Mossberg 590': { action: 'create' } },
  );
  assert.equal(result.firearms.length, 1);
  const created = result.firearms[0];
  assert.equal(created.name, 'Mossberg 590');
  assert.equal(created.category, 'Shotgun', 'the category guess is reused, not reinvented');
  assert.ok(created.legacy, 'a created gun keeps its source row like every other imported record');
  assert.deepEqual(created.legacy.sourceRow, { Date: '2026-03-04', Gun: 'Mossberg 590', Rounds: '25' });
  assert.equal(result.sessions[0].guns[0].firearmId, created.id, 'the session points at the gun we planned');
});

test('a gun is created once however many rows name it', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,G34,150\n2026-03-05,g34,80\n',
    SESSION_MAP,
    emptyLog,
    { G34: { action: 'create' } },
  );
  assert.equal(result.firearms.length, 1);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0].guns[0].firearmId, result.sessions[1].guns[0].firearmId);
});

test('"it is this existing gun" points the rows at the gun they meant', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,G34,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Glock 34')], sessions: [] },
    { G34: { action: 'use', firearmId: 'f1' } },
  );
  assert.equal(result.firearms.length, 0, 'nothing new is created');
  assert.equal(result.sessions[0].guns[0].firearmId, 'f1');
});

test('"skip rows that use it" skips those rows without calling them failures', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-05,Borrowed rental,60\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
    { 'Borrowed rental': { action: 'skip' } },
  );
  assert.equal(result.sessions.length, 1);
  assert.equal(result.rowsFailed, 0);
  assert.equal(result.rowsSkipped, 1);
  assert.equal(result.skipped[0].reason, 'unknownGun');
});

test('an unknown gun with no decision made is a problem, not a guess', () => {
  const result = plan('Date,Gun,Rounds\n2026-03-04,Mystery,60\n', SESSION_MAP, emptyLog);
  assert.equal(result.sessions.length, 0);
  assert.match(result.problems[0].message, /not a gun in your log yet/);
});

test('a gun whose only rows failed is not created', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,New gun,-5\n',
    SESSION_MAP,
    emptyLog,
    { 'New gun': { action: 'create' } },
  );
  assert.equal(result.sessions.length, 0);
  assert.equal(result.firearms.length, 0, 'no gun is created for a row that cannot be imported');
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

test('two identical rows in the same file: the second is skipped and counted', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-04,Apollo,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(result.sessions.length, 1);
  assert.equal(result.duplicatesInFile, 1);
  assert.equal(result.skipped[0].reason, 'duplicateInFile');
});

test('a row already in the log is skipped by default and counted', () => {
  const log: ExistingLog = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [session({ date: '2026-03-04', guns: [{ firearmId: 'f1', rounds: 150 }] })],
  };
  const result = plan('Date,Gun,Rounds\n2026-03-04,Apollo,150\n', SESSION_MAP, log);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.duplicatesInLog, 1);
  assert.equal(result.skipped[0].reason, 'duplicateInLog');
  assert.match(result.skipped[0].message, /already in your log/);
});

test('the same row imports when the shooter switches duplicates back on', () => {
  const log: ExistingLog = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [session({ date: '2026-03-04', guns: [{ firearmId: 'f1', rounds: 150 }] })],
  };
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n', SESSION_MAP, log, {}, { includeDuplicates: true },
  );
  assert.equal(result.sessions.length, 1);
  assert.equal(result.duplicatesInLog, 1, 'still counted, so the count is honest either way');
  assert.equal(result.rowsSkipped, 0);
});

test('a different round count on the same day is not a duplicate', () => {
  const log: ExistingLog = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [session({ date: '2026-03-04', guns: [{ firearmId: 'f1', rounds: 150 }] })],
  };
  const result = plan('Date,Gun,Rounds\n2026-03-04,Apollo,200\n', SESSION_MAP, log);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.duplicatesInLog, 0);
});

test('a session in the trash does not make a row look like a duplicate', () => {
  const log: ExistingLog = {
    firearms: [gun('f1', 'Apollo')],
    sessions: [session({ date: '2026-03-04', guns: [{ firearmId: 'f1', rounds: 150 }], deletedAt: NOW })],
  };
  const result = plan('Date,Gun,Rounds\n2026-03-04,Apollo,150\n', SESSION_MAP, log);
  assert.equal(result.sessions.length, 1);
});

// ---------------------------------------------------------------------------
// GUARD: nothing from the file becomes a key we trust
// ---------------------------------------------------------------------------

test('GUARD: a hostile column name cannot poison a stored record', () => {
  const result = plan(
    'Date,Gun,Rounds,__proto__,constructor\n2026-03-04,Apollo,150,polluted,polluted\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  const bag = result.sessions[0].legacy?.sourceRow as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(bag, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bag, 'constructor'), false);
  assert.equal(Object.getPrototypeOf(bag), Object.prototype, 'the record\'s prototype is untouched');
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'nothing leaked onto every object');
  assert.equal(bag.Gun, 'Apollo', 'the honest columns are still there');
});

test('sourceRowBag drops the dangerous names and keeps everything else', () => {
  const bag = sourceRowBag(['Date', '__proto__', 'prototype', 'Gun'], ['2026-03-04', 'x', 'y', 'Apollo']);
  assert.deepEqual(Object.keys(bag), ['Date', 'Gun']);
});

test('values past the last header are kept rather than lost', () => {
  const bag = sourceRowBag(['Date', 'Gun'], ['2026-03-04', 'Apollo', 'stray']);
  assert.equal(bag['Extra value 1'], 'stray');
});

// ---------------------------------------------------------------------------
// Files the mapping cannot serve
// ---------------------------------------------------------------------------

test('a file with no rows plans nothing and says nothing went wrong with any row', () => {
  const result = plan('Date,Gun,Rounds\n', SESSION_MAP);
  assert.equal(result.rowsTotal, 0);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.rowsFailed, 0);
});

test('an unmapped required field is reported per row rather than crashing', () => {
  const result = plan('Date,Gun,Rounds\n2026-03-04,Apollo,150\n', { Date: 'date', Gun: 'gun' },
    { firearms: [gun('f1', 'Apollo')], sessions: [] });
  assert.equal(result.sessions.length, 0);
  assert.equal(result.rowsFailed, 1);
  assert.match(result.problems[0].message, /round count/);
});

test('a blank required cell is reported, and the advice it gives works', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.match(result.problems[0].message, /Put 0 in the file/);
  const fixed = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,0\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.equal(fixed.sessions[0].guns[0].rounds, 0, 'the advice has to actually work');
});

// ---------------------------------------------------------------------------
// The plan writes nothing
// ---------------------------------------------------------------------------

test('planning does not touch the log it was handed', () => {
  const firearms = [gun('f1', 'Apollo')];
  const sessions = [session({ date: '2026-03-04', guns: [{ firearmId: 'f1', rounds: 150 }] })];
  const before = JSON.stringify({ firearms, sessions });
  plan('Date,Gun,Rounds\n2026-03-09,Apollo,150\n', SESSION_MAP, { firearms, sessions });
  assert.equal(JSON.stringify({ firearms, sessions }), before);
});

// ---------------------------------------------------------------------------
// Round trip: what this app exports, this app can read back
// ---------------------------------------------------------------------------

test('a Sessions file this app EXPORTS imports back field for field', () => {
  const firearms = [gun('f1', 'Apollo')];
  const stores: CsvStores = {
    firearms,
    sessions: [
      session({
        id: 'x1', date: '2026-03-04', type: 'practice', guns: [{ firearmId: 'f1', rounds: 150 }],
        location: 'Rio', distances: '7, 15', notes: 'Windy, cold', rangeFee: 25,
      }),
      session({
        id: 'x2', date: '2026-03-05', type: 'dry_fire', guns: [{ firearmId: 'f1', rounds: 0 }],
        location: 'Home', notes: 'draws only', planned: true,
      }),
    ],
  };
  const text = csvTable('sessions')!.toText(stores, buildLookup(stores));

  const parsed = parseCsv(text);
  const mapping = mappingFor(parsed.headers, {
    Date: 'date', Type: 'type', Gun: 'gun', Rounds: 'rounds', Location: 'location',
    Distances: 'distances', 'Range fee': 'rangeFee', Instructor: 'instructor',
    Planned: 'planned', Notes: 'notes',
  });
  const result = planImport(parsed, mapping, { firearms, sessions: [] }, {}, idMaker(), NOW);

  assert.equal(result.rowsFailed, 0, result.problems.map((p) => p.message).join(' / '));
  assert.equal(result.sessions.length, 2);
  const back = result.sessions.map((s) => ({
    date: s.date, type: s.type, guns: s.guns, location: s.location,
    distances: s.distances, notes: s.notes, rangeFee: s.rangeFee, planned: s.planned,
  }));
  assert.deepEqual(back, [
    {
      date: '2026-03-04', type: 'practice', guns: [{ firearmId: 'f1', rounds: 150 }],
      location: 'Rio', distances: '7, 15', notes: 'Windy, cold', rangeFee: 25, planned: false,
    },
    {
      date: '2026-03-05', type: 'dry_fire', guns: [{ firearmId: 'f1', rounds: 0 }],
      location: 'Home', distances: '', notes: 'draws only', rangeFee: null, planned: true,
    },
  ]);
});

test('a two-gun day exports as two rows and comes back as two sessions', () => {
  // Not a defect: one row is one session, so the day arrives split and the
  // shooter can merge it by hand. The round counts still add up.
  const firearms = [gun('f1', 'Apollo'), gun('f2', 'Vesta')];
  const stores: CsvStores = {
    firearms,
    sessions: [session({ date: '2026-03-04', guns: [{ firearmId: 'f1', rounds: 150 }, { firearmId: 'f2', rounds: 80 }] })],
  };
  const text = csvTable('sessions')!.toText(stores, buildLookup(stores));
  const parsed = parseCsv(text);
  const result = planImport(
    parsed,
    mappingFor(parsed.headers, SESSION_MAP),
    { firearms, sessions: [] }, {}, idMaker(), NOW,
  );
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions.reduce((n, s) => n + s.guns[0].rounds, 0), 230);
});

test('every planned record is stamped with the time it was planned', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,New gun,25\n',
    SESSION_MAP, emptyLog, { 'New gun': { action: 'create' } },
  );
  assert.equal(result.sessions[0].createdAt, NOW);
  assert.equal(result.sessions[0].updatedAt, NOW);
  assert.equal(result.firearms[0].createdAt, NOW);
});

// ---------------------------------------------------------------------------
// Saying what the plan does, in numbers that add up
//
// The screen used to write this sentence itself, off the duplicate COUNTERS
// rather than the skipped LIST, and produced "1 rows skipped, including 1 that
// look like sessions already in your log and 1 that repeat an earlier row in
// the file" for a plan that skipped one row: 1 + 1 > 1, and neither named row
// was the one skipped. These come off the skipped list, so they cannot.
// ---------------------------------------------------------------------------

test('the skipped sentence names only rows that were actually skipped', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-04,Apollo,150\n2026-03-05,Ghost,50\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
    { Ghost: { action: 'skip' } },
  );
  const lines = skippedSummaryLines(result);
  assert.equal(result.rowsSkipped, 2);
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    '2 rows skipped: 1 that repeats an earlier row in this file and 1 using a gun name you chose to skip.',
  );
  // The arithmetic, checked rather than read: the numbers the sentence names
  // add up to the number it opens with.
  const named = [...lines[0].matchAll(/(\d+) that|(\d+) using/g)]
    .map((m) => Number(m[1] ?? m[2]))
    .reduce((a, b) => a + b, 0);
  assert.equal(named, result.rowsSkipped);
});

test('a duplicate the shooter asked for is not counted as skipped', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-04,Apollo,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
    {},
    { includeDuplicates: true },
  );
  assert.equal(result.rowsSkipped, 0);
  assert.deepEqual(skippedSummaryLines(result), [
    'Being added because you asked for them: 1 that repeats an earlier row in this file.',
  ]);
});

test('a log duplicate skipped by default is named as one', () => {
  const existing = session({ id: 'old', date: '2026-03-04', guns: [{ firearmId: 'f1', rounds: 150 }] });
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [existing] },
  );
  assert.deepEqual(skippedSummaryLines(result), [
    '1 row skipped: 1 that looks like a session already in your log.',
  ]);
});

test('a plan that skips nothing says nothing', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.deepEqual(skippedSummaryLines(result), []);
});

// ---------------------------------------------------------------------------
// What the import does to the cans, said before it happens
// ---------------------------------------------------------------------------

test('the ammunition line says what comes off and what is left', () => {
  const can = { ...ammo('am1', 'Range Brand'), quantity: 1000 };
  const result = plan(
    'Date,Gun,Rounds,Ammo\n2026-03-04,Apollo,150,Range Brand\n',
    { ...SESSION_MAP, Ammo: 'ammo' },
    { firearms: [gun('f1', 'Apollo')], sessions: [], ammunition: [can] },
  );
  const lines = ammoEffectLines(result.sessions, [can]);
  assert.match(lines[0], /150 rounds come off/);
  assert.match(lines[0], /leaving 850/);
  assert.equal(lines[1], 'Removing this import puts back what it took.');
});

// MEASURED FALSE, both sentences of it: a can of 100 that an import of 150
// empties was described as losing 150 and, in the next line, as getting 150
// back. It loses 100, and 100 is what comes back. The words move with the
// arithmetic because both now come from deductUsageFromStock.
test('a can with less in it than the rows ask for is described by what actually comes off', () => {
  const can = { ...ammo('am1', 'Range Brand'), quantity: 100 };
  const result = plan(
    'Date,Gun,Rounds,Ammo\n2026-03-04,Apollo,150,Range Brand\n',
    { ...SESSION_MAP, Ammo: 'ammo' },
    { firearms: [gun('f1', 'Apollo')], sessions: [], ammunition: [can] },
  );
  const lines = ammoEffectLines(result.sessions, [can]);
  assert.match(lines[0], /100 rounds come off/);
  assert.match(lines[0], /leaving 0/);
  assert.doesNotMatch(lines[0], /150/, 'the asking figure is not what comes off');
  // The shortfall is said out loud rather than left as a number that does not add up.
  assert.match(lines[1], /name 150 rounds for that can/);
  assert.match(lines[1], /50 more than it holds/);
  assert.equal(lines[2], 'Removing this import puts back what it took.');
});

test('a planned session moves no stock, and the line does not claim it does', () => {
  const can = { ...ammo('am1', 'Range Brand'), quantity: 1000 };
  const result = plan(
    'Date,Gun,Rounds,Ammo,Planned\n2026-03-04,Apollo,150,Range Brand,yes\n',
    { ...SESSION_MAP, Ammo: 'ammo', Planned: 'planned' },
    { firearms: [gun('f1', 'Apollo')], sessions: [], ammunition: [can] },
  );
  assert.deepEqual(ammoEffectLines(result.sessions, [can]), [
    'Your ammunition counts do not change: no row here names ammunition in your log.',
  ]);
});

test('rows naming no ammunition say so rather than saying nothing', () => {
  const result = plan(
    'Date,Gun,Rounds\n2026-03-04,Apollo,150\n',
    SESSION_MAP,
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
  );
  assert.deepEqual(ammoEffectLines(result.sessions, []), [
    'Your ammunition counts do not change: no row here names ammunition in your log.',
  ]);
});
