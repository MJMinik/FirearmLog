// The licence at run time (src/lib/licenceState.ts): the key list, the verdict
// on the stored text, paste, remove, and the `#licence=` link. A throwaway key
// pair is generated here and handed to the app through the same test-only
// constant the browser tests use; nothing is read from or written to a file.
import 'fake-indexeddb/auto';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllData, getSettings, putOne } from '../src/lib/db.ts';
import { LICENCE_KEYS } from '../src/lib/licence.ts';
import type { LicencePayload } from '../src/lib/licence.ts';
import { signLicence } from '../licence-worker/sign.ts';
import {
  addLicenceText, appLicenceKeys, applyLicenceFragment, BUY_PAGE_URL, getLicenceStatus,
  refreshLicenceStatus, removeLicence, subscribeLicence,
} from '../src/lib/licenceState.ts';
import type { AppSettings } from '../src/lib/types.ts';

const g = globalThis as unknown as { __FL_E2E_LICENCE_KEY__?: unknown };
let goodLicence = '';
let publicJwk: JsonWebKey;

const PAYLOAD: LicencePayload = { v: 1, kid: 'unit-test', iss: 'web', plan: 'founding', seq: 17, ref: 'txn_x', at: '2026-11-03', to: 'Jane Shooter' };

before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  goodLicence = await signLicence(PAYLOAD, await crypto.subtle.exportKey('jwk', pair.privateKey));
  g.__FL_E2E_LICENCE_KEY__ = { kid: 'unit-test', jwk: publicJwk };
});
after(() => { delete g.__FL_E2E_LICENCE_KEY__; });

async function freshDevice(settings: Partial<AppSettings> = {}) {
  await clearAllData();
  await putOne('meta', { key: 'settings', value: settings });
}

test('appLicenceKeys: with no test constant it IS the built-in list (same object); with one it adds only that kid', () => {
  const saved = g.__FL_E2E_LICENCE_KEY__;
  for (const off of [undefined, null]) {
    g.__FL_E2E_LICENCE_KEY__ = off;
    assert.equal(appLicenceKeys(), LICENCE_KEYS, 'production list must be returned by reference');
  }
  g.__FL_E2E_LICENCE_KEY__ = saved;
  const withTest = appLicenceKeys();
  assert.notEqual(withTest, LICENCE_KEYS);
  assert.deepEqual(Object.keys(withTest).sort(), [...Object.keys(LICENCE_KEYS), 'unit-test'].sort());
  assert.equal(withTest['unit-test'], publicJwk);
});

test('the production key list never holds a test kid (and is never modified by a test key)', () => {
  // No assumption about WHICH real keys exist (the real public key is added at
  // step 4): only that no test-only kid is ever among them.
  for (const kid of Object.keys(LICENCE_KEYS)) {
    assert.ok(!/^(e2e|unit|restore)[-_]?test/i.test(kid) && kid !== 'not-a-known-key', `test kid "${kid}" is in LICENCE_KEYS`);
  }
  assert.equal(LICENCE_KEYS['unit-test'], undefined);
  assert.equal(LICENCE_KEYS['e2e-test'], undefined);
});

test('with the test constant off, a validly signed licence is refused (the production path)', async () => {
  const saved = g.__FL_E2E_LICENCE_KEY__;
  g.__FL_E2E_LICENCE_KEY__ = null;
  await freshDevice();
  const r = await addLicenceText(goodLicence);
  assert.deepEqual(r, { ok: false, reason: 'not-valid' });
  assert.equal((await getSettings<AppSettings>())?.licence, undefined);
  g.__FL_E2E_LICENCE_KEY__ = saved;
});

test('BUY_PAGE_URL is the placeholder buy page', () => {
  assert.equal(BUY_PAGE_URL, 'https://firearmlog.com/buy');
});

test('pasting a valid licence with newlines and spaces around it stores the trimmed text', async () => {
  await freshDevice();
  const r = await addLicenceText(`  \n${goodLicence}\n\n `);
  assert.equal(r.ok, true);
  assert.equal((await getSettings<AppSettings>())?.licence, goodLicence);
  assert.equal(getLicenceStatus().state, 'valid');
});

test('pasting text that is not a valid licence says so and changes nothing', async () => {
  await freshDevice({ theme: 'keep' });
  const before = getLicenceStatus();
  for (const bad of ['', '   ', 'hello', 'FL1.a.b', goodLicence.slice(0, -3) + 'AAA', goodLicence + 'x.y']) {
    const r = await addLicenceText(bad);
    assert.deepEqual(r, { ok: false, reason: 'not-valid' }, JSON.stringify(bad));
  }
  assert.deepEqual(await getSettings<AppSettings>(), { theme: 'keep' });
  assert.deepEqual(getLicenceStatus(), before);
});

test('an invalid paste does not disturb a valid licence already on the device', async () => {
  await freshDevice();
  await addLicenceText(goodLicence);
  await addLicenceText('nonsense');
  assert.equal((await getSettings<AppSettings>())?.licence, goodLicence);
  assert.equal((await refreshLicenceStatus()).state, 'valid');
});

test('refreshLicenceStatus: none, valid, and a stored text that fails is "invalid" and is NOT deleted', async () => {
  await freshDevice();
  assert.equal((await refreshLicenceStatus()).state, 'none');
  await freshDevice({ licence: goodLicence });
  const ok = await refreshLicenceStatus();
  assert.equal(ok.state, 'valid');
  assert.ok(ok.state === 'valid' && ok.payload.to === 'Jane Shooter' && ok.payload.seq === 17);
  await freshDevice({ licence: 'FL1.garbage.garbage' });
  assert.equal((await refreshLicenceStatus()).state, 'invalid');
  assert.equal((await getSettings<AppSettings>())?.licence, 'FL1.garbage.garbage', 'never deleted silently');
});

test('removeLicence takes it off the device and the status goes to none', async () => {
  await freshDevice({ licence: goodLicence, theme: 'keep' });
  await refreshLicenceStatus();
  assert.equal(await removeLicence(), true);
  const s = await getSettings<AppSettings>();
  assert.equal(s?.licence, undefined);
  assert.equal(s?.theme, 'keep');
  assert.equal(getLicenceStatus().state, 'none');
  assert.equal((await refreshLicenceStatus()).state, 'none');
});

// --- the #licence= link ------------------------------------------------------

function fakeWindow(hash: string) {
  const calls: unknown[][] = [];
  return {
    loc: { hash, pathname: '/app/', search: '?a=1' },
    hist: { state: { view: null }, replaceState: (...a: unknown[]) => { calls.push(a); } },
    calls,
  };
}

test('#licence= link: a valid licence is stored and the fragment is removed from the address bar', async () => {
  await freshDevice();
  const w = fakeWindow(`#licence=${goodLicence}`);
  const out = await applyLicenceFragment(w.loc, w.hist as unknown as History);
  assert.equal(out?.kind, 'added');
  assert.equal((await getSettings<AppSettings>())?.licence, goodLicence);
  assert.deepEqual(w.calls, [[{ view: null }, '', '/app/?a=1']], 'replaceState keeps the history state and drops the hash');
});

test('#licence= link: an invalid licence stores nothing and the fragment is still removed', async () => {
  await freshDevice();
  const w = fakeWindow('#licence=FL1.not.valid');
  const out = await applyLicenceFragment(w.loc, w.hist as unknown as History);
  assert.deepEqual(out, { kind: 'invalid' });
  assert.equal((await getSettings<AppSettings>())?.licence, undefined);
  assert.equal(w.calls.length, 1);
});

test('#licence= link: percent-encoded text is decoded; a broken encoding is just an invalid licence', async () => {
  await freshDevice();
  const w = fakeWindow(`#licence=${encodeURIComponent(goodLicence)}`);
  assert.equal((await applyLicenceFragment(w.loc, w.hist as unknown as History))?.kind, 'added');
  const w2 = fakeWindow('#licence=%E0%A4%A');
  assert.deepEqual(await applyLicenceFragment(w2.loc, w2.hist as unknown as History), { kind: 'invalid' });
});

test('any other fragment (or none) is left alone: null, and the address bar is not touched', async () => {
  for (const hash of ['', '#', '#other=1', '#licence', '#LICENCE=x']) {
    const w = fakeWindow(hash);
    assert.equal(await applyLicenceFragment(w.loc, w.hist as unknown as History), null, hash);
    assert.equal(w.calls.length, 0, hash);
  }
});

test('refreshing when nothing changed does not notify subscribers (no needless re-render)', async () => {
  await freshDevice({ licence: goodLicence });
  await refreshLicenceStatus();
  let calls = 0;
  const off = subscribeLicence(() => { calls++; });
  await refreshLicenceStatus();
  await refreshLicenceStatus();
  assert.equal(calls, 0, 'same verdict, same licence: no notice');
  await freshDevice();
  await refreshLicenceStatus();
  assert.equal(calls, 1, 'a real change is still announced');
  await refreshLicenceStatus();
  assert.equal(calls, 1);
  off();
});
