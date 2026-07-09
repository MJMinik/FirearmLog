// Rung-1 step 3 — the benchmark Worker (worker/), tested end to end.
//
// The D1 storage adapter runs against REAL SQLite (node:sqlite — the same
// engine Cloudflare D1 runs on), so the atomic UPSERT and the json_set
// histogram arithmetic are executed here, not assumed. The handler tests
// drive the Worker's actual fetch() entry point with real Request objects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import {
  BIN_COUNT,
  bucketKey,
  parseBracket,
  parseContribution,
  valueToBin,
} from '../worker/contract.ts';
import { D1BenchmarkStore } from '../worker/store.ts';
import type { D1Database, D1PreparedStatement } from '../worker/store.ts';
import worker from '../worker/index.ts';
import type { Env } from '../worker/index.ts';
import type { BenchmarkContribution } from '../src/lib/benchmark.ts';

const SCHEMA = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');

/** In-memory D1 stand-in backed by real SQLite, implementing exactly the
 *  members the Worker uses. */
class FakeD1 implements D1Database {
  readonly raw: DatabaseSync;

  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec(SCHEMA);
  }

  prepare(sql: string): D1PreparedStatement {
    const stmt = this.raw.prepare(sql);
    const make = (params: (string | number | null)[]): D1PreparedStatement => ({
      bind: (...values: (string | number | null)[]) => make(values),
      first: async <T>() => (stmt.get(...params) as T | undefined) ?? null,
      run: async () => {
        stmt.run(...params);
      },
    });
    return make([]);
  }
}

const contribution = (over: Partial<BenchmarkContribution> = {}): BenchmarkContribution => ({
  scoringType: 'uspsa',
  division: 'Carry Optics',
  class: 'C',
  gunCategory: 'Pistol',
  metric: 'classifier_percent',
  value: 58,
  ...over,
});

const env = (db: D1Database, k?: number): Env => ({
  DB: db,
  ...(k === undefined ? {} : { K_THRESHOLD: String(k) }),
});

const post = (body: unknown, origin?: string): Request =>
  new Request('https://bench.example/v1/contributions', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: origin === undefined ? {} : { Origin: origin },
  });

const query = (over: Record<string, string> = {}): Request => {
  const params = new URLSearchParams({
    scoringType: 'uspsa',
    division: 'Carry Optics',
    class: 'C',
    gunCategory: 'Pistol',
    metric: 'classifier_percent',
    ...over,
  });
  return new Request(`https://bench.example/v1/benchmarks?${params}`);
};

// --- contract: parseContribution (the server's junk-data guard) -------------

test('valid contribution parses and round-trips', () => {
  assert.deepEqual(parseContribution(contribution()), contribution());
});

test('non-objects and arrays are rejected', () => {
  for (const bad of [null, undefined, 42, 'x', [contribution()]]) {
    assert.equal(parseContribution(bad), null);
  }
});

test('extra fields are rejected (strict schema — no data smuggling)', () => {
  assert.equal(parseContribution({ ...contribution(), extra: 'x' }), null);
});

test('missing fields are rejected', () => {
  const c: Record<string, unknown> = { ...contribution() };
  delete c.division;
  assert.equal(parseContribution(c), null);
});

test('division with the bucket-key separator is rejected', () => {
  assert.equal(parseContribution(contribution({ division: 'Open|M' })), null);
});

test('over-long and empty strings are rejected', () => {
  assert.equal(parseContribution(contribution({ division: 'x'.repeat(41) })), null);
  assert.equal(parseContribution(contribution({ class: '' })), null);
});

test('R-B: a division/class off the canonical allow-list is rejected', () => {
  assert.equal(parseContribution(contribution({ division: 'Totally Made Up' })), null);
  assert.equal(parseContribution(contribution({ class: 'Z' })), null);
});

test('unknown metric and out-of-bounds value are rejected', () => {
  assert.equal(parseContribution({ ...contribution(), metric: 'draw_time' }), null);
  assert.equal(parseContribution(contribution({ value: 101 })), null);
  assert.equal(parseContribution({ ...contribution(), value: '58' }), null);
});

// --- contract: parseBracket + histogram geometry -----------------------------

test('valid bracket parses from query params', () => {
  const req = query();
  const bracket = parseBracket(new URL(req.url).searchParams);
  assert.deepEqual(bracket, {
    scoringType: 'uspsa',
    division: 'Carry Optics',
    class: 'C',
    gunCategory: 'Pistol',
    metric: 'classifier_percent',
  });
});

test('bracket with a missing or junk field is rejected', () => {
  const cases: Record<string, string>[] = [
    { metric: 'draw_time' },
    { division: '' },
    { gunCategory: 'Blaster' },
    { scoringType: 'ipsc' },
  ];
  for (const over of cases) {
    const req = query(over);
    assert.equal(parseBracket(new URL(req.url).searchParams), null);
  }
});

test('valueToBin: range edges land inside the histogram', () => {
  assert.equal(valueToBin('classifier_percent', 0), 0);
  assert.equal(valueToBin('classifier_percent', 100), BIN_COUNT - 1); // top edge → last bin
  assert.equal(valueToBin('classifier_percent', 50), 25);
  assert.equal(valueToBin('accuracy_points_kept', 0), 0);
  assert.equal(valueToBin('accuracy_points_kept', 1), BIN_COUNT - 1);
});

test('bucketKey is the five bracket fields joined', () => {
  assert.equal(bucketKey(contribution()), 'uspsa|Carry Optics|C|Pistol|classifier_percent');
});

// --- store: the D1 adapter against real SQLite ------------------------------

test('record creates the bucket, then increments count and the right bin', async () => {
  const store = new D1BenchmarkStore(new FakeD1());
  await store.record(contribution({ value: 58 })); // bin 29
  await store.record(contribution({ value: 58 }));
  await store.record(contribution({ value: 1 })); // bin 0
  const dist = await store.distribution(contribution());
  assert.ok(dist);
  assert.equal(dist.count, 3);
  assert.equal(dist.bins[29], 2);
  assert.equal(dist.bins[0], 1);
  assert.equal(
    dist.bins.reduce((a, b) => a + b, 0),
    dist.count,
  );
});

test('different brackets get different buckets', async () => {
  const store = new D1BenchmarkStore(new FakeD1());
  await store.record(contribution());
  await store.record(contribution({ class: 'B' }));
  const c = await store.distribution(contribution());
  const b = await store.distribution(contribution({ class: 'B' }));
  assert.equal(c?.count, 1);
  assert.equal(b?.count, 1);
});

test('unknown bucket reads as null; corrupt bins read as null, never throw', async () => {
  const db = new FakeD1();
  const store = new D1BenchmarkStore(db);
  assert.equal(await store.distribution(contribution()), null);
  db.raw.exec(
    'INSERT INTO buckets (key, scoring_type, division, class, gun_category, metric, count, bins) ' +
      "VALUES ('uspsa|Carry Optics|C|Pistol|classifier_percent','uspsa','Carry Optics','C','Pistol','classifier_percent',5,'not json')",
  );
  assert.equal(await store.distribution(contribution()), null);
});

// --- handler: the Worker end to end ------------------------------------------

test('POST valid contribution → 204, no body', async () => {
  const res = await worker.fetch(post(contribution()), env(new FakeD1()));
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
});

test('bucket below k answers not_enough_data; at k it opens', async () => {
  const db = new FakeD1();
  const e = env(db, 3);
  for (let i = 0; i < 2; i++) {
    assert.equal((await worker.fetch(post(contribution()), e)).status, 204);
  }
  let body = await (await worker.fetch(query(), e)).json();
  assert.deepEqual(body, { status: 'not_enough_data' });
  assert.equal((await worker.fetch(post(contribution()), e)).status, 204);
  body = await (await worker.fetch(query(), e)).json();
  assert.equal(body.status, 'ok');
  assert.equal(body.count, 3);
  assert.equal(body.binCount, BIN_COUNT);
  assert.equal(body.binStart, 0);
  assert.equal(body.binWidth, 2);
  assert.equal(
    body.bins.reduce((a: number, b: number) => a + b, 0),
    3,
  );
});

test('thin bucket and absent bucket return IDENTICAL bodies (no probe oracle)', async () => {
  const db = new FakeD1();
  const e = env(db); // default k = 50
  await worker.fetch(post(contribution()), e); // thin: 1 contribution
  const thin = await (await worker.fetch(query(), e)).text();
  const absent = await (await worker.fetch(query({ class: 'B' }), e)).text();
  assert.equal(thin, absent);
});

test('junk POSTs are rejected with the right statuses', async () => {
  const e = env(new FakeD1());
  assert.equal((await worker.fetch(post('not json'), e)).status, 400);
  assert.equal((await worker.fetch(post([contribution()]), e)).status, 400);
  assert.equal((await worker.fetch(post(contribution({ value: 200 })), e)).status, 400);
  assert.equal((await worker.fetch(post('x'.repeat(3000)), e)).status, 413);
});

test('R-10: the size gate measures BYTES, not UTF-16 units', async () => {
  // 1000 three-byte chars = 3000 bytes but String length 1000 (< the 2048 cap):
  // the old text.length check would have let it through; the byte check rejects it.
  const res = await worker.fetch(post('✓'.repeat(1000)), env(new FakeD1()));
  assert.equal(res.status, 413);
});

test('R-8: the rate-limit binding blocks an over-limit POST and stores nothing', async () => {
  const denied: Env = { DB: new FakeD1(), K_THRESHOLD: '1', RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const res = await worker.fetch(post(contribution()), denied);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'rate_limited' });
  // GET is not rate-limited; the blocked POST recorded nothing → still thin.
  assert.deepEqual(await (await worker.fetch(query(), denied)).json(), { status: 'not_enough_data' });
});

test('R-8: with the binding allowing, the POST proceeds normally', async () => {
  const allowed: Env = { DB: new FakeD1(), RATE_LIMITER: { limit: async () => ({ success: true }) } };
  assert.equal((await worker.fetch(post(contribution()), allowed)).status, 204);
});

test('rejected POSTs store nothing', async () => {
  const db = new FakeD1();
  const e = env(db, 1);
  await worker.fetch(post(contribution({ value: 200 })), e);
  const res = await (await worker.fetch(query(), e)).json();
  assert.deepEqual(res, { status: 'not_enough_data' });
});

test('invalid GET query → 400', async () => {
  const res = await worker.fetch(query({ metric: 'draw_time' }), env(new FakeD1()));
  assert.equal(res.status, 400);
});

test('wrong methods → 405 with Allow; unknown path → 404; healthz → ok', async () => {
  const e = env(new FakeD1());
  const r405 = await worker.fetch(new Request('https://bench.example/v1/contributions'), e);
  assert.equal(r405.status, 405);
  assert.equal(r405.headers.get('Allow'), 'POST');
  assert.equal((await worker.fetch(new Request('https://bench.example/nope'), e)).status, 404);
  const health = await worker.fetch(new Request('https://bench.example/healthz'), e);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
});

test('CORS: allowed origin is echoed, unknown origin is not', async () => {
  const e = env(new FakeD1());
  const ok = await worker.fetch(post(contribution(), 'https://firearmlog.com'), e);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://firearmlog.com');
  assert.equal(ok.headers.get('Vary'), 'Origin');
  const no = await worker.fetch(post(contribution(), 'https://evil.example'), e);
  assert.equal(no.headers.get('Access-Control-Allow-Origin'), null);
});

test('OPTIONS preflight answers with methods and headers', async () => {
  const res = await worker.fetch(
    new Request('https://bench.example/v1/contributions', {
      method: 'OPTIONS',
      headers: { Origin: 'https://firearmlog.com' },
    }),
    env(new FakeD1()),
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
});

test('a storage failure returns a clean 500 and leaks nothing', async () => {
  const broken: D1Database = {
    prepare() {
      throw new Error('secret internal detail');
    },
  };
  const res = await worker.fetch(post(contribution()), env(broken));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal' });
});
