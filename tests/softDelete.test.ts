// App 7 — soft-delete rules, pinned by tests. These prove a trashed session is
// excluded from "active" lists (the blast-radius guarantee) and that the 30-day
// window math is correct.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRASH_WINDOW_DAYS, isTrashed, activeOnly, trashedOnly, trashedIdSet,
  activeMalfunctions, daysLeft, isExpired, expiredOnly
} from '../src/lib/softDelete.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 23); // 2026-06-23

function ses(id: string, deletedAt?: number | null) {
  return { id, deletedAt };
}

test('isTrashed only counts a real positive timestamp', () => {
  assert.equal(isTrashed(ses('a')), false);            // undefined
  assert.equal(isTrashed(ses('a', null)), false);      // explicit null (restored)
  assert.equal(isTrashed(ses('a', 0)), false);         // 0 is not a real stamp
  assert.equal(isTrashed(ses('a', NOW)), true);
});

test('activeOnly drops trashed; trashedOnly keeps only trashed, newest first', () => {
  const list = [ses('live1'), ses('t1', NOW - 5 * DAY), ses('live2'), ses('t2', NOW - DAY)];
  assert.deepEqual(activeOnly(list).map((r) => r.id), ['live1', 'live2']);
  assert.deepEqual(trashedOnly(list).map((r) => r.id), ['t2', 't1']); // newest deletion first
});

test('trashedIdSet + activeMalfunctions exclude a trashed session\'s malfunctions', () => {
  const sessions = [ses('keep'), ses('gone', NOW)];
  const ids = trashedIdSet(sessions);
  assert.deepEqual([...ids], ['gone']);
  const malfs = [
    { id: 'm1', sessionId: 'keep' },
    { id: 'm2', sessionId: 'gone' },   // belongs to a trashed session — drop it
    { id: 'm3', sessionId: null },     // standalone — keep it
    { id: 'm4' }                       // no sessionId — keep it
  ];
  assert.deepEqual(activeMalfunctions(malfs, ids).map((m) => m.id), ['m1', 'm3', 'm4']);
});

test('daysLeft counts down whole days and floors at 0', () => {
  assert.equal(daysLeft(NOW, NOW), TRASH_WINDOW_DAYS);          // just deleted
  assert.equal(daysLeft(NOW - 5 * DAY, NOW), TRASH_WINDOW_DAYS - 5);
  assert.equal(daysLeft(NOW - 29 * DAY, NOW), 1);
  assert.equal(daysLeft(NOW - 40 * DAY, NOW), 0);              // never negative
});

test('isExpired / expiredOnly fire exactly at the 30-day boundary', () => {
  assert.equal(isExpired(NOW - 29 * DAY, NOW), false);
  assert.equal(isExpired(NOW - TRASH_WINDOW_DAYS * DAY, NOW), true);
  const list = [ses('fresh', NOW - DAY), ses('old', NOW - 31 * DAY), ses('live')];
  assert.deepEqual(expiredOnly(list, NOW).map((r) => r.id), ['old']);
});
