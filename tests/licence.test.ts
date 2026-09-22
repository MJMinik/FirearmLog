// ENTITLEMENT_SPEC_2026-09-18.md §10, unit tests for licence.ts (verification)
// and trialGate.ts (the free-session count), with a throwaway key pair
// generated in this file. Neither module's shipped key list is used for
// verification here; every test builds and signs its own licences.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseLicence,
  verifyLicence,
  licenceSummary,
  base64UrlEncode,
  base64UrlDecode,
  LICENCE_KEYS,
} from '../src/lib/licence.ts';
import type { LicencePayload } from '../src/lib/licence.ts';
import {
  countLiveFireSessions,
  wallBlocksNewLiveSession,
  FREE_LIVE_FIRE_SESSIONS,
} from '../src/lib/trialGate.ts';
import type { AppSettings, Session } from '../src/lib/types.ts';

// --- test-only signing helper (never used outside tests/) -------------------

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]) as Promise<CryptoKeyPair>;
}

async function publicJwk(pair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', pair.publicKey);
}

/** Builds an `FL1.…` licence text from an arbitrary payload object, signed
 *  with the given private key. Accepts `unknown` (not the typed
 *  LicencePayload) so the bad-payload tests can build shapes the real type
 *  would refuse to let them construct. */
async function signRaw(raw: unknown, privateKey: CryptoKey): Promise<string> {
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(raw)));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sig));
  return `FL1.${payloadB64}.${sigB64}`;
}

function payload(over: Partial<LicencePayload> = {}): LicencePayload {
  return {
    v: 1,
    kid: 'test-kid',
    iss: 'web',
    plan: 'standard',
    ref: 'txn_1',
    at: '2026-11-03',
    ...over,
  };
}

// --- licence.ts: verifyLicence ----------------------------------------------

test('a good licence verifies, with and without `to`', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };

  const withTo = await signRaw(payload({ to: 'Jane Shooter' }), pair.privateKey);
  const r1 = await verifyLicence(withTo, keys);
  assert.equal(r1.ok, true);
  assert.ok(r1.ok && r1.payload.to === 'Jane Shooter');

  const withoutTo = await signRaw(payload(), pair.privateKey);
  const r2 = await verifyLicence(withoutTo, keys);
  assert.equal(r2.ok, true);
  assert.ok(r2.ok && r2.payload.to === undefined);
});

test('a founding licence with a valid seq verifies', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw(payload({ plan: 'founding', seq: 17 }), pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.payload.plan === 'founding' && r.payload.seq === 17);
});

test('a changed payload fails as bad-signature (signature was for a different payload)', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const licenceA = await signRaw(payload({ ref: 'txn_A' }), pair.privateKey);
  const licenceB = await signRaw(payload({ ref: 'txn_B' }), pair.privateKey);
  const [tagA, payloadA] = licenceA.split('.');
  const [, , sigB] = licenceB.split('.');
  const tampered = `${tagA}.${payloadA}.${sigB}`;
  const r = await verifyLicence(tampered, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'bad-signature');
});

test('a changed signature fails as bad-signature', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw(payload(), pair.privateKey);
  const [tag, p, s] = text.split('.');
  const sigBytes = base64UrlDecode(s);
  sigBytes[0] = sigBytes[0] ^ 0xff;
  const corrupted = `${tag}.${p}.${base64UrlEncode(sigBytes)}`;
  const r = await verifyLicence(corrupted, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'bad-signature');
});

test('an unknown kid fails as unknown-key', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw(payload({ kid: 'nobody-2019' }), pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'unknown-key');
});

test('a licence signed by a different key fails as bad-signature', async () => {
  const pairA = await generateKeyPair();
  const pairB = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pairA) }; // A's public key is what the app trusts
  const text = await signRaw(payload(), pairB.privateKey); // but B signed it
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'bad-signature');
});

test('a two-part or four-part string fails as format', async () => {
  const keys = {};
  assert.deepEqual(await verifyLicence('FL1.onlypayload', keys), { ok: false, reason: 'format' });
  assert.deepEqual(await verifyLicence('FL1.a.b.c', keys), { ok: false, reason: 'format' });
  assert.deepEqual(await verifyLicence('not-even-close', keys), { ok: false, reason: 'format' });
});

test('a text not starting FL1 fails as format', async () => {
  const r = await verifyLicence('FL2.abc.def', {});
  assert.deepEqual(r, { ok: false, reason: 'format' });
});

// --- licence.ts: bad payload fields (spec §3.2 step 2) ----------------------

test('a bad `at` date fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  for (const at of ['2026-13-40', 'not-a-date', '2026/11/03', '20261103']) {
    const text = await signRaw({ ...payload(), at }, pair.privateKey);
    const r = await verifyLicence(text, keys);
    assert.equal(r.ok, false, `expected ${at} to fail`);
    assert.ok(
      !r.ok && r.reason === 'payload',
      `expected ${at} to fail as payload, got ${!r.ok && r.reason}`,
    );
  }
});

test('a seq field on a standard plan fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw({ ...payload({ plan: 'standard' }), seq: 5 }, pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'payload');
});

test('seq 0 or 201 on a founding plan fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  for (const seq of [0, 201, -1, 1.5]) {
    const text = await signRaw(payload({ plan: 'founding', seq }), pair.privateKey);
    const r = await verifyLicence(text, keys);
    assert.equal(r.ok, false, `expected seq ${seq} to fail`);
    assert.ok(!r.ok && r.reason === 'payload');
  }
});

test('a founding plan with no seq fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const raw = { ...payload({ plan: 'founding' }) };
  const text = await signRaw(raw, pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'payload');
});

test('an unknown `iss` fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw({ ...payload(), iss: 'amazon' }, pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'payload');
});

test('a wrong `v` fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw({ ...payload(), v: 2 }, pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'payload');
});

test('a missing required field fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const raw: Record<string, unknown> = { ...payload() };
  delete raw.ref;
  const text = await signRaw(raw, pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'payload');
});

// --- licence.ts: parseLicence (sync, format + payload only) -----------------

test('parseLicence agrees with verifyLicence on format and payload failures', async () => {
  const pair = await generateKeyPair();
  assert.deepEqual(parseLicence('FL1.a.b.c'), { ok: false, reason: 'format' });
  const badAt = await signRaw({ ...payload(), at: 'nope' }, pair.privateKey);
  assert.deepEqual(parseLicence(badAt), { ok: false, reason: 'payload' });
});

test('parseLicence accepts a well-formed payload without checking the signature', async () => {
  const pair = await generateKeyPair();
  // Signed by a key nobody trusts: parseLicence never looks, because it
  // only does spec §3.2 steps 1-2, never the (async) signature check.
  const text = await signRaw(payload({ to: 'Jane Shooter' }), pair.privateKey);
  const r = parseLicence(text);
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.payload.to === 'Jane Shooter');
});

// --- licence.ts: LICENCE_KEYS ships empty until the key ceremony ------------

test('LICENCE_KEYS ships empty until the key ceremony', () => {
  assert.deepEqual(LICENCE_KEYS, {});
});

// --- licence.ts: trimming and the base64url alphabet (spec §3.2, finding 4) -

test('a trailing newline or a leading space verifies (both are common after a copy-paste)', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw(payload(), pair.privateKey);

  const withTrailingNewline = await verifyLicence(`${text}\n`, keys);
  assert.equal(withTrailingNewline.ok, true);

  const withLeadingSpace = await verifyLicence(` ${text}`, keys);
  assert.equal(withLeadingSpace.ok, true);
});

test('a `+` or `=` inside a base64url part fails as format', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw(payload(), pair.privateKey);
  const [tag, p, s] = text.split('.');

  const withPlus = `${tag}.${p.slice(0, -1)}+.${s}`;
  const withEquals = `${tag}.${p}.${s.slice(0, -1)}=`;

  assert.deepEqual(await verifyLicence(withPlus, keys), { ok: false, reason: 'format' });
  assert.deepEqual(await verifyLicence(withEquals, keys), { ok: false, reason: 'format' });
});

test('a whitespace-only `to` fails as payload', async () => {
  const pair = await generateKeyPair();
  const keys = { 'test-kid': await publicJwk(pair) };
  const text = await signRaw({ ...payload(), to: '   ' }, pair.privateKey);
  const r = await verifyLicence(text, keys);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'payload');
});

// --- licence.ts: licenceSummary ----------------------------------------------

test('licenceSummary reads as the Settings card copy (spec §5.5)', () => {
  assert.equal(
    licenceSummary(payload({ plan: 'founding', seq: 17, to: 'Jane Shooter', at: '2026-11-03' })),
    'Licensed to Jane Shooter, Founding member #17, since 2026-11-03',
  );
  assert.equal(
    licenceSummary(payload({ plan: 'standard', at: '2026-11-03' })),
    'Licensed, Standard, since 2026-11-03',
  );
  assert.equal(
    licenceSummary(payload({ plan: 'founding', seq: 3, at: '2026-11-03' })),
    'Licensed, Founding member #3, since 2026-11-03',
  );
});

// --- trialGate.ts: countLiveFireSessions (spec §5.1) -------------------------

const base = { createdAt: 0, updatedAt: 0 };

function ses(p: Partial<Session>): Session {
  return {
    ...base,
    id: 's1',
    date: '2026-06-01',
    type: 'practice',
    guns: [],
    location: '',
    distances: '',
    notes: '',
    ammoUsage: [],
    drills: [],
    targetMediaIds: [],
    malfunctions: [],
    selfRating: null,
    rangeFee: null,
    planned: false,
    checklist: null,
    ...p,
  };
}

test('dry fire is not counted', () => {
  const sessions = [ses({ id: 's1', type: 'dry_fire' })];
  assert.equal(countLiveFireSessions(sessions, undefined), 0);
});

test('a planned session is not counted', () => {
  const sessions = [ses({ id: 's1', planned: true })];
  assert.equal(countLiveFireSessions(sessions, undefined), 0);
});

test('a deleted session is not counted', () => {
  const sessions = [ses({ id: 's1', deletedAt: Date.now() })];
  assert.equal(countLiveFireSessions(sessions, undefined), 0);
});

test('a session carrying `legacy` (imported) is not counted', () => {
  const sessions = [ses({ id: 's1', legacy: { importBatch: 'b1' } })];
  assert.equal(countLiveFireSessions(sessions, undefined), 0);
});

test('a class session is counted', () => {
  const sessions = [ses({ id: 's1', type: 'class' })];
  assert.equal(countLiveFireSessions(sessions, undefined), 1);
});

test('a plain live-fire session is counted', () => {
  const sessions = [ses({ id: 's1', type: 'practice' })];
  assert.equal(countLiveFireSessions(sessions, undefined), 1);
});

test('the sample log makes the count zero regardless of the records', () => {
  const sessions = [ses({ id: 's1' }), ses({ id: 's2' }), ses({ id: 's3' })];
  const settings: Pick<AppSettings, 'sampleLogLoaded'> = { sampleLogLoaded: true };
  assert.equal(countLiveFireSessions(sessions, settings), 0);
});

test('mixed sessions: only the eligible ones count', () => {
  const sessions = [
    ses({ id: 's1', type: 'practice' }), // counts
    ses({ id: 's2', type: 'dry_fire' }), // dry
    ses({ id: 's3', planned: true }), // planned
    ses({ id: 's4', deletedAt: 12345 }), // deleted
    ses({ id: 's5', legacy: { foo: 1 } }), // imported
    ses({ id: 's6', type: 'class' }), // counts
  ];
  assert.equal(countLiveFireSessions(sessions, undefined), 2);
});

// --- trialGate.ts: wallBlocksNewLiveSession (spec §5.2) ----------------------

test('FREE_LIVE_FIRE_SESSIONS is 10', () => {
  assert.equal(FREE_LIVE_FIRE_SESSIONS, 10);
});

test('9 live-fire sessions, unlicensed: the wall does not block', () => {
  assert.equal(wallBlocksNewLiveSession(9, false), false);
});

test('10 live-fire sessions, unlicensed: the wall blocks (the tenth was free)', () => {
  assert.equal(wallBlocksNewLiveSession(10, false), true);
});

test('10 live-fire sessions, licensed: the wall never blocks', () => {
  assert.equal(wallBlocksNewLiveSession(10, true), false);
});

// --- the network-word guard, mirrored (scripts/check-imports.mjs) -----------

test('licence.ts and trialGate.ts name none of the five disallowed network words', () => {
  const NET_RE = /\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource)\b/;
  for (const rel of ['../src/lib/licence.ts', '../src/lib/trialGate.ts']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      assert.ok(!NET_RE.test(line), `${rel}:${i + 1} names a disallowed network word: ${line}`);
    }
  }
});
