// App 3b — the Malfunctions list search/filter brain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyMalfFilter, malfFilterCount, filterMalfunctions, distinctTypes, malfunctionMatchesFilter
} from '../src/lib/malfunctionFilter.ts';
import type { MalfunctionEntry } from '../src/lib/types.ts';

function mf(p: Partial<MalfunctionEntry>): MalfunctionEntry {
  return {
    id: p.id ?? 'mf' + Math.random(), createdAt: 0, updatedAt: 0,
    sessionId: p.sessionId ?? 's1', date: p.date ?? '2026-06-01',
    firearmId: p.firearmId ?? 'g1', type: p.type ?? 'Stovepipe',
    resolution: p.resolution ?? 'Tap-Rack-Bang', notes: p.notes ?? '',
    ammoId: p.ammoId ?? null, magazineId: p.magazineId ?? null, roundCount: p.roundCount ?? null,
  } as MalfunctionEntry;
}

const data: MalfunctionEntry[] = [
  mf({ id: 'a', date: '2026-06-10', firearmId: 'g1', type: 'Stovepipe', ammoId: 'am1', magazineId: 'mg1', notes: 'cold gun' }),
  mf({ id: 'b', date: '2026-06-05', firearmId: 'g2', type: 'Double feed', ammoId: 'am2', magazineId: 'mg1' }),
  mf({ id: 'c', date: '2026-05-20', firearmId: 'g1', type: 'Failure to feed', ammoId: 'am1', magazineId: 'mg2' }),
  mf({ id: 'd', date: '2026-06-01', firearmId: 'g1', type: 'Stovepipe', ammoId: null, magazineId: null }),
];

test('empty filter returns everything, newest date first', () => {
  const out = filterMalfunctions(data, emptyMalfFilter()).map((m) => m.id);
  assert.deepEqual(out, ['a', 'b', 'd', 'c']); // 06-10, 06-05, 06-01, 05-20
});

test('filter by gun', () => {
  const out = filterMalfunctions(data, { ...emptyMalfFilter(), firearmId: 'g1' }).map((m) => m.id);
  assert.deepEqual(out, ['a', 'd', 'c']);
});

test('filter by type (exact)', () => {
  const out = filterMalfunctions(data, { ...emptyMalfFilter(), type: 'Stovepipe' }).map((m) => m.id);
  assert.deepEqual(out, ['a', 'd']);
});

test('filter by ammo and by magazine', () => {
  assert.deepEqual(filterMalfunctions(data, { ...emptyMalfFilter(), ammoId: 'am1' }).map((m) => m.id), ['a', 'c']);
  assert.deepEqual(filterMalfunctions(data, { ...emptyMalfFilter(), magazineId: 'mg1' }).map((m) => m.id), ['a', 'b']);
});

test('date range is inclusive on both ends', () => {
  const out = filterMalfunctions(data, { ...emptyMalfFilter(), from: '2026-06-01', to: '2026-06-05' }).map((m) => m.id);
  assert.deepEqual(out, ['b', 'd']); // 06-05 before 06-01
});

test('text query matches across type, resolution, and notes (all words must hit)', () => {
  assert.deepEqual(filterMalfunctions(data, { ...emptyMalfFilter(), query: 'cold' }).map((m) => m.id), ['a']);
  assert.deepEqual(filterMalfunctions(data, { ...emptyMalfFilter(), query: 'double feed' }).map((m) => m.id), ['b']);
  assert.deepEqual(filterMalfunctions(data, { ...emptyMalfFilter(), query: 'tap rack' }).map((m) => m.id), ['a', 'b', 'd', 'c']);
});

test('combined filters AND together', () => {
  const out = filterMalfunctions(data, { ...emptyMalfFilter(), firearmId: 'g1', type: 'Stovepipe', ammoId: 'am1' }).map((m) => m.id);
  assert.deepEqual(out, ['a']);
});

test('malfFilterCount counts active criteria; date range counts once', () => {
  assert.equal(malfFilterCount(emptyMalfFilter()), 0);
  assert.equal(malfFilterCount({ ...emptyMalfFilter(), from: '2026-01-01', to: '2026-12-31' }), 1);
  assert.equal(malfFilterCount({ ...emptyMalfFilter(), firearmId: 'g1', type: 'Stovepipe', query: 'x' }), 3);
});

test('distinctTypes is sorted and de-duplicated', () => {
  assert.deepEqual(distinctTypes(data), ['Double feed', 'Failure to feed', 'Stovepipe']);
});

test('a malfunction with no date is excluded once a date bound is set', () => {
  const noDate = mf({ id: 'z', date: '' });
  assert.equal(malfunctionMatchesFilter(noDate, emptyMalfFilter()), true);
  assert.equal(malfunctionMatchesFilter(noDate, { ...emptyMalfFilter(), from: '2026-01-01' }), false);
});
