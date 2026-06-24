import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrillReportHtml, scoringLabel, type DrillReportItem } from '../src/lib/drillReport.ts';

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

test('scoringLabel humanizes the old codes, hides none, passes free text through', () => {
  assert.equal(scoringLabel('time_score'), 'Time / Score');
  assert.equal(scoringLabel('time'), 'Time');
  assert.equal(scoringLabel('score'), 'Score');
  assert.equal(scoringLabel('none'), '');
  assert.equal(scoringLabel('Par 2.0s'), 'Par 2.0s');
});

test('report shows the humanized scoring code, not the raw value', () => {
  const html = buildDrillReportHtml([item({ scoring: 'time_score' })], { includeScoring: true });
  assert.match(html, /Time \/ Score/);
  assert.doesNotMatch(html, /time_score/);
});

test('drill report escapes user text and handles an empty list', () => {
  const html = buildDrillReportHtml([item({ name: 'A & <B>' })], { includeScoring: false });
  assert.match(html, /A &amp; &lt;B&gt;/);
  assert.match(buildDrillReportHtml([], { includeScoring: true }), /No drills scheduled yet/);
});

test('drill report prints attached target images with their markup legend', () => {
  const html = buildDrillReportHtml([item({
    targets: [{ src: 'data:image/jpeg;base64,AAAA', legend: ['A-zone hits', 'Low left'] }]
  })], { includeScoring: false });
  assert.match(html, /<img class="target" src="data:image\/jpeg;base64,AAAA"/);
  assert.match(html, /A-zone hits/);
  assert.match(html, /Low left/);
});

test('drill with no target adds no image block', () => {
  const html = buildDrillReportHtml([item({})], { includeScoring: false });
  assert.doesNotMatch(html, /class="target"/);
});
