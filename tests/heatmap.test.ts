import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../src/lib/types.ts';
import { buildHeatmap, heatLevel } from '../src/lib/heatmap.ts';

test('heatLevel thresholds', () => {
  assert.equal(heatLevel(0, 0), 0);
  assert.equal(heatLevel(0, 1), 1);   // dry-fire / no-round day still counts
  assert.equal(heatLevel(49, 1), 1);
  assert.equal(heatLevel(50, 1), 2);
  assert.equal(heatLevel(150, 1), 3);
  assert.equal(heatLevel(300, 1), 4);
});

const session = (s: Partial<Session>): Session => ({
  id: 's', createdAt: 0, updatedAt: 0, date: '2026-06-10', type: 'practice', guns: [],
  location: '', distances: '', notes: '', ammoUsage: [], drills: [], targetMediaIds: [],
  malfunctions: [], selfRating: null, rangeFee: null, planned: false, instructor: null,
  checklist: {}, ...s
} as Session);

test('buildHeatmap is weeks×7 and places a session on its day', () => {
  const now = new Date(2026, 5, 14); // Sun Jun 14 2026
  const grid = buildHeatmap([session({ date: '2026-06-10', guns: [{ firearmId: 'g', rounds: 200 }] })], 12, now);
  assert.equal(grid.length, 12);
  for (const col of grid) assert.equal(col.length, 7);
  // find the cell for 2026-06-10
  const cell = grid.flat().find((c) => c.date === '2026-06-10');
  assert.ok(cell);
  assert.equal(cell!.rounds, 200);
  assert.equal(cell!.level, 3);
});

test('buildHeatmap marks future padding days out of range and ignores planned', () => {
  const now = new Date(2026, 5, 10); // Wed Jun 10
  const grid = buildHeatmap([session({ date: '2026-06-20', planned: true, guns: [{ firearmId: 'g', rounds: 100 }] })], 4, now);
  const future = grid.flat().filter((c) => !c.inRange);
  assert.ok(future.length > 0);           // days after "now" in the last week
  assert.ok(future.every((c) => c.level === 0));
  // planned session contributes nothing
  assert.ok(grid.flat().every((c) => c.sessions === 0));
});
