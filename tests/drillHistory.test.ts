import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drillHistory, drillMetric, drillLowerIsBetter } from '../src/lib/dashboard.ts';
import type { DrillResult, Session } from '../src/lib/types.ts';

// ---- fixtures ----
function dr(name: string, o: Partial<DrillResult> = {}): DrillResult {
  return { name, distance: '', time: null, score: null, maxScore: null, notes: '', ...o };
}
function sess(id: string, date: string, drills: DrillResult[]): Pick<Session, 'id' | 'date' | 'drills'> {
  return { id, date, drills };
}
const defs = [
  { name: 'Bill Drill', scoring: 'time' },
  { name: 'Dot Torture', scoring: 'score' },
  { name: 'El Prez', scoring: 'time_score' },
];

test('drillMetric picks the right number per scoring style', () => {
  assert.equal(drillMetric({ time: 2, score: null }, 'time'), 2);
  assert.equal(drillMetric({ time: 0, score: null }, 'time'), null); // 0s isn't a real time
  assert.equal(drillMetric({ time: null, score: 45 }, 'score'), 45);
  assert.equal(drillMetric({ time: 5, score: 50 }, 'time_score'), 10); // hit factor
  assert.equal(drillMetric({ time: null, score: null }, 'time'), null);
});

test('drillLowerIsBetter is true only for time drills', () => {
  assert.equal(drillLowerIsBetter('time'), true);
  assert.equal(drillLowerIsBetter('score'), false);
  assert.equal(drillLowerIsBetter('time_score'), false);
});

test('time drill: newest-first list, best is the lowest time', () => {
  const sessions = [
    sess('s1', '2026-01-01', [dr('Bill Drill', { time: 2.5 })]),
    sess('s2', '2026-02-01', [dr('Bill Drill', { time: 2.0 })]),
    sess('s3', '2026-03-01', [dr('Bill Drill', { time: 2.2 })]),
  ];
  const h = drillHistory(sessions, defs, 'Bill Drill');
  assert.equal(h.attempts.length, 3);
  assert.equal(h.attempts[0].date, '2026-03-01'); // newest first
  assert.equal(h.attempts[2].date, '2026-01-01');
  assert.equal(h.lowerIsBetter, true);
  assert.equal(h.best?.time, 2.0);
  assert.equal(h.best?.date, '2026-02-01');
  assert.equal(h.best?.sessionId, 's2');
  assert.equal(h.attempts[0].metric, 2.2); // metric = raw time for a time drill
});

test('score drill: best is the highest score', () => {
  const sessions = [
    sess('s1', '2026-01-01', [dr('Dot Torture', { score: 45, maxScore: 50 })]),
    sess('s2', '2026-02-01', [dr('Dot Torture', { score: 50, maxScore: 50 })]),
    sess('s3', '2026-03-01', [dr('Dot Torture', { score: 48, maxScore: 50 })]),
  ];
  const h = drillHistory(sessions, defs, 'Dot Torture');
  assert.equal(h.best?.score, 50);
  assert.equal(h.best?.date, '2026-02-01');
  assert.equal(h.lowerIsBetter, false);
});

test('time+score drill: best is the highest hit factor', () => {
  const sessions = [
    sess('s1', '2026-01-01', [dr('El Prez', { score: 40, time: 5 })]),  // hf 8
    sess('s2', '2026-02-01', [dr('El Prez', { score: 50, time: 5 })]),  // hf 10 (best)
    sess('s3', '2026-03-01', [dr('El Prez', { score: 45, time: 6 })]),  // hf 7.5
  ];
  const h = drillHistory(sessions, defs, 'El Prez');
  assert.equal(h.best?.sessionId, 's2');
  assert.equal(h.best?.metric, 10);
});

test('a drill never run returns no attempts and no best', () => {
  const sessions = [sess('s1', '2026-01-01', [dr('Bill Drill', { time: 2 })])];
  const h = drillHistory(sessions, defs, 'Mozambique');
  assert.equal(h.attempts.length, 0);
  assert.equal(h.best, null);
});

test('unscoreable attempts still list, but yield no best', () => {
  const sessions = [
    sess('s1', '2026-01-01', [dr('Bill Drill', { time: null, notes: 'forgot the timer' })]),
    sess('s2', '2026-02-01', [dr('Bill Drill', { time: null })]),
  ];
  const h = drillHistory(sessions, defs, 'Bill Drill');
  assert.equal(h.attempts.length, 2);
  assert.equal(h.attempts[0].metric, null);
  assert.equal(h.best, null);
});

test('best is found across multiple attempts in one session too', () => {
  const sessions = [
    sess('s1', '2026-01-01', [dr('Bill Drill', { time: 2.4 }), dr('Bill Drill', { time: 1.9 })]),
  ];
  const h = drillHistory(sessions, defs, 'Bill Drill');
  assert.equal(h.attempts.length, 2);
  assert.equal(h.best?.time, 1.9);
});
