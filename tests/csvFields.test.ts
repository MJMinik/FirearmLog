// Field-registry, guess and value-reader tests (design doc section 5, the
// number-conversion list plus the mapping guesses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_FIELDS, guessMapping, missingRequiredFields, fieldByKey,
  parseLooseNumber, strippedNote, matchGunRef, matchAmmoRef,
} from '../src/lib/import/csvFields.ts';
import type { Ammunition, Firearm } from '../src/lib/types.ts';

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

const keysOf = (headers: string[]): (string | null)[] =>
  guessMapping(headers, SESSION_FIELDS).map((g) => g.fieldKey);

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test('the required session fields are date, gun and rounds', () => {
  const required = SESSION_FIELDS.filter((f) => f.required).map((f) => f.key);
  assert.deepEqual(required, ['date', 'gun', 'rounds']);
});

test('every field has a label and a plain-English description', () => {
  for (const field of SESSION_FIELDS) {
    assert.ok(field.label.length > 0, `${field.key} needs a label`);
    assert.ok(field.description.length > 0, `${field.key} needs a description`);
    assert.ok(field.matchPatterns.length > 0, `${field.key} needs header patterns`);
  }
  assert.equal(fieldByKey(SESSION_FIELDS, 'rounds')?.label, 'Rounds');
  assert.equal(fieldByKey(SESSION_FIELDS, null), null);
});

// ---------------------------------------------------------------------------
// Guessing the mapping
// ---------------------------------------------------------------------------

test('the obvious headers are guessed', () => {
  assert.deepEqual(
    keysOf(['Date', 'Gun', 'Rounds', 'Location', 'Notes']),
    ['date', 'gun', 'rounds', 'location', 'notes'],
  );
});

test('other apps\' names for the same thing are guessed too', () => {
  assert.deepEqual(
    keysOf(['Date Fired', 'Firearm', 'Rds', 'Range']),
    ['date', 'gun', 'rounds', 'location'],
  );
});

test('a column we do not recognise is left for the shooter to say', () => {
  const guesses = guessMapping(['Date', 'Wind call'], SESSION_FIELDS);
  assert.equal(guesses[1].fieldKey, null);
  assert.equal(guesses[1].guessed, false);
  assert.equal(guesses[0].guessed, true, 'a guess is marked as a guess');
});

test('an exact name beats a loose one, so the fee column does not land in Location', () => {
  const guesses = guessMapping(['Range fee', 'Location'], SESSION_FIELDS);
  assert.equal(guesses[0].fieldKey, 'rangeFee');
  assert.equal(guesses[1].fieldKey, 'location');
});

test('one field is claimed once, so a second lookalike column stays unmapped', () => {
  const guesses = guessMapping(['Gun', 'Guns in session'], SESSION_FIELDS);
  assert.equal(guesses[0].fieldKey, 'gun');
  assert.equal(guesses[1].fieldKey, null);
});

test('our own export headers map straight back onto our own fields', () => {
  // A file this app writes has to be a file this app can read.
  const exported = ['Date', 'Type', 'Gun', 'Rounds', 'Guns in session', 'Location',
    'Distances', 'Drills', 'Ammo used', 'Range fee', 'Instructor', 'Planned', 'Notes'];
  assert.deepEqual(keysOf(exported), [
    'date', 'type', 'gun', 'rounds', null, 'location',
    'distances', 'drillName', 'ammo', 'rangeFee', 'instructor', 'planned', 'notes',
  ]);
});

test('missing required fields are named, and go quiet once mapped', () => {
  const missing = missingRequiredFields(['date', null, 'notes'], SESSION_FIELDS).map((f) => f.label);
  assert.deepEqual(missing, ['Gun', 'Rounds']);
  assert.deepEqual(missingRequiredFields(['date', 'gun', 'rounds'], SESSION_FIELDS), []);
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

test('a plain number reads as itself', () => {
  assert.equal(parseLooseNumber('150').value, 150);
  assert.equal(parseLooseNumber(150).value, 150);
  assert.deepEqual(parseLooseNumber('150').stripped, []);
});

test('units are stripped AND reported', () => {
  const rounds = parseLooseNumber('150 rds');
  assert.equal(rounds.value, 150);
  assert.deepEqual(rounds.stripped, ['rds']);
  assert.equal(parseLooseNumber('25 yd').value, 25);
  assert.deepEqual(parseLooseNumber('25 yd').stripped, ['yd']);
  assert.equal(strippedNote('Rounds', rounds), 'Rounds: read "150 rds" as 150.');
  assert.equal(strippedNote('Rounds', parseLooseNumber('150')), null, 'nothing stripped, nothing to say');
});

test('currency, thousands separators and percent signs are read', () => {
  assert.equal(parseLooseNumber('$12.50').value, 12.5);
  assert.deepEqual(parseLooseNumber('$12.50').stripped, ['$']);
  assert.equal(parseLooseNumber('1,250').value, 1250);
  assert.deepEqual(parseLooseNumber('1,250').stripped, [',']);
  assert.equal(parseLooseNumber('92%').value, 92);
  assert.deepEqual(parseLooseNumber('92%').stripped, ['%']);
  assert.equal(parseLooseNumber('$1,250.75').value, 1250.75);
});

test('garbage is null, and NEVER a not-a-number', () => {
  for (const input of ['abc', '', '   ', 'n/a', '-', '.', null, undefined, 'twelve']) {
    const read = parseLooseNumber(input);
    assert.equal(read.value, null, `${String(input)} should read as no value`);
    assert.equal(Number.isNaN(read.value as unknown as number), false);
  }
});

test('the magnitude cap from csv.ts is kept, and junk is not quietly read as 1', () => {
  assert.equal(parseLooseNumber('1e308').value, null, 'scientific-notation junk stays refused');
  assert.equal(parseLooseNumber('99999999').value, null, 'past the cap');
  assert.equal(parseLooseNumber('9999999').value, 9999999, 'under the cap');
});

test('a negative number survives so the planner can refuse it in words', () => {
  assert.equal(parseLooseNumber('-5').value, -5);
  assert.equal(parseLooseNumber('-12.5').value, -12.5);
});

test('the raw cell is kept whatever happens to it', () => {
  assert.equal(parseLooseNumber(' 150 rds ').raw, ' 150 rds ');
  assert.equal(parseLooseNumber('abc').raw, 'abc');
});

// ---------------------------------------------------------------------------
// Matching guns and ammunition by name
// ---------------------------------------------------------------------------

test('a gun matches through case and spacing drift', () => {
  const firearms = [gun('f1', 'Apollo'), gun('f2', 'Glock 34')];
  assert.equal(matchGunRef('Apollo', firearms).id, 'f1');
  assert.equal(matchGunRef('  apollo ', firearms).id, 'f1');
  assert.equal(matchGunRef('GLOCK   34', firearms).id, 'f2');
  assert.equal(matchGunRef('Glock 34', firearms).matched, true);
});

test('a gun we do not have comes back unmatched, with the name as their file wrote it', () => {
  const result = matchGunRef(' G34 Competition ', [gun('f1', 'Apollo')]);
  assert.equal(result.matched, false);
  assert.equal(result.id, null);
  assert.equal(result.name, 'G34 Competition');
});

test('an empty name is not a match', () => {
  assert.equal(matchGunRef('', [gun('f1', 'Apollo')]).matched, false);
});

test('ammunition matches on the exported label or on the brand alone', () => {
  const cans = [ammo('a1', 'Blazer')];
  assert.equal(matchAmmoRef('Blazer 9mm 124gr FMJ', cans).id, 'a1');
  assert.equal(matchAmmoRef('blazer', cans).id, 'a1');
  assert.equal(matchAmmoRef('Federal', cans).matched, false);
});
