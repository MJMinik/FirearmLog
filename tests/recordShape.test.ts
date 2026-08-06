// The missing-field crash class (session 107, 6 Aug 2026).
//
// WHAT THIS GUARDS. `src/lib/types.ts` declares most record fields as a plain
// required `string`. Nothing enforced that: `parseFlog` passes `stores` through
// verbatim, so an older backup or an import that never set a field puts
// `undefined` where the type promises a string. Every screen then calls string
// methods on it — `.localeCompare` in a sort, `.startsWith` in a filter — and a
// TypeError in a React render path takes the WHOLE SCREEN down, not one row.
// The record is then neither editable nor deletable, because the screen that
// would edit it is the screen that died.
//
// MEASURED, not reasoned: seeding a match with no `date` produced
// "COULDN'T LOAD THIS SCREEN" and
// `TypeError: Cannot read properties of undefined (reading 'localeCompare')`
// from the Compete tab's list sort (round-4 cold audit of the Edit Match
// branch). A second instance sits on the same screen, in a filter
// rather than a sort — which is why the fix is at the read boundary and not at
// the sort.
//
// THE FIX UNDER TEST. `normalizeRecords` fills any missing plain-`string` field
// with `''` as records leave storage, so the type declaration finally tells the
// truth. Fields declared `string | null` are NOT touched: there, `null` means
// "not recorded" and `''` would be a different fact.
//
// EVERY TEST HERE WAS RUN AGAINST THE PRE-FIX TREE FIRST and observed to fail
// (see the differential run in the session notes). A regression test that has
// never failed proves nothing.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_SHAPE, normalizeRecord, normalizeRecords } from '../src/lib/recordShape.ts';
import { deleteOne, getAll, getOne, putOne, STORE_NAMES } from '../src/lib/db.ts';
import { formatDayKey } from '../src/lib/dates.ts';
import type { Match, Firearm, Session } from '../src/lib/types.ts';

// A record shaped the way a damaged restore actually delivers one: the id and
// stamps are present (IndexedDB could not store it otherwise) and the declared
// strings simply are not there.
const damagedMatch = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, createdAt: 1000, updatedAt: 2000, ...over }) as unknown as Match;

// ---------------------------------------------------------------------------
// 1. The two operations that actually crashed, run on a normalised record.
// ---------------------------------------------------------------------------

test('the Compete list sort survives a match with no date', () => {
  const rows = normalizeRecords<Match>('matches', [
    damagedMatch('m-1'),
    damagedMatch('m-2', { date: '2026-08-02' }),
  ]);
  assert.doesNotThrow(() => rows.sort((a, b) => b.date.localeCompare(a.date)));
});

test('the season filter survives a match with no date', () => {
  const rows = normalizeRecords<Match>('matches', [damagedMatch('m-1')]);
  // CompeteScreen.tsx:98 — a filter, not a sort. Guarding only the sort would
  // have left this live on the same screen, on the same record.
  assert.doesNotThrow(() => rows.filter((m) => m.date.startsWith('2026')));
});

test('a dateless match sorts to the BOTTOM of a newest-first list', () => {
  // Michael's decision 3a: bottom of the list, date shown blank. Honest,
  // undramatic, and the row stays reachable so he can open it and set a date.
  const rows = normalizeRecords<Match>('matches', [
    damagedMatch('m-blank'),
    damagedMatch('m-old', { date: '2025-01-01' }),
    damagedMatch('m-new', { date: '2026-08-02' }),
  ]).sort((a, b) => b.date.localeCompare(a.date));
  assert.deepEqual(rows.map((m) => m.id), ['m-new', 'm-old', 'm-blank']);
});

test('the raw, un-normalised record still throws — the guard is what is working', () => {
  // The proof that the three tests above are not passing for some other reason.
  // Without the boundary this is exactly what reached CompeteScreen, and it is
  // what a future change removing the normaliser would put back.
  // TWO records, deliberately: Array.prototype.sort never calls the comparator
  // on a one-element array, so a single damaged row cannot demonstrate the sort
  // crash. Written with one at first, and it passed while proving nothing —
  // which is the same shape as the negative assertion that stayed green for
  // three rounds on yesterday's branch. Left documented so it is not "tidied"
  // back to one.
  const raw = [damagedMatch('m-raw-1'), damagedMatch('m-raw-2')];
  assert.throws(() => raw.sort((a, b) => b.date.localeCompare(a.date)), TypeError);
  assert.throws(() => raw.filter((m) => m.date.startsWith('2026')), TypeError);
});

test('a blank date renders blank rather than as a word', () => {
  // Decision 3a asks for the date SHOWN BLANK. formatDayKey returns its input
  // unchanged when it is not a day-key, so '' formats to ''. Asserted here so a
  // future change to that fallback cannot quietly print "Invalid Date" on the
  // row this whole change exists to make visible.
  assert.equal(formatDayKey(''), '');
});

// ---------------------------------------------------------------------------
// 2. The narrow contract: fill plain strings, touch nothing else.
// ---------------------------------------------------------------------------

test('fills every plain-string field the model declares', () => {
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1'));
  for (const f of RECORD_SHAPE.matches.strings) {
    assert.equal((m as unknown as Record<string, unknown>)[f], '',
      `expected ${f} to be filled with an empty string`);
  }
});

test('leaves a string|null field alone — null is a different fact from empty', () => {
  // Firearm.serialNumber is `string | null`. null means "not recorded".
  // Rewriting it to '' would assert something the user never said.
  const f = normalizeRecord<Firearm>('firearms',
    { id: 'fa-1', createdAt: 1, updatedAt: 1, serialNumber: null } as unknown as Firearm);
  assert.equal(f.serialNumber, null);
});

test('leaves an absent optional field absent', () => {
  // Session.instructor is `instructor?: string`. Absent is its normal state;
  // creating the key would make every record claim to have an empty instructor.
  const s = normalizeRecord<Session>('sessions',
    { id: 's-1', createdAt: 1, updatedAt: 1 } as unknown as Session);
  assert.equal('instructor' in (s as unknown as Record<string, unknown>), false);
});

test('never overwrites a value that is present', () => {
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', {
    date: '2026-08-02', name: 'Gun Craft L1', division: 'Open',
  }));
  assert.equal(m.date, '2026-08-02');
  assert.equal(m.name, 'Gun Craft L1');
  assert.equal(m.division, 'Open');
});

test('a number where a string belongs KEEPS ITS VALUE as text', () => {
  // A hand-edited or foreign backup can carry a number where a string belongs, and
  // `20260802..localeCompare` throws exactly like undefined does. The first version
  // replaced it with '' — which fixed the crash by deleting the date. String() fixes
  // the crash and keeps the information. Add, never replace.
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { date: 20260802 }));
  assert.equal(m.date, '20260802');
  assert.doesNotThrow(() => m.date.startsWith('2026'));
});

test('an OBJECT where a string belongs is left alone rather than blanked', () => {
  // There is no honest string for an object. Blanking it would delete whatever it
  // was — and a normalised record can reach disk through the app's own
  // read-then-write paths, so the deletion would be permanent.
  const odd = { legacy: true };
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { name: odd }));
  assert.equal((m as unknown as Record<string, unknown>).name, odd);
});

test('returns the SAME object when nothing was missing — no needless copying', () => {
  // media records carry raw ArrayBuffers; cloning every read would be a real
  // cost on a large log for no benefit.
  const whole = {
    id: 'm-1', createdAt: 1, updatedAt: 1, date: '2026-08-02', name: 'x',
    matchType: 'USPSA', division: 'Open', powerFactor: 'Minor', firearmId: 'fa-1',
    practiScoreUrl: '', notes: '', stages: [],
  } as unknown as Match;
  assert.equal(normalizeRecord<Match>('matches', whole), whole);
});

// ---------------------------------------------------------------------------
// 3. Nested rows — a session's drills and a match's stages are records too.
// ---------------------------------------------------------------------------

test('normalises nested drill rows inside a session', () => {
  const s = normalizeRecord<Session>('sessions', {
    id: 's-1', createdAt: 1, updatedAt: 1,
    drills: [{ drillId: 'd-1' }],
  } as unknown as Session);
  const d = s.drills[0] as unknown as Record<string, unknown>;
  assert.equal(d.name, '');
  assert.equal(d.distance, '');
  assert.equal(d.notes, '');
});

test('normalises nested stage rows inside a match', () => {
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { stages: [{ stageNo: 1 }] }));
  assert.equal((m.stages[0] as unknown as Record<string, unknown>).notes, '');
});

// --- The three data-loss defects a cold audit found in the first version. ---
// Each of these passed as a "fix" and each destroyed information. They are the
// reason this module's one rule is ADD, NEVER REPLACE.

test('a nested value that is not an array is LEFT ALONE, not emptied', () => {
  // The worst of the three. A match whose `stages` arrived as a keyed object had
  // every stage — points, times, percentages — replaced with []. The blanked
  // record is what the next backup writes, so the loss was permanent.
  const asObject = { '0': { number: 1, points: 100, time: 12.5 } };
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { stages: asObject }));
  assert.equal(m.stages as unknown, asObject);
});

test('a nested ROW that is not an object is left alone, not replaced with blanks', () => {
  // A session whose drills arrived from an importer as bare name strings showed
  // two nameless rows where "Bill Drill" had been.
  const s = normalizeRecord<Session>('sessions', {
    id: 's-1', createdAt: 1, updatedAt: 1, drills: ['Bill Drill', 'El Presidente'],
  } as unknown as Session);
  assert.deepEqual(s.drills as unknown, ['Bill Drill', 'El Presidente']);
});

test('a good nested row beside a bad one is still normalised', () => {
  // Leaving the untouchable row alone must not stop the rest being repaired.
  const s = normalizeRecord<Session>('sessions', {
    id: 's-1', createdAt: 1, updatedAt: 1,
    guns: [{ firearmId: 'fa-1', rounds: 250 }, 'legacy-string', { rounds: 10 }],
  } as unknown as Session);
  const guns = s.guns as unknown as unknown[];
  assert.deepEqual(guns[0], { firearmId: 'fa-1', rounds: 250 });
  assert.equal(guns[1], 'legacy-string');
  assert.deepEqual(guns[2], { rounds: 10, firearmId: '' });
});

// --- Round two of the cold audit: what the round-one FIX broke. ---
// Guarding `typeof row !== 'object'` catches primitives only. Arrays, Dates, Maps
// and boxed primitives all pass that test and are destroyed by a spread. Every
// one of these survives IndexedDB's structured clone, so every one is storable.

test('a nested row stored as an ARRAY is left alone, not spread into an object', () => {
  const asArray = [['Stage 1', 45, 12.3]];
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { stages: asArray }));
  assert.deepEqual(m.stages as unknown, asArray);
  assert.equal(Array.isArray(m.stages[0]), true);
});

test('a nested row stored as a Date keeps its time', () => {
  // Measured before the fix: `{notes: ''}`. The timestamp was simply gone.
  const when = new Date('2026-08-02T12:00:00Z');
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { stages: [when] }));
  assert.equal((m.stages[0] as unknown as Date).getTime(), when.getTime());
});

test('a boxed String row is not exploded into numbered characters', () => {
  const boxed = new String('an imported note');
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { stages: [boxed] }));
  assert.equal(String(m.stages[0]), 'an imported note');
});

test('own properties on a nested ARRAY survive the repair', () => {
  // `arr.map()` drops them. Measured: `stages.importedFrom` was lost on read, and
  // the next backup wrote the loss.
  const stages: unknown[] = [{ number: 1 }];
  (stages as unknown as Record<string, unknown>).importedFrom = 'ps.csv';
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { stages }));
  assert.equal((m.stages as unknown as Record<string, unknown>).importedFrom, 'ps.csv');
  assert.equal((m.stages[0] as unknown as Record<string, unknown>).notes, '');
});

test('a boolean in a string field becomes text rather than crashing a screen', () => {
  // This one went back and forth twice and the reasoning is worth keeping. Leaving
  // it alone means `false.trim()` takes the screen down — the exact failure this
  // module exists to prevent. Converting means `String(false)` is the TRUTHY text
  // "false", so a render guard reading `if (rec.notes)` changes behaviour. Zero-crash
  // outranks a cosmetic surprise, and the surprise is visible and editable while the
  // dead screen is neither. No importer can produce a boolean here — all four coerce.
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { notes: false }));
  assert.equal(m.notes, 'false');
  assert.doesNotThrow(() => m.notes.trim());
});

test('a required STRING-UNION field is normalised — the live Gun Detail crash', () => {
  // `Firearm.category` is typed `GunCategory`, a union of string literals, not
  // `string`. `GunDetail.tsx:301` calls `gun.category.toLowerCase()`, so a restored
  // firearm with no category took that screen down — inside the very class this
  // boundary exists to close, and invisible to the first version of the build check,
  // which tested for the literal type `string`.
  const f = normalizeRecord<Firearm>('firearms',
    { id: 'fa-1', createdAt: 1, updatedAt: 1 } as unknown as Firearm);
  assert.equal(f.category as unknown, '');
  assert.doesNotThrow(() => (f.category as unknown as string).toLowerCase());
});

test('the inline-typed nested arrays a cold audit found uncovered are covered', () => {
  // `Session.ammoUsage` and `Reference.links` are typed inline rather than as named
  // interfaces, so the first version of the build check could not see them.
  const s = normalizeRecord<Session>('sessions', {
    id: 's-1', createdAt: 1, updatedAt: 1, ammoUsage: [{ rounds: 50 }],
  } as unknown as Session);
  assert.equal((s.ammoUsage[0] as unknown as Record<string, unknown>).ammoId, '');
});

// ---------------------------------------------------------------------------
// 4. The boundary itself: a damaged record read back through db.ts.
// ---------------------------------------------------------------------------

test('getAll returns a damaged record already normalised', async () => {
  await putOne('matches', damagedMatch('m-db-1'));
  await putOne('matches', damagedMatch('m-db-1b', { date: '2026-08-02' }));
  const rows = await getAll<Match>('matches');
  const row = rows.find((m) => m.id === 'm-db-1');
  assert.ok(row, 'the damaged record should still be readable');
  assert.equal(row.date, '');
  // TWO records at minimum, or Array.sort never calls the comparator and this
  // asserts nothing. A second damaged-record test made exactly that mistake and
  // was caught by an audit of the tests themselves.
  assert.ok(rows.length >= 2, 'the sort assertion is vacuous with fewer than two rows');
  assert.doesNotThrow(() => rows.sort((a, b) => b.date.localeCompare(a.date)));
});

test('getOne returns a damaged record already normalised', async () => {
  await putOne('matches', damagedMatch('m-db-2'));
  const row = await getOne<Match>('matches', 'm-db-2');
  assert.ok(row);
  assert.equal(row.name, '');
  assert.doesNotThrow(() => row.name.trim());
});

test('the damaged record can actually be DELETED', async () => {
  // The part that made this more than cosmetic: a record that crashes its own list
  // screen cannot be reached to be deleted. An earlier version of this test was
  // named for deletion and never deleted anything — it put a record and asserted it
  // was there, which is true of a record nobody can remove.
  await putOne('matches', damagedMatch('m-db-3'));
  assert.ok((await getAll<Match>('matches')).some((m) => m.id === 'm-db-3'));
  await deleteOne('matches', 'm-db-3');
  assert.equal((await getAll<Match>('matches')).some((m) => m.id === 'm-db-3'), false);
});

// ---------------------------------------------------------------------------
// 5. The keeper: the map must cover the model, or the build fails.
// ---------------------------------------------------------------------------

test('every persisted store has a shape entry', () => {
  for (const store of STORE_NAMES) {
    if (store === 'meta') continue; // a settings blob, not a record store
    assert.ok(store in RECORD_SHAPE, `${store} has no RECORD_SHAPE entry`);
  }
});

test('no shape entry names a store that does not exist', () => {
  for (const store of Object.keys(RECORD_SHAPE)) {
    assert.ok((STORE_NAMES as readonly string[]).includes(store), `${store} is not a real store`);
  }
});

test('id is deliberately NOT normalised', () => {
  // IndexedDB uses id as the key path, so a record without one could never have
  // been stored. Filling it with '' would invent a colliding key for a record
  // that cannot exist. Left out on purpose, and asserted so nobody "fixes" it.
  for (const shape of Object.values(RECORD_SHAPE)) {
    assert.equal(shape.strings.includes('id'), false);
  }
});

// ---------------------------------------------------------------------------
// 6. Gaps found by an audit OF THESE TESTS, not of the code.
//
// Each of these was a mutation that survived the whole suite: a one-line change
// to recordShape.ts that broke a documented behaviour while 1,024 tests stayed
// green. A contract clause with no test is a claim, not a guarantee.
// ---------------------------------------------------------------------------

test('a NULL field is filled — JSON has no other way to say "empty"', () => {
  // The surviving mutation: `if (value === undefined) return ''` (dropping the
  // null branch) passed every test, every E2E case and the build check. Every
  // damaged fixture used an ABSENT key; none used null. An exporter writing
  // `date: null` reaches `null.localeCompare` and throws identically.
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { date: null, name: null }));
  assert.equal(m.date, '');
  assert.equal(m.name, '');
  assert.doesNotThrow(() => m.date.startsWith('2026'));
});

test('a damaged NESTED row is repaired even when the top level is complete', () => {
  // The other surviving mutation: deleting the entire nested-completeness loop
  // also passed everything, because every nested fixture was ALSO missing a
  // top-level string, so the top-level branch did the repair and the nested check
  // was never what made the difference. This record's top level is whole.
  const whole = {
    id: 'm-1', createdAt: 1, updatedAt: 1, date: '2026-08-02', name: 'Complete',
    matchType: 'USPSA', division: 'Open', powerFactor: 'Minor', firearmId: 'fa-1',
    practiScoreUrl: '', notes: '',
    stages: [{ number: 1, points: 100 }],          // no `notes` key
  } as unknown as Match;
  const m = normalizeRecord<Match>('matches', whole);
  assert.notEqual(m, whole, 'a record with a damaged nested row is not whole');
  assert.equal((m.stages[0] as unknown as Record<string, unknown>).notes, '');
  assert.equal(m.date, '2026-08-02');
});

test('normalizeRecords returns the SAME array when nothing changed', () => {
  // Documented in the module and previously unasserted: mutating it to always
  // return the mapped copy survived the suite.
  const rows = [
    { id: 'm-1', createdAt: 1, updatedAt: 1, date: '2026-08-02', name: 'A', matchType: 'USPSA',
      division: 'Open', powerFactor: 'Minor', firearmId: 'fa-1', practiScoreUrl: '', notes: '',
      stages: [] },
  ] as unknown as Match[];
  assert.equal(normalizeRecords('matches', rows), rows);
});

test('a store with no shape entry is passed through untouched', () => {
  // `meta` holds a settings blob keyed by `key`, not records. Returning it
  // unchanged is deliberate; asserted so nobody adds an entry for it.
  const blob = { key: 'settings', value: { ownerName: 'Michael' } };
  assert.equal(normalizeRecord('meta', blob), blob);
});

test('every store in the shape map actually normalises a damaged record', () => {
  // Sixteen of the nineteen stores had no direct test — the map was trusted
  // because `matches` worked. This walks all of them from the map itself, so a
  // store added tomorrow is covered the day it is added.
  for (const [store, shape] of Object.entries(RECORD_SHAPE)) {
    const damaged = { id: `${store}-x`, createdAt: 1, updatedAt: 1 } as Record<string, unknown>;
    const fixed = normalizeRecord(store as keyof typeof RECORD_SHAPE, damaged) as Record<string, unknown>;
    for (const field of shape.strings) {
      assert.equal(fixed[field], '', `${store}.${field} was not normalised`);
    }
  }
});

test('every non-index own key on a nested array survives, including odd ones', () => {
  // Round four: the first index test was `/^\d+$/`, which treats '-1' and 'NaN' as
  // neither indices nor properties, so both were dropped. Unlikely in the wild and
  // still the exact data loss this loop exists to prevent.
  const stages: unknown[] = [{ number: 1 }];
  const extra = stages as unknown as Record<string, unknown>;
  extra.importedFrom = 'ps.csv';
  extra['-1'] = 'meta';
  extra.NaN = 'odd';
  extra['4294967296'] = 'past the index range';
  const m = normalizeRecord<Match>('matches', damagedMatch('m-1', { stages }));
  const out = m.stages as unknown as Record<string, unknown>;
  assert.equal(out.importedFrom, 'ps.csv');
  assert.equal(out['-1'], 'meta');
  assert.equal(out.NaN, 'odd');
  assert.equal(out['4294967296'], 'past the index range');
  assert.equal((m.stages[0] as unknown as Record<string, unknown>).notes, '');
});
