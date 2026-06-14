import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportHtml } from '../src/lib/reports.ts';

test('buildReportHtml renders title, subtitle, rows and a table; escapes text', () => {
  const html = buildReportHtml('Round Count', 'All time', [
    { heading: 'Per Gun', rows: [{ label: 'Atlas <Erebus>', value: '7,520' }] },
    { heading: 'By Category', table: { headers: ['Category', 'Rounds'], rows: [['Pistol', '7,000'], ['Shotgun', '520']] } }
  ]);
  assert.match(html, /Round Count/);
  assert.match(html, /All time/);
  assert.match(html, /Atlas &lt;Erebus&gt;/); // escaped
  assert.match(html, /7,520/);
  assert.match(html, /<table>/);
  assert.match(html, /Shotgun/);
});

test('buildReportHtml embeds images and handles empty sections', () => {
  const withImg = buildReportHtml('Insurance', '', [{ heading: 'Photos', images: ['data:image/png;base64,AAAA'] }]);
  assert.match(withImg, /<img src="data:image\/png;base64,AAAA"/);
  assert.match(buildReportHtml('Empty', '', []), /Nothing to report yet/);
});

test('a table with no rows is omitted', () => {
  const html = buildReportHtml('T', '', [{ heading: 'Empty table', table: { headers: ['A'], rows: [] } }]);
  assert.doesNotMatch(html, /<table>/);
});
