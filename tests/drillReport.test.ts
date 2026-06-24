import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrillReportHtml, type DrillReportItem } from '../src/lib/drillReport.ts';

const item = (o: Partial<DrillReportItem>): DrillReportItem => ({
  name: 'Bill Drill', brief: '6 shots from holster at 7 yards.',
  distance: '', time: null, score: null, maxScore: null, ...o
});

test('planned sheet: headers, the drill, its description, and blank fill-in boxes', () => {
  const html = buildDrillReportHtml([item({})], { planned: true, date: '2026-06-14', location: 'Shoot Straight' });
  assert.match(html, /Drills for this session/);
  assert.match(html, /Bill Drill/);
  assert.match(html, /6 shots from holster/);
  assert.match(html, /<th>Distance<\/th>/);
  assert.match(html, /<th>Time \(s\)<\/th>/);
  assert.match(html, /<th>Score<\/th>/);
  assert.match(html, /<th>Out of<\/th>/);
  assert.match(html, /class="box"/);
  assert.match(html, /Fill in your results/);
  assert.match(html, /Shoot Straight/);
});

test('planned pre-fills a set distance but leaves Time/Score/Out-of as boxes', () => {
  const html = buildDrillReportHtml([item({ distance: '7 yd' })], { planned: true });
  assert.match(html, /<div class="val">7 yd<\/div>/);          // distance pre-filled
  assert.equal((html.match(/class="box"/g) || []).length, 3); // the other three stay blank
});

test('logged sheet fills the recorded results and uses no fill-in boxes', () => {
  const html = buildDrillReportHtml(
    [item({ distance: '5 yd', time: 2.6, score: 5, maxScore: 6 })],
    { planned: false }
  );
  assert.match(html, /<div class="val">5 yd<\/div>/);
  assert.match(html, /<div class="val">2\.6<\/div>/);
  assert.match(html, /<div class="val">5<\/div>/);
  assert.match(html, /<div class="val">6<\/div>/);
  assert.doesNotMatch(html, /class="box"/);
  assert.doesNotMatch(html, /Fill in your results/);
});

test('escapes user text and handles an empty list', () => {
  const html = buildDrillReportHtml([item({ name: 'A & <B>' })], { planned: false });
  assert.match(html, /A &amp; &lt;B&gt;/);
  assert.match(buildDrillReportHtml([], { planned: true }), /No drills scheduled yet/);
});
