import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrillReportHtml, type DrillReportItem } from '../src/lib/drillReport.ts';

const item = (o: Partial<DrillReportItem>): DrillReportItem => ({
  name: 'Bill Drill', fire: 'live', gunCategories: ['Pistol'],
  brief: '6 shots from the holster at 7 yards.', full: '', scoring: 'Par 2.0s',
  requiresHolster: true, distance: '7 yd', ...o
});

test('drill report lists drills, brief, distance, and the fire/category tags', () => {
  const html = buildDrillReportHtml([item({})], { includeScoring: false, date: '2026-06-14', location: 'Shoot Straight' });
  assert.match(html, /Drills for This Session/);
  assert.match(html, /Bill Drill/);
  assert.match(html, /6 shots from the holster/);
  assert.match(html, /Live fire/);
  assert.match(html, /Holster/);
  assert.match(html, /7 yd/);
  assert.match(html, /Shoot Straight/);
});

test('includeScoring shows or hides the scoring line', () => {
  const withScore = buildDrillReportHtml([item({})], { includeScoring: true });
  const without = buildDrillReportHtml([item({})], { includeScoring: false });
  assert.match(withScore, /Par 2\.0s/);
  assert.doesNotMatch(without, /Par 2\.0s/);
});

test('drill report escapes user text and handles an empty list', () => {
  const html = buildDrillReportHtml([item({ name: 'A & <B>' })], { includeScoring: false });
  assert.match(html, /A &amp; &lt;B&gt;/);
  assert.match(buildDrillReportHtml([], { includeScoring: true }), /No drills scheduled yet/);
});
