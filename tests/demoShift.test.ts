// Demo date shift (session 132, DEMO_SHIFT_SPEC_S132.md). These tests run
// against the REAL shipped artifact (public/demo-dataset.bin), exactly like
// demoStory.test.ts, because the guarantee that matters is about what
// actually ships, not a hand-built fixture that might not resemble it.
//
// A fixed NOW throughout (never Date.now()) so this suite's outcome does not
// depend on when it happens to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlog } from '../src/lib/flog.ts';
import type { Snapshot } from '../src/lib/flog.ts';
import { demoDateShiftMs, shiftDemoDates } from '../src/lib/demoShift.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2027-03-15T16:00:00Z');

const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-dataset.bin');
const bin = readFileSync(binPath);

/** Parses the shipped bin fresh. Two independent parses (never a deep clone
 * of one) is how this file gets a pre-shift and a post-shift snapshot to
 * compare — see the module header. */
function loadSnap(): Snapshot {
  return parseFlog(new Uint8Array(bin));
}

// ─── Test-local completeness scanner ───────────────────────────────────────
// Written fresh here, deliberately NOT imported from demoShift.ts. Its job is
// to watch the implementation from the outside: it flags every ISO date
// string and every NUMBER in a plausible epoch-ms range under ANY key
// whatsoever, ignoring EPOCH_KEYS entirely, so a real field the shift
// implementation doesn't know about shows up as a mismatch here rather than
// silently passing because both sides agree on the same (possibly wrong)
// key list. Test 2 below proves this scanner can actually catch something.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH_FLOOR = Date.parse('2020-01-01T00:00:00Z');
const EPOCH_CEILING = NOW + 5 * 365 * DAY;

type PathSeg = string | number;
interface Hit { path: PathSeg[]; kind: 'date' | 'epoch'; value: string | number }

function scan(node: unknown, path: PathSeg[], out: Hit[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => scan(item, [...path, i], out));
    return;
  }
  if (typeof node !== 'object' || node === null || ArrayBuffer.isView(node) || node instanceof ArrayBuffer) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const here = [...path, key];
    if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
      out.push({ path: here, kind: 'date', value });
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= EPOCH_FLOOR && value <= EPOCH_CEILING) {
      out.push({ path: here, kind: 'epoch', value });
    } else {
      scan(value, here, out);
    }
  }
}

function getAtPath(root: unknown, path: PathSeg[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<PathSeg, unknown>)[seg];
  }
  return cur;
}

function pathToString(path: PathSeg[]): string {
  return path.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('').replace(/^\./, '');
}

/** Independent day-add, deliberately a different arithmetic shape than
 * demoShift.ts's noonUtcMs+format (plain Date.UTC(y, m-1, d+days) rather than
 * parse-a-string-then-add-milliseconds) so this isn't just re-running the
 * same code under test with different variable names. */
function addDaysUtc(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

test('completeness sweep: every epoch-range number and ISO date anywhere in the snapshot shifts by exactly the computed amount', () => {
  const pre = loadSnap();
  const shiftMs = demoDateShiftMs(pre, NOW);
  // If the shipped bin is ever regenerated fresh enough that no shift is
  // needed, this sweep would vacuously pass without checking anything --
  // that would silently defeat the whole test, so it must fail loudly instead.
  assert.notEqual(shiftMs, 0, 'expected the shipped demo bin to need a shift under this NOW; this test proves nothing if it does not');

  const hits: Hit[] = [];
  scan(pre, [], hits);
  assert.ok(hits.length > 50, `expected many date/epoch hits across the real dataset, got ${hits.length}`);

  // Aligned-blind-spot guard (cold-audit finding 3): the shifter and this
  // scanner share the same bare-YYYY-MM-DD regex, so a date stored as a FULL
  // ISO timestamp string ("2026-06-21T12:00:00Z") would be invisible to both
  // — the one class of miss the independent scanner cannot see. Assert the
  // shipped artifact carries no such string, so if one ever appears (e.g. a
  // trash-store deletedAt in string form) this goes red instead of silent.
  const isoTimestampStrings: string[] = [];
  (function huntTimestamps(node: unknown, path: PathSeg[]): void {
    if (Array.isArray(node)) { node.forEach((item, i) => huntTimestamps(item, [...path, i])); return; }
    if (typeof node !== 'object' || node === null || ArrayBuffer.isView(node) || node instanceof ArrayBuffer) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
        isoTimestampStrings.push(`${pathToString([...path, key])}: ${value}`);
      } else {
        huntTimestamps(value, [...path, key]);
      }
    }
  })(pre, []);
  assert.deepEqual(isoTimestampStrings, [], 'the demo bin now carries full ISO-timestamp strings the shift cannot see — extend ISO_DATE_RE and this scanner together');

  const post = shiftDemoDates(loadSnap(), NOW);
  const shiftDays = shiftMs / DAY;
  const mismatches: string[] = [];
  for (const hit of hits) {
    const actual = getAtPath(post, hit.path);
    const expected = hit.kind === 'date'
      ? addDaysUtc(hit.value as string, shiftDays)
      : (hit.value as number) + shiftMs;
    if (actual !== expected) mismatches.push(`${pathToString(hit.path)}: expected ${String(expected)}, got ${String(actual)}`);
  }
  assert.deepEqual(mismatches, []);
});

test('the watchdog barks: a synthetic field outside EPOCH_KEYS is caught unshifted (permanent sabotage proof)', () => {
  // A tiny synthetic snapshot: one dated session so demoDateShiftMs has
  // something to anchor a shift to, plus one record carrying a real
  // EPOCH_KEYS field (createdAt) alongside a same-shaped epoch-ms number
  // under a key the implementation does not know (finishedAt).
  const anchorDate = '2020-01-06';
  const anchorMs = Date.parse(`${anchorDate}T12:00:00Z`);
  const pre: Snapshot = {
    exportedAt: anchorMs,
    lastModified: anchorMs,
    stores: {
      sessions: [{ id: 's1', date: anchorDate, createdAt: anchorMs, updatedAt: anchorMs }],
      widgets: [{ id: 'w1', createdAt: anchorMs, finishedAt: anchorMs }],
    },
    media: [],
  };
  const shiftMs = demoDateShiftMs(pre, NOW);
  assert.notEqual(shiftMs, 0);

  const hits: Hit[] = [];
  scan(pre, [], hits);

  const post = shiftDemoDates(JSON.parse(JSON.stringify(pre)) as Snapshot, NOW);
  const shiftDays = shiftMs / DAY;
  const report: string[] = [];
  for (const hit of hits) {
    const actual = getAtPath(post, hit.path);
    const expected = hit.kind === 'date'
      ? addDaysUtc(hit.value as string, shiftDays)
      : (hit.value as number) + shiftMs;
    if (actual !== expected) report.push(pathToString(hit.path));
  }

  assert.notEqual(report.length, 0, 'the scanner should have caught at least one unshifted field, but reported none');
  assert.ok(
    report.some((p) => p.includes('finishedAt')),
    `expected the report to name finishedAt (the field outside EPOCH_KEYS); got: ${report.join(', ')}`
  );
});

test('freshness: the newest session lands in [NOW-14d, NOW-7d]', () => {
  const post = shiftDemoDates(loadSnap(), NOW);
  const sessions = post.stores.sessions as { date: string }[];
  const newestMs = Math.max(...sessions.map((s) => Date.parse(`${s.date}T12:00:00Z`)));
  assert.ok(
    newestMs >= NOW - 14 * DAY && newestMs <= NOW - 7 * DAY,
    `newest session ${new Date(newestMs).toISOString()} is outside [NOW-14d, NOW-7d]`
  );
});

test('weekday and inter-session spacing preserved; record order unchanged in every store', () => {
  const pre = loadSnap();
  const post = shiftDemoDates(loadSnap(), NOW);

  for (const storeName of Object.keys(pre.stores)) {
    const preIds = (pre.stores[storeName] as { id: string }[]).map((r) => r.id);
    const postIds = (post.stores[storeName] as { id: string }[]).map((r) => r.id);
    assert.deepEqual(postIds, preIds, `record order changed in store "${storeName}"`);
  }

  const preSessions = pre.stores.sessions as { id: string; date: string }[];
  const postSessions = post.stores.sessions as { id: string; date: string }[];
  for (let i = 0; i < preSessions.length; i++) {
    const preWeekday = new Date(`${preSessions[i].date}T12:00:00Z`).getUTCDay();
    const postWeekday = new Date(`${postSessions[i].date}T12:00:00Z`).getUTCDay();
    assert.equal(postWeekday, preWeekday, `weekday changed for session ${preSessions[i].id}`);
  }

  const gaps = (dates: string[]) => {
    const sorted = [...dates].sort();
    const out: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      out.push(Date.parse(`${sorted[i]}T12:00:00Z`) - Date.parse(`${sorted[i - 1]}T12:00:00Z`));
    }
    return out;
  };
  assert.deepEqual(gaps(postSessions.map((s) => s.date)), gaps(preSessions.map((s) => s.date)));
});

test('evidence gate opens: at least one gun clears >=3 live sessions and >=200 rounds in the trailing 90 days', () => {
  // forecast.ts's own gate + window math (computeForecast) is not exported --
  // it's a module-private helper behind maintForecast/forecastLine — so this
  // reimplements just the existence check inline, as the spec allows. This is
  // a deliberate simplification, not a reproduction of forecast.ts's exact
  // boundary semantics: forecast.ts compares LOCAL dayKey strings, this
  // compares millisecond timestamps against a fixed UTC NOW. For a coarse
  // "does any gun clear the gate at all" check that difference cannot matter
  // -- the gate margins in the demo data are not day-boundary-thin -- but a
  // reader should not mistake this for forecast.ts's own logic under test.
  const post = shiftDemoDates(loadSnap(), NOW);
  type SessGun = { firearmId: string; rounds: unknown };
  type Sess = { date: string; type: string; planned: boolean; guns: SessGun[] };
  const sessions = post.stores.sessions as unknown as Sess[];
  const cutoffMs = NOW - 90 * DAY;

  const perGun = new Map<string, { sessions: number; rounds: number }>();
  for (const s of sessions) {
    if (s.planned || s.type === 'dry_fire') continue;
    const ms = Date.parse(`${s.date}T12:00:00Z`);
    if (ms <= cutoffMs || ms > NOW) continue;
    for (const g of s.guns) {
      const rec = perGun.get(g.firearmId) ?? { sessions: 0, rounds: 0 };
      rec.sessions += 1;
      rec.rounds += typeof g.rounds === 'number' && Number.isFinite(g.rounds) ? g.rounds : 0;
      perGun.set(g.firearmId, rec);
    }
  }

  const anyClearsGate = [...perGun.values()].some((v) => v.sessions >= 3 && v.rounds >= 200);
  assert.ok(anyClearsGate, `no gun cleared the evidence gate; per-gun totals: ${JSON.stringify([...perGun.entries()])}`);
});

/** The newest session-or-match timestamp, computed independently of
 * demoShift.ts (duplicated here on purpose, to build the "already fresh"
 * NOW for the no-op test below without depending on the function under test
 * to locate its own anchor). */
function newestSessionOrMatchMs(snap: Snapshot): number {
  let newest = -Infinity;
  for (const storeName of ['sessions', 'matches']) {
    const records = (snap.stores[storeName] ?? []) as { date?: unknown }[];
    for (const r of records) {
      if (typeof r.date === 'string' && ISO_DATE_RE.test(r.date)) {
        const ms = Date.parse(`${r.date}T12:00:00Z`);
        if (ms > newest) newest = ms;
      }
    }
  }
  return newest;
}

test('already-fresh no-op: NOW = newestMs + 8 days gives shift 0 and a byte-equal store walk', () => {
  const newestMs = newestSessionOrMatchMs(loadSnap());
  const alreadyFreshNow = newestMs + 8 * DAY;

  const pristine = loadSnap();
  const shiftMs = demoDateShiftMs(pristine, alreadyFreshNow);
  assert.equal(shiftMs, 0);

  const shifted = shiftDemoDates(loadSnap(), alreadyFreshNow);
  assert.deepEqual(shifted.stores, pristine.stores);
});

test('nothing else mutates: media ArrayBuffers keep referential identity, record counts unchanged, re-parsing the bin is stable', () => {
  const pre = loadSnap();
  const preMediaRefs = pre.media.map((m) => m.data);
  const preCounts = Object.fromEntries(Object.entries(pre.stores).map(([k, v]) => [k, v.length]));
  const preMediaCount = pre.media.length;

  const shiftMs = demoDateShiftMs(pre, NOW);
  assert.notEqual(shiftMs, 0);
  const post = shiftDemoDates(pre, NOW); // in-place, per the documented contract

  assert.equal(post, pre, 'shiftDemoDates is documented to mutate and return the same snapshot');
  post.media.forEach((m, i) => assert.equal(m.data, preMediaRefs[i], `media[${i}].data ArrayBuffer reference changed`));
  const postCounts = Object.fromEntries(Object.entries(post.stores).map(([k, v]) => [k, v.length]));
  assert.deepEqual(postCounts, preCounts);
  assert.equal(post.media.length, preMediaCount);

  // This suite cannot see the working tree, only what it reads into memory --
  // the real "public/demo-dataset.bin untouched on disk" guarantee is the
  // git-status check called out in the spec, enforced outside this file. What
  // this DOES confirm is that parsing the same bytes again still produces the
  // same record counts, which is the first thing that would change if the
  // file on disk had actually been altered.
  const freshCounts = Object.fromEntries(Object.entries(loadSnap().stores).map(([k, v]) => [k, v.length]));
  assert.deepEqual(freshCounts, preCounts);
});
