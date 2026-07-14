// F4 — unit tests for the shared chart-furniture math (session 62).
import test from 'node:test';
import assert from 'node:assert/strict';
import { thinIndices, midTicks, daySpan, chartDateLabel, dateMode, labeledTicks, formatMetricTick } from '../src/lib/chartFurniture.ts';

test('thinIndices labels everything when it fits', () => {
  assert.deepEqual(thinIndices(1, 4), [0]);
  assert.deepEqual(thinIndices(2, 4), [0, 1]);
  assert.deepEqual(thinIndices(4, 4), [0, 1, 2, 3]);
});

test('thinIndices always keeps the first and last anchors', () => {
  for (const n of [5, 9, 12, 30, 200]) {
    const idxs = thinIndices(n, 4);
    assert.equal(idxs[0], 0, `n=${n} first`);
    assert.equal(idxs[idxs.length - 1], n - 1, `n=${n} last`);
    assert.ok(idxs.length <= 4, `n=${n} at most 4 labels`);
    // strictly increasing — no duplicate or out-of-order labels
    for (let i = 1; i < idxs.length; i++) assert.ok(idxs[i] > idxs[i - 1]);
  }
});

test('thinIndices spreads labels roughly evenly', () => {
  const idxs = thinIndices(31, 4); // 0 .. 30
  assert.deepEqual(idxs, [0, 10, 20, 30]);
});

test('thinIndices edge inputs', () => {
  assert.deepEqual(thinIndices(0, 4), []);
  // a degenerate maxLabels still yields the two anchors
  assert.deepEqual(thinIndices(10, 1), [0, 9]);
});

test('midTicks gives hi/mid/lo, collapsing a flat domain', () => {
  assert.deepEqual(midTicks(80, 100), [100, 90, 80]);
  assert.deepEqual(midTicks(1.5, 2.5), [2.5, 2, 1.5]);
  assert.deepEqual(midTicks(7, 7), [7]);
});

test('daySpan counts days between day-keys, order-independent', () => {
  assert.equal(daySpan('2026-03-01', '2026-03-15'), 14);
  assert.equal(daySpan('2026-03-15', '2026-03-01'), 14);
  assert.equal(daySpan('2025-07-14', '2026-07-14'), 365);
  assert.equal(daySpan('2026-01-01', '2026-01-01'), 0);
  assert.equal(daySpan('garbage', '2026-01-01'), 0); // malformed input fails safe
});

test('chartDateLabel renders both modes and fails safe on garbage', () => {
  assert.equal(chartDateLabel('2026-03-14', 'day'), 'Mar 14');
  assert.equal(chartDateLabel('2026-03-04', 'day'), 'Mar 4'); // no zero-padding
  assert.equal(chartDateLabel('2026-03-14', 'year'), "Mar '26");
  assert.equal(chartDateLabel('2025-11-02', 'year'), "Nov '25");
  assert.equal(chartDateLabel('not-a-key', 'day'), 'not-a-key'); // fails safe, shows raw
});

test('dateMode: day form inside a year, year form beyond', () => {
  assert.equal(dateMode('2026-03-01', '2026-06-15'), 'day');
  assert.equal(dateMode('2025-01-01', '2026-06-15'), 'year');
});

test('dateMode: two different anchors that would print identically force year form', () => {
  // Exactly 365 days apart — "Jul 14" twice would be worse than no dates.
  assert.equal(dateMode('2025-07-14', '2026-07-14'), 'year');
  // Same actual date is fine in day form (a single-day series).
  assert.equal(dateMode('2026-07-14', '2026-07-14'), 'day');
});

test('labeledTicks dedupes labels a near-flat domain would repeat', () => {
  const fmt = (v: number) => `${v.toFixed(2)}s`;
  assert.deepEqual(labeledTicks(1.5, 2.5, fmt).map((t) => t.label), ['2.50s', '2.00s', '1.50s']);
  // 2.001 vs 2.002 all format to "2.00s" — one tick, not three copies.
  assert.deepEqual(labeledTicks(2.001, 2.002, fmt).map((t) => t.label), ['2.00s']);
  assert.deepEqual(labeledTicks(7, 7, (v) => String(v)).map((t) => t.label), ['7']);
});

test('formatMetricTick is unit-aware by scoring style', () => {
  assert.equal(formatMetricTick(1.85, 'time'), '1.85s');
  assert.equal(formatMetricTick(6.512, 'time_score'), 'HF 6.51');
  assert.equal(formatMetricTick(42, 'score'), '42');
  assert.equal(formatMetricTick(42.25, 'score'), '42.3');
});
