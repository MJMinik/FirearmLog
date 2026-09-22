// ENTITLEMENT_SPEC_2026-09-18.md §10 -- the licence-signing Worker
// (licence-worker/), tested end to end, following the same pattern
// tests/worker.test.ts uses for the benchmark Worker.
//
// The D1 storage adapter runs against real SQLite (node:sqlite -- the same
// engine Cloudflare D1 runs on). The handler tests drive the Worker's actual
// fetch() entry point with real Request objects, and inject a fake
// MerchantLookup through the test-only Env.MERCHANT_LOOKUP seam so no
// network call happens in a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { D1FoundingStore, MemoryFoundingStore, FOUNDING_CAP } from '../licence-worker/store.ts';
import type { D1Database, D1PreparedStatement } from '../licence-worker/store.ts';
import { MapMerchantLookup } from '../licence-worker/merchant.ts';
import type { MerchantTransaction } from '../licence-worker/merchant.ts';
import { signLicence } from '../licence-worker/sign.ts';
import worker from '../licence-worker/index.ts';
import type { Env } from '../licence-worker/index.ts';
import { verifyLicence, parseLicence } from '../src/lib/licence.ts';

const SCHEMA = readFileSync(new URL('../licence-worker/schema.sql', import.meta.url), 'utf8');

/** In-memory D1 stand-in backed by real SQLite, the same shape
 *  tests/worker.test.ts uses for the benchmark Worker. */
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

async function makeKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]) as Promise<CryptoKeyPair>;
}

async function testEnv(over: Partial<Env> = {}): Promise<{ env: Env; publicJwk: JsonWebKey }> {
  const pair = await makeKeyPair();
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const env: Env = {
    DB: new FakeD1(),
    SIGNING_KEY_JWK: JSON.stringify(privateJwk),
    KEY_ID: 'test-kid',
    WEBHOOK_SECRET: 'a-shared-webhook-secret',
    MERCHANT_API_KEY: 'unused-in-tests',
    MERCHANT_LOOKUP: new MapMerchantLookup(),
    ...over,
  };
  return { env, publicJwk };
}

async function signedWebhookHeader(ts: string, rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${rawBody}`));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `ts=${ts};h1=${hex}`;
}

function webhookBody(
  over: Partial<{ id: string; product: string; occurred_at: string; event_type: string }> = {},
) {
  const { event_type = 'transaction.completed', ...dataOver } = over;
  return {
    event_type,
    data: {
      id: 'txn_001',
      product: 'founding',
      occurred_at: '2026-11-03T10:00:00Z',
      ...dataOver,
    },
  };
}

const txn = (over: Partial<MerchantTransaction> = {}): MerchantTransaction => ({
  id: 'txn_001',
  paid: true,
  product: 'standard',
  date: '2026-11-03',
  ...over,
});

// --- store.ts: the D1 adapter against real SQLite ----------------------------

test('claim gives seq 1 to the first txn, seq 2 to the next', async () => {
  const store = new D1FoundingStore(new FakeD1());
  const a = await store.claim('txn_a', '2026-11-01');
  const b = await store.claim('txn_b', '2026-11-02');
  assert.deepEqual(a, { seq: 1 });
  assert.deepEqual(b, { seq: 2 });
});

test('the same txn claimed twice returns the same seq, marked existing', async () => {
  const store = new D1FoundingStore(new FakeD1());
  const first = await store.claim('txn_a', '2026-11-01');
  const second = await store.claim('txn_a', '2026-11-01');
  assert.deepEqual(first, { seq: 1 });
  assert.deepEqual(second, { seq: 1, existing: true });
});

test('the 201st claim is refused with cap, in the same statement', async () => {
  const store = new D1FoundingStore(new FakeD1());
  for (let i = 1; i <= FOUNDING_CAP; i++) {
    const r = await store.claim(`txn_${i}`, '2026-11-01');
    assert.ok('seq' in r && r.seq === i);
  }
  const refused = await store.claim('txn_201', '2026-11-01');
  assert.deepEqual(refused, { refused: 'cap' });
});

test('same seq never issued twice by the in-memory store', async () => {
  // This proves MemoryFoundingStore's own claim() cannot double-issue a seq
  // when called concurrently, because it has no await between reading the
  // current highest seq and pushing the new row (see store.ts's comment on
  // MemoryFoundingStore). It says nothing about CLAIM_SQL. D1's real
  // atomicity rests on two different things instead: the single
  // INSERT...SELECT...HAVING...RETURNING statement being one indivisible
  // unit of work, and D1 serialising every write to one SQLite database, so
  // two real concurrent claims can never interleave inside it. The tests
  // above ("the same txn claimed twice", "the 201st claim is refused with
  // cap") exercise that statement directly, against real SQLite.
  const store = new MemoryFoundingStore();
  const [a, b] = await Promise.all([
    store.claim('txn_a', '2026-11-01'),
    store.claim('txn_b', '2026-11-01'),
  ]);
  assert.ok('seq' in a && 'seq' in b);
  assert.notEqual((a as { seq: number }).seq, (b as { seq: number }).seq);
  assert.deepEqual([a, b].map((r) => (r as { seq: number }).seq).sort(), [1, 2]);
});

test('MemoryFoundingStore reproduces the same cap and idempotency as D1', async () => {
  const store = new MemoryFoundingStore();
  for (let i = 1; i <= FOUNDING_CAP; i++) {
    await store.claim(`txn_${i}`, '2026-11-01');
  }
  assert.deepEqual(await store.claim('txn_201', '2026-11-01'), { refused: 'cap' });
  assert.deepEqual(await store.claim('txn_1', '2026-11-01'), { seq: 1, existing: true });
});

// --- sign.ts: field order and round-trip -------------------------------------

test('signLicence produces a fixed payload field order', async () => {
  const pair = await makeKeyPair();
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const text = await signLicence(
    {
      v: 1,
      kid: 'k1',
      iss: 'web',
      plan: 'founding',
      seq: 9,
      ref: 'txn_x',
      at: '2026-11-03',
      to: 'Jane Shooter',
    },
    privateJwk,
  );
  const parsed = parseLicence(text);
  assert.equal(parsed.ok, true);
  const [, payloadB64] = text.split('.');
  const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  );
  const keys = Object.keys(JSON.parse(json));
  assert.deepEqual(keys, ['v', 'kid', 'iss', 'plan', 'seq', 'ref', 'at', 'to']);
});

test('signLicence omits seq for a standard plan and to when absent', async () => {
  const pair = await makeKeyPair();
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const text = await signLicence(
    { v: 1, kid: 'k1', iss: 'web', plan: 'standard', ref: 'txn_x', at: '2026-11-03' },
    privateJwk,
  );
  const [, payloadB64] = text.split('.');
  const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  );
  const keys = Object.keys(JSON.parse(json));
  assert.deepEqual(keys, ['v', 'kid', 'iss', 'plan', 'ref', 'at']);
});

// --- index.ts: POST /v1/webhook ----------------------------------------------

test('webhook with a bad signature is rejected and claims nothing', async () => {
  const { env } = await testEnv();
  const body = JSON.stringify(webhookBody());
  const res = await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body,
      headers: { 'Paddle-Signature': 'ts=1700000000;h1=deadbeef' },
    }),
    env,
  );
  assert.equal(res.status, 400);
  const claim = await new D1FoundingStore(env.DB).claim('txn_001', '2026-11-03');
  assert.deepEqual(claim, { seq: 1 }); // nothing claimed it yet, so this is a FRESH claim
});

test('webhook with a good signature answers 200 and claims exactly one founding number', async () => {
  const { env } = await testEnv();
  const body = JSON.stringify(webhookBody());
  const header = await signedWebhookHeader('1700000000', body, env.WEBHOOK_SECRET);
  const res = await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body,
      headers: { 'Paddle-Signature': header },
    }),
    env,
  );
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  const again = await new D1FoundingStore(env.DB).claim('txn_001', '2026-11-03');
  assert.deepEqual(again, { seq: 1, existing: true }); // the webhook already claimed seq 1
});

test('a webhook whose MAC is the right length but the wrong value is rejected', async () => {
  const { env } = await testEnv();
  const body = JSON.stringify(webhookBody());
  const wrongMac = '0'.repeat(64); // 64 hex characters: the right LENGTH, not the real HMAC
  const res = await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body,
      headers: { 'Paddle-Signature': `ts=1700000000;h1=${wrongMac}` },
    }),
    env,
  );
  assert.equal(res.status, 400);
  const claim = await new D1FoundingStore(env.DB).claim('txn_001', '2026-11-03');
  assert.deepEqual(claim, { seq: 1 }); // still unclaimed, so this is a FRESH claim
});

test('a webhook whose event is not the paid event claims nothing (finding 5, section 9)', async () => {
  const { env } = await testEnv();
  const body = JSON.stringify(webhookBody({ event_type: 'transaction.created' }));
  const header = await signedWebhookHeader('1700000000', body, env.WEBHOOK_SECRET);
  const res = await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body,
      headers: { 'Paddle-Signature': header },
    }),
    env,
  );
  assert.equal(res.status, 200); // a valid signature always answers 200
  const claim = await new D1FoundingStore(env.DB).claim('txn_001', '2026-11-03');
  assert.deepEqual(claim, { seq: 1 }); // still unclaimed, so this is a FRESH claim
});

test('a webhook for the completed-payment event claims a founding number', async () => {
  const { env } = await testEnv();
  const body = JSON.stringify(webhookBody({ event_type: 'transaction.completed' }));
  const header = await signedWebhookHeader('1700000000', body, env.WEBHOOK_SECRET);
  const res = await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body,
      headers: { 'Paddle-Signature': header },
    }),
    env,
  );
  assert.equal(res.status, 200);
  const claim = await new D1FoundingStore(env.DB).claim('txn_001', '2026-11-03');
  assert.deepEqual(claim, { seq: 1, existing: true }); // already claimed by the webhook
});

test('the same webhook delivered twice yields the same seq (Paddle may retry)', async () => {
  const { env } = await testEnv();
  const body = JSON.stringify(webhookBody());
  const header = await signedWebhookHeader('1700000000', body, env.WEBHOOK_SECRET);
  for (let i = 0; i < 2; i++) {
    const res = await worker.fetch(
      new Request('https://licence.example/v1/webhook', {
        method: 'POST',
        body,
        headers: { 'Paddle-Signature': header },
      }),
      env,
    );
    assert.equal(res.status, 200);
  }
  const store = new D1FoundingStore(env.DB);
  assert.deepEqual(await store.claim('txn_001', '2026-11-03'), { seq: 1, existing: true });
  const otherWebhookBody = JSON.stringify(webhookBody({ id: 'txn_002' }));
  const otherHeader = await signedWebhookHeader('1700000001', otherWebhookBody, env.WEBHOOK_SECRET);
  await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body: otherWebhookBody,
      headers: { 'Paddle-Signature': otherHeader },
    }),
    env,
  );
  assert.deepEqual(await store.claim('txn_002', '2026-11-03'), { seq: 2, existing: true });
});

// --- index.ts: GET /v1/licence ------------------------------------------------

test('GET for an unknown txn returns 404', async () => {
  const { env } = await testEnv();
  const res = await worker.fetch(new Request('https://licence.example/v1/licence?txn=nope'), env);
  assert.equal(res.status, 404);
});

test('GET for an unpaid txn returns 404', async () => {
  const { env } = await testEnv();
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn({ paid: false }));
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  assert.equal(res.status, 404);
});

test('GET for a paid standard txn returns a licence that verifyLicence accepts (round trip)', async () => {
  const { env, publicJwk } = await testEnv();
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(
    txn({ product: 'standard', buyerName: 'Jane Shooter' }),
  );
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { licence: string };
  const verified = await verifyLicence(body.licence, { 'test-kid': publicJwk });
  assert.equal(verified.ok, true);
  assert.ok(
    verified.ok &&
      verified.payload.plan === 'standard' &&
      verified.payload.to === 'Jane Shooter' &&
      verified.payload.ref === 'txn_001' &&
      verified.payload.at === '2026-11-03',
  );
});

test('signing the same transaction twice yields the same payload and two signatures that both verify (spec §10)', async () => {
  const { env, publicJwk } = await testEnv();
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(
    txn({ product: 'standard', buyerName: 'Jane Shooter' }),
  );
  const res1 = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  const res2 = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  const { licence: licence1 } = (await res1.json()) as { licence: string };
  const { licence: licence2 } = (await res2.json()) as { licence: string };

  assert.notEqual(licence1, licence2); // ECDSA adds fresh randomness each sign
  const [, payload1] = licence1.split('.');
  const [, payload2] = licence2.split('.');
  assert.equal(payload1, payload2); // spec §4.3: nothing to store, nothing to drift

  const v1 = await verifyLicence(licence1, { 'test-kid': publicJwk });
  const v2 = await verifyLicence(licence2, { 'test-kid': publicJwk });
  assert.equal(v1.ok, true);
  assert.equal(v2.ok, true);
});

test('an unset KEY_ID or SIGNING_KEY_JWK refuses the request instead of signing (finding 6)', async () => {
  const { env } = await testEnv();
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn());

  const noKeyId = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    { ...env, KEY_ID: '' },
  );
  assert.equal(noKeyId.status, 500);

  const noSigningKey = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    { ...env, SIGNING_KEY_JWK: '' },
  );
  assert.equal(noSigningKey.status, 500);
});

test('a licence the app itself would reject is never handed out (finding 6)', async () => {
  const { env } = await testEnv();
  // A merchant record with a bad date: signLicence would happily sign it,
  // but the app's own parseLicence would refuse it, so the Worker must too.
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn({ date: 'not-a-date' }));
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  assert.equal(res.status, 500);
});

test('the GET route uses the merchant record id, not the query string, for ref and the claim (finding 11)', async () => {
  const { env, publicJwk } = await testEnv({
    MERCHANT_LOOKUP: {
      // Simulates a merchant lookup that tolerates a variant spelling of an
      // id: whatever is queried, it answers with the CANONICAL id.
      async transaction(id: string) {
        if (id.toLowerCase() !== 'txn_001') return null;
        return { id: 'txn_001', paid: true, product: 'standard' as const, date: '2026-11-03' };
      },
    },
  });
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=TXN_001'),
    env,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { licence: string };
  const verified = await verifyLicence(body.licence, { 'test-kid': publicJwk });
  assert.ok(verified.ok && verified.payload.ref === 'txn_001'); // record.id, not the query "TXN_001"
});

test('GET for a founding txn returns plan founding with the claimed seq', async () => {
  const { env, publicJwk } = await testEnv();
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn({ product: 'founding' }));
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  const body = (await res.json()) as { licence: string };
  const verified = await verifyLicence(body.licence, { 'test-kid': publicJwk });
  assert.equal(verified.ok, true);
  assert.ok(verified.ok && verified.payload.plan === 'founding' && verified.payload.seq === 1);
});

test('a founding txn arriving after the cap gets a standard licence, logged (decision 12.8)', async () => {
  const { env, publicJwk } = await testEnv();
  const store = new D1FoundingStore(env.DB);
  for (let i = 1; i <= FOUNDING_CAP; i++) await store.claim(`other_${i}`, '2026-11-01');
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn({ product: 'founding' }));
  const originalLog = console.log;
  let logged = '';
  console.log = (msg: string) => {
    logged = msg;
  };
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  console.log = originalLog;
  const body = (await res.json()) as { licence: string };
  const verified = await verifyLicence(body.licence, { 'test-kid': publicJwk });
  assert.equal(verified.ok, true);
  assert.ok(
    verified.ok && verified.payload.plan === 'standard' && verified.payload.seq === undefined,
  );
  assert.match(logged, /txn_001/);
});

test('GET for a founding txn is idempotent with a prior webhook claim', async () => {
  const { env, publicJwk } = await testEnv();
  const body = JSON.stringify(webhookBody());
  const header = await signedWebhookHeader('1700000000', body, env.WEBHOOK_SECRET);
  await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body,
      headers: { 'Paddle-Signature': header },
    }),
    env,
  );
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn({ product: 'founding' }));
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  const respBody = (await res.json()) as { licence: string };
  const verified = await verifyLicence(respBody.licence, { 'test-kid': publicJwk });
  assert.ok(verified.ok && verified.payload.seq === 1); // the webhook's own claim, not a second number
});

test('healthz answers ok without touching the store', async () => {
  const { env } = await testEnv();
  const res = await worker.fetch(new Request('https://licence.example/healthz'), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('wrong method on /v1/licence is 405 with Allow', async () => {
  const { env } = await testEnv();
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001', { method: 'POST' }),
    env,
  );
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'GET');
});

test('R-8 style: the rate-limit binding blocks an over-limit GET', async () => {
  const { env } = await testEnv({ RATE_LIMITER: { limit: async () => ({ success: false }) } });
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn());
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001'),
    env,
  );
  assert.equal(res.status, 429);
});

test('CORS: allowed origin is echoed on the licence route', async () => {
  const { env } = await testEnv();
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn());
  const res = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001', {
      headers: { Origin: 'https://app.firearmlog.com' },
    }),
    env,
  );
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://app.firearmlog.com');
});

test('ALLOWED_ORIGINS overrides the default list, same as worker/index.ts', async () => {
  const { env } = await testEnv({ ALLOWED_ORIGINS: 'https://custom.example' });
  (env.MERCHANT_LOOKUP as MapMerchantLookup).set(txn());

  const allowed = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001', {
      headers: { Origin: 'https://custom.example' },
    }),
    env,
  );
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://custom.example');

  const noLongerAllowed = await worker.fetch(
    new Request('https://licence.example/v1/licence?txn=txn_001', {
      headers: { Origin: 'https://app.firearmlog.com' },
    }),
    env,
  );
  assert.equal(noLongerAllowed.headers.get('Access-Control-Allow-Origin'), null);
});

test('a missing WEBHOOK_SECRET returns 400, not 500, with a log line', async () => {
  const { env } = await testEnv({ WEBHOOK_SECRET: '' });
  const body = JSON.stringify(webhookBody());
  const originalLog = console.log;
  let logged = '';
  console.log = (msg: string) => {
    logged = msg;
  };
  const res = await worker.fetch(
    new Request('https://licence.example/v1/webhook', {
      method: 'POST',
      body,
      headers: { 'Paddle-Signature': 'ts=1700000000;h1=ab' },
    }),
    env,
  );
  console.log = originalLog;
  assert.equal(res.status, 400);
  assert.match(logged, /WEBHOOK_SECRET/);
});
