// CAN A COSTS EXPORT BE MISTAKEN FOR A SESSION FILE?
//
// Raised as an unclosed SUSPECTED finding by the session-135 cold audit and
// measured here rather than reasoned about.
//
// Adding the "For which gun" picker gave the Costs CSV export a "Gun" column it
// never had. The session importer pre-fills its mapping by matching header names
// against a pattern registry, and the session importer's three REQUIRED fields
// are date, gun and rounds. Before this change a Costs export could not satisfy
// all three, because nothing in it matched /gun/ -- so the mapping screen
// blocked with a required field unmapped. Now it can, and the screen no longer
// blocks. The protection has moved from the screen down to the individual row.
//
// That is a real change in where the guard lives, so the guard needs a test at
// its new home. This one runs the REAL exporter, the REAL header guesser and the
// REAL planner end to end: nothing here is a hand-written fixture standing in
// for the thing it describes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvTable, buildLookup } from '../src/lib/csvTables.ts';
import type { CsvStores } from '../src/lib/csvTables.ts';
import { parseCsv } from '../src/lib/import/csvParse.ts';
import { guessMapping, SESSION_FIELDS, missingRequiredFields } from '../src/lib/import/csvFields.ts';
import { planImport } from '../src/lib/import/csvPlan.ts';
import type { Firearm, Purchase } from '../src/lib/types.ts';

const NOW = 1781200000000;
const base = { createdAt: 0, updatedAt: 0 };

const gun = (id: string, name: string): Firearm => ({
  ...base, id, name, manufacturer: '', model: '', caliber: '9mm', category: 'Pistol',
  serialNumber: null, dateAcquired: '', startingRoundCount: 0,
  photoIds: [], referenceId: null, notes: '',
});

const buy = (o: Partial<Purchase> & { id: string }): Purchase => ({
  ...base, date: '2026-03-04', category: 'Gear / Equipment', item: 'Thing',
  vendor: 'Shop', cost: 60, notes: '', ...o,
});

/** The three row shapes a real Costs export actually contains. */
function costsCsv(): string {
  const stores: CsvStores = {
    firearms: [gun('f1', 'Apollo')],
    purchases: [
      // Ammo: carries Rounds, and can never carry a gun (the picker is offered
      // on Gear / Equipment and Service / Repair only).
      buy({ id: 'p1', category: 'Ammo Purchase', item: '9mm case', rounds: 1000, cost: 220 }),
      // Gear linked to a gun: carries Gun, never Rounds.
      buy({ id: 'p2', category: 'Gear / Equipment', item: 'Holster', firearmId: 'f1' }),
      // Service linked to a gun: same shape.
      buy({ id: 'p3', category: 'Service / Repair', item: 'Trigger job', firearmId: 'f1', cost: 150 }),
      // Unlinked, no rounds.
      buy({ id: 'p4', category: 'Travel', item: 'Fuel', cost: 40 }),
    ],
  };
  return csvTable('purchases')!.toText(stores, buildLookup(stores));
}

test('the Costs export now DOES auto-map all three required session fields (the change)', () => {
  const parsed = parseCsv(costsCsv());
  const guesses = guessMapping(parsed.headers, SESSION_FIELDS);
  const assigned = guesses.map((g) => g.fieldKey);

  // Recorded so that if the export's headers ever change, this test says what
  // moved rather than silently passing for a new reason.
  assert.deepEqual(parsed.headers, ['Date', 'Category', 'Item', 'Vendor', 'Cost', 'Rounds', 'Gun', 'Notes']);
  assert.equal(assigned[parsed.headers.indexOf('Date')], 'date');
  assert.equal(assigned[parsed.headers.indexOf('Gun')], 'gun');
  assert.equal(assigned[parsed.headers.indexOf('Rounds')], 'rounds');

  // So the mapping screen no longer blocks. This is the finding, stated as a
  // fact rather than a worry.
  assert.deepEqual(missingRequiredFields(assigned, SESSION_FIELDS), [],
    'nothing required is unmapped any more, so the screen-level guard is gone');
});

test('...and the PLANNER refuses every row of it, so nothing is imported', () => {
  // The guard that actually matters now. Each row is missing whichever required
  // field the other row shape carries: an ammo row has Rounds but no Gun, a gear
  // or service row has a Gun but no Rounds, and an unlinked row has neither.
  const parsed = parseCsv(costsCsv());
  const guesses = guessMapping(parsed.headers, SESSION_FIELDS);
  const result = planImport(
    parsed,
    { assignments: guesses.map((g) => g.fieldKey), dateFormat: 'ymd' },
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
    {},
    (p: string) => `${p}-1`,
    NOW,
    {},
  );

  assert.equal(result.sessions.length, 0, 'a costs file must never become sessions');
  assert.equal(result.rowsPlanned, 0);
  assert.equal(result.rowsFailed, 4, 'every row is refused, and refused individually');
  assert.equal(result.firearms.length, 0, 'and no gun is invented from a costs file');
});

test('the refusal is per-row, not luck: a row carrying BOTH would be planned', () => {
  // The honest boundary of the guard above, stated so nobody mistakes it for a
  // rule about costs files as such. Nothing in a real Costs export carries both
  // a Gun and a Rounds value -- an Ammo Purchase cannot be gun-linked and a gear
  // or service purchase has no rounds -- but the planner is deciding row by row,
  // not recognising the file. If those two facts about Purchase ever change,
  // this test is where it shows.
  const parsed = parseCsv('Date,Category,Item,Vendor,Cost,Rounds,Gun,Notes\n2026-03-04,Ammo Purchase,9mm case,Shop,220,1000,Apollo,\n');
  const guesses = guessMapping(parsed.headers, SESSION_FIELDS);
  const result = planImport(
    parsed,
    { assignments: guesses.map((g) => g.fieldKey), dateFormat: 'ymd' },
    { firearms: [gun('f1', 'Apollo')], sessions: [] },
    {},
    (p: string) => `${p}-1`,
    NOW,
    {},
  );
  assert.equal(result.sessions.length, 1,
    'a row with a date, a gun and a round count IS a session as far as the planner can tell');
});
