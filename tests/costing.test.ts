import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ammoCurrentCostPerRound, computeFifoCosts, costPerRoundAfterBuy, costTotals, firearmShare,
  gunOwnershipSpend, gunSpend, inventoryAfterUsageChange, isLinkableGunCategory,
  linkedGunIdForSave, lowAmmo, matchFee, purchaseAmmoLink, roundsFired, sessionAmmoCost
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

test('M-9: partial FIFO coverage prices the remainder at the flat rate — not $0', () => {
  // A single 100-round lot @ $0.40 ($40); the session shot 200. FIFO covers the
  // first 100 ($40); the ammo's flat $0.50/rd covers the other 100 ($50) → $90.
  // Before the fix this returned $40, silently pricing 100 rounds at nothing.
  const purchase = [{ id: 'pu-9', date: '2026-01-01', category: 'Ammo Purchase', cost: 40, ammoId: 'am-9', rounds: 100 }];
  const s = { id: 'se-9', date: '2026-02-01', ammoUsage: [{ ammoId: 'am-9', rounds: 200 }] };
  const ammo = [{ id: 'am-9', quantity: 0, costPerRound: 0.5 }];
  const fifo = computeFifoCosts(purchase, [s]);
  assert.equal(fifo.sessionCosts['se-9'], 40);              // 100 × $0.40 covered by the lot
  assert.equal(fifo.sessionRoundsCovered['se-9'], 100);
  assert.equal(fifo.sessionAmmoCovered['se-9']['am-9'], 100);
  assert.equal(sessionAmmoCost(s, fifo, ammo), 90);         // $40 FIFO + 100 × $0.50 flat
});

test('M-9: a fully FIFO-covered session takes NO flat top-up', () => {
  // se-mar shoots all 1,000 from lots ($400); the flat rate must be ignored.
  const ammo = [{ id: 'am-1', quantity: 0, costPerRound: 99 }];
  const fifo = computeFifoCosts(lots, marchApril);
  assert.equal(sessionAmmoCost(marchApril[0], fifo, ammo), 400);
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

// ---------------------------------------------------------------------------
// gunOwnershipSpend — "Gun & gear cost per gun" (Aug 2026)
// ---------------------------------------------------------------------------

test('gunOwnershipSpend: gun price + optic + parts + linked gear + linked service + ammo all add up', () => {
  const firearms = [{ id: 'fa-1', pricePaid: 500 }];
  const optics = [{ firearmId: 'fa-1', pricePaid: 300 }];
  const parts = [{ firearmId: 'fa-1', cost: 40 }];
  const purchases = [
    ...lots, // ammo lots — not linked to any gun, feed FIFO only
    { id: 'pu-gear', date: '2026-03-01', category: 'Gear / Equipment', cost: 60, firearmId: 'fa-1' },
    { id: 'pu-svc', date: '2026-03-02', category: 'Service / Repair', cost: 25, firearmId: 'fa-1' },
  ];
  const sessions = [marchApril[0]]; // se-mar: 1,000 rounds of am-1, all fa-1's
  const withGuns = sessions.map((s) => ({ ...s, guns: [{ firearmId: 'fa-1', rounds: 1000 }] }));
  const ammo = [{ id: 'am-1', quantity: 0, costPerRound: 0 }];
  const g = gunOwnershipSpend('fa-1', withGuns, purchases, ammo, firearms, optics, parts);
  assert.equal(g.ammo, 400);   // same FIFO figure as gunSpend: 1,000 × $0.40 (Jan lot)
  assert.equal(g.gun, 500);
  assert.equal(g.optic, 300);
  assert.equal(g.parts, 40);
  assert.equal(g.linked, 85);  // $60 gear + $25 service
  assert.equal(g.total, 400 + 500 + 300 + 40 + 85);
});

test('gunOwnershipSpend: a gun with nothing recorded but ammo shows only ammo', () => {
  const firearms = [{ id: 'fa-2' }]; // no pricePaid at all
  const sessions = [{ ...marchApril[0], guns: [{ firearmId: 'fa-2', rounds: 1000 }] }];
  const ammo = [{ id: 'am-1', quantity: 0, costPerRound: 0 }];
  const g = gunOwnershipSpend('fa-2', sessions, lots, ammo, firearms);
  assert.equal(g.ammo, 400);
  assert.equal(g.gun, 0);
  assert.equal(g.optic, 0);
  assert.equal(g.parts, 0);
  assert.equal(g.linked, 0);
  assert.equal(g.total, 400);
});

test('gunOwnershipSpend never includes range fees or match fees, which gunSpend does', () => {
  const firearms = [{ id: 'fa-3', pricePaid: 100 }];
  const sessions = [{
    id: 'se-y', date: '2026-04-01', rangeFee: 20,
    guns: [{ firearmId: 'fa-3', rounds: 100 }], ammoUsage: []
  }];
  const matches = [{ firearmId: 'fa-3', date: '2026-04-05', entryFee: 30, totalRounds: 50 }];
  const ammo: { id: string; quantity: number; costPerRound: number }[] = [];
  // gunOwnershipSpend takes no `matches` argument at all — there is no field
  // for a match fee to arrive through, and it never reads session.rangeFee.
  const own = gunOwnershipSpend('fa-3', sessions, [], ammo, firearms);
  assert.equal(own.total, 100); // the gun's own price only
  // Same session and gun, through gunSpend: both fees show up there.
  const spend = gunSpend('fa-3', sessions, [], matches, ammo);
  assert.equal(spend.rangeFees, 20);
  assert.equal(spend.matchFees, 30);
  assert.equal(spend.total, 50);
});

test('gunOwnershipSpend: a linked Ammo Purchase or Range Fee purchase is ignored even with a firearmId', () => {
  const firearms = [{ id: 'fa-4' }];
  const purchases = [
    { id: 'pu-ammo-linked', date: '2026-01-01', category: 'Ammo Purchase', cost: 999, ammoId: 'am-4', rounds: 100, firearmId: 'fa-4' },
    { id: 'pu-fee-linked', date: '2026-01-01', category: 'Range Fee', cost: 50, firearmId: 'fa-4' },
  ];
  const g = gunOwnershipSpend('fa-4', [], purchases, [], firearms);
  assert.equal(g.linked, 0);
  assert.equal(g.total, 0);
});

test('gunOwnershipSpend: a linked Ammo Purchase still feeds FIFO once, never doubled as gear', () => {
  const firearms = [{ id: 'fa-5' }];
  const purchases = [
    { id: 'pu-5', date: '2026-01-01', category: 'Ammo Purchase', cost: 40, ammoId: 'am-5', rounds: 100, firearmId: 'fa-5' },
  ];
  const sessions = [
    { id: 'se-5', date: '2026-02-01', guns: [{ firearmId: 'fa-5', rounds: 100 }], ammoUsage: [{ ammoId: 'am-5', rounds: 100 }] },
  ];
  const ammo = [{ id: 'am-5', quantity: 0, costPerRound: 0 }];
  const g = gunOwnershipSpend('fa-5', sessions, purchases, ammo, firearms);
  assert.equal(g.ammo, 40);   // the FIFO figure, once
  assert.equal(g.linked, 0);  // never added a second time as gear
  assert.equal(g.total, 40);
});

test('gunOwnershipSpend: a missing or non-numeric pricePaid contributes 0, never NaN', () => {
  const firearms = [{ id: 'fa-6', pricePaid: 'free' as unknown as number }];
  const optics = [{ firearmId: 'fa-6', pricePaid: undefined }, { firearmId: 'fa-6' }];
  const g = gunOwnershipSpend('fa-6', [], [], [], firearms, optics);
  assert.equal(g.gun, 0);
  assert.equal(g.optic, 0);
  assert.equal(Number.isNaN(g.total), false);
  assert.equal(g.total, 0);
});

test('gunOwnershipSpend: two optics on the same gun over its life sum together', () => {
  const firearms = [{ id: 'fa-7' }];
  const optics = [
    { firearmId: 'fa-7', pricePaid: 250 },
    { firearmId: 'fa-7', pricePaid: 90 },
    { firearmId: 'fa-other', pricePaid: 1000 }, // a different gun's optic never counts
  ];
  const g = gunOwnershipSpend('fa-7', [], [], [], firearms, optics);
  assert.equal(g.optic, 340);
  assert.equal(g.total, 340);
});


// ---------------------------------------------------------------------------
// SESSION-135 COLD-AUDIT FIXES
// ---------------------------------------------------------------------------

// The gun link is decided in two places on the purchase form -- whether to SHOW
// the picker, and what to SAVE once the category may have moved. They were two
// separate expressions and could drift apart, which is exactly how a link ends
// up hidden but still stored. Both now call these, so the two answers cannot
// disagree. Tested directly because the property lives in the pure function, not
// in the screen: an E2E round trip proves one path works, this proves the rule.
test('isLinkableGunCategory: only the two categories the picker is offered on', () => {
  assert.equal(isLinkableGunCategory('Gear / Equipment'), true);
  assert.equal(isLinkableGunCategory('Service / Repair'), true);
  assert.equal(isLinkableGunCategory('gear / equipment'), true, 'case-insensitive, as stored data may vary');
  for (const c of ['Ammo Purchase', 'Range Fee', 'Training / Class', 'Travel', 'Other', '']) {
    assert.equal(isLinkableGunCategory(c), false, c + ' must never carry a gun link');
  }
});

test('linkedGunIdForSave: a category change away from the linkable two CLEARS the link', () => {
  assert.equal(linkedGunIdForSave('Gear / Equipment', 'fa-1'), 'fa-1');
  assert.equal(linkedGunIdForSave('Service / Repair', 'fa-1'), 'fa-1');
  // The defect this exists to stop: the shooter picks a gun on a gear purchase,
  // then switches the category to Ammo. The picker disappears from the screen;
  // without this rule the id it was holding is still written to disk.
  assert.equal(linkedGunIdForSave('Ammo Purchase', 'fa-1'), null);
  assert.equal(linkedGunIdForSave('Range Fee', 'fa-1'), null);
  assert.equal(linkedGunIdForSave('Other', 'fa-1'), null);
  // And no gun picked is null on a linkable category too, never ''.
  assert.equal(linkedGunIdForSave('Gear / Equipment', ''), null);
  assert.equal(linkedGunIdForSave('Gear / Equipment', null), null);
});

test('a NEGATIVE stored price contributes 0 rather than subtracting from the gun total', () => {
  // Not reachable through the forms, which reject negatives. Reachable through a
  // restore: a .flog is written back verbatim and optional numbers are never
  // normalised, so a hand-edited or third-party backup can carry one. Unfloored,
  // this subtracted -- and because rows totalling 0 are skipped on the card, a
  // big enough negative deleted the gun's row from the screen altogether.
  const guns = [{ id: 'fa-1', pricePaid: -500 }];
  const optics = [{ firearmId: 'fa-1', pricePaid: -50 }];
  const partsNeg = [{ id: 'pt-1', firearmId: 'fa-1', cost: -25 }];
  const buys = [{ id: 'pu-1', date: '2026-01-01', category: 'Gear / Equipment', cost: -80, firearmId: 'fa-1' }];
  const g = gunOwnershipSpend('fa-1', [], buys, [], guns, optics, partsNeg);
  assert.equal(g.gun, 0, 'a negative gun price is floored');
  assert.equal(g.optic, 0, 'a negative optic price is floored');
  assert.equal(g.parts, 0, 'a negative part cost is floored');
  assert.equal(g.linked, 0, 'a negative linked purchase is floored');
  assert.equal(g.total, 0);
  // And the floor must not eat a legitimate figure sitting beside a poisoned one.
  const mixed = gunOwnershipSpend(
    'fa-1', [], [], [], [{ id: 'fa-1', pricePaid: 900 }], [{ firearmId: 'fa-1', pricePaid: -50 }], []);
  assert.equal(mixed.gun, 900);
  assert.equal(mixed.optic, 0);
  assert.equal(mixed.total, 900);
});
