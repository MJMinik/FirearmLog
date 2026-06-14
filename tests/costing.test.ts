import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ammoCurrentCostPerRound, computeFifoCosts, costPerRoundAfterBuy, costTotals, firearmShare,
  gunSpend, inventoryAfterUsageChange, lowAmmo, matchFee, purchaseAmmoLink,
  roundsFired, sessionAmmoCost
} from '../src/lib/costing.ts';

// The worked example from the old app's verified engine: 1,500 @ $0.40 in
// January, 500 @ $0.20 in February; 1,000 shot in March (all January lot),
// 1,000 in April (500 January + 500 February).
const lots = [
  { id: 'pu-1', date: '2026-01-05', category: 'Ammo Purchase', cost: 600, ammoId: 'am-1', rounds: 1500 },
  { id: 'pu-2', date: '2026-02-05', category: 'Ammo Purchase', cost: 100, ammoId: 'am-1', rounds: 500 }
];
const marchApril = [
  { id: 'se-mar', date: '2026-03-10', ammoUsage: [{ ammoId: 'am-1', rounds: 1000 }] },
  { id: 'se-apr', date: '2026-04-10', ammoUsage: [{ ammoId: 'am-1', rounds: 1000 }] }
];

test('FIFO: oldest lot is consumed first, costs split across lots correctly', () => {
  const fifo = computeFifoCosts(lots, marchApril);
  assert.equal(fifo.sessionCosts['se-mar'], 400);            // 1,000 × $0.40
  assert.equal(fifo.sessionCosts['se-apr'], 300);            // 500 × $0.40 + 500 × $0.20
  assert.equal(fifo.sessionRoundsCovered['se-mar'], 1000);
  assert.equal(fifo.sessionRoundsCovered['se-apr'], 1000);
});

test('FIFO: planned sessions consume nothing', () => {
  const fifo = computeFifoCosts(lots, [
    { id: 'se-plan', date: '2026-03-01', planned: true, ammoUsage: [{ ammoId: 'am-1', rounds: 500 }] },
    ...marchApril
  ]);
  assert.equal(fifo.sessionCosts['se-plan'], 0);
  assert.equal(fifo.sessionCosts['se-mar'], 400); // unaffected by the plan
});

test('what is left in the can averages only the unspent lots', () => {
  // After 1,000 rounds: 500 left of the $0.40 lot + 500 of the $0.20 lot.
  const perRound = ammoCurrentCostPerRound('am-1', lots, [marchApril[0]]);
  assert.equal(perRound, 0.3);
  assert.equal(ammoCurrentCostPerRound('am-none', lots, []), null);
});

test('purchase legacy fallback: pre-M6 imports still feed FIFO without re-import', () => {
  const legacyPurchase = {
    id: 'pu-old', date: '2026-01-05', category: 'Ammo Purchase', cost: 600,
    legacy: { ammoId: 'am-1', rounds: 1500 }
  };
  assert.deepEqual(purchaseAmmoLink(legacyPurchase), { ammoId: 'am-1', rounds: 1500 });
  const fifo = computeFifoCosts([legacyPurchase], [marchApril[0]]);
  assert.equal(fifo.sessionCosts['se-mar'], 400);
});

test('sessionAmmoCost falls back to the flat cost/round when no lot covers it', () => {
  const ammo = [{ id: 'am-2', quantity: 800, costPerRound: 0.25 }];
  const s = { id: 'se-x', date: '2026-05-01', ammoUsage: [{ ammoId: 'am-2', rounds: 200 }] };
  const fifo = computeFifoCosts([], [s]);
  assert.equal(sessionAmmoCost(s, fifo, ammo), 50);
});

test('F2 regression: multi-gun session shares always sum to exactly 1 — never double-counted', () => {
  const s = {
    id: 'se-split', date: '2026-05-02',
    guns: [
      { firearmId: 'fa-1', rounds: 300 },
      { firearmId: 'fa-2', rounds: 100 },
      { firearmId: 'fa-3', rounds: 0 }
    ]
  };
  assert.equal(firearmShare(s, 'fa-1'), 0.75);
  assert.equal(firearmShare(s, 'fa-2'), 0.25);
  assert.equal(firearmShare(s, 'fa-3'), 0);
  assert.equal(firearmShare(s, 'fa-elsewhere'), 0);
  const sum = ['fa-1', 'fa-2', 'fa-3'].reduce((t, id) => t + firearmShare(s, id), 0);
  assert.equal(sum, 1);
  // Zero-rounds session (dry-fire day with a fee): split evenly, still sums to 1.
  const dry = { id: 'se-dry', date: '2026-05-03', guns: [{ firearmId: 'fa-1', rounds: 0 }, { firearmId: 'fa-2', rounds: 0 }] };
  assert.equal(firearmShare(dry, 'fa-1') + firearmShare(dry, 'fa-2'), 1);
});

test('per-gun spend across guns equals the whole-wallet total (no double count)', () => {
  const sessions = [
    {
      id: 'se-1', date: '2026-03-10', rangeFee: 20,
      guns: [{ firearmId: 'fa-1', rounds: 750 }, { firearmId: 'fa-2', rounds: 250 }],
      ammoUsage: [{ ammoId: 'am-1', rounds: 1000 }]
    }
  ];
  const matches = [{ firearmId: 'fa-1', date: '2026-03-20', entryFee: 25, totalRounds: 150 }];
  const ammo = [{ id: 'am-1', quantity: 1000, costPerRound: 0 }];
  const a = gunSpend('fa-1', sessions, lots, matches, ammo);
  const b = gunSpend('fa-2', sessions, lots, matches, ammo);
  // Session: $400 ammo + $20 fee. fa-1 gets 75%, fa-2 25%; match fee all fa-1.
  assert.equal(a.ammo + b.ammo, 400);
  assert.equal(a.rangeFees + b.rangeFees, 20);
  assert.equal(a.total, 0.75 * 420 + 25);
  assert.equal(b.total, 0.25 * 420);
});

test('costTotals: every dollar lands in exactly one bucket', () => {
  const sessions = [
    { id: 'se-1', date: '2026-03-10', rangeFee: 20 },
    { id: 'se-2', date: '2026-03-12', rangeFee: null },
    { id: 'se-plan', date: '2026-07-01', planned: true, rangeFee: 15 } // planned fee doesn't count
  ];
  const purchases = [
    ...lots,                                                                          // $700 ammo
    { id: 'pu-3', date: '2026-02-10', category: 'Range Fee', cost: 12 },
    { id: 'pu-4', date: '2026-02-11', category: 'Gear / Equipment', cost: 150 },
    { id: 'pu-5', date: '2026-02-12', category: 'Travel', cost: 60 }
  ];
  const matches = [
    { date: '2026-03-20', entryFee: 25 },
    { date: '2026-03-27', cost: 30 } // old-app match: fee lives in `cost`
  ];
  const t = costTotals(sessions, purchases, matches);
  assert.equal(t.ammoBought, 700);
  assert.equal(t.rangeFees, 32);   // 20 session + 12 purchase
  assert.equal(t.matchFees, 55);   // 25 entryFee + 30 legacy cost
  assert.equal(t.gearAndOther, 210);
  assert.equal(t.total, 997);
});

test('parts: spare-part costs flow into totals and per-gun spend', () => {
  const parts = [
    { firearmId: 'fa-1', cost: 40, datePurchased: '2026-05-01' }, // recoil spring for fa-1
    { firearmId: 'fa-1', cost: 15 },                              // extractor for fa-1
    { firearmId: '', cost: 25 },                                  // universal — not gun-specific
    { firearmId: 'fa-2', cost: '12' }                             // string cost tolerated
  ];
  const t = costTotals([], [], [], parts);
  assert.equal(t.parts, 92); // 40 + 15 + 25 + 12
  assert.equal(t.total, 92);

  const g1 = gunSpend('fa-1', [], [], [], [], parts);
  assert.equal(g1.parts, 55); // 40 + 15; universal excluded
  assert.equal(g1.total, 55);

  assert.equal(gunSpend('fa-2', [], [], [], [], parts).parts, 12);
});

test('matchFee: entryFee wins, old `cost` field honored, junk ignored', () => {
  assert.equal(matchFee({ entryFee: 25, cost: 99 }), 25);
  assert.equal(matchFee({ cost: 30 }), 30);
  assert.equal(matchFee({ cost: '30' }), 30);
  assert.equal(matchFee({}), 0);
  assert.equal(matchFee({ cost: 'free' }), 0);
});

test('roundsFired counts live sessions and matches, skips planned and dry fire', () => {
  const sessions = [
    { id: 's1', date: '2026-01-01', guns: [{ firearmId: 'f', rounds: 200 }] },
    { id: 's2', date: '2026-01-02', planned: true, guns: [{ firearmId: 'f', rounds: 999 }] },
    { id: 's3', date: '2026-01-03', type: 'dry_fire', guns: [{ firearmId: 'f', rounds: 500 }] }
  ];
  assert.equal(roundsFired(sessions, [{ totalRounds: 150 }]), 350);
});

test('inventory math: new session, edit, and delete all reduce to one delta rule', () => {
  const ammo = [{ id: 'am-1', quantity: 500, costPerRound: 0 }, { id: 'am-2', quantity: 100, costPerRound: 0 }];
  // New session using 200 of am-1.
  let next = inventoryAfterUsageChange(ammo, [], [{ ammoId: 'am-1', rounds: 200 }]);
  assert.equal(next.get('am-1'), 300);
  // Edit from 200 → 150 puts 50 back.
  next = inventoryAfterUsageChange(ammo, [{ ammoId: 'am-1', rounds: 200 }], [{ ammoId: 'am-1', rounds: 150 }]);
  assert.equal(next.get('am-1'), 550);
  // Delete returns it all; switching cans returns one and draws the other.
  next = inventoryAfterUsageChange(ammo, [{ ammoId: 'am-1', rounds: 200 }], []);
  assert.equal(next.get('am-1'), 700);
  next = inventoryAfterUsageChange(ammo, [{ ammoId: 'am-1', rounds: 100 }], [{ ammoId: 'am-2', rounds: 100 }]);
  assert.equal(next.get('am-1'), 600);
  assert.equal(next.get('am-2'), 0);
  // Never below zero; unchanged cans aren't touched.
  next = inventoryAfterUsageChange(ammo, [], [{ ammoId: 'am-2', rounds: 250 }]);
  assert.equal(next.get('am-2'), 0);
  assert.equal(next.has('am-1'), false);
});

test('lowAmmo flags 1–50 rounds, ignores empty and healthy cans', () => {
  const ammo = [
    { id: 'a', quantity: 0, costPerRound: 0 },
    { id: 'b', quantity: 50, costPerRound: 0 },
    { id: 'c', quantity: 51, costPerRound: 0 }
  ];
  assert.deepEqual(lowAmmo(ammo).map((a) => a.id), ['b']);
});

test('costPerRoundAfterBuy: existing FIFO basis plus the new lot', () => {
  // Can has 500 left @ $0.40 + 500 @ $0.20 (basis $300/1,000). Buy 1,000 for $200.
  const after = costPerRoundAfterBuy('am-1', lots, [marchApril[0]], 0, 1000, 1000, 200);
  assert.equal(after, 0.25); // ($300 + $200) / 2,000
});

test('costPerRoundAfterBuy: brand-new can is just the buy price', () => {
  assert.equal(costPerRoundAfterBuy(null, [], [], 0, 0, 1000, 300), 0.3);
});

test('costPerRoundAfterBuy: typed flat cost covers shelf rounds when no lots exist', () => {
  // 400 rounds on the shelf at a typed $0.25, buying 600 for $240 ($0.40).
  const after = costPerRoundAfterBuy(null, [], [], 0.25, 400, 600, 240);
  assert.equal(after, 0.34); // ($100 + $240) / 1,000
});

test('costPerRoundAfterBuy: nothing to price returns null', () => {
  assert.equal(costPerRoundAfterBuy(null, [], [], 0, 0, 0, 0), null);
  assert.equal(costPerRoundAfterBuy('am-none', [], [], 0, 500, 0, 0), null);
});
