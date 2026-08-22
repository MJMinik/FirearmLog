import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magsNeedingCleaning } from '../src/lib/magCleaning.ts';

// Minimal Magazine/Match shapes — only the fields magsNeedingCleaning reads,
// same "as never" convention the other bare-fixture unit tests use.
const mag = (over: object = {}) => ({ id: 'mg-a', label: 'A01', active: true, ...over }) as never;
const match = (over: object = {}) =>
  ({ id: 'm1', name: 'Test Match', date: '2026-08-10', magConditions: [], ...over }) as never;

test('a tagging match with no lastCleanedAt on the mag flags it', () => {
  const mags = [mag()];
  const matches = [match({ magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out.length, 1);
  assert.equal(out[0].magId, 'mg-a');
  assert.equal(out[0].tag, 'sand');
});

test('a match dated BEFORE lastCleanedAt does not flag', () => {
  const mags = [mag({ lastCleanedAt: '2026-08-15' })];
  const matches = [match({ date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  assert.deepEqual(magsNeedingCleaning(mags, matches), []);
});

test('a match dated AFTER lastCleanedAt flags', () => {
  const mags = [mag({ lastCleanedAt: '2026-08-05' })];
  const matches = [match({ date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out.length, 1);
});

test('a match dated the SAME DAY as lastCleanedAt does NOT flag (accepted edge)', () => {
  const mags = [mag({ lastCleanedAt: '2026-08-10' })];
  const matches = [match({ date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  assert.deepEqual(magsNeedingCleaning(mags, matches), []);
});

test('a soft-deleted match is ignored entirely', () => {
  const mags = [mag()];
  const matches = [match({ deletedAt: Date.now(), magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  assert.deepEqual(magsNeedingCleaning(mags, matches), []);
});

test('a retired mag (active: false) is excluded even with a qualifying tag', () => {
  const mags = [mag({ active: false })];
  const matches = [match({ magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  assert.deepEqual(magsNeedingCleaning(mags, matches), []);
});

test('an empty tag never counts', () => {
  const mags = [mag()];
  const matches = [match({ magConditions: [{ magId: 'mg-a', tag: '' }] })];
  assert.deepEqual(magsNeedingCleaning(mags, matches), []);
});

test('an undated match qualifies regardless of lastCleanedAt', () => {
  const mags = [mag({ lastCleanedAt: '2026-08-20' })]; // a very recent cleaning
  const matches = [match({ date: undefined, magConditions: [{ magId: 'mg-a', tag: 'mud' }] })];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out.length, 1);
  assert.equal(out[0].matchDate, undefined);
});

test('moreCount counts extra qualifying matches, and the detail string appends "(+N more)"', () => {
  const mags = [mag()];
  const matches = [
    match({ id: 'm1', name: 'First Match', date: '2026-08-01', magConditions: [{ magId: 'mg-a', tag: 'sand' }] }),
    match({ id: 'm2', name: 'Second Match', date: '2026-08-05', magConditions: [{ magId: 'mg-a', tag: 'mud' }] }),
    match({ id: 'm3', name: 'Third Match', date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'rain' }] }),
  ];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out.length, 1);
  assert.equal(out[0].moreCount, 2);
  assert.equal(out[0].matchId, 'm3'); // most recent by date
  assert.equal(out[0].detail, 'Rain — Third Match, 2026-08-10 (+2 more)');
});

test('a dated most-recent match beats an undated one, regardless of array order', () => {
  const mags = [mag()];
  const matches = [
    match({ id: 'm1', name: 'Dated Match', date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'sand' }] }),
    match({ id: 'm2', name: 'Undated Match', date: undefined, magConditions: [{ magId: 'mg-a', tag: 'mud' }] }),
  ];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out[0].matchId, 'm1');
  assert.equal(out[0].tag, 'sand');

  // Reversed input order: the dated match still wins (undated sorts before dated).
  const reversed = [...matches].reverse();
  const out2 = magsNeedingCleaning(mags, reversed);
  assert.equal(out2[0].matchId, 'm1');
});

test('output is sorted by magLabel', () => {
  const mags = [mag({ id: 'mg-b', label: 'B02' }), mag({ id: 'mg-a', label: 'A01' })];
  const matches = [
    match({ magConditions: [{ magId: 'mg-b', tag: 'sand' }, { magId: 'mg-a', tag: 'mud' }] }),
  ];
  const out = magsNeedingCleaning(mags, matches);
  assert.deepEqual(out.map((o) => o.magLabel), ['A01', 'B02']);
});

test('detail exact format: dated, no extras', () => {
  const mags = [mag()];
  const matches = [match({ name: 'Gun Craft Steel Challenge', date: '2026-08-16', magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out[0].detail, 'Sand — Gun Craft Steel Challenge, 2026-08-16');
});

test('detail exact format: undated, no extras, blank match name falls back to "a match"', () => {
  const mags = [mag()];
  const matches = [match({ name: '', date: undefined, magConditions: [{ magId: 'mg-a', tag: 'issue' }] })];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out[0].detail, 'Issue — a match');
});

test('a magConditions entry referencing an unknown magId is ignored (orphan-safe, structural)', () => {
  const mags = [mag()]; // only mg-a exists
  const matches = [match({ magConditions: [{ magId: 'mg-ghost', tag: 'sand' }] })];
  assert.deepEqual(magsNeedingCleaning(mags, matches), []);
});

// ---- Cold-audit additions (21 Aug 2026): the two MEDIUM fixes, proved ----

test('a mag with active MISSING (corrupt/restored record) is treated as retired — excluded', () => {
  const mags = [mag({ active: undefined })];
  const matches = [match({ magConditions: [{ magId: 'mg-a', tag: 'sand' }] })];
  assert.deepEqual(magsNeedingCleaning(mags, matches), []);
});

test('a mag with a MISSING label cannot crash the sort — it lists with an empty label', () => {
  const mags = [mag({ label: undefined }), mag({ id: 'mg-b', label: 'B02' })];
  const matches = [
    match({ magConditions: [{ magId: 'mg-a', tag: 'sand' }, { magId: 'mg-b', tag: 'mud' }] }),
  ];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.magLabel), ['', 'B02']);
});

// ---- Tests-constrain-audit impostor kills (21 Aug 2026) ----

test('exact date tie: the LATER match in array order wins (rule f)', () => {
  const mags = [mag()];
  const matches = [
    match({ id: 'm1', name: 'Morning Match', date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'sand' }] }),
    match({ id: 'm2', name: 'Evening Match', date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'mud' }] }),
  ];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out[0].matchId, 'm2');
  assert.equal(out[0].tag, 'mud');
});

test('two undated matches: the later one in array order wins', () => {
  const mags = [mag()];
  const matches = [
    match({ id: 'm1', name: 'First', date: undefined, magConditions: [{ magId: 'mg-a', tag: 'sand' }] }),
    match({ id: 'm2', name: 'Second', date: undefined, magConditions: [{ magId: 'mg-a', tag: 'rain' }] }),
  ];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out[0].matchId, 'm2');
});

test('moreCount counts only QUALIFYING matches — one disqualified by the cleaning cutoff does not pad it', () => {
  const mags = [mag({ lastCleanedAt: '2026-08-05' })];
  const matches = [
    match({ id: 'm1', name: 'Before Cleaning', date: '2026-08-01', magConditions: [{ magId: 'mg-a', tag: 'sand' }] }),
    match({ id: 'm2', name: 'After Cleaning', date: '2026-08-10', magConditions: [{ magId: 'mg-a', tag: 'mud' }] }),
  ];
  const out = magsNeedingCleaning(mags, matches);
  assert.equal(out.length, 1);
  assert.equal(out[0].matchId, 'm2');
  assert.equal(out[0].moreCount, 0); // the pre-cleaning match must not count
  assert.equal(out[0].detail, 'Mud — After Cleaning, 2026-08-10'); // and no "(+1 more)"
});
