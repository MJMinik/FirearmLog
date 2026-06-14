import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Goal } from '../src/lib/types.ts';
import { goalCategories, goalStats, sortGoals } from '../src/lib/goals.ts';

const goal = (g: Partial<Goal>): Goal => ({
  id: 'go-x', createdAt: 0, updatedAt: 0, text: 'Goal', category: '', target: '',
  achieved: false, dateSet: '2026-01-01', dateAchieved: '', ...g
});

test('sortGoals: open first (newest set), then achieved (newest achieved)', () => {
  const goals = [
    goal({ id: 'a', achieved: true, dateAchieved: '2026-02-01' }),
    goal({ id: 'b', achieved: false, dateSet: '2026-01-01' }),
    goal({ id: 'c', achieved: false, dateSet: '2026-03-01' }),
    goal({ id: 'd', achieved: true, dateAchieved: '2026-05-01' })
  ];
  assert.deepEqual(sortGoals(goals).map((g) => g.id), ['c', 'b', 'd', 'a']);
});

test('goalStats counts open and achieved', () => {
  const goals = [goal({ achieved: true }), goal({ achieved: false }), goal({ achieved: false })];
  assert.deepEqual(goalStats(goals), { open: 2, achieved: 1, total: 3 });
});

test('goalCategories: distinct, case-insensitive, alphabetical, blanks dropped', () => {
  const goals = [goal({ category: 'Speed' }), goal({ category: 'accuracy' }), goal({ category: 'speed' }), goal({ category: '' })];
  assert.deepEqual(goalCategories(goals), ['accuracy', 'Speed']);
});
