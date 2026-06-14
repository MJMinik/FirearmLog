import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firearm, Optic, Part } from '../src/lib/types.ts';
import { buildPartsReportHtml, groupParts, partsTotals } from '../src/lib/partsReport.ts';

const part = (p: Partial<Part>): Part => ({
  id: 'pt-x', createdAt: 0, updatedAt: 0, firearmId: '', name: 'Part', quantity: 1,
  partNumber: '', datePurchased: '', notes: '', ...p
});

const optic = (o: Partial<Optic>): Optic => ({
  id: 'op-x', createdAt: 0, updatedAt: 0, firearmId: '', make: 'Holosun', model: '507C',
  installDate: '', dotSize: '', zeroDist: '', mountHeight: '', torqueSpec: '',
  settingsSnapshot: '', batteryLog: [], notes: '', ...o
});

const gun = (id: string, name: string): Firearm =>
  ({ id, name, category: 'Pistol', caliber: '9mm', createdAt: 0, updatedAt: 0 } as unknown as Firearm);

const firearms = [gun('g-apollo', 'Atlas Apollo'), gun('g-glock', 'Glock 47')];

test('groupParts: guns alphabetical, Any / Universal last, parts sorted by name', () => {
  const parts = [
    part({ id: 'p1', name: 'Recoil spring', firearmId: 'g-glock' }),
    part({ id: 'p2', name: 'Extractor', firearmId: 'g-apollo' }),
    part({ id: 'p3', name: 'Cleaning patch', firearmId: '' }),
    part({ id: 'p4', name: 'Firing pin', firearmId: 'g-apollo' })
  ];
  const groups = groupParts(parts, firearms);
  assert.deepEqual(groups.map((g) => g.heading), ['Atlas Apollo', 'Glock 47', 'Any / Universal']);
  // Apollo's parts sorted by name: Extractor, Firing pin
  assert.deepEqual(groups[0].parts.map((p) => p.name), ['Extractor', 'Firing pin']);
  assert.equal(groups[2].heading, 'Any / Universal');
});

test('groupParts: a missing firearm falls back to a dash heading', () => {
  const groups = groupParts([part({ firearmId: 'ghost' })], firearms);
  assert.equal(groups[0].heading, '—');
});

test('partsTotals sums distinct records, quantities, and cost', () => {
  const parts = [part({ quantity: 3, cost: 40 }), part({ quantity: 2, cost: 15 }), part({ quantity: 0 })];
  assert.deepEqual(partsTotals(parts), { distinct: 3, quantity: 5, cost: 55 });
});

test('buildPartsReportHtml includes parts, group headings, totals — and escapes', () => {
  const parts = [
    part({ name: 'Recoil <spring>', firearmId: 'g-glock', quantity: 4, partNumber: 'RS-9' }),
    part({ name: 'Cleaning patch', firearmId: '', quantity: 50 })
  ];
  const html = buildPartsReportHtml({ parts, firearms, today: '2026-06-14' });
  assert.match(html, /Spare Parts &amp; Inventory/);
  assert.match(html, /Glock 47/);
  assert.match(html, /Any \/ Universal/);
  assert.match(html, /Recoil &lt;spring&gt;/); // escaped, not raw
  assert.match(html, /RS-9/);
  assert.match(html, /2 parts on hand/);
  assert.match(html, /54 items total/);
});

test('buildPartsReportHtml lists unassigned optics in their own section', () => {
  const html = buildPartsReportHtml({
    parts: [], firearms, optics: [optic({ make: 'Trijicon', model: 'RMR HD' })], today: '2026-06-14'
  });
  assert.match(html, /Unassigned Optics/);
  assert.match(html, /Trijicon RMR HD/);
});

test('buildPartsReportHtml handles a completely empty inventory', () => {
  const html = buildPartsReportHtml({ parts: [], firearms, optics: [], today: '2026-06-14' });
  assert.match(html, /Nothing in inventory yet/);
});
