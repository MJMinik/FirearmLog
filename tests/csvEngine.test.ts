// The engine's one door, and the rules its words have to keep.
//
// Two of these guard copy rather than behaviour, because both were real
// findings on the earlier build: five em dashes reached user-facing strings,
// and one remedy line named an action that could not help the shooter it was
// shown to. Copy defects do not fail a type-check, so they get a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as engine from '../src/lib/import/csvEngine.ts';
import { parseCsv } from '../src/lib/import/csvParse.ts';
import { planImport } from '../src/lib/import/csvPlan.ts';
import { dateAmbiguityMessage } from '../src/lib/import/csvDates.ts';
import { strippedNote, parseLooseNumber } from '../src/lib/import/csvFields.ts';
import type { Firearm } from '../src/lib/types.ts';

const ENGINE_FILES = ['csvParse.ts', 'csvFields.ts', 'csvDates.ts', 'csvPlan.ts', 'csvEngine.ts'];

const sourceOf = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/lib/import/${name}`, import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------
// The API the design document names
// ---------------------------------------------------------------------------

test('the barrel exports the whole engine API', () => {
  for (const name of [
    'parseCsv', 'SESSION_FIELDS', 'guessMapping', 'parseLooseNumber',
    'matchGunRef', 'matchAmmoRef', 'analyseDateColumn', 'convertDateValue',
    'distinguishingDateSample', 'collectUnmatchedGunNames', 'planImport',
  ]) {
    assert.ok(name in engine, `${name} has to be reachable from the barrel`);
  }
});

test('the engine holds no storage and no browser code', () => {
  for (const name of ENGINE_FILES) {
    const src = sourceOf(name);
    assert.doesNotMatch(src, /indexedDB|from '\.\.\/db\.ts'/, `${name} must stay pure logic`);
    assert.doesNotMatch(src, /\bdocument\.|\bwindow\./, `${name} must not touch the DOM`);
  }
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** Every string this engine can put in front of a shooter, in one list. */
function everyMessage(): string[] {
  const messages: string[] = [
    dateAmbiguityMessage('order'),
    dateAmbiguityMessage('twoDigitYear'),
    dateAmbiguityMessage('contradiction'),
    strippedNote('Rounds', parseLooseNumber('150 rds')) ?? '',
  ];

  const gun: Firearm = {
    id: 'f1', createdAt: 0, updatedAt: 0, name: 'Apollo', manufacturer: '', model: '',
    caliber: '9mm', category: 'Pistol', serialNumber: null, dateAcquired: '',
    startingRoundCount: 0, photoIds: [], referenceId: null, notes: '',
  };

  // A file that goes wrong in every way the planner knows how to report.
  const text = 'Date,Gun,Rounds,Range fee,Ammo used\n'
    + '2026-03-04,Apollo,150,25,Federal\n'
    + '2026-03-04,Apollo,150,25,\n'
    + 'sometime,Apollo,-20,-5,\n'
    + '2026-03-06,Nobody knows,10,,\n'
    + '2026-03-07,Apollo,150 rds\n'
    + '2026-03-08,Skip me,10,,\n';
  const parsed = parseCsv(text);
  for (const p of parsed.problems) messages.push(p.message);
  messages.push(...parseCsv('').problems.map((p) => p.message));
  messages.push(...parseCsv('Date,Gun\n').problems.map((p) => p.message));

  const result = planImport(
    parsed,
    {
      assignments: ['date', 'gun', 'rounds', 'rangeFee', 'ammo'],
      dateFormat: 'ymd',
    },
    { firearms: [gun], sessions: [], ammunition: [] },
    { 'Skip me': { action: 'skip' } },
    (prefix) => `${prefix}-1`,
    0,
  );
  for (const p of result.problems) messages.push(p.message);
  for (const n of result.notes) messages.push(n.message);
  for (const s of result.skipped) messages.push(s.message);
  return messages;
}

test('the fixture behind the copy checks really does exercise every kind of message', () => {
  const messages = everyMessage();
  assert.ok(messages.length >= 12, `expected a full spread of messages, got ${messages.length}`);
  assert.ok(messages.every((m) => m.length > 0));
});

test('no em dash anywhere in the engine, source and messages alike', () => {
  // The app-wide '—' empty-value placeholder is a separate, established
  // convention elsewhere. Nothing newly written here uses one.
  for (const name of ENGINE_FILES) {
    assert.equal(sourceOf(name).includes('—'), false, `${name} has an em dash in it`);
  }
  for (const message of everyMessage()) {
    assert.equal(message.includes('—'), false, `em dash in a message: ${message}`);
  }
});

test('no message claims quality for the app', () => {
  const selfPraise = /\b(accurate|accurately|careful|carefully|smart|smartly|intelligent|expert|rigorous|precise|reliable|best.in.class|seamless)\b/i;
  for (const message of everyMessage()) {
    assert.doesNotMatch(message, selfPraise, `quality claim in a message: ${message}`);
  }
});

test('no message tells the shooter to do something that will not work', () => {
  // The one found by measurement: telling somebody with a uniform two-digit
  // year column to edit the file so the dates use one order. That file already
  // uses one order.
  assert.doesNotMatch(dateAmbiguityMessage('twoDigitYear'), /one order/i);
  assert.match(dateAmbiguityMessage('twoDigitYear'), /four-digit/i);
});

test('messages that name a line number name a real one', () => {
  const parsed = parseCsv('Date,Gun,Rounds\n2026-03-04,Apollo,150\n2026-03-05,Apollo\n');
  const lines = parsed.problems.filter((p) => p.row !== null).map((p) => p.line);
  assert.deepEqual(lines, [3]);
  for (const problem of parsed.problems) {
    const named = /Line (\d+)/.exec(problem.message);
    if (named) assert.equal(Number(named[1]), problem.line);
  }
});
