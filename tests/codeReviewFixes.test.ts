import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looseNum } from '../src/lib/csv.ts';
import { combinedCan, repointAmmoUsage } from '../src/lib/ammoMerge.ts';

// CR-10: looseNum rejects implausible magnitudes but keeps real values.
test('looseNum parses normal CSV numbers', () => {
  assert.equal(looseNum('72.4%'), 72.4);
  assert.equal(looseNum('1,000'), 1000);
  assert.equal(looseNum(''), null);
  assert.equal(looseNum('abc'), null);
});
test('looseNum rejects implausible huge numbers (CR-10)', () => {
  assert.equal(looseNum('1e308'), null);
  assert.equal(looseNum('99999999'), null); // > 1e7
});

// CR-7: combine-cans cost rule — average across priced rounds only; an unpriced
// can must not drag the average toward $0.
test('combinedCan: two priced cans weight-average correctly', () => {
  const r = combinedCan({ quantity: 100, costPerRound: 0.40 }, { quantity: 100, costPerRound: 0.20 });
  assert.equal(r.quantity, 200);
  assert.equal(r.costPerRound, 0.30);
});
test('combinedCan: a priced + an unpriced can keeps the priced cost (CR-7)', () => {
  const r = combinedCan({ quantity: 100, costPerRound: 0.30 }, { quantity: 100, costPerRound: 0 });
  assert.equal(r.quantity, 200);
  assert.equal(r.costPerRound, 0.30);
});

// CR-8-adjacent: repoint collapses duplicate ammo rows into the kept can.
test('repointAmmoUsage collapses from->to and sums rounds', () => {
  const out = repointAmmoUsage(
    [{ id: 's1', ammoUsage: [{ ammoId: 'old', rounds: 50 }, { ammoId: 'keep', rounds: 30 }] }],
    'old', 'keep'
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].ammoUsage, [{ ammoId: 'keep', rounds: 80 }]);
});
test('repointAmmoUsage leaves unrelated sessions out', () => {
  const out = repointAmmoUsage(
    [{ id: 's2', ammoUsage: [{ ammoId: 'other', rounds: 10 }] }],
    'old', 'keep'
  );
  assert.equal(out.length, 0);
});
