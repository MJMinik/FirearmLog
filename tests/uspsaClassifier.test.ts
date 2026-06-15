import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUspsaClassifiers, classifierKey, SAMPLE_USPSA_CSV
} from '../src/lib/uspsaClassifier.ts';

test('parses the sample USPSA classifier export', () => {
  const rows = parseUspsaClassifiers(SAMPLE_USPSA_CSV);
  assert.equal(rows.length, 7);
  const first = rows[0];
  assert.equal(first.date, '2025-09-14');
  assert.equal(first.code, '99-11');
  assert.equal(first.name, 'Down the Middle');
  assert.equal(first.division, 'Carry Optics');
  assert.equal(first.hitFactor, 7.1234);
  assert.equal(first.percent, 72.4);
});

test('captures a second division', () => {
  const rows = parseUspsaClassifiers(SAMPLE_USPSA_CSV);
  const ltd = rows.filter((r) => r.division === 'Limited');
  assert.equal(ltd.length, 1);
  assert.equal(ltd[0].code, '99-63');
});

test('adapts to alternate headers and % signs', () => {
  const csv = [
    'Date,Code,Div,HF,Pct',
    '2026-06-01,03-09,CO,6.10,77.5%',
  ].join('\n');
  const rows = parseUspsaClassifiers(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '03-09');
  assert.equal(rows[0].division, 'CO');
  assert.equal(rows[0].hitFactor, 6.1);
  assert.equal(rows[0].percent, 77.5);
});

test('skips blank lines and rows with no code or percent', () => {
  const csv = [
    'Date,Classifier,Division,Percent',
    '2026-01-01,99-11,Open,80',
    '',
    ',,,',
  ].join('\n');
  const rows = parseUspsaClassifiers(csv);
  assert.equal(rows.length, 1);
});

test('classifierKey is stable and case-insensitive for de-duping', () => {
  const a = classifierKey({ date: '2026-01-01', code: '99-11', division: 'Carry Optics' });
  const b = classifierKey({ date: '2026-01-01', code: '99-11', division: 'carry optics' });
  assert.equal(a, b);
});

test('throws a plain-language error on non-USPSA text', () => {
  assert.throws(() => parseUspsaClassifiers('hello\nworld'), /USPSA/);
});
