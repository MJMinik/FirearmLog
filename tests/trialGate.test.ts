// Drift guards for decision 83 (28 Sep 2026): the rule "a session came with
// the bundled sample log" is `sampleLogLoaded === true` AND an id of the exact
// form `se-` plus three digits (src/lib/trialGate.ts, isSampleSession). It
// holds only while two facts stay true, and each has a test here so a future
// change to either side fails the build instead of silently walling or
// un-walling someone:
//   (a) EVERY session in the shipped sample (public/demo-dataset.bin) has an id
//       of that form. If a regenerated sample used any other id form, its
//       sessions would count toward the shooter's ten free sessions.
//   (b) NO id the app itself makes for a session can have that form. If newId
//       ever produced `se-` plus three digits, a shooter's own session would
//       be treated as the sample's and never count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlog } from '../src/lib/flog.ts';
import { newId } from '../src/lib/id.ts';
import {
  SAMPLE_SESSION_ID_PATTERN, countLiveFireSessions, countedLiveFireRounds, isSampleSession, loadTrialFigures, trialFigures,
} from '../src/lib/trialGate.ts';
import type { Session } from '../src/lib/types.ts';
import { sessionRounds } from '../src/lib/stats.ts';

const bin = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-dataset.bin'));
const snap = parseFlog(new Uint8Array(bin));
const demoSessions = (snap.stores as Record<string, unknown[]>).sessions as Session[];

test('drift guard (a): every session in the shipped sample matches the sample-id rule', () => {
  assert.ok(demoSessions.length > 0, 'the sample holds sessions');
  const offenders = demoSessions.filter((s) => !SAMPLE_SESSION_ID_PATTERN.test(s.id)).map((s) => s.id);
  assert.deepEqual(offenders, [], `sample sessions outside the se-NNN form would count as the shooter's own: ${offenders.join(', ')}`);
});

test('drift guard (a2): with the sample loaded, the whole shipped sample counts zero', () => {
  assert.equal(countLiveFireSessions(demoSessions, { sampleLogLoaded: true }), 0);
});

test('drift guard (a3): the shipped sample settings carry sampleLogLoaded (the rule needs the flag)', () => {
  const rows = (snap.stores as Record<string, { key: string; value: { sampleLogLoaded?: boolean } }[]>).meta;
  const settings = rows.find((r) => r.key === 'settings');
  assert.equal(settings?.value.sampleLogLoaded, true);
});

test("drift guard (b): newId('se') never matches the sample-id rule (5000 ids)", () => {
  for (let i = 0; i < 5000; i++) {
    const id = newId('se');
    assert.ok(!SAMPLE_SESSION_ID_PATTERN.test(id), `newId('se') produced ${id}`);
    assert.equal(isSampleSession({ id }, { sampleLogLoaded: true }), false);
  }
});

test('the rule is anchored: neither a prefix nor a suffix of an id can match it', () => {
  for (const id of ['se-042-x', 'xse-042', 'se-04', 'se-0421', 'SE-042', 'se-04a']) {
    assert.equal(SAMPLE_SESSION_ID_PATTERN.test(id), false, id);
  }
  assert.equal(SAMPLE_SESSION_ID_PATTERN.test('se-042'), true);
});

// --- round 1 audit M3: the count is robust to odd records ---------------------
const own = (id: string, extra: Record<string, unknown> = {}): Session =>
  ({ id, type: 'practice', planned: false, guns: [{ firearmId: 'g', rounds: 50 }], ...extra }) as unknown as Session;

test('a session with no guns array counts as a session with zero rounds (never throws)', () => {
  const noGuns = { id: 'x1', type: 'practice', planned: false } as unknown as Session;
  assert.equal(sessionRounds(noGuns), 0);
  assert.equal(countLiveFireSessions([noGuns, own('x2')], undefined), 2);
  assert.equal(countedLiveFireRounds([noGuns, own('x2')], undefined), 50);
  assert.deepEqual(trialFigures([noGuns, own('x2')], undefined), { count: 2, rounds: 50 });
});

test('odd gun entries (null, missing or text rounds) are zero rounds, not a crash or a text join', () => {
  const odd = own('x3', { guns: [null, { firearmId: 'g' }, { firearmId: 'g', rounds: '50' }, { firearmId: 'g', rounds: 20 }] });
  assert.equal(sessionRounds(odd), 20);
  assert.deepEqual(trialFigures([odd], undefined), { count: 1, rounds: 20 });
});

test('a failure in the ROUNDS figure cannot zero the count', () => {
  // A guns value whose reduce throws: not an array.
  const bad = own('x4', { guns: { reduce: () => { throw new Error('boom'); } } });
  const figs = trialFigures([bad, own('x5')], undefined);
  assert.equal(figs.count, 2, 'the count survives');
  assert.equal(figs.rounds, 0, 'rounds falls back to zero');
});

test('a failure in the COUNT propagates (the hook then stays not ready instead of showing 0 used)', () => {
  const hostile = new Proxy({}, { get() { throw new Error('unreadable record'); } }) as unknown as Session;
  assert.throws(() => trialFigures([hostile], undefined));
});

test('loadTrialFigures: a good read gives the figures', async () => {
  const r = await loadTrialFigures(async () => [[own('a'), own('b')], undefined] as const);
  assert.deepEqual(r, { ok: true, count: 2, rounds: 100 });
});

test('loadTrialFigures: a rejected read, or a record that trips the count, is "not ok" (never zero used)', async () => {
  assert.deepEqual(await loadTrialFigures(async () => { throw new Error('db down'); }), { ok: false });
  const hostile = new Proxy({}, { get() { throw new Error('unreadable'); } }) as unknown as Session;
  assert.deepEqual(await loadTrialFigures(async () => [[hostile], undefined] as const), { ok: false });
});
