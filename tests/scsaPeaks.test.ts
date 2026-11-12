import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SCSA_PEAKS, SCSA_STAGES, scsaPeak } from '../src/lib/scsaPeaks.ts';
import { STEEL_DIVISIONS } from '../src/lib/competition.ts';
import { STOCK_DRILLS_V2_STEEL } from '../src/lib/stockDrills.ts';

// The table is a copy of the marketing site's SC_PEAKS. This checksum is the
// tripwire: a casual edit to any of the 128 figures, or to a division name,
// fails here. Change it only when SCSA has revised a peak AND the site's copy
// has been changed in the same sitting (website-verify/run.js checks the pair).
const PINNED = '24853ac730652a8bf7f83c04d4713cf1c4db24db587c30cb8d5b73742265e705';

function checksum(): string {
  const canon = JSON.stringify(Object.keys(SCSA_PEAKS).sort().map((k) => [k, SCSA_PEAKS[k]]));
  return createHash('sha256').update(canon).digest('hex');
}

test('the peak table matches its pinned checksum', () => {
  assert.equal(checksum(), PINNED);
});

test('sixteen divisions, eight positive peaks each: 128 figures', () => {
  const names = Object.keys(SCSA_PEAKS);
  assert.equal(names.length, 16);
  let n = 0;
  for (const d of names) {
    assert.equal(SCSA_PEAKS[d].length, 8, d);
    for (const v of SCSA_PEAKS[d]) {
      assert.ok(Number.isFinite(v) && v > 0, `${d}: ${v}`);
      n++;
    }
  }
  assert.equal(n, 128);
});

test('the divisions are exactly the app\'s Steel divisions, less Other', () => {
  const want = STEEL_DIVISIONS.filter((d) => d !== 'Other').slice().sort();
  assert.deepEqual(Object.keys(SCSA_PEAKS).sort(), want);
});

test('eight stages, SC-101 to SC-108, and only Outer Limits counts three strings', () => {
  assert.equal(SCSA_STAGES.length, 8);
  SCSA_STAGES.forEach((s, i) => {
    assert.equal(s.code, `SC-10${i + 1}`);
    assert.equal(s.countedStrings, s.name === 'Outer Limits' ? 3 : 4, s.name);
  });
  assert.equal(SCSA_STAGES.filter((s) => s.countedStrings === 3).length, 1);
});

test('every stage name is carried by a built-in Steel Challenge drill, in order', () => {
  assert.deepEqual(
    STOCK_DRILLS_V2_STEEL.map((d) => d.name),
    SCSA_STAGES.map((s) => `Steel Challenge: ${s.name}`)
  );
});

test('spot figures, read from scsa.org by hand', () => {
  assert.equal(scsaPeak('Carry Optics', 2), 10); // Smoke & Hope
  assert.equal(scsaPeak('Open', 0), 11.25); // Five to Go
  assert.equal(scsaPeak('Open', 3), 12.5); // Outer Limits
  assert.equal(scsaPeak('Rimfire Rifle Optics', 7), 7); // Roundabout
  assert.equal(scsaPeak('Iron Sight Revolver', 3), 15.75);
});

test('an unknown division or stage is null, never a crash or a borrowed figure', () => {
  assert.equal(scsaPeak('Other', 0), null);
  assert.equal(scsaPeak('toString', 0), null);
  assert.equal(scsaPeak('__proto__', 0), null);
  assert.equal(scsaPeak('Open', 8), null);
  assert.equal(scsaPeak('Open', -1), null);
  assert.equal(scsaPeak('Open', 1.5), null);
  assert.equal(scsaPeak('Open', NaN), null);
  // An untyped caller (a value read from an address, say) must not borrow a
  // property of the row: the row's own length is 8.
  assert.equal(scsaPeak('Open', 'length' as unknown as number), null);
  // Names every object answers to. The table has no such division, and the
  // lookup must not find the built-in of that name either.
  for (const name of ['constructor', 'hasOwnProperty', 'valueOf', 'toString', '__proto__']) {
    assert.equal(scsaPeak(name, 0), null, name);
    assert.equal(scsaPeak(name, 'length' as unknown as number), null, name);
  }
});
