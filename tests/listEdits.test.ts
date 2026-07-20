import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRename, collectValues, countMatches, filterHidden, LIST_DEFS,
} from '../src/lib/listEdits.ts';
import type { RecordsByStore } from '../src/lib/listEdits.ts';
import type { Ammunition, Firearm, Part, Purchase, Session } from '../src/lib/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's-1', createdAt: 1000, updatedAt: 2000,
    date: '2026-01-01', type: 'practice', guns: [], location: 'Home', distances: '',
    notes: '', ammoUsage: [], drills: [], targetMediaIds: [], malfunctions: [],
    selfRating: null, rangeFee: null, planned: false, checklist: null,
    ...over,
  };
}

function ammo(over: Partial<Ammunition> = {}): Ammunition {
  return {
    id: 'am-1', createdAt: 1000, updatedAt: 2000,
    brand: 'Blazer', caliber: '9mm', grain: '115', bulletType: 'FMJ',
    quantity: 500, costPerRound: 0.18, notes: '',
    ...over,
  };
}

function firearm(over: Partial<Firearm> = {}): Firearm {
  return {
    id: 'fa-1', createdAt: 1000, updatedAt: 2000,
    name: 'Glock 17', manufacturer: 'Glock', model: '17', caliber: '9mm',
    category: 'Pistol', serialNumber: null, dateAcquired: '', startingRoundCount: 0,
    photoIds: [], referenceId: null, notes: '',
    ...over,
  };
}

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: 'pu-1', createdAt: 1000, updatedAt: 2000,
    date: '2026-01-01', category: 'Ammo Purchase', item: 'Ammo', vendor: 'Primary Arms',
    cost: 100, notes: '',
    ...over,
  };
}

function part(over: Partial<Part> = {}): Part {
  return {
    id: 'pt-1', createdAt: 1000, updatedAt: 2000,
    firearmId: 'fa-1', name: 'Recoil spring', quantity: 1,
    partNumber: '', datePurchased: '', notes: '',
    ...over,
  };
}

const locationsDef = LIST_DEFS.find((d) => d.id === 'locations')!;
const calibersDef = LIST_DEFS.find((d) => d.id === 'calibers')!;
const vendorsDef = LIST_DEFS.find((d) => d.id === 'vendors')!;
const instructorsDef = LIST_DEFS.find((d) => d.id === 'instructors')!;

// ---------------------------------------------------------------------------
// collectValues
// ---------------------------------------------------------------------------

test('collectValues: returns visible values from session.location', () => {
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: 'Home', updatedAt: 3000 }),
      session({ id: 's-2', location: 'Range', updatedAt: 2000 }),
    ],
  };
  const { visible, hidden } = collectValues(records, locationsDef, new Set());
  assert.deepEqual(visible, ['Home', 'Range']);
  assert.deepEqual(hidden, []);
});

test('collectValues: hidden values are split into the hidden array', () => {
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: 'Home', updatedAt: 3000 }),
      session({ id: 's-2', location: 'Range', updatedAt: 2000 }),
    ],
  };
  const { visible, hidden } = collectValues(records, locationsDef, new Set(['range']));
  assert.deepEqual(visible, ['Home']);
  assert.deepEqual(hidden, ['Range']);
});

test('collectValues: multi-store calibers span both stores', () => {
  const records: RecordsByStore = {
    ammunition: [ammo({ caliber: '9mm', updatedAt: 3000 })],
    firearms: [firearm({ caliber: '.45 ACP', updatedAt: 2000 })],
  };
  const { visible } = collectValues(records, calibersDef, new Set());
  assert.ok(visible.includes('9mm'));
  assert.ok(visible.includes('.45 ACP'));
});

test('collectValues: case-insensitive dedup keeps newest casing', () => {
  // Sessions use the 'date' field for recency (mirrors SessionForm). The newer
  // date wins the dedup, so its casing is kept.
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: 'home', date: '2026-01-01', updatedAt: 1000 }),
      session({ id: 's-2', location: 'Home', date: '2026-06-01', updatedAt: 1000 }), // newer date
    ],
  };
  const { visible } = collectValues(records, locationsDef, new Set());
  assert.deepEqual(visible, ['Home']);
});

test('collectValues: blank/null/undefined locations are excluded', () => {
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: '', updatedAt: 3000 }),
      session({ id: 's-2', location: '   ', updatedAt: 2000 }),
    ],
  };
  const { visible } = collectValues(records, locationsDef, new Set());
  assert.deepEqual(visible, []);
});

// ---------------------------------------------------------------------------
// countMatches
// ---------------------------------------------------------------------------

test('countMatches: case-insensitive, trimmed', () => {
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: 'Home' }),
      session({ id: 's-2', location: 'HOME' }),
      session({ id: 's-3', location: ' home ' }),
      session({ id: 's-4', location: 'Range' }),
    ],
  };
  const counts = countMatches(records, locationsDef, 'home');
  assert.equal(counts.find((c) => c.store === 'sessions')?.count, 3);
});

test('countMatches: multi-store counts (calibers)', () => {
  const records: RecordsByStore = {
    ammunition: [ammo({ caliber: '9mm' }), ammo({ id: 'am-2', caliber: '9mm' })],
    firearms: [firearm({ caliber: '9mm' }), firearm({ id: 'fa-2', caliber: '.45' })],
  };
  const counts = countMatches(records, calibersDef, '9mm');
  assert.equal(counts.find((c) => c.store === 'ammunition')?.count, 2);
  assert.equal(counts.find((c) => c.store === 'firearms')?.count, 1);
});

test('countMatches: zero count when no matches', () => {
  const records: RecordsByStore = {
    sessions: [session({ location: 'Range' })],
  };
  const counts = countMatches(records, locationsDef, 'Home');
  assert.equal(counts.find((c) => c.store === 'sessions')?.count, 0);
});

// ---------------------------------------------------------------------------
// applyRename
// ---------------------------------------------------------------------------

test('applyRename: updates field and updatedAt, nothing else changes', () => {
  const s = session({ id: 's-1', location: 'Home', notes: 'keep this', updatedAt: 1000 });
  const records: RecordsByStore = { sessions: [s] };
  const now = 9999;
  const renamed = applyRename(records, locationsDef, 'Home', 'Home (dry)', now);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].store, 'sessions');
  assert.equal(renamed[0].record['location'], 'Home (dry)');
  assert.equal(renamed[0].record['updatedAt'], now);
  assert.equal(renamed[0].record['notes'], 'keep this'); // unchanged
  assert.equal(renamed[0].record['id'], 's-1'); // unchanged
  assert.equal(renamed[0].record['createdAt'], 1000); // unchanged
});

test('applyRename: case-insensitive matching, new value is exact-as-typed', () => {
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: 'home range' }),
      session({ id: 's-2', location: 'Home Range' }),
      session({ id: 's-3', location: 'HOME RANGE' }),
    ],
  };
  const renamed = applyRename(records, locationsDef, 'Home Range', 'Club Range', 5000);
  assert.equal(renamed.length, 3);
  assert.ok(renamed.every((r) => r.record['location'] === 'Club Range'));
});

test('applyRename: trimmed matching — surrounding spaces match the core value', () => {
  const records: RecordsByStore = {
    sessions: [session({ id: 's-1', location: '  Home  ' })],
  };
  const renamed = applyRename(records, locationsDef, 'Home', 'Home (dry)', 5000);
  assert.equal(renamed.length, 1);
});

test('applyRename: recase-only rename (changes casing of existing value)', () => {
  const records: RecordsByStore = {
    sessions: [session({ id: 's-1', location: 'home' })],
  };
  const renamed = applyRename(records, locationsDef, 'home', 'Home', 5000);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].record['location'], 'Home');
});

test('applyRename: null/undefined/empty instructor is never matched or written', () => {
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', instructor: null }),
      session({ id: 's-2', instructor: undefined }),
      session({ id: 's-3', instructor: '' }),
      session({ id: 's-4', instructor: 'John Doe' }),
    ],
  };
  const renamed = applyRename(records, instructorsDef, 'John Doe', 'Jane Doe', 5000);
  assert.equal(renamed.length, 1);
  assert.equal(renamed[0].record['instructor'], 'Jane Doe');
});

test('applyRename: multi-store rename (calibers) hits both stores', () => {
  const records: RecordsByStore = {
    ammunition: [ammo({ id: 'am-1', caliber: '9mm' }), ammo({ id: 'am-2', caliber: '9mm' })],
    firearms: [firearm({ id: 'fa-1', caliber: '9mm' }), firearm({ id: 'fa-2', caliber: '.45' })],
  };
  const renamed = applyRename(records, calibersDef, '9mm', '9×19mm', 5000);
  const ammoChanges = renamed.filter((r) => r.store === 'ammunition');
  const gunChanges = renamed.filter((r) => r.store === 'firearms');
  assert.equal(ammoChanges.length, 2);
  assert.equal(gunChanges.length, 1);
  assert.ok(renamed.every((r) => r.record['caliber'] === '9×19mm'));
});

test('applyRename: multi-store where one store has zero matches is fine', () => {
  const records: RecordsByStore = {
    purchases: [purchase({ vendor: 'Primary Arms' })],
    parts: [part({ vendor: 'Brownells' })],
  };
  const renamed = applyRename(records, vendorsDef, 'Primary Arms', 'PA', 5000);
  assert.equal(renamed.filter((r) => r.store === 'purchases').length, 1);
  assert.equal(renamed.filter((r) => r.store === 'parts').length, 0);
});

test('applyRename: returns empty array when no matches', () => {
  const records: RecordsByStore = { sessions: [session({ location: 'Range' })] };
  const renamed = applyRename(records, locationsDef, 'Home', 'Home (dry)', 5000);
  assert.equal(renamed.length, 0);
});

// ---------------------------------------------------------------------------
// filterHidden
// ---------------------------------------------------------------------------

test('filterHidden: removes hidden values from suggestions', () => {
  const values = ['Home', 'Range', 'Club'];
  const hidden = { locations: ['range'] };
  assert.deepEqual(filterHidden(values, hidden, 'locations'), ['Home', 'Club']);
});

test('filterHidden: no hidden settings returns all values unchanged', () => {
  const values = ['Home', 'Range'];
  assert.deepEqual(filterHidden(values, undefined, 'locations'), ['Home', 'Range']);
  assert.deepEqual(filterHidden(values, {}, 'locations'), ['Home', 'Range']);
});

test('filterHidden: case-insensitive matching', () => {
  const values = ['Primary Arms', 'Brownells'];
  const hidden = { vendors: ['primary arms'] };
  assert.deepEqual(filterHidden(values, hidden, 'vendors'), ['Brownells']);
});

test('filterHidden: list with no hidden entries returns all values', () => {
  const values = ['Speed', 'Accuracy'];
  const hidden = { 'goal-categories': [] };
  assert.deepEqual(filterHidden(values, hidden, 'goal-categories'), ['Speed', 'Accuracy']);
});

// ---------------------------------------------------------------------------
// collectValues: hidden-value collision detection (Fix 4 — hidden values must
// appear so existingCollision can detect them)
// ---------------------------------------------------------------------------

test('collectValues: a hidden value still appears in the hidden array (collision can be detected)', () => {
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: 'Home', updatedAt: 3000 }),
      session({ id: 's-2', location: 'Range', updatedAt: 2000 }),
    ],
  };
  // 'range' is hidden — it must still come back in the hidden array so the
  // rename sheet can detect a collision when the user types "Range".
  const { visible, hidden } = collectValues(records, locationsDef, new Set(['range']));
  assert.ok(hidden.includes('Range'), 'hidden array must contain the hidden value');
  assert.ok(!visible.includes('Range'), 'visible array must not contain the hidden value');
});

test('collectValues: all-sources combine — hidden value in hidden array for collision detection', () => {
  const records: RecordsByStore = {
    ammunition: [ammo({ caliber: '9mm', updatedAt: 3000 })],
    firearms: [firearm({ caliber: '.45 ACP', updatedAt: 2000 })],
  };
  const calDef = LIST_DEFS.find((d) => d.id === 'calibers')!;
  // Hide 9mm — it must still be detectable as a collision target
  const { visible, hidden } = collectValues(records, calDef, new Set(['9mm']));
  assert.ok(hidden.includes('9mm'), 'hidden caliber must appear in hidden array');
  assert.ok(visible.includes('.45 ACP'));
  assert.ok(!visible.includes('9mm'));
});

// ---------------------------------------------------------------------------
// LIST_DEFS completeness
// ---------------------------------------------------------------------------

test('LIST_DEFS has exactly 10 entries', () => {
  assert.equal(LIST_DEFS.length, 10);
});

test('LIST_DEFS ids are unique', () => {
  const ids = LIST_DEFS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('calibers def has two sources (ammunition + firearms)', () => {
  const stores = calibersDef.sources.map((s) => s.store);
  assert.ok(stores.includes('ammunition'));
  assert.ok(stores.includes('firearms'));
});

test('vendors def has two sources (purchases + parts)', () => {
  const stores = vendorsDef.sources.map((s) => s.store);
  assert.ok(stores.includes('purchases'));
  assert.ok(stores.includes('parts'));
});

// ---------------------------------------------------------------------------
// collectValues: recencyField ordering (Fix 7)
// ---------------------------------------------------------------------------

test('collectValues: sessions use date field for recency ordering', () => {
  // Two sessions — the one with the LATER date string should rank first.
  // This mirrors what SessionForm does: recentValues(sessions.map(s => ({ date: s.date, value: s.location })))
  const records: RecordsByStore = {
    sessions: [
      session({ id: 's-1', location: 'Older Range', updatedAt: 9999, date: '2026-01-01' }),
      session({ id: 's-2', location: 'Newer Range', updatedAt: 1000, date: '2026-06-01' }),
    ],
  };
  const { visible } = collectValues(records, locationsDef, new Set());
  // 'Newer Range' has the later date and should rank first, even though its updatedAt is smaller
  assert.equal(visible[0], 'Newer Range');
  assert.equal(visible[1], 'Older Range');
});

test('collectValues: ammo uses updatedAt field for recency ordering', () => {
  // Two ammo cans — the one with the higher updatedAt should rank first.
  // This mirrors AmmoScreens: recentValues(allAmmo.map(a => ({ date: String(a.updatedAt), value: a.brand })))
  const ammoDef = LIST_DEFS.find((d) => d.id === 'ammo-brands')!;
  const records: RecordsByStore = {
    ammunition: [
      ammo({ id: 'am-1', brand: 'OlderBrand', updatedAt: 1000 }),
      ammo({ id: 'am-2', brand: 'NewerBrand', updatedAt: 9999 }),
    ],
  };
  const { visible } = collectValues(records, ammoDef, new Set());
  assert.equal(visible[0], 'NewerBrand');
  assert.equal(visible[1], 'OlderBrand');
});

test('collectValues: purchases use date field for recency ordering', () => {
  // Mirrors CostsScreen: recentValues(all.map(p => ({ date: p.date, value: p.item })))
  const itemsDef = LIST_DEFS.find((d) => d.id === 'purchase-items')!;
  const records: RecordsByStore = {
    purchases: [
      purchase({ id: 'pu-1', item: 'OlderItem', updatedAt: 9999, date: '2026-01-01' }),
      purchase({ id: 'pu-2', item: 'NewerItem', updatedAt: 1000, date: '2026-06-01' }),
    ],
  };
  const { visible } = collectValues(records, itemsDef, new Set());
  assert.equal(visible[0], 'NewerItem');
  assert.equal(visible[1], 'OlderItem');
});

test('LIST_DEFS: every source has a recencyField', () => {
  for (const def of LIST_DEFS) {
    for (const src of def.sources) {
      assert.ok(
        src.recencyField === 'date' || src.recencyField === 'updatedAt',
        `${def.id}/${src.store}/${src.field} missing recencyField`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Fix 1: mixed-source recency normalization
// A parts vendor updated more recently than a purchases vendor must rank first
// even though purchases use date (ISO) and parts use updatedAt (ms-epoch).
// ---------------------------------------------------------------------------

test('collectValues: parts vendor (updatedAt) ranks before purchases vendor (date) when more recent', () => {
  // purchases vendor last used 2026-01-15 (ISO date)
  // parts vendor updatedAt = Date.parse('2026-06-15') = epoch ms for June 15 2026
  // June 2026 is more recent than January 2026, so parts vendor must rank first.
  const juneDateMs = Date.parse('2026-06-15'); // ~1750xxx ms
  const records: RecordsByStore = {
    purchases: [purchase({ id: 'pu-1', vendor: 'PurchaseVendor', date: '2026-01-15', updatedAt: 1000 })],
    parts: [{ ...part({ id: 'pt-1', vendor: 'PartsVendor', updatedAt: juneDateMs }) }],
  };
  const { visible } = collectValues(records, vendorsDef, new Set());
  // 'PartsVendor' (parts, updatedAt = June 2026) must rank before 'PurchaseVendor' (purchases, date = Jan 2026)
  assert.equal(visible[0], 'PartsVendor', 'more-recent parts vendor must rank first');
  assert.equal(visible[1], 'PurchaseVendor');
});

test('collectValues: purchases vendor (date) ranks before parts vendor (updatedAt) when more recent', () => {
  // purchases vendor last used 2026-07-01 (July 2026) — most recent
  // parts vendor updatedAt = Date.parse('2026-01-01') = January 2026 — older
  const janDateMs = Date.parse('2026-01-01');
  const records: RecordsByStore = {
    purchases: [purchase({ id: 'pu-2', vendor: 'RecentPurchaseVendor', date: '2026-07-01', updatedAt: 1000 })],
    parts: [{ ...part({ id: 'pt-2', vendor: 'OlderPartsVendor', updatedAt: janDateMs }) }],
  };
  const { visible } = collectValues(records, vendorsDef, new Set());
  assert.equal(visible[0], 'RecentPurchaseVendor', 'more-recent purchases vendor must rank first');
  assert.equal(visible[1], 'OlderPartsVendor');
});
