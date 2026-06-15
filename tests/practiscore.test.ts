import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePractiScore, countInDivision, SAMPLE_PRACTISCORE_CSV
} from '../src/lib/practiscore.ts';

test('parses the sample match metadata', () => {
  const m = parsePractiScore(SAMPLE_PRACTISCORE_CSV);
  assert.equal(m.name, 'Spring Classic USPSA Level 1');
  assert.equal(m.date, '2026-05-17');
  assert.equal(m.stageCount, 5);
  assert.equal(m.competitors.length, 5);
});

test("reads a competitor's row correctly (Michael)", () => {
  const m = parsePractiScore(SAMPLE_PRACTISCORE_CSV);
  const me = m.competitors.find((c) => c.name === 'Michael Minik');
  assert.ok(me, 'found Michael');
  assert.equal(me!.overallPlace, 3);
  assert.equal(me!.divisionPlace, 2);
  assert.equal(me!.division, 'Carry Optics');
  assert.equal(me!.classLetter, 'C');
  assert.equal(me!.powerFactor, 'Minor');
  assert.equal(me!.memberNumber, 'TY79901');
  assert.equal(me!.matchPercent, 84.98);
  assert.equal(me!.matchPoints, 612.34);
  assert.equal(me!.stages.length, 5);
  assert.deepEqual(me!.stages.map((s) => s.number), [1, 2, 3, 4, 5]);
  assert.equal(me!.stages[2].percent, 79.5); // Stage 3 %
});

test('division counts drive "X of Y" division place', () => {
  const m = parsePractiScore(SAMPLE_PRACTISCORE_CSV);
  assert.equal(countInDivision(m.competitors, 'Carry Optics'), 4);
  assert.equal(countInDivision(m.competitors, 'Limited'), 1);
  assert.equal(countInDivision(m.competitors, 'Open'), 0);
});

test('works without a metadata block (headers as first line)', () => {
  const csv = [
    'Place,Division,Name,Power Factor,Match %,Stage 1 %,Stage 2 %',
    '1,Open,Lee Park,Major,100.00,100.00,98.0',
    '2,Open,Bo Tran,Major,90.50,88,92',
  ].join('\n');
  const m = parsePractiScore(csv);
  assert.equal(m.name, '');
  assert.equal(m.date, '');
  assert.equal(m.competitors.length, 2);
  assert.equal(m.competitors[0].name, 'Lee Park');
  assert.equal(m.competitors[0].division, 'Open');
  assert.equal(m.competitors[0].matchPercent, 100);
  assert.equal(m.competitors[0].stages[1].percent, 98);
});

test('adapts to abbreviated / alternate headers', () => {
  const csv = [
    'Pos,Div,Competitor,PF,Final %,Stage 1',
    '1,CO,A Shooter,Minor,95.5,95.5',
  ].join('\n');
  const m = parsePractiScore(csv);
  const c = m.competitors[0];
  assert.equal(c.overallPlace, 1);
  assert.equal(c.division, 'CO');
  assert.equal(c.name, 'A Shooter');
  assert.equal(c.powerFactor, 'Minor');
  assert.equal(c.matchPercent, 95.5);
  assert.equal(c.stages[0].percent, 95.5);
});

test('handles quoted fields with commas', () => {
  const csv = [
    'Place,Division,Name,Match %',
    '1,Limited,"Smith, John",100.00',
  ].join('\n');
  const m = parsePractiScore(csv);
  assert.equal(m.competitors[0].name, 'Smith, John');
});

test('skips blank lines and rows with no name or place', () => {
  const csv = [
    'Place,Division,Name,Match %',
    '1,Open,Real Person,100',
    '',
    ',,,',
  ].join('\n');
  const m = parsePractiScore(csv);
  assert.equal(m.competitors.length, 1);
});

test('throws a plain-language error on non-PractiScore text', () => {
  assert.throws(() => parsePractiScore('just some random text\nwith no table'), /PractiScore/);
});
