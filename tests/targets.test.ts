import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_TARGETS, buildTargetsPrintHtml, targetById } from '../src/lib/targets.ts';

test('STANDARD_TARGETS has the expected ids and each carries an SVG', () => {
  const ids = STANDARD_TARGETS.map((t) => t.id);
  assert.deepEqual(ids, ['uspsa', 'b8', 'zero', '5dot']);
  for (const t of STANDARD_TARGETS) {
    assert.match(t.svg, /<svg/);
    assert.ok(t.printWidthIn > 0);
  }
});

test('targetById finds a target or returns undefined', () => {
  assert.equal(targetById('b8')?.name, 'B-8 bullseye (25 yd)');
  assert.equal(targetById(''), undefined);
  assert.equal(targetById(undefined), undefined);
  assert.equal(targetById('nope'), undefined);
});

test('buildTargetsPrintHtml embeds each target name + svg, one per page', () => {
  const html = buildTargetsPrintHtml([targetById('b8')!, targetById('zero')!]);
  assert.match(html, /B-8 bullseye/);
  assert.match(html, /zeroing grid/);
  assert.match(html, /page-break-after/);
  assert.equal((html.match(/<svg/g) ?? []).length, 2);
});

test('buildTargetsPrintHtml handles an empty selection', () => {
  const html = buildTargetsPrintHtml([]);
  assert.match(html, /None of the chosen drills has a printable target/);
});
