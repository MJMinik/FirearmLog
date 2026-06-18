import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../src/lib/types.ts';
import { buildHeatmap, heatLevel, monthLabels, sessionsOnDay } from '../src/lib/heatmap.ts';

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

test('monthLabels: leftmost column is labeled and columns strictly increase', () => {
  const grid = buildHeatmap([], 52, new Date(2026, 5, 18)); // 52 weeks ending Jun 18 2026
  const labels = monthLabels(grid);
  assert.equal(labels[0].col, 0);
  for (let i = 1; i < labels.length; i++) assert.ok(labels[i].col > labels[i - 1].col);
  for (const l of labels) assert.match(l.text, /^[A-Z][a-z]{2}$/);
});

test('monthLabels: 52 weeks spans ~13 months, 26 weeks spans ~7', () => {
  const long = monthLabels(buildHeatmap([], 52, new Date(2026, 5, 18)));
  const short = monthLabels(buildHeatmap([], 26, new Date(2026, 5, 18)));
  assert.ok(long.length >= 12 && long.length <= 14, `52wk labels: ${long.length}`);
  assert.ok(short.length >= 6 && short.length <= 8, `26wk labels: ${short.length}`);
});

test('sessionsOnDay returns only that day\'s real sessions, skipping planned', () => {
  const ss = [
    session({ id: 'a', date: '2026-06-10' }),
    session({ id: 'b', date: '2026-06-10' }),
    session({ id: 'c', date: '2026-06-11' }),
    session({ id: 'p', date: '2026-06-10', planned: true })
  ];
  const ids = sessionsOnDay(ss, '2026-06-10').map((s) => s.id);
  assert.deepEqual(ids, ['a', 'b']);
  assert.equal(sessionsOnDay(ss, '2026-06-12').length, 0);
});
