// The select-options rule behind the 5 August 2026 defect: a shooter changed the
// division away from what PractiScore recorded and could not get back to it,
// because the "(as scored)" option existed only while it was the current value.
// His words: "There was no way to change it back to -0-".
//
// These test the RULE, not the instance — the question each one asks is whether
// the value is reachable, so a future edit that reintroduces the bug in a
// different shape still fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldOptions } from '../src/lib/selectOptions.ts';

const DIVISIONS = ['Carry Optics', 'Open', 'Limited', 'Limited Optics', 'Production', 'Single Stack', 'Revolver', 'PCC', 'Other'];
const values = (o: { value: string }[]) => o.map((x) => x.value);

test('the as-scored value is offered when it is not one of ours', () => {
  const o = fieldOptions(DIVISIONS, 'O', 'O');
  assert.equal(o[0].value, 'O');
  assert.equal(o[0].label, 'O (as scored)');
});

test('the as-scored value is STILL offered after the shooter picks something else — the actual defect', () => {
  const o = fieldOptions(DIVISIONS, 'O', 'Carry Optics');
  assert.ok(values(o).includes('O'), 'the as-scored option was removed once it stopped being selected');
  assert.equal(o[0].label, 'O (as scored)');
});

test('the round trip is reachable: away and back, at every stop', () => {
  for (const stop of DIVISIONS) {
    const o = fieldOptions(DIVISIONS, 'O', stop);
    assert.ok(values(o).includes('O'), `cannot get back to "O" from "${stop}"`);
    assert.ok(values(o).includes(stop), `"${stop}" is not in its own list`);
  }
});

test('whatever is selected always has an option, so the screen cannot show one value and save another', () => {
  for (const [asScored, current] of [['O', 'O'], ['O', 'Open'], ['', ''], ['', 'Open'], ['Open', 'Open'], ['X', 'Y']]) {
    const o = fieldOptions(DIVISIONS, asScored, current);
    assert.ok(values(o).includes(current), `selected value "${current}" has no option`);
  }
});

test('a non-empty as-scored value always has an option, selected or not', () => {
  for (const current of ['O', '', 'Open', 'PCC']) {
    assert.ok(values(fieldOptions(DIVISIONS, 'O', current)).includes('O'), `as-scored "O" unreachable from "${current}"`);
  }
});

test('a BLANK as-scored value earns an option only when blank is what is selected', () => {
  // The screen seeds power factor to 'Minor' when the results left the cell
  // empty, so blank is not a state the form can hold and must not be offerable.
  // Division has no such fallback, so blank IS the state and must be shown.
  // Getting this wrong made an empty power factor selectable, and an empty
  // power factor scores as Minor everywhere downstream while claiming not to be
  // recorded.
  assert.deepEqual(values(fieldOptions(['Minor', 'Major'], '', 'Minor')), ['Minor', 'Major']);
  assert.equal(fieldOptions(DIVISIONS, '', '')[0].label, 'Not recorded');
});

test('nothing is duplicated when the as-scored value IS one of ours', () => {
  const o = fieldOptions(DIVISIONS, 'Open', 'Open');
  assert.deepEqual(values(o), DIVISIONS);
  assert.equal(new Set(values(o)).size, o.length);
});

test('no duplicate values in any combination — a repeated value is a React key collision', () => {
  for (const asScored of ['O', '', 'Open', 'Min', 'Other']) {
    for (const current of ['O', '', 'Open', 'PCC', 'Min', 'Other']) {
      const v = values(fieldOptions(DIVISIONS, asScored, current));
      assert.equal(new Set(v).size, v.length, `duplicate option for asScored="${asScored}" current="${current}"`);
    }
  }
});

test('power factor behaves the same way — Min is reachable after picking Minor', () => {
  const PF = ['Minor', 'Major'];
  assert.ok(values(fieldOptions(PF, 'Min', 'Minor')).includes('Min'));
  assert.equal(fieldOptions(PF, 'Min', 'Min')[0].label, 'Min (as scored)');
});

test('our own list is never reordered or dropped', () => {
  const o = fieldOptions(DIVISIONS, 'O', 'Carry Optics');
  assert.deepEqual(values(o).filter((v) => DIVISIONS.includes(v)), DIVISIONS);
});
