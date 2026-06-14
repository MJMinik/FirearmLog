import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SkillAssessment } from '../src/lib/types.ts';
import { SKILL_AREAS, assessmentAverage, assessmentsByDate, latestAssessment } from '../src/lib/skills.ts';

const sa = (s: Partial<SkillAssessment>): SkillAssessment => ({
  id: 'sk-x', createdAt: 0, updatedAt: 0, date: '2026-01-01', ratings: {}, notes: '', ...s
});

test('the 8 skill areas are present and stable', () => {
  assert.equal(SKILL_AREAS.length, 8);
  assert.deepEqual(SKILL_AREAS.map((a) => a.key),
    ['draw', 'reload', 'splits', 'transitions', 'accuracy', 'movement', 'mental', 'recoil']);
});

test('assessmentAverage means the rated areas, ignoring blanks/zeros', () => {
  assert.equal(assessmentAverage({}), null);
  assert.equal(assessmentAverage({ draw: 8, reload: 6 }), 7);
  assert.equal(assessmentAverage({ draw: 10, reload: 0, splits: 5 }), 7.5); // zero ignored
});

test('latestAssessment picks the newest date; assessmentsByDate sorts oldest first', () => {
  const list = [sa({ id: 'a', date: '2026-01-01' }), sa({ id: 'b', date: '2026-05-01' }), sa({ id: 'c', date: '2026-03-01' })];
  assert.equal(latestAssessment(list)?.id, 'b');
  assert.equal(latestAssessment([]), null);
  assert.deepEqual(assessmentsByDate(list).map((x) => x.id), ['a', 'c', 'b']);
});
